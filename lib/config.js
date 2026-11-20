/**
 * Aral Neon — central configuration.
 * Merges defaults ← env vars ← persisted settings (panel.json inside the data dir).
 * Runtime protocol toggles live in the store so the panel UI can change them;
 * env vars act as the first-boot default and as an operator override.
 */
'use strict';

const path = require('path');
const { PROTOCOLS, DEFAULT_ENABLE, normalizeHost, resolveDataDir, isRailway } = require('./constants');

const parseBool = (v, dflt) => (v !== undefined ? /^(1|true|yes|on)$/i.test(String(v)) : dflt);

function buildConfig() {
  const env = process.env;

  const cfg = {
    brand: 'Aral Neon',
    version: '1.0.0',
    // Railway injects PORT; VPS/Pterodactyl can use PORT or NEON_PORT.
    publicPort: parseInt(env.PORT || env.NEON_PORT || '8080', 10) || 8080,
    // Extra Cloudflare TLS ports for VPS mode (comma list, e.g. "2053,2083,8443").
    extraTlsPorts: String(env.EXTRA_TLS_PORTS || '').split(',').map((s) => parseInt(s.trim(), 10)).filter((n) => Number.isInteger(n) && n > 0 && n < 65536),
    panelPath: String(env.PANEL_PATH || 'neon').replace(/^\/+|\/+$/g, '') || 'neon',
    domain: normalizeHost(env.DOMAIN || ''),
    forceHost: normalizeHost(env.FORCE_HOST || ''),
    singBoxVersion: env.SINGBOX_VERSION || '1.11.15',
    xrayVersion: env.XRAY_VERSION || '',
    shadowsocks: { method: env.SS_METHOD || 'aes-256-gcm', password: '' },
    enable: { ...DEFAULT_ENABLE },
    railway: isRailway()
  };

  // Protocol switches via env (first-boot default / operator override).
  for (const p of PROTOCOLS) {
    if (env[p.env] !== undefined) cfg.enable[p.key] = parseBool(env[p.env], cfg.enable[p.key]);
  }

  const dataDir = resolveDataDir();
  cfg.paths = {
    dataDir,
    storeFile: path.join(dataDir, 'panel.json'),
    trafficFile: path.join(dataDir, 'traffic.json'),
    binDir: path.join(dataDir, 'bin'),
    certDir: path.join(dataDir, 'cert'),
    certPath: path.join(dataDir, 'cert', 'cert.pem'),
    keyPath: path.join(dataDir, 'cert', 'key.pem'),
    singboxBin: path.join(dataDir, 'bin', process.platform === 'win32' ? 'sing-box.exe' : 'sing-box'),
    singboxConfig: path.join(dataDir, 'sing-box.json'),
    singboxLog: path.join(dataDir, 'sing-box.log'),
    xrayBin: path.join(dataDir, 'bin', process.platform === 'win32' ? 'xray.exe' : 'xray'),
    xrayConfig: path.join(dataDir, 'xray.json'),
    xrayLog: path.join(dataDir, 'xray.log'),
    logFile: path.join(dataDir, 'neon.log')
  };
  return cfg;
}

module.exports = { buildConfig, parseBool };
