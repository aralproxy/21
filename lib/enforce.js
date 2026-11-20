/**
 * Aral Neon — live quota & expiry enforcement (RailPanel model).
 * Every 30 s: poll Xray counters → grow usedBytes → evaluate limits →
 * rebuild engines ONLY when the set of usable clients actually changed
 * (counting traffic must not restart the tunnels every half minute).
 */
'use strict';

const Logger = require('./logger');
const { readCounters, applyCounters } = require('./xray-stats');

const INTERVAL_MS = 30_000;
const REASONS = { QUOTA: 'quota', EXPIRED: 'expired' };

function durationMinutesOf(client) {
  if (client.durationMinutes !== undefined && client.durationMinutes !== null) {
    return Math.max(0, Math.round(Number(client.durationMinutes) || 0));
  }
  return Math.max(0, Math.round((client.durationDays || 0) * 1440));
}

/** Effective expiry: "start after first use" means the clock starts at firstUseAt. */
function expiryOf(client) {
  if (client.startAfterFirstUse) {
    const minutes = durationMinutesOf(client);
    if (!client.firstUseAt || !minutes) return null;
    return new Date(new Date(client.firstUseAt).getTime() + minutes * 60000).toISOString();
  }
  return client.expiry || null;
}

/** Pure evaluation: marks over-quota / expired clients disabled, in-limit ones enabled. */
function evaluate(clients, now = new Date()) {
  let changed = false;
  const events = []; // { type: 'quota'|'expiry', client }

  for (const client of clients) {
    const limit = Number(client.limitBytes || 0);
    const used = Number(client.usedBytes || 0);
    const expiry = expiryOf(client);

    const overQuota = limit > 0 && used >= limit;
    const pastDate = expiry && new Date(expiry).getTime() <= now.getTime();

    if (!overQuota && !pastDate) {
      if (client.enabled === false && client.disabledReason) {
        client.enabled = true;
        client.disabledReason = null;
        changed = true;
      }
      continue;
    }

    const reason = overQuota ? REASONS.QUOTA : REASONS.EXPIRED;
    if (client.enabled !== false || client.disabledReason !== reason) {
      const wasActive = client.enabled !== false;
      client.enabled = false;
      client.disabledReason = reason;
      client.disabledAt = now.toISOString();
      if (wasActive) events.push({ type: reason, client: { ...client } });
      changed = true;
    }
  }
  return { changed, events };
}

let timer = null;
let ctx = null; // { store, xrayEngine, notify }

async function tick() {
  const data = ctx.store.data;
  const clients = data.clients || [];
  if (!clients.length) return;

  const events = [];
  let statsOk = false;

  // 1. Poll counters (one read covers every inbound: nodeset + core + xhttp)
  if (ctx.xrayEngine && ctx.xrayEngine.running() && ctx.xrayEngine.apiPort) {
    const { ok, counters } = await readCounters(ctx.xrayEngine.paths.xrayBin, ctx.xrayEngine.apiPort);
    if (ok) {
      statsOk = true;
      ctx.store.update((d) => {
        applyCounters(d.clients, counters, (c) => `nodeset.${c.id}`);
        applyCounters(d.clients, counters, (c) => `xhttp.${c.id}`);
        for (const ib of d.coreInbounds) applyCounters(d.clients, counters, (c) => `${ib.id}.${c.id}`);
      });
    }
  }

  // 2. Evaluate limits
  const result = ctx.store.update((d) => evaluate(d.clients));
  events.push(...result.events);

  // 3. Rebuild engines only when the active client set changed
  const after = ctx.store.data;
  const activeCount = after.clients.filter((c) => c.enabled !== false).length;
  if (activeCount !== tick.lastActive) {
    const changed = tick.lastActive !== null;
    tick.lastActive = activeCount;
    if (changed && ctx.applyRuntime) {
      try { await ctx.applyRuntime(); } catch (err) { Logger.error(`enforce apply: ${err.message}`); }
    }
  }

  // 4. Alerts (quota / expiry)
  for (const ev of events) {
    const t = ctx.store.data.telegram;
    if (t.enabled && t.events && t.events[ev.type] && ctx.notify) {
      const why = ev.type === 'quota' ? 'سهمیه ترافیک تمام شد' : 'تاریخ انقضا گذشت';
      ctx.notify(`⛔️ <b>${ev.client.tag}</b>\n${why} — کلاینت غیرفعال شد.`);
    }
  }
}
tick.lastActive = null;

function start(context) {
  if (timer) return;
  ctx = context;
  const initial = ctx.store.data.clients.filter((c) => c.enabled !== false).length;
  tick.lastActive = initial;
  timer = setInterval(() => { tick().catch((err) => Logger.error('enforcement: ' + err.message)); }, INTERVAL_MS);
  timer.unref?.();
}

function stop() {
  clearInterval(timer);
  timer = null;
}

module.exports = { start, stop, tick, evaluate, expiryOf, durationMinutesOf, REASONS };
