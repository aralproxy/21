/**
 * Aral Neon — Xray-core engine.
 * Hosts VLESS-XHTTP, Shadowsocks-WS, the Cloudflare NodeSet inbound (WS)
 * and up to 4 manual Core Inbounds (user-chosen protocol/network).
 * Exposes the gRPC Stats Service on 127.0.0.1 so per-user traffic counters
 * can be polled (the basis for live quota enforcement).
 */
'use strict';

const fs = require('fs');
const net = require('net');
const { spawn, spawnSync } = require('child_process');
const Logger = require('../logger');
const { PATHS } = require('../constants');

const POLICY_LEVEL = 0;

class XrayEngine {
  constructor(cfg, store, ports, activeClients, nodesetInbound) {
    this.cfg = cfg;
    this.paths = cfg.paths;
    this.store = store;
    this.ports = ports;                       // { xhttp, ssWs, nodeset, core: {<inboundId>: port} }
    this.activeClients = activeClients;       // () => enabled clients
    this.nodesetInbound = nodesetInbound;     // () => nodeset inbound object or null
    this.process = null;
    this.apiPort = null;
    this._stopping = false;
    this._restarts = 0;
    this.onDown = null;
  }

  /** Email convention: "<inboundId>.<clientId>" — used by stats and enforcement. */
  static emailFor(inboundId, clientId) { return `${inboundId}.${clientId}`; }

  _clientsFor(inboundId) {
    // All enabled clients ride every inbound (single credential set model).
    return this.activeClients().map((c) => ({ id: c.id, uuid: c.uuid, tag: c.tag, email: XrayEngine.emailFor(inboundId, c.id) }));
  }

  buildConfig() {
    const enable = this.store.data.enable;
    const ssPass = this.store.data.ssPassword || '';
    const inbounds = [];

    // 1. VLESS-XHTTP
    if (enable.vlessXhttp && this.ports.xhttp) {
      inbounds.push({
        tag: 'vless-xhttp-in',
        listen: '127.0.0.1', port: this.ports.xhttp, protocol: 'vless',
        settings: { clients: this._clientsFor('xhttp').map((c) => ({ id: c.uuid, level: POLICY_LEVEL, email: c.email })), decryption: 'none' },
        streamSettings: { network: 'xhttp', security: 'none', xhttpSettings: { path: PATHS.xhttp, mode: 'auto' } }
      });
    }

    // 2. Shadowsocks-WS (single shared password — SS has no per-user field)
    if (enable.ssWs && this.ports.ssWs && ssPass) {
      inbounds.push({
        tag: 'ss-ws-in',
        listen: '127.0.0.1', port: this.ports.ssWs, protocol: 'shadowsocks',
        settings: { method: this.cfg.shadowsocks.method, password: ssPass, email: 'ss.shared' },
        streamSettings: { network: 'ws', security: 'none', wsSettings: { path: PATHS.ssWs } }
      });
    }

    // 3. NodeSet inbound (Cloudflare generated nodes, always VLESS-WS on an internal port)
    const ns = this.nodesetInbound();
    if (ns && this.ports.nodeset) {
      inbounds.push({
        tag: 'nodeset-in',
        listen: '127.0.0.1', port: this.ports.nodeset, protocol: 'vless',
        settings: { clients: this._clientsFor('nodeset').map((c) => ({ id: c.uuid, level: POLICY_LEVEL, email: c.email })), decryption: 'none' },
        streamSettings: { network: ns.network || 'ws', security: 'none', wsSettings: { path: ns.path } }
      });
    }

    // 4. Core inbounds (manual, max 4) — operator-chosen protocol/network
    for (const ib of this.store.data.coreInbounds) {
      if (ib.enabled === false) continue;
      const port = this.ports.core?.[ib.id];
      if (!port) continue;
      const clients = this._clientsFor(ib.id).map((c) => ({ id: c.uuid, level: POLICY_LEVEL, email: c.email }));
      const stream = { network: ib.network || 'ws', security: 'none' };
      if (ib.network === 'ws') stream.wsSettings = { path: ib.path || '/' + ib.id };
      if (ib.network === 'grpc') stream.grpcSettings = { serviceName: ib.path || ib.id };
      const settingsByProtocol = {
        vless: { clients, decryption: 'none' },
        vmess: { clients: clients.map((c) => ({ id: c.uuid, level: POLICY_LEVEL, alterId: 0, email: c.email })) },
        trojan: { clients: clients.map((c) => ({ password: c.uuid, level: POLICY_LEVEL, email: c.email })) }
      };
      inbounds.push({
        tag: `core-${ib.id}`,
        listen: ib.listen || '127.0.0.1', port,
        protocol: ib.protocol || 'vless',
        settings: settingsByProtocol[ib.protocol || 'vless'] || settingsByProtocol.vless,
        streamSettings: stream
      });
    }

    if (!inbounds.length) return null;

    // Stats Service (per-user counters over gRPC on a random local port)
    this.apiPort = this.ports.api;
    const full = {
      log: { loglevel: 'warning' },
      stats: {},
      policy: { levels: { [POLICY_LEVEL]: { statsUserUplink: true, statsUserDownlink: true } }, system: { statsInboundUplink: true, statsInboundDownlink: true } },
      api: { tag: 'api', services: ['StatsService'] },
      inbounds: [
        ...inbounds,
        { tag: 'api-in', listen: '127.0.0.1', port: this.apiPort, protocol: 'dokodemo-door', settings: { address: '127.0.0.1' } }
      ],
      outbounds: [{ protocol: 'freedom', tag: 'direct' }, { protocol: 'blackhole', tag: 'block' }],
      routing: { rules: [{ type: 'field', inboundTag: ['api-in'], outboundTag: 'api' }] }
    };
    return full;
  }

