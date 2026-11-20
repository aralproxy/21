/** Aral Neon — live system stats (CPU, memory, uptime) from /proc and os module. */
'use strict';

const os = require('os');
const fs = require('fs');

let lastCpu = null;

/** CPU % over the interval since the previous call (100 ms floor). */
function cpuPercent() {
  try {
    const cpus = os.cpus();
    let idle = 0, total = 0;
    for (const c of cpus) {
      idle += c.times.idle;
      total += c.times.idle + c.times.user + c.times.nice + c.times.sys + c.times.irq;
    }
    const now = { idle, total, t: Date.now() };
    if (!lastCpu) { lastCpu = now; return 0; }
    const dIdle = now.idle - lastCpu.idle;
    const dTotal = now.total - lastCpu.total;
    lastCpu = now;
    if (dTotal <= 0) return 0;
    return Math.max(0, Math.min(100, Math.round((1 - dIdle / dTotal) * 100)));
  } catch {
    return 0;
  }
}

function memory() {
  const total = os.totalmem();
  let free = os.freemem();
  // On Linux, available memory (in /proc/meminfo) is the honest number.
  try {
    const mi = fs.readFileSync('/proc/meminfo', 'utf8');
    const m = /MemAvailable:\s+(\d+)\s+kB/.exec(mi);
    if (m) free = Number(m[1]) * 1024;
  } catch {}
  return { total, free, used: total - free, percent: total ? Math.round((total - free) / total * 100) : 0 };
}

function snapshot() {
  const mem = memory();
  const load = os.loadavg();
  return {
    ok: true,
    now: new Date().toISOString(),
    platform: `${os.type()} ${os.arch()}`,
    hostname: os.hostname(),
    uptime: os.uptime(),
    processUptime: process.uptime(),
    cpu: { percent: cpuPercent(), cores: os.cpus().length, model: (os.cpus()[0] || {}).model || '', load: load.map((x) => Number(x.toFixed(2))) },
    memory: { ...mem, totalMB: Math.round(mem.total / 1048576), usedMB: Math.round(mem.used / 1048576) },
    node: process.version
  };
}

module.exports = { snapshot, cpuPercent, memory };
