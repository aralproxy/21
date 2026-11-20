/**
 * Aral Neon — sing-box engine.
 * Hosts VLESS/VMess/Trojan-WS, HTTPUpgrade ×3 and gRPC (± TLS) inbounds.
 * All listen on 127.0.0.1; the TCP mux on the public PORT routes to them.
 * Supports live client sync (reload via SIGHUP-capable restart) and per-user
 * traffic through the shared stats service (see server.js — sing-box exposes
 * no user counters, so the router-level meter plus Xray's API cover accounting).
 */
'use strict';

const fs = require('fs');
const net = require('net');
const { spawn, spawnSync } = require('child_process');
const Logger = require('../logger');
const { PATHS } = require('../constants');
const { ensureTlsCertificates } = require('../cert');

class SingBoxEngine {
  constructor(cfg, store, ports, activeClients) {
    this.cfg = cfg;
    this.paths = cfg.paths;
    this.store = store;             // Store instance
    this.ports = ports;
    this.activeClients = activeClients; // () => [{ uuid, tag }] — only enabled clients
    this.process = null;
    this._stopping = false;
    this._restarts = 0;
    this.onDown = null;             // callback for alerts
  }

  /** Users for a protocol inbound: every enabled client (uuid = credential). */
  users() {
    return this.activeClients().map((c) => ({ uuid: c.uuid, tag: c.tag }));
  }

  buildConfig() {
    const enable = this.store.data.enable;
    const ports = this.ports;
    const users = this.users();
    const inbounds = [];

    const mkUsers = (proto) => (proto === 'vmess'
      ? users.map((u) => ({ uuid: u.uuid, alterId: 0, name: u.tag }))
      : users.map((u) => (proto === 'trojan'
        ? { password: u.uuid, name: u.tag }
        : { uuid: u.uuid, flow: '', name: u.tag })));

    // 1. VLESS-WS (also backend for VLESS-WS-TLS after gate TLS termination)
    if ((enable.vlessWs || enable.vlessWsTls) && ports.vlessWs) {
      inbounds.push({
        type: 'vless', tag: 'vless-ws-in', listen: '127.0.0.1', listen_port: ports.vlessWs,
        users: mkUsers('vless'), tls: { enabled: false },
        transport: { type: 'ws', path: PATHS.vlessWs, max_early_data: 2560, early_data_header_name: 'Sec-WebSocket-Protocol' }
      });
    }
    // 2. VMess-WS
    if ((enable.vmessWs || enable.vmessWsTls) && ports.vmessWs) {
      inbounds.push({
        type: 'vmess', tag: 'vmess-ws-in', listen: '127.0.0.1', listen_port: ports.vmessWs,
        users: mkUsers('vmess'),
        transport: { type: 'ws', path: PATHS.vmessWs, max_early_data: 2560, early_data_header_name: 'Sec-WebSocket-Protocol' }
      });
    }
    // 3. Trojan-WS
    if ((enable.trojanWs || enable.trojanWsTls) && ports.trojanWs) {
      inbounds.push({
        type: 'trojan', tag: 'trojan-ws-in', listen: '127.0.0.1', listen_port: ports.trojanWs,
        users: mkUsers('trojan'),
        transport: { type: 'ws', path: PATHS.trojanWs }
      });
    }
    // 4. HTTPUpgrade ×3
    if (enable.vlessHu && ports.vlessHu) {
      inbounds.push({
        type: 'vless', tag: 'vless-hu-in', listen: '127.0.0.1', listen_port: ports.vlessHu,
        users: mkUsers('vless'), tls: { enabled: false },
        transport: { type: 'httpupgrade', path: PATHS.vlessHu }
      });
    }
    if (enable.vmessHu && ports.vmessHu) {
      inbounds.push({
        type: 'vmess', tag: 'vmess-hu-in', listen: '127.0.0.1', listen_port: ports.vmessHu,
        users: mkUsers('vmess'),
        transport: { type: 'httpupgrade', path: PATHS.vmessHu }
      });
    }
    if (enable.trojanHu && ports.trojanHu) {
      inbounds.push({
        type: 'trojan', tag: 'trojan-hu-in', listen: '127.0.0.1', listen_port: ports.trojanHu,
        users: mkUsers('trojan'),
        transport: { type: 'httpupgrade', path: PATHS.trojanHu }
      });
    }
    // 5. VLESS-gRPC (h2c backend; also backend for gRPC-TLS decrypted by the gate h2 router)
    if ((enable.vlessGrpc || enable.vlessGrpcTls) && ports.vlessGrpc) {
      inbounds.push({
        type: 'vless', tag: 'vless-grpc-in', listen: '127.0.0.1', listen_port: ports.vlessGrpc,
        users: mkUsers('vless'), tls: { enabled: false },
        transport: { type: 'grpc', service_name: PATHS.grpcService }
      });
    }
    // 5b. VLESS-gRPC-TLS (mux sends TLS ClientHellos offering only ALPN h2 here)
    if (enable.vlessGrpcTls && ports.vlessGrpcTls) {
      ensureTlsCertificates(this.paths.certPath, this.paths.keyPath, this.cfg.domain || 'www.google.com');
      inbounds.push({
        type: 'vless', tag: 'vless-grpc-tls-in', listen: '127.0.0.1', listen_port: ports.vlessGrpcTls,
        users: mkUsers('vless'),
        tls: {
          enabled: true,
          server_name: this.cfg.domain || 'www.google.com',
          alpn: ['h2'],
          certificate_path: this.paths.certPath,
          key_path: this.paths.keyPath
        },
        transport: { type: 'grpc', service_name: PATHS.grpcService }
      });
    }

    return {
      log: { level: 'info', timestamp: true },
      inbounds,
      outbounds: [{ type: 'direct', tag: 'direct' }, { type: 'block', tag: 'block' }],
      route: { final: 'direct' }
    };
  }

