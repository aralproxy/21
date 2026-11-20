/**
 * Aral Neon — panel API routes (mounted under /<PANEL_PATH>/api/).
 * Auth: scrypt password + HMAC-signed cookie session + login throttling.
 */
'use strict';

const crypto = require('crypto');
const Logger = require('../logger');
const { PROTOCOLS, CF_HTTPS_PORTS, normalizeHost, fmtBytes } = require('../constants');
const { parseSize, minutesFrom, expiryFrom } = require('../store');
const nodesLib = require('../nodes');
const { testNodes } = require('../selftest');
const { LinkBuilder } = require('../links');
const { toSvg } = require('../qr');
const { expiryOf } = require('../enforce');

const SESSION_DAYS = 14;
const COOKIE = 'neon_session';

class Api {
  constructor(ctx) {
    this.ctx = ctx; // { cfg, store, engines: { singbox, xray }, traffic, telegram, sysinfo, applyRuntime, activeClients, resolvedHost }
    this.fails = new Map();
  }

  /* ---------------- auth helpers ---------------- */

  hashPw(pw, salt) { return crypto.scryptSync(String(pw), String(salt), 64).toString('hex'); }
  safeEq(a, b) {
    const x = Buffer.from(String(a)), y = Buffer.from(String(b));
    return x.length === y.length && crypto.timingSafeEqual(x, y);
  }
  sign(v) { return crypto.createHmac('sha256', this.ctx.store.data.admin.secret).update(String(v)).digest('hex'); }

  ipOf(req) {
    return String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').split(',')[0].trim();
  }
  blocked(ip) {
    const r = this.fails.get(ip);
    return !!r && r.count >= 8 && Date.now() - r.first < 15 * 60000;
  }
  noteFail(ip) {
    const r = this.fails.get(ip);
    if (!r || Date.now() - r.first > 15 * 60000) this.fails.set(ip, { first: Date.now(), count: 1 });
    else r.count += 1;
  }

  hasSession(req) {
    const admin = this.ctx.store.data.admin;
    if (!admin?.hash || !admin.secret) return false;
    const raw = String(req.headers.cookie || '');
    const found = raw.split(';').map((p) => p.trim().split('=')).find(([n]) => n === COOKIE);
    if (!found) return false;
    const [exp, sig] = String(found[1] || '').split('.');
    if (!exp || !sig || Number(exp) < Date.now()) return false;
    const expect = this.sign(exp);
    return this.safeEq(sig, expect);
  }

  ensureAdmin() {
    // First run: create the admin record so login switches from "setup" to "verify".
    if (!this.ctx.store.data.admin) {
      this.ctx.store.update((d) => {
        d.admin = { user: 'admin', secret: crypto.randomBytes(32).toString('hex'), salt: null, hash: null };
      });
    }
    return this.ctx.store.data.admin;
  }

  /* ---------------- routing ---------------- */

