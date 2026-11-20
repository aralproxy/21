/**
 * ====================================================================
 *   ARAL NEON — one-port multi-protocol proxy panel
 * --------------------------------------------------------------------
 *   Brand: Aral Neon · یک پورت، همهٔ پروتکل‌ها، درخشش طلایی
 *
 *   Protocols (all on the single public PORT):
 *     VLESS-WS / VLESS-WS-TLS · VMess-WS / VMess-WS-TLS
 *     Trojan-WS / Trojan-WS-TLS · VLESS / VMess / Trojan HTTPUpgrade
 *     VLESS-gRPC / VLESS-gRPC-TLS · Shadowsocks-WS · VLESS-XHTTP
 *
 *   Engines: sing-box + Xray-core (downloaded automatically on first start)
 *   Storage: ./neon-data/  (keep this folder!)
 *   Deploy:  Railway (PORT) or VPS/Pterodactyl (EXTRA_TLS_PORTS for CF)
 * ====================================================================
 */
'use strict';

const net = require('net');
const Logger = require('./lib/logger');
const { buildConfig } = require('./lib/config');
const { BRAND, resolveDataDir } = require('./lib/constants');
const { Store } = require('./lib/store');
const Traffic = require('./lib/traffic');
const sysinfo = require('./lib/sysinfo');
const { BinaryManager } = require('./lib/binaries');
const SingBoxEngine = require('./lib/engines/singbox');
const XrayEngine = require('./lib/engines/xray');
const TcpRouter = require('./lib/mux/tcp-router');
const { Api } = require('./lib/panel/api');
const { createPanelServer } = require('./lib/panel/server');
const { Telegram } = require('./lib/telegram');
const enforce = require('./lib/enforce');

/** Reserve a free internal port on 127.0.0.1 (ephemeral, released, reused by the engine). */
function allocatePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const port = srv.address().port;
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