  testConfigSync(cfgObj) {
    const tmpFile = this.paths.singboxConfig + `.check-${Date.now()}.json`;
    try {
      fs.writeFileSync(tmpFile, JSON.stringify(cfgObj, null, 2), 'utf8');
      const res = spawnSync(this.paths.singboxBin, ['check', '-c', tmpFile], { encoding: 'utf8', timeout: 8000 });
      try { fs.unlinkSync(tmpFile); } catch {}
      return { ok: res.status === 0, error: (res.stderr || res.stdout || '').trim() };
    } catch (err) {
      try { fs.unlinkSync(tmpFile); } catch {}
      return { ok: false, error: err.message };
    }
  }

  /** Strip optional inbounds until sing-box accepts the config. */
  validateAndSanitize(configData) {
    let check = this.testConfigSync(configData);
    if (check.ok) return configData;
    Logger.warn(`sing-box check: ${check.error}. Auto-fixing...`);
    const optionalTags = ['vless-grpc-tls-in', 'vless-grpc-in', 'trojan-hu-in', 'vmess-hu-in', 'trojan-ws-in'];
    for (const tag of optionalTags) {
      const idx = configData.inbounds.findIndex((ib) => ib.tag === tag);
      if (idx !== -1) {
        configData.inbounds.splice(idx, 1);
        check = this.testConfigSync(configData);
        if (check.ok) {
          Logger.warn(`sing-box validated after stripping ${tag}.`);
          return configData;
        }
      }
    }
    const coreTags = ['vless-ws-in', 'vmess-ws-in', 'vless-hu-in'];
    configData.inbounds = configData.inbounds.filter((ib) => coreTags.includes(ib.tag));
    check = this.testConfigSync(configData);
    if (check.ok) return configData;
    return null;
  }