  start() {
    if (!fs.existsSync(this.paths.xrayBin)) return false;
    const cfg = this.buildConfig();
    if (!cfg) { Logger.info('Xray: no inbounds enabled — engine idle.'); return false; }
    fs.writeFileSync(this.paths.xrayConfig, JSON.stringify(cfg, null, 2), 'utf8');
    try {
      const t = spawnSync(this.paths.xrayBin, ['run', '-test', '-c', this.paths.xrayConfig], { encoding: 'utf8', timeout: 15000 });
      if (t.status !== 0) {
        Logger.error('Xray config test failed: ' + String(t.stdout || t.stderr || '').replace(/\x1b\[[0-9;]*m/g, '').trim());
        return false;
      }
    } catch (err) {
      Logger.warn('Xray config test could not run: ' + err.message);
    }
    this._spawn();
    this._probe(cfg);
    return true;
  }

  reload() {
    if (!fs.existsSync(this.paths.xrayBin)) return false;
    const cfg = this.buildConfig();
    if (!cfg) { this.stop(); return false; }
    fs.writeFileSync(this.paths.xrayConfig, JSON.stringify(cfg, null, 2), 'utf8');
    try {
      const t = spawnSync(this.paths.xrayBin, ['run', '-test', '-c', this.paths.xrayConfig], { encoding: 'utf8', timeout: 15000 });
      if (t.status !== 0) {
        Logger.error('Xray reload rejected: ' + String(t.stderr || t.stdout || '').trim());
        return false;
      }
    } catch {}
    const wasRunning = this.running();
    this._stopping = true;
    if (this.process) { try { this.process.kill('SIGTERM'); } catch {} }
    this._stopping = false;
    this._spawn();
    if (wasRunning) Logger.info('Xray-core reloaded (client list changed).');
    this._probe(cfg);
    return true;
  }

  _spawn() {
    try {
      if (fs.existsSync(this.paths.xrayLog) && fs.statSync(this.paths.xrayLog).size > 5 * 1024 * 1024) {
        fs.truncateSync(this.paths.xrayLog, 0);
      }
    } catch {}
    const logFd = fs.openSync(this.paths.xrayLog, 'a');
    this.process = spawn(this.paths.xrayBin, ['run', '-c', this.paths.xrayConfig], { stdio: ['ignore', 'pipe', 'pipe'] });
    Logger.info(`Xray-core started (pid ${this.process.pid})`);

    let windowStart = Date.now();
    let printed = 0;
    const onData = (buf) => {
      try { fs.writeSync(logFd, buf); } catch {}
      const text = buf.toString('utf8').replace(/\x1b\[[0-9;]*m/g, '');
      for (const line of text.split('\n')) {
        if (!/\[(Warning|Error)\]|panic|failed to/i.test(line)) continue;
        if (/is deprecated|Please migrate/i.test(line)) continue;
        if (Date.now() - windowStart > 60000) { windowStart = Date.now(); printed = 0; }
        if (++printed <= 15) console.log('[xray] ' + line.trim().slice(0, 300));
      }
    };
    this.process.stdout.on('data', onData);
    this.process.stderr.on('data', onData);
    this.process.on('error', (err) => Logger.error(`Xray process error: ${err.message}`));
    this.process.on('exit', (code, sig) => {
      try { fs.closeSync(logFd); } catch {}
      if (this._stopping) return;
      Logger.warn(`Xray-core exited (${code}/${sig || 'none'})`);
      if (this.onDown) { try { this.onDown('xray', code); } catch {} }
      this._restarts += 1;
      if (this._restarts <= 20) {
        const delay = Math.min(30000, 1000 * this._restarts);
        setTimeout(() => { if (!this._stopping) this._spawn(); }, delay);
      } else {
        Logger.error('Xray-core keeps crashing; giving up (see xray.log).');
      }
    });
  }

  _probe(cfg) {
    setTimeout(() => {
      for (const ib of cfg.inbounds) {
        if (ib.listen !== '127.0.0.1') continue;
        const sock = net.connect(ib.port, '127.0.0.1');
        sock.setTimeout(3000);
        sock.once('connect', () => { Logger.ok(`xray inbound ${ib.tag} on :${ib.port}`); sock.destroy(); });
        sock.once('error', () => Logger.error(`xray inbound ${ib.tag} NOT listening on :${ib.port}`));
        sock.once('timeout', () => { sock.destroy(); });
      }
    }, 2500);
  }

  running() {
    return !!(this.process && !this.process.killed && this.process.exitCode === null);
  }

  stop() {
    this._stopping = true;
    if (this.process && !this.process.killed) {
      try { this.process.kill('SIGTERM'); } catch {}
    }
  }
}

module.exports = XrayEngine;