async function main() {
  Logger.banner();

  // 1. Configuration + persisted state
  const cfg = buildConfig();
  Logger.section('Configuration');
  Logger.item('Public Port', cfg.publicPort);
  Logger.item('Panel Path', `/${cfg.panelPath}`);
  Logger.item('Data Directory', `${cfg.paths.dataDir} (${resolveDataDir.info.source})`);
  Logger.item('Environment', cfg.railway ? 'Railway' : 'VPS / standalone');
  if (cfg.extraTlsPorts.length) Logger.item('Extra TLS Ports', cfg.extraTlsPorts.join(', '));

  const store = new Store(cfg);
  Traffic.init(cfg.paths.dataDir);

  // 2. Resolve public host (domain → saved → egress IP)
  let resolvedHost = cfg.forceHost || cfg.domain || store.data.domain?.node || '';
  if (!resolvedHost) {
    resolvedHost = await discoverEgressIp();
  }
  Logger.item('Link Host', resolvedHost || '127.0.0.1');

  // 3. Internal ports for the engines
  const enable = store.data.enable;
  const ports = {};
  if (enable.vlessWs || enable.vlessWsTls) ports.vlessWs = await allocatePort();
  if (enable.vmessWs || enable.vmessWsTls) ports.vmessWs = await allocatePort();
  if (enable.trojanWs || enable.trojanWsTls) ports.trojanWs = await allocatePort();
  if (enable.vlessHu) ports.vlessHu = await allocatePort();
  if (enable.vmessHu) ports.vmessHu = await allocatePort();
  if (enable.trojanHu) ports.trojanHu = await allocatePort();
  if (enable.vlessGrpc || enable.vlessGrpcTls) ports.vlessGrpc = await allocatePort();
  if (enable.vlessGrpcTls) ports.vlessGrpcTls = await allocatePort();
  if (enable.ssWs) ports.ssWs = await allocatePort();
  if (enable.vlessXhttp) ports.xhttp = await allocatePort();
  if (store.data.nodeset) ports.nodeset = await allocatePort();
  ports.api = await allocatePort();
  const corePorts = {};
  for (const ib of store.data.coreInbounds) corePorts[ib.id] = await allocatePort();
  ports.core = corePorts;

  // 4. Binaries
  Logger.section('Engines & Binaries');
  const binManager = new BinaryManager(cfg);
  const hasSingBox = await binManager.ensureSingBox(Logger);
  const needsXray = enable.vlessXhttp || enable.ssWs || store.data.nodeset || store.data.coreInbounds.length > 0 || store.data.clients.length > 0;
  const hasXray = needsXray ? await binManager.ensureXray(Logger) : false;

  // 5. Engines
  const activeClients = () => store.data.clients.filter((c) => c.enabled !== false).map((c) => ({ id: c.id, uuid: c.uuid, tag: c.tag }));
  const nodesetInbound = () => (store.data.nodeset ? { network: store.data.nodeset.network, path: store.data.nodeset.path } : null);

  let singbox = null;
  if (hasSingBox) {
    singbox = new SingBoxEngine(cfg, store, ports, activeClients);
    singbox.start();
  } else {
    Logger.warn('sing-box unavailable — offline mode (panel + subs still work).');
  }

  let xray = null;
  let xhttpPort = null;
  if (hasXray) {
    xray = new XrayEngine(cfg, store, { ...ports, core: corePorts }, activeClients, nodesetInbound);
    if (xray.start()) xhttpPort = ports.xhttp || null;
    else Logger.warn('Xray-core did not start; XHTTP / SS-WS / per-user stats off.');
  }

  // 6. Runtime appliers
  const telegram = new Telegram(store);
  const applyRuntime = async () => {
    // Refresh engine port maps when inbounds were added/removed since boot.
    for (const ib of store.data.coreInbounds) {
      if (!corePorts[ib.id]) corePorts[ib.id] = await allocatePort();
    }
    if (store.data.nodeset && !ports.nodeset) ports.nodeset = await allocatePort();
    if (singbox) singbox.reload();
    if (xray) xray.reload();
  };

  const engines = { singbox, xray };
  const ctx = {
    cfg, store, engines, traffic: Traffic, telegram, sysinfo,
    applyRuntime, activeClients,
    resolvedHost: () => cfg.forceHost || cfg.domain || store.data.domain?.node || resolvedHost || '127.0.0.1',
    xhttpPort: () => xhttpPort
  };
  ctx.api = new Api(ctx);

  // Engine-down alerts
  if (singbox) singbox.onDown = (name) => {
    const t = store.data.telegram;
    if (t.enabled && t.events?.engineDown) telegram.send(`🛑 <b>Aral Neon</b>\nموتور ${name} متوقف شد!`).catch(() => {});
  };
  if (xray) xray.onDown = (name) => {
    const t = store.data.telegram;
    if (t.enabled && t.events?.engineDown) telegram.send(`🛑 <b>Aral Neon</b>\nموتور ${name} متوقف شد!`).catch(() => {});
  };

  // 7. Panel HTTP server + TCP mux
  Logger.section('Network');
  const { server: httpServer } = createPanelServer(ctx);
  const tcpRouter = new TcpRouter(cfg, ports, httpServer, httpServer.listeners('request')[0]);
  await tcpRouter.start();

  // 8. Enforcement loop (quota / expiry, 30 s)
  enforce.start({
    store, xrayEngine: xray, telegram,
    notify: (text) => telegram.send(text).catch(() => {}),
    applyRuntime
  });

  // 9. Periodic telegram backup (daily at first start of each day)
  setInterval(() => {
    const t = store.data.telegram;
    if (t.enabled && t.sendBackup) {
      const today = new Date().toISOString().slice(0, 10);
      if (telegram._lastBackupDay !== today) {
        telegram._lastBackupDay = today;
        telegram.backupNow().catch(() => {});
      }
    }
  }, 6 * 3600 * 1000).unref?.();

  // 10. Summary
  Logger.section(`${BRAND.name} Active`);
  Logger.item('Panel', `http://${resolvedHost || '127.0.0.1'}:${cfg.publicPort}/${cfg.panelPath}`);
  Logger.item('Subscription', `/sub/&lt;id&gt; — auto format by User-Agent`);
  const clientCount = store.data.clients.length;
  const nodeCount = store.data.nodeset?.nodes?.length || 0;
  Logger.item('Clients', `${clientCount} (${store.data.clients.filter((c) => c.enabled !== false).length} active)`);
  Logger.item('CF Nodes', nodeCount);
  Logger.item('Protocols', Object.values(enable).filter(Boolean).length + ' enabled');
  if (!store.data.admin?.hash) Logger.warn('First run: open the panel to create your password.');

  // Graceful shutdown
  let shuttingDown = false;
  const shutdown = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    Logger.info('Shutting down Aral Neon...');
    enforce.stop();
    if (singbox) singbox.stop();
    if (xray) xray.stop();
    tcpRouter.stop();
    try { Traffic.save(); } catch {}
    setTimeout(() => process.exit(0), 800).unref();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

async function discoverEgressIp() {
  const fetchText = (url) => new Promise((resolve) => {
    const https = require('https');
    const req = https.get(url, { headers: { 'User-Agent': 'AralNeon/1.0' }, timeout: 3500 }, (res) => {
      if (res.statusCode !== 200) { res.resume(); return resolve(null); }
      let s = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { s += c; });
      res.on('end', () => resolve(s));
    });
    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.on('error', () => resolve(null));
  });
  try {
    const t = await fetchText('https://api.ipify.org?format=text');
    if (t && t.trim()) return t.trim();
  } catch {}
  try {
    const t = await fetchText('https://1.1.1.1/cdn-cgi/trace');
    const m = /ip=([^\r\n]+)/.exec(t || '');
    if (m) return m[1].trim();
  } catch {}
  return '127.0.0.1';
}

main().catch((err) => {
  console.error('[FATAL] Aral Neon failed to start:', err);
  process.exit(1);
});
