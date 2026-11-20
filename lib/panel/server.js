/**
 * Aral Neon — panel HTTP server.
 * Routes: /<PANEL_PATH> panel UI + API, /sub/<id> smart subscriptions
 * (User-Agent → base64 / Clash YAML / sing-box JSON / HTML page),
 * /healthz public health, XHTTP reverse proxy to the Xray engine.
 * This handler is passed both to the plain HTTP server and to the internal
 * HTTPS terminator inside the TCP mux.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
const Logger = require('../logger');
const { PATHS, BRAND, normalizeHost } = require('../constants');
const Traffic = require('../traffic');
const { LinkBuilder } = require('../links');
const subpage = require('../subpage');
const { expiryOf } = require('../enforce');

const HOP_HEADERS = new Set(['connection', 'keep-alive', 'proxy-connection', 'upgrade', 'te', 'trailer', 'proxy-authorization', 'proxy-authenticate', 'transfer-encoding']);
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2'
};

/* ---------------- User-Agent → subscription format ---------------- */

const CLIENT_FORMATS = {
  v2ray: { ext: 'txt', type: 'text/plain; charset=utf-8' },
  clash: { ext: 'yaml', type: 'text/yaml; charset=utf-8' },
  singbox: { ext: 'json', type: 'application/json; charset=utf-8' }
};

function clientFromUserAgent(ua = '') {
  const s = String(ua).toLowerCase();
  if (!s) return null;
  // Specific apps first — several advertise every engine they are "like".
  if (/hiddify|exclave|sfa\/|sfi\/|sfm\/|husi/.test(s)) return 'singbox';
  if (/v2rayng|v2rayn\/|nekobox|nekoray|streisand|shadowrocket|v2box|foxray|sagernet|karing/.test(s)) return 'v2ray';
  if (/sing-?box/.test(s)) return 'singbox';
  if (/clash|mihomo|meta|stash/.test(s)) return 'clash';
  if (/v2ray|xray/.test(s)) return 'v2ray';
  return null;
}

function normaliseClient(value) {
  const key = String(value || '').toLowerCase();
  if (key === 'clash' || key === 'mihomo') return 'clash';
  if (key === 'singbox' || key === 'sing-box' || key === 'hiddify') return 'singbox';
  return 'v2ray';
}

