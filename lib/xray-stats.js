/**
 * Aral Neon — per-user traffic counters from Xray's Stats Service.
 * Polls `xray api statsquery` over the local dokodemo-door API port.
 * Xray keeps counters in memory, so they reset on restart; the enforcement
 * loop therefore grows each client's stored total by the DELTA since the
 * last read (a counter that went backwards = restart = current value is new traffic).
 */
'use strict';

const { execFile } = require('child_process');

function run(bin, args) {
  return new Promise((resolve) => {
    execFile(bin, args, { timeout: 3000, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) return resolve({ ok: false, error: (stderr || err.message).trim() });
      resolve({ ok: true, stdout });
    });
  });
}

/** Returns { 'nodeset.c1a2b3': { up, down }, ... } as reported right now. */
async function readCounters(bin, apiPort) {
  const result = await run(bin, ['api', 'statsquery', `--server=127.0.0.1:${apiPort}`, 'user>>>']);
  if (!result.ok) return { ok: false, error: result.error, counters: {} };
  let parsed;
  try {
    parsed = JSON.parse(result.stdout);
  } catch {
    return { ok: false, error: 'could not parse stats output', counters: {} };
  }
  const counters = {};
  for (const entry of parsed.stat || []) {
    // name: user>>>nodeset.c1a2b3>>>traffic>>>downlink
    const parts = String(entry.name || '').split('>>>');
    if (parts.length < 4 || parts[0] !== 'user') continue;
    const email = parts[1];
    const direction = parts[3];
    const value = Number(entry.value || 0);
    if (!counters[email]) counters[email] = { up: 0, down: 0 };
    if (direction === 'uplink') counters[email].up = value;
    if (direction === 'downlink') counters[email].down = value;
  }
  return { ok: true, counters };
}

/**
 * Grow each client's stored total by whatever Xray counted since the last look.
 * counterAt is a map { email: lastSeenTotal } so several inbounds track separately.
 */
function applyCounters(clients, counters, keyFor) {
  let changed = false;
  for (const client of clients) {
    const key = keyFor(client);
    const now = counters[key];
    if (!now) continue;
    const total = now.up + now.down;
    const previous = Number(client.counterAt?.[key] || 0);
    const delta = total < previous ? total : total - previous;
    if (delta > 0) {
      client.usedBytes = Number(client.usedBytes || 0) + delta;
      if (!client.firstUseAt) client.firstUseAt = new Date().toISOString();
      changed = true;
    }
    if (total !== previous) {
      client.counterAt = client.counterAt || {};
      client.counterAt[key] = total;
      changed = true;
    }
  }
  return changed;
}

module.exports = { readCounters, applyCounters };