  /** Handle (req, res). Path already stripped of the panel base. */
  async handle(req, res, path, body, url) {
    const send = (code, obj, headers = {}) => {
      const data = typeof obj === 'string' || Buffer.isBuffer(obj) ? obj : JSON.stringify(obj);
      res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
      res.end(data);
    };

    // ---- public: login ----
    if (path === '/api/login' && req.method === 'POST') {
      const admin = this.ensureAdmin();
      const ip = this.ipOf(req);
      if (this.blocked(ip)) return send(429, { ok: false, error: 'too many attempts; try again in a few minutes' });

      const setup = !admin.hash;
      const pw = String(body?.password || '');
      if (setup) {
        if (pw.length < 8) return send(400, { ok: false, error: 'password must be at least 8 characters', setup: true });
        this.ctx.store.update((d) => {
          d.admin.salt = crypto.randomBytes(16).toString('hex');
          d.admin.hash = this.hashPw(pw, d.admin.salt);
        });
        this.setSession(res);
        Logger.ok('Panel password created.');
        return send(200, { ok: true, setup: true });
      }
      if (!this.safeEq(this.hashPw(pw, admin.salt), admin.hash)) {
        this.noteFail(ip);
        return send(401, { ok: false, error: 'wrong password' });
      }
      this.fails.delete(ip);
      this.setSession(res);
      const t = this.ctx.store.data.telegram;
      if (t.enabled && t.events?.login) {
        this.ctx.telegram.send(`🔓 <b>Aral Neon</b>\nSuccessful panel login from <code>${esc(ip)}</code>`).catch(() => {});
      }
      return send(200, { ok: true });
    }

    if (path === '/api/logout' && req.method === 'POST') {
      res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
      return send(200, { ok: true });
    }

    // ---- everything below needs a session ----
    if (!this.hasSession(req)) return send(401, { ok: false, error: 'session required' });

    // ---------- status / health ----------
    if (path === '/api/health' && req.method === 'GET') {
      const d = this.ctx.store.data;
      const host = this.ctx.resolvedHost();
      return send(200, {
        ok: true,
        brand: 'Aral Neon',
        version: this.ctx.cfg.version,
        host,
        port: this.ctx.cfg.publicPort,
        setup: !!d.admin?.hash,
        engines: {
          singbox: !!(this.ctx.engines.singbox && this.ctx.engines.singbox.running()),
          xray: !!(this.ctx.engines.xray && this.ctx.engines.xray.running())
        },
        protocols: PROTOCOLS.map((p) => ({ ...p, enabled: !!d.enable[p.key] })),
        tls: { pcs: require('../cert').certSha256(this.ctx.cfg.paths.certPath) ? 'set' : '' },
        stats: {
          clients: d.clients.length,
          active: d.clients.filter((c) => c.enabled !== false).length,
          nodes: d.nodeset?.nodes?.length || 0
        },
        lang: d.lang, theme: d.theme
      });
    }

    // ---------- dashboard ----------
    if (path === '/api/dashboard' && req.method === 'GET') {
      const d = this.ctx.store.data;
      const traffic = this.ctx.traffic.snapshot();
      const sys = this.ctx.sysinfo.snapshot();
      const totalUsed = d.clients.reduce((s, c) => s + Number(c.usedBytes || 0), 0);
      const totalLimit = d.clients.reduce((s, c) => s + Number(c.limitBytes || 0), 0);
      return send(200, {
        ok: true,
        dials: {
          traffic: { used: totalUsed, limit: totalLimit, label: fmtBytes(totalUsed) },
          cpu: { percent: sys.cpu.percent },
          memory: { percent: sys.memory.percent, usedMB: sys.memory.usedMB, totalMB: sys.memory.totalMB },
          clients: { total: d.clients.length, active: d.clients.filter((c) => c.enabled !== false).length },
          nodes: { total: d.nodeset?.nodes?.length || 0 }
        },
        live: traffic.live,
        history: traffic.history,
        traffic: { day: traffic.day, month: traffic.month, allTime: traffic.allTime },
        uptime: sys.uptime,
        processUptime: sys.processUptime
      });
    }

    // ---------- clients ----------
    if (path === '/api/clients' && req.method === 'GET') {
      const clients = this.ctx.store.data.clients.map((c) => ({ ...c, effectiveExpiry: expiryOf(c) }));
      return send(200, { ok: true, clients });
    }

    if (path === '/api/clients' && req.method === 'POST') {
      const c = this.ctx.store.newClient(body || {});
      await this.ctx.applyRuntime();
      const t = this.ctx.store.data.telegram;
      if (t.enabled && t.events?.quota) {
        this.ctx.telegram.send(`➕ <b>کلاینت جدید</b>\n${esc(c.tag)} · سهمیه: ${c.limitBytes ? fmtBytes(c.limitBytes) : 'نامحدود'}`).catch(() => {});
      }
      return send(200, { ok: true, client: c });
    }

    if (path.startsWith('/api/clients/') && req.method === 'PUT') {
      const id = path.split('/')[3];
      const result = this.ctx.store.update((d) => {
        const c = d.clients.find((x) => x.id === id);
        if (!c) return null;
        const input = body || {};
        if (input.tag !== undefined) c.tag = String(input.tag).trim().slice(0, 48) || c.tag;
        if (input.comment !== undefined) c.comment = String(input.comment).trim().slice(0, 200);
        if (input.limitGB !== undefined) c.limitBytes = parseSize(input.limitGB);
        if (input.startAfterFirstUse !== undefined) c.startAfterFirstUse = Boolean(input.startAfterFirstUse);
        if (input.durationMinutes !== undefined || input.durationHours !== undefined || input.durationDays !== undefined) {
          c.durationMinutes = minutesFrom(input);
        }
        if (input.expiry !== undefined) c.expiry = expiryFrom(input.expiry, input.tzOffset);
        if (input.enabled !== undefined) {
          c.enabled = Boolean(input.enabled);
          c.disabledReason = input.enabled ? null : (c.disabledReason || 'manual');
        }
        if (input.resetTraffic) {
          c.usedBytes = 0;
          c.counterAt = {};
          if (c.disabledReason === 'quota') { c.enabled = true; c.disabledReason = null; }
        }
        c.updatedAt = new Date().toISOString();
        return c;
      });
      if (!result) return send(404, { ok: false, error: 'no such client' });
      await this.ctx.applyRuntime();
      return send(200, { ok: true, client: { ...result, effectiveExpiry: expiryOf(result) } });
    }

    if (path.startsWith('/api/clients/') && req.method === 'DELETE') {
      const id = path.split('/')[3];
      const before = this.ctx.store.data.clients.length;
      this.ctx.store.update((d) => { d.clients = d.clients.filter((c) => c.id !== id); });
      if (this.ctx.store.data.clients.length === before) return send(404, { ok: false, error: 'no such client' });
      await this.ctx.applyRuntime();
      return send(200, { ok: true });
    }

    if (path.startsWith('/api/clients/') && path.endsWith('/reset') && req.method === 'POST') {
      const id = path.split('/')[3];
      const result = this.ctx.store.update((d) => {
        const c = d.clients.find((x) => x.id === id);
        if (!c) return null;
        c.usedBytes = 0;
        c.counterAt = {};
        if (c.disabledReason === 'quota') { c.enabled = true; c.disabledReason = null; }
        c.updatedAt = new Date().toISOString();
        return c;
      });
      if (!result) return send(404, { ok: false, error: 'no such client' });
      await this.ctx.applyRuntime();
      return send(200, { ok: true, client: result });
    }

    if (path.startsWith('/api/clients/') && path.endsWith('/links') && req.method === 'GET') {
      const id = path.split('/')[3];
      const c = this.ctx.store.findClient(id);
      if (!c) return send(404, { ok: false, error: 'no such client' });
      const builder = new LinkBuilder(this.ctx.cfg, this.ctx.store, this.ctx.resolvedHost());
      const nodes = builder.nodesFor(c.uuid, c.tag);
      return send(200, {
        ok: true,
        client: c,
        links: nodes.map((n) => ({ name: n.name, type: n.type, uri: n.uri })),
        nodeset: builder.nodesetLinks(c).map((n) => ({ name: n.name, uri: n.uri })),
        qr: toSvg(nodes[0]?.uri || '', { scale: 4, quiet: 3, dark: '#000', light: '#fff' })
      });
    }

    // ---------- node generator ----------
    if (path === '/api/nodes/generate' && req.method === 'POST') {
      const d = this.ctx.store.data;
      const domain = d.domain.node;
      if (!domain) return send(400, { ok: false, error: 'verify a Cloudflare domain first' });
      try {
        const collected = await nodesLib.collectAddresses(domain, d.nodesSettings);
        if (collected.warning === 'dns-failed') {
          return send(400, { ok: false, error: `could not resolve ${domain} — every node would share one address` });
        }
        const ports = nodesLib.usablePorts(d.nodesSettings, d.domain.proxied);
        const built = nodesLib.generate({ domain, settings: { ...d.nodesSettings, httpsPorts: ports.https }, addresses: collected.addresses });
        if (!built.nodes.length) return send(400, { ok: false, error: 'no nodes: check ports and addresses' });

        const path = '/' + crypto.randomBytes(9).toString('base64url');
        this.ctx.store.update((s) => {
          s.nodeset = {
            id: crypto.randomUUID(),
            name: s.nodeset?.name || 'node-set',
            network: 'ws',
            path,
            nodes: built.nodes,
            summary: nodesLib.summarise(built.nodes),
            truncated: built.truncated,
            createdAt: new Date().toISOString()
          };
        });
        await this.ctx.applyRuntime();
        return send(200, {
          ok: true,
          summary: nodesLib.summarise(built.nodes),
          truncated: built.truncated,
          addresses: collected.addresses.length
        });
      } catch (err) {
        return send(500, { ok: false, error: `generation failed: ${err.message}` });
      }
    }

    if (path === '/api/nodes/delete' && req.method === 'POST') {
      if (!this.ctx.store.data.nodeset) return send(400, { ok: false, error: 'nothing to delete' });
      this.ctx.store.update((d) => { d.nodeset = null; });
      await this.ctx.applyRuntime();
      return send(200, { ok: true, clientsKept: this.ctx.store.data.clients.length });
    }

    if (path === '/api/nodes/rename' && req.method === 'POST') {
      const name = String(body?.name || '').trim().slice(0, 48);
      if (!name) return send(400, { ok: false, error: 'name cannot be empty' });
      if (!this.ctx.store.data.nodeset) return send(400, { ok: false, error: 'no node set' });
      this.ctx.store.update((d) => { d.nodeset.name = name; });
      return send(200, { ok: true, name });
    }

    if (path === '/api/nodes/selftest' && req.method === 'POST') {
      const ns = this.ctx.store.data.nodeset;
      if (!ns?.nodes?.length) return send(400, { ok: false, error: 'no nodes generated yet' });
      const result = await testNodes(ns.nodes, 36);
      return send(200, { ok: true, ...result });
    }

    if (path === '/api/nodes' && req.method === 'GET') {
      const ns = this.ctx.store.data.nodeset;
      const d = this.ctx.store.data;
      return send(200, {
        ok: true,
        nodeset: ns ? { name: ns.name, path: ns.path, network: ns.network, summary: ns.summary, createdAt: ns.createdAt, nodes: ns.nodes } : null,
        settings: d.nodesSettings,
        domain: d.domain
      });
    }

    if (path === '/api/nodes/settings' && req.method === 'POST') {
      const patch = body || {};
      this.ctx.store.update((d) => {
        const s = d.nodesSettings;
        if (Array.isArray(patch.httpsPorts)) s.httpsPorts = patch.httpsPorts.map(Number).filter((p) => CF_HTTPS_PORTS.includes(p));
        if (typeof patch.cleanIPs === 'string' || Array.isArray(patch.cleanIPs)) {
          s.cleanIPs = nodesLib.parseAddressList(Array.isArray(patch.cleanIPs) ? patch.cleanIPs.join('\n') : patch.cleanIPs);
        }
        for (const key of ['fingerprint', 'prefix']) {
          if (typeof patch[key] === 'string') s[key] = patch[key].trim();
        }
        if (typeof patch.alpn === 'string') s.alpn = /^http\/1\.1$/.test(patch.alpn.trim()) ? patch.alpn.trim() : 'http/1.1';
        if (typeof patch.includeIPv6 === 'boolean') s.includeIPv6 = patch.includeIPv6;
        if (patch.maxNodes !== undefined) s.maxNodes = Math.max(1, Math.min(500, Number(patch.maxNodes) || 150));
        return s;
      });
      return send(200, { ok: true, settings: this.ctx.store.data.nodesSettings });
    }

    if (path === '/api/domain' && req.method === 'POST') {
      const raw = normalizeHost(String(body?.domain || ''));
      if (!raw || !raw.includes('.')) return send(400, { ok: false, error: 'that does not look like a domain' });
      const resolved = await nodesLib.resolveDomain(raw, {});
      const proxied = resolved.v4.length > 1; // CF proxies fan out over multiple edges
      this.ctx.store.update((d) => {
        d.domain = { node: raw, verifiedAt: new Date().toISOString(), proxied };
      });
      this.ctx.cfg.domain = raw;
      return send(200, { ok: true, domain: raw, proxied, addresses: resolved.v4.length });
    }

    // ---------- core inbounds ----------
    if (path === '/api/core' && req.method === 'GET') {
      return send(200, { ok: true, inbounds: this.ctx.store.data.coreInbounds });
    }

    if (path === '/api/core' && req.method === 'POST') {
      if (this.ctx.store.data.coreInbounds.length >= 4) {
        return send(400, { ok: false, error: 'core inbound limit reached (max 4)' });
      }
      const input = body || {};
      const proto = ['vless', 'vmess', 'trojan'].includes(input.protocol) ? input.protocol : 'vless';
      const network = ['ws', 'grpc'].includes(input.network) ? input.network : 'ws';
      const id = crypto.randomBytes(4).toString('hex');
      const ib = {
        id,
        remark: String(input.remark || '').trim().slice(0, 48) || `core-${id}`,
        protocol: proto,
        network,
        path: network === 'ws' ? ('/' + crypto.randomBytes(6).toString('base64url')) : ('svc-' + crypto.randomBytes(6).toString('hex')),
        listen: '127.0.0.1',
        enabled: true,
        createdAt: new Date().toISOString()
      };
      this.ctx.store.update((d) => { d.coreInbounds.push(ib); });
      await this.ctx.applyRuntime();
      return send(200, { ok: true, inbound: ib });
    }

    if (path.startsWith('/api/core/') && req.method === 'PUT') {
      const id = path.split('/')[3];
      const result = this.ctx.store.update((d) => {
        const ib = d.coreInbounds.find((x) => x.id === id);
        if (!ib) return null;
        if (body?.remark !== undefined) ib.remark = String(body.remark).trim().slice(0, 48) || ib.remark;
        if (body?.enabled !== undefined) ib.enabled = Boolean(body.enabled);
        return ib;
      });
      if (!result) return send(404, { ok: false, error: 'no such inbound' });
      await this.ctx.applyRuntime();
      return send(200, { ok: true, inbound: result });
    }

    if (path.startsWith('/api/core/') && req.method === 'DELETE') {
      const id = path.split('/')[3];
      const before = this.ctx.store.data.coreInbounds.length;
      this.ctx.store.update((d) => { d.coreInbounds = d.coreInbounds.filter((x) => x.id !== id); });
      if (this.ctx.store.data.coreInbounds.length === before) return send(404, { ok: false, error: 'no such inbound' });
      await this.ctx.applyRuntime();
      return send(200, { ok: true });
    }

    // ---------- settings ----------
    if (path === '/api/settings/protocols' && req.method === 'POST') {
      const enable = body?.enable || {};
      this.ctx.store.update((d) => {
        for (const p of PROTOCOLS) {
          if (enable[p.key] !== undefined) d.enable[p.key] = Boolean(enable[p.key]);
        }
      });
      await this.ctx.applyRuntime();
      return send(200, { ok: true, enable: this.ctx.store.data.enable });
    }

    if (path === '/api/settings/password' && req.method === 'POST') {
      const pw = String(body?.password || '');
      if (pw.length < 8) return send(400, { ok: false, error: 'password must be at least 8 characters' });
      this.ctx.store.update((d) => {
        d.admin.salt = crypto.randomBytes(16).toString('hex');
        d.admin.hash = this.hashPw(pw, d.admin.salt);
        d.admin.secret = crypto.randomBytes(32).toString('hex'); // invalidate old sessions
      });
      this.setSession(res);
      return send(200, { ok: true });
    }

    if (path === '/api/settings/prefs' && req.method === 'POST') {
      this.ctx.store.update((d) => {
        if (body?.lang === 'fa' || body?.lang === 'en') d.lang = body.lang;
        if (body?.theme === 'dark' || body?.theme === 'light') d.theme = body.theme;
      });
      return send(200, { ok: true, lang: this.ctx.store.data.lang, theme: this.ctx.store.data.theme });
    }

    // ---------- telegram ----------
    if (path === '/api/telegram' && req.method === 'GET') {
      const t = this.ctx.store.data.telegram;
      return send(200, { ok: true, config: { ...t, botToken: undefined, hasToken: !!t.botToken } });
    }

    if (path === '/api/telegram' && req.method === 'POST') {
      const patch = body || {};
      if (patch.verify) {
        const token = String(patch.botToken || '').trim();
        const chatId = String(patch.chatId || '').trim();
        const result = await this.ctx.telegram.verify(token, chatId);
        if (result.ok) {
          this.ctx.store.update((d) => {
            d.telegram.botToken = token;
            d.telegram.chatId = chatId;
            d.telegram.enabled = true;
          });
        }
        return send(result.ok ? 200 : 400, { ...result, bot: result.bot });
      }
      this.ctx.store.update((d) => {
        if (patch.enabled !== undefined) d.telegram.enabled = Boolean(patch.enabled);
        if (patch.chatId !== undefined) d.telegram.chatId = String(patch.chatId).trim();
        if (patch.sendBackup !== undefined) d.telegram.sendBackup = Boolean(patch.sendBackup);
        if (patch.thresholds) {
          d.telegram.thresholds.cpu = clamp(patch.thresholds.cpu, d.telegram.thresholds.cpu);
          d.telegram.thresholds.memory = clamp(patch.thresholds.memory, d.telegram.thresholds.memory);
        }
        if (patch.events) d.telegram.events = { ...d.telegram.events, ...patch.events };
        if (patch.botToken !== undefined && patch.botToken !== '') d.telegram.botToken = String(patch.botToken).trim();
      });
      return send(200, { ok: true });
    }

    if (path === '/api/telegram/test' && req.method === 'POST') {
      const r = await this.ctx.telegram.send('✨ <b>Aral Neon</b> — test message');
      return r.ok ? send(200, { ok: true }) : send(400, { ok: false, error: r.message });
    }

    if (path === '/api/telegram/backup' && req.method === 'POST') {
      const r = await this.ctx.telegram.backupNow();
      return r.ok ? send(200, { ok: true }) : send(400, { ok: false, error: r.message });
    }

    // ---------- backup / restore ----------
    if (path === '/api/backup' && req.method === 'GET') {
      const data = this.ctx.store.exportBackup();
      const safe = { ...data, telegram: { ...data.telegram, botToken: undefined } };
      const json = JSON.stringify(safe, null, 2);
      return send(200, json, {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="aral-neon-backup-${new Date().toISOString().slice(0, 10)}.json"`
      });
    }

    if (path === '/api/backup' && req.method === 'POST') {
      try {
        const restored = this.ctx.store.restoreBackup(body);
        await this.ctx.applyRuntime();
        this.ctx.store.update((d) => { d.meta.lastBackupAt = new Date().toISOString(); });
        return send(200, { ok: true, ...restored });
      } catch (err) {
        return send(400, { ok: false, error: err.message });
      }
    }

    // ---------- system ----------
    if (path === '/api/system' && req.method === 'GET') {
      return send(200, { ok: true, sys: this.ctx.sysinfo.snapshot(), traffic: this.ctx.traffic.snapshot() });
    }

    return send(404, { ok: false, error: 'not found' });
  }

  setSession(res) {
    const exp = String(Date.now() + SESSION_DAYS * 86400000);
    const val = exp + '.' + this.sign(exp);
    res.setHeader('Set-Cookie', `${COOKIE}=${val}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}`);
  }
}

function clamp(v, fallback) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(1, Math.min(100, Math.round(n)));
}
function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;'); }

module.exports = { Api };