function headerSafe(value) {
  return String(value ?? '').replace(/[\r\n\t\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 120);
}

/* ---------------- server factory ---------------- */

function createPanelServer(ctx) {
  // ctx: { cfg, store, engines: { singbox, xray }, traffic, telegram, sysinfo, api, applyRuntime, activeClients, resolvedHost, xhttpPort }
  const WEB = path.join(__dirname, '..', '..', 'web');
  const BASE = '/' + ctx.cfg.panelPath;
  const api = ctx.api;

  const readBody = (req, limit = 8 * 1024 * 1024) => new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) { reject(new Error('body too large')); req.destroy(); return; }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });

  const send = (res, code, body, headers = {}) => {
    const data = typeof body === 'object' && !Buffer.isBuffer(body) ? JSON.stringify(body) : body;
    res.writeHead(code, { 'Cache-Control': 'no-store', ...headers });
    res.end(data);
  };

  function serveStatic(res, urlPath) {
    const rel = urlPath === '/' ? '/index.html' : urlPath;
    const file = path.join(WEB, rel);
    if (!file.startsWith(WEB) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return false;
    let body = fs.readFileSync(file);
    // The SPA must know the panel base (PANEL_PATH); a stale bookmark or a
    // changed path otherwise produces a page that answers 404 to every call.
    if (rel === '/index.html' || rel === '/login.html') {
      body = Buffer.from(
        String(body).replace('<head>', `<head><script>window.__NEON_BASE=${JSON.stringify(BASE)};</script>`),
        'utf8'
      );
    }
    send(res, 200, body, {
      'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': rel === '/index.html' ? 'no-store' : 'public, max-age=300'
    });
    return true;
  }

  /* ---------------- subscription assembly ---------------- */

  function subscriptionFor(subId, clientApp) {
    const store = ctx.store;
    const client = store.findBySubId(subId);
    if (!client) return { missing: 'client' };
    const builder = new LinkBuilder(ctx.cfg, store, ctx.resolvedHost());
    builder.xhttpAvailable = !!(ctx.engines.xray && ctx.engines.xray.running());
    const nodes = builder.nodesFor(client.uuid, client.tag);
    const nsLinks = builder.nodesetLinks(client);
    const all = [...nodes, ...nsLinks];
    if (!all.length) return { missing: 'nodes' };

    const kind = normaliseClient(clientApp);
    let body, type;
    if (kind === 'clash') {
      const yaml = builder.clashYaml(all, `${BRAND.name} · ${client.tag}`);
      if (!yaml) return { missing: 'nodes' };
      body = yaml; type = CLIENT_FORMATS.clash.type;
    } else if (kind === 'singbox') {
      // Nodeset sbOut entries are single objects, protocol nodes carry arrays.
      const sbNodes = all.map((n) => (Array.isArray(n.sbOut) ? n : { ...n, sbOut: [n.sbOut] })).filter((n) => n.sbOut);
      const json = builder.singboxJson(sbNodes);
      if (!json) return { missing: 'nodes' };
      body = json; type = CLIENT_FORMATS.singbox.type;
    } else {
      body = Buffer.from(all.map((n) => n.uri).join('\n'), 'utf8').toString('base64');
      type = CLIENT_FORMATS.v2ray.type;
    }

    const realExpiry = expiryOf(client);
    const expiryUnix = realExpiry ? Math.floor(new Date(realExpiry).getTime() / 1000) : 0;
    const headers = {
      'Content-Type': type,
      'Profile-Update-Interval': '12',
      'Profile-Title': Buffer.from(`${client.tag}`, 'utf8').toString('base64'),
      'Subscription-Userinfo': `upload=0; download=${client.usedBytes || 0}; total=${client.limitBytes || 0}; expire=${expiryUnix || 0}`,
      'X-Node-Count': String(all.length)
    };
    return { body, headers, client: { ...client, effectiveExpiry: realExpiry, clientApp: kind }, links: all, nodesetName: store.data.nodeset?.name };
  }

  /* ---------------- main handler ---------------- */

  const handler = async (req, res) => {
    try {
      let url;
      try {
        url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
      } catch {
        return send(res, 400, { ok: false, error: 'bad request' });
      }
      let pathname = decodeURIComponent(url.pathname);

      // ---- XHTTP reverse proxy (registered before auth; path is the credential) ----
      const xhttpPath = PATHS.xhttp;
      let p = pathname.split('?')[0];
      if ((p === xhttpPath || p.startsWith(xhttpPath + '/')) && ctx.engines.xray) {
        const port = ctx.xhttpPort;
        if (!port || !ctx.engines.xray.running()) { res.statusCode = 404; return res.end(); }
        for (const sock of [req.socket]) {
          try { sock.setTimeout(0); sock.setNoDelay(true); sock.setKeepAlive(true, 10000); } catch {}
        }
        const headers = {};
        for (let i = 0; i < req.rawHeaders.length; i += 2) {
          const k = req.rawHeaders[i];
          if (HOP_HEADERS.has(k.toLowerCase())) continue;
          headers[k] = headers[k] === undefined ? req.rawHeaders[i + 1] : [].concat(headers[k], req.rawHeaders[i + 1]);
        }
        const up = http.request({ host: '127.0.0.1', port, method: req.method, path: req.url, headers, agent: false });
        up.on('socket', (sk) => { try { sk.setTimeout(0); sk.setNoDelay(true); } catch {} });
        up.on('response', (pr) => {
          const out = {};
          for (let i = 0; i < pr.rawHeaders.length; i += 2) {
            const k = pr.rawHeaders[i];
            if (HOP_HEADERS.has(k.toLowerCase())) continue;
            out[k] = out[k] === undefined ? pr.rawHeaders[i + 1] : [].concat(out[k], pr.rawHeaders[i + 1]);
          }
          res.removeHeader('X-Powered-By');
          res.writeHead(pr.statusCode, pr.statusMessage, out);
          if (typeof res.flushHeaders === 'function') res.flushHeaders();
          pr.on('data', (b) => Traffic.add('VLESS-XHTTP', 0, b.length));
          pr.pipe(res);
          pr.on('error', () => { try { res.destroy(); } catch {} });
        });
        up.on('error', () => {
          if (!res.headersSent) { res.statusCode = 502; res.end(); } else { try { res.destroy(); } catch {} }
        });
        const xhDone = Traffic.open('VLESS-XHTTP');
        res.once('close', xhDone);
        req.on('data', (b) => Traffic.add('VLESS-XHTTP', b.length, 0));
        req.pipe(up);
        req.on('error', () => { try { up.destroy(); } catch {} });
        res.on('close', () => { if (!res.writableFinished) { try { up.destroy(); } catch {} } });
        return;
      }

      // ---- public endpoints (outside the hidden panel base) ----
      if (pathname === '/healthz') {
        return send(res, 200, { ok: true, brand: BRAND.name, version: ctx.cfg.version });
      }

      // ---- subscriptions: one link, every client app ----
      if (req.method === 'GET' && pathname.startsWith('/sub/')) {
        let rest = pathname.slice('/sub/'.length);
        let client = url.searchParams.get('client');
        const slash = rest.indexOf('/');
        if (slash !== -1) {
          client = client || rest.slice(slash + 1);
          rest = rest.slice(0, slash);
        }
        const result = subscriptionFor(rest, client || clientFromUserAgent(req.headers['user-agent']));
        if (!result || result.missing) {
          const why = !result ? 'unknown subscription' : result.missing === 'client'
            ? 'این سابسکریپشن وجود ندارد — کلاینت حذف شده یا داده‌ها ریست شده است.'
            : 'هیچ نود فعالی وجود ندارد — پروتکل‌ها را در پنل فعال کنید.';
          return send(res, 404, `# Aral Neon\n# ${why}\n`, { 'Content-Type': 'text/plain; charset=utf-8' });
        }

        // Same URL, two audiences: proxy clients want the raw list, browsers the page.
        const wantsList = url.searchParams.has('raw')
          || !String(req.headers.accept || '').includes('text/html');
        if (wantsList) {
          return send(res, 200, result.body, { ...result.headers, 'Cache-Control': 'no-store, no-transform' });
        }
        const host = normalizeHost(req.headers.host || '') || ctx.resolvedHost();
        const proto = req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http';
        const subUrl = `${proto}://${host}/sub/${rest}`;
        const html = subpage.render({
          client: result.client,
          subUrl,
          links: result.links,
          nodesetName: result.nodesetName,
          lang: ctx.store.data.lang || 'fa'
        });
        return send(res, 200, html, { 'Content-Type': 'text/html; charset=utf-8' });
      }

      // ---- hidden panel base ----
      if (pathname === BASE) {
        res.writeHead(302, { Location: BASE + '/' });
        return res.end();
      }
      if (pathname.startsWith(BASE + '/')) {
        pathname = pathname.slice(BASE.length) || '/';
      } else {
        // Outside the base: answer as if nothing is here.
        return send(res, 200, '', { 'Content-Type': 'text/html; charset=utf-8' });
      }

      // ---- API ----
      if (pathname.startsWith('/api/')) {
        let body = null;
        if (['POST', 'PUT', 'PATCH'].includes(req.method)) {
          try {
            const raw = await readBody(req);
            body = raw.length ? JSON.parse(raw.toString('utf8')) : {};
          } catch {
            return send(res, 400, { ok: false, error: 'invalid body' });
          }
        }
        try {
          return await api.handle(req, res, pathname, body, url);
        } catch (err) {
          Logger.error(`api ${pathname}: ${err.message}`);
          return send(res, 500, { ok: false, error: err.message || 'internal error' });
        }
      }

      // ---- static UI (session required) ----
      if (req.method === 'GET') {
        const isLogin = pathname === '/login.html' || pathname === '/';
        if (!isLogin && !api.hasSession(req) && pathname !== '/login.html') {
          // serve the SPA shell; it redirects itself to login when /api/health says so
        }
        if (serveStatic(res, pathname === '/' ? '/index.html' : pathname)) return;
      }

      return send(res, 404, { ok: false, error: 'not found' });
    } catch (err) {
      Logger.error(`request failed: ${req.method} ${req.url} — ${err.message}`);
      if (!res.headersSent) send(res, 500, { ok: false, error: String(err.message || err) });
      else try { res.end(); } catch {}
    }
  };

  const server = http.createServer((req, res) => handler(req, res));
  server.keepAliveTimeout = 120000;
  server.headersTimeout = 125000;
  server.requestTimeout = 0;
  server.timeout = 0;
  return { server, handler };
}

module.exports = { createPanelServer, clientFromUserAgent, normaliseClient };
