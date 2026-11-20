/**
 * Aral Neon — shared constants and helpers.
 * Brand, transport paths, host normalization, data-dir resolution.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const BRAND = {
  name: 'Aral Neon',
  short: 'Neon',
  tagline: 'یک پورت، همهٔ پروتکل‌ها، درخشش طلایی',
  taglineEn: 'One port. Every protocol. Neon gold.'
};

/**
 * Every transport path routed on the single public port.
 * Exact-path routing (longest first) keeps `.../vmess-hu` distinct from `.../vmess`.
 */
const P = '/@AralNeon--';
const PATHS = {
  vlessWs: P + 'ws',
  vmessWs: P + 'vmess',
  trojanWs: P + 'trojan',
  vlessHu: P + 'httpupgrade',
  vmessHu: P + 'vmess-hu',
  trojanHu: P + 'trojan-hu',
  ssWs: P + 'ss',
  xhttp: P + 'xhttp',
  grpcService: P.slice(1) + 'grpc'
};

/** Cloudflare proxied ports (TLS and plain). */
const CF_HTTPS_PORTS = [443, 2053, 2083, 2087, 2096, 8443];
const CF_HTTP_PORTS = [80, 8080, 2052, 2082, 2086, 2095, 8880];

/** Protocol switches and their env names (single source of truth). */
const PROTOCOLS = [
  { key: 'vlessWs',       env: 'ENABLE_VLESS_WS',        label: 'VLESS-WS',          group: 'ws' },
  { key: 'vlessWsTls',    env: 'ENABLE_VLESS_WS_TLS',    label: 'VLESS-WS-TLS',      group: 'ws' },
  { key: 'vmessWs',       env: 'ENABLE_VMESS_WS',        label: 'VMess-WS',          group: 'ws' },
  { key: 'vmessWsTls',    env: 'ENABLE_VMESS_WS_TLS',    label: 'VMess-WS-TLS',      group: 'ws' },
  { key: 'trojanWs',      env: 'ENABLE_TROJAN_WS',       label: 'Trojan-WS',         group: 'ws' },
  { key: 'trojanWsTls',   env: 'ENABLE_TROJAN_WS_TLS',   label: 'Trojan-WS-TLS',     group: 'ws' },
  { key: 'vlessHu',       env: 'ENABLE_VLESS_HU',        label: 'VLESS-HTTPUpgrade', group: 'hu' },
  { key: 'vmessHu',       env: 'ENABLE_VMESS_HU',        label: 'VMess-HTTPUpgrade', group: 'hu' },
  { key: 'trojanHu',      env: 'ENABLE_TROJAN_HU',       label: 'Trojan-HTTPUpgrade', group: 'hu' },
  { key: 'vlessGrpc',     env: 'ENABLE_VLESS_GRPC',      label: 'VLESS-gRPC',        group: 'grpc' },
  { key: 'vlessGrpcTls',  env: 'ENABLE_VLESS_GRPC_TLS',  label: 'VLESS-gRPC-TLS',    group: 'grpc' },
  { key: 'ssWs',          env: 'ENABLE_SS_WS',           label: 'Shadowsocks-WS',    group: 'other' },
  { key: 'vlessXhttp',    env: 'ENABLE_XHTTP',           label: 'VLESS-XHTTP',       group: 'other' }
];
const DEFAULT_ENABLE = Object.fromEntries(PROTOCOLS.map(p => [p.key, true]));

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Normalize a host: strips scheme, path, port; keeps IPv6 brackets. */
function normalizeHost(v) {
  let h = String(v || '').trim();
  if (!h) return '';
  h = h.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '').split('/')[0].split('?')[0].split('#')[0];
  if (h.startsWith('[')) return h.slice(0, h.indexOf(']') + 1);
  if ((h.match(/:/g) || []).length === 1) h = h.split(':')[0];
  return h.toLowerCase();
}

function isIpLiteral(h) {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(h) || String(h || '').includes(':') || String(h || '').startsWith('[');
}

function isLocalAddress(host) {
  if (!host) return true;
  const clean = String(host).toLowerCase().trim();
  return clean === '127.0.0.1' || clean === 'localhost' || clean === '::1' ||
    clean === '0.0.0.0' || clean.startsWith('127.');
}

/** Short, non-secret form of a credential for logs. */
function mask(v) {
  v = String(v || '');
  return v ? v.slice(0, 4) + '…(' + v.length + ')' : '(empty)';
}

/** True when running on Railway (metadata env or RAILWAY_SERVICE_ID). */
function isRailway() {
  return Boolean(process.env.RAILWAY_SERVICE_ID || process.env.RAILWAY_PROJECT_ID || process.env.RAILWAY_ENVIRONMENT);
}

/**
 * Writable data directory. Order:
 * NEON_DATA_DIR → ./neon-data (cwd) → app-dir/neon-data → tmpdir fallback.
 */
function resolveDataDir() {
  const tryDir = (dir) => {
    try {
      fs.mkdirSync(dir, { recursive: true });
      fs.accessSync(dir, fs.constants.W_OK);
      const probe = path.join(dir, '.neon-write-test');
      fs.writeFileSync(probe, 'ok');
      fs.unlinkSync(probe);
      return true;
    } catch {
      return false;
    }
  };
  const candidates = [
    [process.env.NEON_DATA_DIR || process.env.DATA_DIR, 'NEON_DATA_DIR'],
    [path.join(process.cwd(), 'neon-data'), './neon-data'],
    [path.join(__dirname, '..', 'neon-data'), 'app-dir neon-data']
  ];
  for (const [dir, source] of candidates) {
    if (dir && tryDir(dir)) {
      resolveDataDir.info = { dir, source };
      return dir;
    }
  }
  const dir = path.join(os.tmpdir(), 'aral-neon-data');
  resolveDataDir.info = { dir, source: 'temp-dir fallback' };
  return dir;
}

/** Human byte size: 1536 → "1.5 KB" (locale-neutral, tabular-friendly). */
function fmtBytes(n) {
  const v = Number(n || 0);
  if (v <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0, out = v;
  while (out >= 1024 && i < units.length - 1) { out /= 1024; i++; }
  return `${out < 10 ? out.toFixed(1) : Math.round(out)} ${units[i]}`;
}

module.exports = {
  BRAND, PATHS, PROTOCOLS, DEFAULT_ENABLE, CF_HTTPS_PORTS, CF_HTTP_PORTS,
  UUID_RE, normalizeHost, isIpLiteral, isLocalAddress, mask, isRailway,
  resolveDataDir, fmtBytes
};
