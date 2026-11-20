/**
 * Aral Neon — per-protocol traffic accounting (neon-data/traffic.json).
 * The TCP router meters every proxied byte pair; dials and charts read the snapshot.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const KEYS = ['VLESS-WS', 'VMess-WS', 'Trojan-WS', 'VLESS-XHTTP', 'VLESS-HTTPUpgrade', 'VMess-HTTPUpgrade', 'Trojan-HTTPUpgrade', 'VLESS-gRPC', 'Shadowsocks-WS', 'NodeSet', 'Other'];
const utcDay = (d = new Date()) => d.toISOString().slice(0, 10);
const utcMonth = (d = new Date()) => d.toISOString().slice(0, 7);

const Traffic = (() => {
  let file = null;
  let st = null;
  let dirty = false;
  let lastSave = 0;
  let writable = false;
  const live = { up: 0, down: 0 };
  const history = [];         // [{ t, upBps, downBps }] — rolling 120 samples ≈ 2 min at 1 Hz
  const samples = [];
  const active = {};

  const fresh = () => ({ v: 1, since: new Date().toISOString(), allTime: {}, day: { key: utcDay(), per: {} }, month: { key: utcMonth(), per: {} } });
  const norm = (label) => (KEYS.includes(label) ? label : 'Other');
  const bump = (bucket, k, up, down) => { const e = bucket[k] || (bucket[k] = { up: 0, down: 0 }); e.up += up; e.down += down; };
  const sum = (per) => {
    let up = 0, down = 0;
    for (const k of Object.keys(per || {})) { up += per[k].up; down += per[k].down; }
    return { up, down, total: up + down };
  };

  function roll() {
    if (!st) return;
    const d = utcDay(), m = utcMonth();
    if (st.day.key !== d) { st.day = { key: d, per: {} }; dirty = true; }
    if (st.month.key !== m) { st.month = { key: m, per: {} }; dirty = true; }
  }

  function save() {
    if (!file || !st) return;
    try {
      const tmp = file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(st));
      fs.renameSync(tmp, file);
      dirty = false;
      lastSave = Date.now();
      writable = true;
    } catch { writable = false; }
  }

  function tick() {
    const now = Date.now();
    samples.push({ t: now, up: live.up, down: live.down });
    if (samples.length > 6) samples.shift();
    // 1 Hz rate estimate over the sample window
    if (samples.length >= 2) {
      const a = samples[0], b = samples[samples.length - 1];
      const dt = Math.max(1, (b.t - a.t) / 1000);
      const upBps = Math.max(0, (b.up - a.up) / dt);
      const downBps = Math.max(0, (b.down - a.down) / dt);
      history.push({ t: now, upBps: Math.round(upBps), downBps: Math.round(downBps) });
      if (history.length > 120) history.shift();
    }
    roll();
    if (dirty && now - lastSave > 30000) save();
  }

  return {
    KEYS,
    init(dataDir) {
      file = path.join(dataDir, 'traffic.json');
      try {
        st = JSON.parse(fs.readFileSync(file, 'utf8'));
        if (!st || st.v !== 1) st = fresh();
      } catch { st = fresh(); }
      st.allTime = st.allTime || {};
      st.day = st.day || { key: utcDay(), per: {} };
      st.month = st.month || { key: utcMonth(), per: {} };
      roll();
      save();
      const t = setInterval(tick, 1000);
      if (t.unref) t.unref();
      process.once('exit', () => { try { save(); } catch {} });
    },
    add(label, up, down) {
      if (!st || (!up && !down)) return;
      const k = norm(label);
      bump(st.allTime, k, up, down);
      bump(st.day.per, k, up, down);
      bump(st.month.per, k, up, down);
      live.up += up;
      live.down += down;
      dirty = true;
    },
    /** Count bytes of a proxied duplex pair: client→backend = upload, backend→client = download. */
    meter(label, client, backend) {
      const k = norm(label);
      active[k] = (active[k] || 0) + 1;
      let done = false;
      const end = () => { if (!done) { done = true; active[k] = Math.max(0, (active[k] || 1) - 1); } };
      client.on('data', (b) => Traffic.add(k, b.length, 0));
      backend.on('data', (b) => Traffic.add(k, 0, b.length));
      client.once('close', end);
      backend.once('close', end);
    },
    open(label) {
      const k = norm(label);
      active[k] = (active[k] || 0) + 1;
      let done = false;
      return () => { if (!done) { done = true; active[k] = Math.max(0, (active[k] || 1) - 1); } };
    },
    save,
    reset() { st = fresh(); save(); },
    snapshot() {
      if (!st) return { ok: false, error: 'not started' };
      roll();
      const day = sum(st.day.per);
      const month = sum(st.month.per);
      return {
        ok: true,
        keys: KEYS,
        now: new Date().toISOString(),
        since: st.since,
        persisted: writable,
        day: { key: st.day.key, per: st.day.per, ...day },
        month: { key: st.month.key, per: st.month.per, ...month },
        allTime: { per: st.allTime, ...sum(st.allTime) },
        live: history.length ? { upBps: history[history.length - 1].upBps, downBps: history[history.length - 1].downBps } : { upBps: 0, downBps: 0 },
        history,
        active: { ...active }
      };
    }
  };
})();

module.exports = Traffic;
