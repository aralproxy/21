/**
 * Aral Neon — persistent state store (neon-data/panel.json).
 * Atomic writes (tmp + rename); a corrupt file is rescued, never overwritten silently.
 * Holds: admin credentials, clients (all inbounds), node set, protocol toggles,
 * telegram config, system settings. Runtime-only values (engine pids, ports) live elsewhere.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { randomBytes, randomUUID } = require('crypto');
const { DEFAULT_ENABLE } = require('./constants');

const SCHEMA_VERSION = 1;

function blank() {
  return {
    version: SCHEMA_VERSION,
    createdAt: new Date().toISOString(),
    admin: null,                    // { user, salt, hash } — created on first login
    // Every client, from every inbound (core or nodeset). One list keeps
    // enforcement and subscriptions simple; the inbound owns only routing.
    clients: [],
    // Core inbounds: manual, at most 4, each { id, remark, protocol, network, port, listen, enabled }
    coreInbounds: [],
    // Generated Cloudflare node set: { id, name, network, path, nodes[], summary, createdAt }
    nodeset: null,
    nodesSettings: {
      cleanIPs: [],
      includeIPv6: false,
      httpsPorts: [443],            // start with 443 only: many mobile carriers block the rest
      fingerprint: 'chrome',
      alpn: 'http/1.1',
      prefix: 'Neon',
      maxNodes: 150
    },
    domain: { node: '', verifiedAt: null, proxied: false },
    enable: { ...DEFAULT_ENABLE },
    ssPassword: null,               // generated on first boot if absent
    telegram: {
      enabled: false, botToken: null, chatId: null,
      sendBackup: true,
      thresholds: { cpu: 85, memory: 85 },
      events: { quota: true, expiry: true, login: true, engineDown: true, system: true }
    },
    theme: 'dark',
    lang: 'fa',
    meta: { lastBackupAt: null }
  };
}

class Store {
  constructor(cfg) {
    this.file = cfg.paths.storeFile;
    this.data = null;
    this.load();
  }

  load() {
    if (!fs.existsSync(this.file)) {
      this.data = blank();
      this.data.ssPassword = randomBytes(16).toString('base64url');
      this.persist();
      return this.data;
    }
    try {
      this.data = this.migrate(JSON.parse(fs.readFileSync(this.file, 'utf8')));
    } catch (err) {
      const rescued = this.file + '.corrupt-' + Date.now();
      try { fs.renameSync(this.file, rescued); } catch {}
      console.error(`[store] panel.json unreadable (${err.message}); moved to ${rescued}`);
      this.data = blank();
      this.persist();
    }
    return this.data;
  }

  /** Fill missing sections from a blank record without dropping stored values. */
  migrate(old) {
    const fresh = blank();
    const d = { ...fresh, ...old };
    d.nodesSettings = { ...fresh.nodesSettings, ...(old.nodesSettings || {}) };
    d.domain = { ...fresh.domain, ...(old.domain || {}) };
    d.telegram = { ...fresh.telegram, ...(old.telegram || {}) };
    d.telegram.thresholds = { ...fresh.telegram.thresholds, ...(old.telegram?.thresholds || {}) };
    d.telegram.events = { ...fresh.telegram.events, ...(old.telegram?.events || {}) };
    d.enable = { ...fresh.enable, ...(old.enable || {}) };
    d.coreInbounds = Array.isArray(old.coreInbounds) ? old.coreInbounds : [];
    d.clients = Array.isArray(old.clients) ? old.clients : [];
    d.version = SCHEMA_VERSION;
    if (!d.ssPassword) d.ssPassword = randomBytes(16).toString('base64url');
    return d;
  }

  persist() {
    const tmp = this.file + '.tmp';
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, this.file); // atomic: never a half-written store
  }

  update(fn) {
    const r = fn(this.data);
    this.persist();
    return r;
  }

  /* ---------------- clients ---------------- */

  findClient(id) { return this.data.clients.find((c) => c.id === id) || null; }
  findBySubId(subId) { return this.data.clients.find((c) => c.subId === subId) || null; }

  newClient(input = {}) {
    const c = {
      id: randomBytes(6).toString('hex'),
      uuid: randomUUID(),
      tag: String(input.tag || '').trim().slice(0, 48) || 'client',
      comment: String(input.comment || '').trim().slice(0, 200),
      limitBytes: parseSize(input.limitGB),
      expiry: expiryFrom(input.expiry, input.tzOffset),
      durationMinutes: minutesFrom(input),
      startAfterFirstUse: Boolean(input.startAfterFirstUse),
      enabled: true,
      usedBytes: 0,
      counterAt: {},
      firstUseAt: null,
      disabledReason: null,
      subId: randomBytes(12).toString('base64url'),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    this.data.clients.push(c);
    this.persist();
    return c;
  }

  /* ---------------- backup ---------------- */

  exportBackup() {
    return JSON.parse(JSON.stringify(this.data));
  }

  /** Replace state from a backup; returns count of restored records. */
  restoreBackup(raw) {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('expected a JSON object');
    if (!Array.isArray(parsed.clients)) throw new Error('backup has no clients list');
    this.data = this.migrate(parsed);
    this.persist();
    return { clients: this.data.clients.length, nodeset: !!this.data.nodeset };
  }
}

/* "50 GB", "20MB", 2 (plain = GB), "0.5t" — all accepted. */
function parseSize(input) {
  if (input === null || input === undefined || input === '') return 0;
  const text = String(input).trim().toLowerCase().replace(/\s+/g, '');
  const m = text.match(/^([0-9]*\.?[0-9]+)(kb|k|mb|m|gb|g|tb|t)?$/);
  if (!m) return 0;
  const value = Number(m[1]);
  if (!Number.isFinite(value) || value < 0) return 0;
  const scale = { k: 1024, kb: 1024, m: 1024 ** 2, mb: 1024 ** 2, g: 1024 ** 3, gb: 1024 ** 3, t: 1024 ** 4, tb: 1024 ** 4 };
  return Math.round(value * scale[m[2] || 'gb']);
}

/** Duration: one number + optional unit. Kept in whole minutes. */
function minutesFrom(input) {
  if (!input) return 0;
  for (const [key, mult] of [['durationMinutes', 1], ['durationHours', 60], ['durationDays', 1440]]) {
    if (input[key] !== undefined) return Math.max(0, Math.round((Number(input[key]) || 0) * mult));
  }
  return 0;
}

/** A date picker picks a day; that day means service through its end, in the picker's own zone. */
function expiryFrom(value, offsetMinutes = 0) {
  if (!value) return null;
  const text = String(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    const parsed = new Date(text);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }
  const offset = Number.isFinite(Number(offsetMinutes)) ? Number(offsetMinutes) : 0;
  return new Date(new Date(`${text}T23:59:59.999Z`).getTime() - offset * 60000).toISOString();
}

module.exports = { Store, parseSize, minutesFrom, expiryFrom, SCHEMA_VERSION };