  start() {
    if (!fs.existsSync(this.paths.singboxBin)) {
      Logger.warn('sing-box executable missing — engine skipped.');
      return false;
    }
    let configData = this.buildConfig();
    if (!configData.inbounds.length) {
      Logger.info('sing-box: no inbounds enabled — engine idle.');
      return false;
    }
    configData = this.validateAndSanitize(configData);
    if (!configData) {
      Logger.error('sing-box validation failed completely.');
      return false;
    }
    fs.writeFileSync(this.paths.singboxConfig, JSON.stringify(configData, null, 2), 'utf8');
    this._spawn();
    this._probe(configData);
    return true;
  }

  /** Rebuild config and restart the process (client list or toggles changed). */
  reload() {
    if (!fs.existsSync(this.paths.singboxBin)) return false;
    const configData = this.buildConfig();
    if (!configData.inbounds.length) {
      this.stop();
      return false;
    }
    const sanitized = this.validateAndSanitize(configData);
    if (!sanitized) return false;
    fs.writeFileSync(this.paths.singboxConfig, JSON.stringify(sanitized, null, 2), 'utf8');
    const wasRunning = !!(this.process && !this.process.killed);
    this._stopping = true;
    if (this.process) { try { this.process.kill('SIGTERM'); } catch {} }
    this._stopping = false;
    this._spawn();
    if (wasRunning) Logger.info('sing-box reloaded (client list changed).');
    this._probe(sanitized);
    return true;
  }

  _spawn() {
    try {
      if (fs.existsSync(this.paths.singboxLog) && fs.statSync(this.paths.singboxLog).size > 5 * 1024 * 1024) {
        fs.truncateSync(this.paths.singboxLog, 0);
      }
    } catch {}
    const logFd = fs.openSync(this.paths.singboxLog, 'a');
    this.process = spawn(this.paths.singboxBin, ['run', '-c', this.paths.singboxConfig], {
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: false
    });
    Logger.info(`sing-box started (pid ${this.process.pid})`);

    let windowStart = Date.now();
    let printed = 0;
    const onData = (buf) => {
      try { fs.writeSync(logFd, buf); } catch {}
      const text = buf.toString('utf8').replace(/\x1b\[[0-9;]*m/g, '');
      for (const line of text.split('\n')) {
        if (!/FATAL|ERROR|WARN|panic/i.test(line)) continue;
        if (Date.now() - windowStart > 60000) { windowStart = Date.now(); printed = 0; }
        if (++printed <= 15) console.log('[sing-box] ' + line.trim().slice(0, 300));
      }
    };
    this.process.stdout.on('data', onData);
    this.process.stderr.on('data', onData);
    this.process.on('error', (err) => Logger.error(`sing-box process error: ${err.message}`));
    this.process.on('exit', (code, sig) => {
      try { fs.closeSync(logFd); } catch {}
      if (this._stopping) return;
      Logger.warn(`sing-box exited (${code}/${sig || 'none'})`);
      if (this.onDown) { try { this.onDown('sing-box', code); } catch {} }
      this._restarts += 1;
      if (this._restarts <= 20) {
        const delay = Math.min(30000, 1000 * this._restarts);
        setTimeout(() => { if (!this._stopping) this._spawn(); }, delay);
      } else {
        Logger.error('sing-box keeps crashing; giving up (see sing-box.log).');
      }
    });
  }

  _probe(configData) {
    const list = (configData.inbounds || []).filter((ib) => ib.listen_port && ib.listen === '127.0.0.1');
    setTimeout(() => {
      for (const ib of list) {
        const sock = net.connect(ib.listen_port, '127.0.0.1');
        sock.setTimeout(3000);
        sock.once('connect', () => { Logger.ok(`sing-box inbound ${ib.tag} on :${ib.listen_port}`); sock.destroy(); });
        sock.once('error', () => Logger.error(`sing-box inbound ${ib.tag} NOT listening on :${ib.listen_port}`));
        sock.once('timeout', () => { Logger.error(`sing-box inbound ${ib.tag} probe timeout`); sock.destroy(); });
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

module.exports = SingBoxEngine;
