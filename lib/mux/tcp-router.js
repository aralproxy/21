/**
 * Aral Neon — single-port TCP multiplexer.
 *
 * One public PORT carries everything. The first bytes of each TCP connection decide the route:
 *   - TLS ClientHello (0x16 0x03) → ALPN routing: h2-only (gRPC clients) → sing-box gRPC-TLS;
 *     everything else → internal HTTPS terminator (panel, subs, WS/HTTPUpgrade/XHTTP over TLS).
 *   - HTTP/2 cleartext preface ("PRI * HTTP/2.0") → sing-box VLESS-gRPC (h2c).
 *   - Plain HTTP → Node HTTP server (panel, subscriptions, WS/HTTPUpgrade upgrades) per path.
 * In VPS mode, extra Cloudflare TLS ports (2053, 2083, ...) forward straight into the
 * internal HTTPS terminator, so CF-proxied nodes on those ports reach the same stack.
 */
'use strict';

const net = require('net');
const http = require('http');
const tls = require('tls');
const http2 = require('http2');
const Logger = require('../logger');
const { PATHS } = require('../constants');
const { parseClientHello } = require('../tls-sni');
const { ensureTlsCertificates } = require('../cert');
const Traffic = require('../traffic');

class TcpRouter {
  constructor(cfg, ports, httpServer, handler) {
    this.cfg = cfg;
    this.ports = ports;         // { vlessWs, vmessWs, trojanWs, vlessHu, vmessHu, trojanHu, ssWs, xhttp, vlessGrpc, vlessGrpcTls }
    this.httpServer = httpServer;
    this.handler = handler;     // the panel request handler (req, res)
    this.server = null;
    this.httpsServer = null;
    this.internalHttpsPort = null;
    this.extraServers = [];
  }

  pipeToBackend(clientSocket, firstChunk, targetPort, label) {
    clientSocket.setTimeout(0);
    clientSocket.setKeepAlive(true, 10000);
    clientSocket.setNoDelay(true);

    const backend = net.connect(targetPort, '127.0.0.1', () => {
      backend.setTimeout(0);
      backend.setKeepAlive(true, 10000);
      backend.setNoDelay(true);
      backend.write(firstChunk);
      if (label !== 'Internal-HTTPS') { // decrypted WS/HTTPUpgrade/XHTTP is metered inside the HTTPS path
        Traffic.add(label, firstChunk ? firstChunk.length : 0, 0);
        Traffic.meter(label, clientSocket, backend);
      }
      clientSocket.pipe(backend);
      backend.pipe(clientSocket);
      clientSocket.resume();
    });

    backend.on('error', (err) => {
      const now = Date.now();
      if (!this._lastWarns) this._lastWarns = {};
      if (!this._lastWarns[label] || now - this._lastWarns[label] > 15000) {
        Logger.warn(`TCP Router: ${label} backend :${targetPort} unreachable (${err.message})`);
        this._lastWarns[label] = now;
      }
      try { clientSocket.destroy(); } catch {}
    });
    clientSocket.on('error', () => { try { backend.destroy(); } catch {} });
  }

  /** Route WebSocket / HTTPUpgrade handshakes per path (exact path, longest first). */
  attachUpgradeHandlers(server) {
    server.on('upgrade', (req, socket, head) => {
      socket.setTimeout(0);
      socket.setKeepAlive(true, 10000);
      socket.setNoDelay(true);

      let url = req.url || '';
      try { url = decodeURIComponent(url.split('?')[0]); } catch { url = url.split('?')[0]; }
      const routes = [
        [PATHS.vlessWs, this.ports.vlessWs, 'VLESS-WS'],
        [PATHS.vmessWs, this.ports.vmessWs, 'VMess-WS'],
        [PATHS.trojanWs, this.ports.trojanWs, 'Trojan-WS'],
        [PATHS.vlessHu, this.ports.vlessHu, 'VLESS-HTTPUpgrade'],
        [PATHS.vmessHu, this.ports.vmessHu, 'VMess-HTTPUpgrade'],
        [PATHS.trojanHu, this.ports.trojanHu, 'Trojan-HTTPUpgrade'],
        [PATHS.ssWs, this.ports.ssWs, 'Shadowsocks-WS'],
        [PATHS.xhttp, this.ports.xhttp, 'VLESS-XHTTP']
      ];
      const hit = (p) => url === p || url.startsWith(p + '/');

      let destPort = null;
      let label = 'Unknown-Upgrade';
      for (const [p, port, lbl] of routes) {
        if (hit(p)) { if (port) { destPort = port; label = lbl; } break; }
      }

      this._upgradeCount = (this._upgradeCount || 0) + 1;
      if (this._upgradeCount <= 20 || !destPort) {
        Logger.info(`WS upgrade #${this._upgradeCount} ${label} path=${url.slice(0, 80)} host=${req.headers.host || '-'}`);
      }

      if (!destPort) {
        socket.write('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
        socket.destroy();
        return;
      }

      const backend = net.connect(destPort, '127.0.0.1', () => {
        backend.setTimeout(0);
        backend.setKeepAlive(true, 10000);
        backend.setNoDelay(true);
        let headersStr = `${req.method} ${req.url} HTTP/${req.httpVersion}\r\n`;
        for (let i = 0; i < req.rawHeaders.length; i += 2) {
          headersStr += `${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}\r\n`;
        }
        headersStr += '\r\n';
        backend.write(headersStr);
        if (head && head.length > 0) backend.write(head);
        Traffic.add(label, head && head.length ? head.length : 0, 0);
        Traffic.meter(label, socket, backend);
        socket.pipe(backend);
        backend.pipe(socket);
      });

      let connected = false;
      backend.once('connect', () => { connected = true; });
      backend.on('error', (err) => {
        if (!connected) {
          const now = Date.now();
          if (!this._lastUpErr || now - this._lastUpErr > 15000) {
            this._lastUpErr = now;
            Logger.error(`${label} backend :${destPort} unreachable (${err.message}) — is the engine running?`);
          }
          try { socket.end('HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\nContent-Length: 0\r\n\r\n'); } catch {}
        }
        try { socket.destroy(); } catch {}
      });
      socket.on('error', () => { try { backend.destroy(); } catch {} });
      socket.on('close', () => { try { backend.destroy(); } catch {} });
      backend.on('close', () => { try { socket.destroy(); } catch {} });
    });
  }

  /**
   * One internal TLS terminator for everything TLS on the shared port:
   *   ALPN http/1.1 → panel / subscription + WS / HTTPUpgrade / XHTTP upgrades
   *   ALPN h2       → per-stream router: gRPC service path → sing-box VLESS-gRPC, else panel
   * (Xray clients with a uTLS fingerprint offer "h2,http/1.1" for gRPC exactly like a
   *  browser, so the split has to happen per HTTP/2 stream, not from the ClientHello.)
   */
  async setupInternalHttps() {
    try {
      const certs = ensureTlsCertificates(this.cfg.paths.certPath, this.cfg.paths.keyPath, this.cfg.domain || 'localhost');
      if (!certs || !certs.cert || !certs.key) return;

      this.h1Server = http.createServer(this.handler);
      this.h1Server.keepAliveTimeout = 120000;
      this.h1Server.headersTimeout = 125000;
      this.h1Server.requestTimeout = 0;
      this.h1Server.timeout = 0;
      this.attachUpgradeHandlers(this.h1Server);

      const grpcBackend = this.cfg.enable.vlessGrpcTls && this.ports.vlessGrpcTls;
      if (grpcBackend) this._setupH2Router();

      this.httpsServer = tls.createServer({
        cert: certs.cert,
        key: certs.key,
        ALPNProtocols: grpcBackend ? ['h2', 'http/1.1'] : ['http/1.1']
      }, (sock) => {
        sock.on('error', () => {});
        if (sock.alpnProtocol === 'h2' && this.h2Server) this.h2Server.emit('connection', sock);
        else this.h1Server.emit('connection', sock);
      });
      this.httpsServer.on('tlsClientError', () => {});

      await new Promise((resolve) => {
        this.httpsServer.listen(0, '127.0.0.1', () => {
          this.internalHttpsPort = this.httpsServer.address().port;
          Logger.item('Internal HTTPS', `127.0.0.1:${this.internalHttpsPort}`);
          resolve();
        });
        this.httpsServer.on('error', (err) => {
          Logger.warn(`Internal HTTPS server failed to start: ${err.message}`);
          resolve();
        });
      });
    } catch (err) {
      Logger.warn(`Internal HTTPS setup error: ${err.message}`);
    }
  }

  /** HTTP/2 stream router inside the TLS terminator: gRPC paths → sing-box, else panel over h1. */
  _setupH2Router() {
    const HOP = new Set(['connection', 'keep-alive', 'proxy-connection', 'transfer-encoding', 'upgrade', 'host', 'te', 'trailer', 'proxy-authorization', 'proxy-authenticate']);
    const grpcPrefix = '/' + PATHS.grpcService + '/';
    const big = { initialWindowSize: 4 * 1024 * 1024, maxFrameSize: 64 * 1024 };
    this.h2Server = http2.createServer({ settings: big });
    this.h2Server.on('session', (session) => {
      session.on('error', () => {});
      try { session.setLocalWindowSize(16 * 1024 * 1024); } catch {}
      session.on('close', () => {
        if (session._neonBackend) { try { session._neonBackend.close(); } catch {} }
      });
    });
    const backendFor = (session) => {
      let be = session._neonBackend;
      if (be && !be.closed && !be.destroyed) return be;
      be = http2.connect(`http://127.0.0.1:${this.ports.vlessGrpcTls}`, { settings: big });
      be.on('error', () => {});
      be.on('connect', () => { try { be.setLocalWindowSize(16 * 1024 * 1024); } catch {} });
      session._neonBackend = be;
      return be;
    };
    this.h2Server.on('stream', (stream, headers) => {
      stream.on('error', () => {});
      const p = String(headers[':path'] || '/');
      const fwd = {};
      for (const k of Object.keys(headers)) if (!k.startsWith(':') && !HOP.has(k)) fwd[k] = headers[k];

      if (p.startsWith(grpcPrefix)) {
        let up;
        try {
          up = backendFor(stream.session).request({ ...fwd, ':method': headers[':method'] || 'POST', ':path': p });
        } catch { try { stream.close(http2.constants.NGHTTP2_INTERNAL_ERROR); } catch {} return; }
        let trailers = null;
        up.on('error', () => { try { stream.close(http2.constants.NGHTTP2_INTERNAL_ERROR); } catch {} });
        up.on('response', (rh) => {
          const out = { ':status': rh[':status'] || 200 };
          for (const k of Object.keys(rh)) if (!k.startsWith(':') && !HOP.has(k)) out[k] = rh[k];
          try { stream.respond(out, { waitForTrailers: true }); } catch { return; }
          Traffic.meter('VLESS-gRPC', stream, up);
          up.pipe(stream);
        });
        up.on('trailers', (t) => { trailers = t; });
        stream.on('wantTrailers', () => {
          const t = {};
          if (trailers) for (const k of Object.keys(trailers)) if (!k.startsWith(':')) t[k] = trailers[k];
          if (!Object.keys(t).length) t['grpc-status'] = '0';
          try { stream.sendTrailers(t); } catch {}
        });
        stream.pipe(up);
        stream.on('close', () => { if (!up.closed) { try { up.close(); } catch {} } });
        up.on('close', () => { if (!stream.closed && !stream.headersSent) { try { stream.close(); } catch {} } });
        return;
      }

      // Not a gRPC client: relay the request to the panel over HTTP/1.1.
      fwd.host = headers[':authority'] || 'localhost';
      fwd['x-forwarded-proto'] = 'https';
      const rq = http.request({ host: '127.0.0.1', port: this.cfg.publicPort, method: headers[':method'] || 'GET', path: p, headers: fwd, agent: false });
      rq.on('response', (r) => {
        const out = { ':status': r.statusCode };
        for (const [k, v] of Object.entries(r.headers)) if (!HOP.has(k)) out[k] = v;
        try { stream.respond(out); } catch { r.destroy(); return; }
        r.pipe(stream);
      });
      rq.on('error', () => { try { if (!stream.headersSent) stream.respond({ ':status': 502 }); stream.end(); } catch {} });
      stream.pipe(rq);
    });
  }

  /** Build the first-chunk router for a raw socket. */
  routeChunk(socket) {
    return (chunk) => {
      // 1. TLS ClientHello (0x16 0x03)
      if (chunk.length >= 3 && chunk[0] === 0x16 && chunk[1] === 0x03) {
        const { sni } = parseClientHello(chunk);
        let target = null;
        // Priority 1: gRPC over TLS — gRPC clients offer ONLY "h2"
        const { alpn } = parseClientHello(chunk);
        if (alpn.includes('h2') && !alpn.includes('http/1.1') && this.cfg.enable.vlessGrpcTls && this.ports.vlessGrpcTls) {
          target = { port: this.ports.vlessGrpcTls, label: 'VLESS-gRPC' };
        }
        // Priority 2: internal HTTPS terminator (WS-TLS, HTTPUpgrade-TLS, XHTTP-TLS, panel over TLS)
        else if (this.internalHttpsPort) {
          target = { port: this.internalHttpsPort, label: 'Internal-HTTPS' };
        }
        // Priority 3: sing-box's own TLS inbound
        else if (this.cfg.enable.vlessGrpcTls && this.ports.vlessGrpcTls) {
          target = { port: this.ports.vlessGrpcTls, label: 'VLESS-gRPC' };
        }
        if (target) {
          this.pipeToBackend(socket, chunk, target.port, target.label);
          return;
        }
      }

      // 2. HTTP/2 cleartext preface → sing-box VLESS-gRPC (h2c)
      if (this.cfg.enable.vlessGrpc && this.ports.vlessGrpc && chunk.length >= 16 &&
          chunk.toString('latin1', 0, 16) === 'PRI * HTTP/2.0\r\n') {
        this.pipeToBackend(socket, chunk, this.ports.vlessGrpc, 'VLESS-gRPC');
        return;
      }

      // 3. Plain HTTP → panel server (it handles WS upgrades per path)
      socket.unshift(chunk);
      this.httpServer.emit('connection', socket);
      socket.resume();
    };
  }

  /**
   * Wrap the raw socket with first-chunk buffering: a TLS ClientHello with
   * post-quantum key shares (~1.8 KB) often arrives split over several TCP
   * segments; wait for the whole first record so SNI/ALPN routing sees it all.
   */
  attachRawRouter(server) {
    server.on('connection', (socket) => {
      socket.setTimeout(0);
      socket.setKeepAlive(true, 10000);
      socket.setNoDelay(true);
      socket.on('error', () => {});

      let pending = null;
      let waitTimer = null;
      const route = this.routeChunk(socket);
      const onFirstData = (data) => {
        pending = pending ? Buffer.concat([pending, data]) : data;
        const needMore = (pending[0] === 0x16 && pending[1] === 0x03 && pending.length >= 5 && pending.length < pending.readUInt16BE(3) + 5)
          || (pending.length < 16 && 'PRI * HTTP/2.0\r\n'.startsWith(pending.toString('latin1')));
        if (needMore) {
          if (!waitTimer) waitTimer = setTimeout(() => {
            socket.removeListener('data', onFirstData);
            socket.pause();
            route(pending);
          }, 400);
          return;
        }
        if (waitTimer) clearTimeout(waitTimer);
        socket.removeListener('data', onFirstData);
        socket.pause();
        route(pending);
      };
      socket.on('data', onFirstData);
    });
  }

  async start() {
    this.httpServer.keepAliveTimeout = 120000;
    this.httpServer.headersTimeout = 125000;
    this.httpServer.requestTimeout = 0;
    this.httpServer.timeout = 0;
    this.attachUpgradeHandlers(this.httpServer);

    await this.setupInternalHttps();

    // Public single port
    this.server = net.createServer((socket) => this.attachRawRouterOnConnect(socket));
    await new Promise((resolve, reject) => {
      this.server.listen(this.cfg.publicPort, '0.0.0.0', () => {
        Logger.ok(`Public TCP multiplexer listening on 0.0.0.0:${this.cfg.publicPort}`);
        resolve();
      });
      this.server.on('error', reject);
    });

    // VPS/Pterodactyl mode: extra Cloudflare TLS ports all funnel into the internal HTTPS terminator.
    if (this.cfg.extraTlsPorts.length && this.internalHttpsPort) {
      for (const port of this.cfg.extraTlsPorts) {
        try {
          const extra = net.createServer((socket) => this.pipeToBackend(socket, Buffer.alloc(0), this.internalHttpsPort, 'Internal-HTTPS'));
          // pipeToBackend writes an empty first chunk, then pipes; the first real
          // chunk flows through pipe() — TLS bytes are opaque to us here.
          await new Promise((resolve) => {
            extra.listen(port, '0.0.0.0', () => {
              Logger.ok(`Extra TLS port :${port} → internal HTTPS (Cloudflare)`);
              resolve();
            });
            extra.on('error', (err) => {
              Logger.warn(`Could not listen on extra port ${port}: ${err.message}`);
              resolve();
            });
          });
          this.extraServers.push(extra);
        } catch {}
      }
    }
  }

  /** Connection handler for the public port (with first-chunk buffering). */
  attachRawRouterOnConnect(socket) {
    socket.setTimeout(0);
    socket.setKeepAlive(true, 10000);
    socket.setNoDelay(true);
    socket.on('error', () => {});

    let pending = null;
    let waitTimer = null;
    const route = this.routeChunk(socket);
    const onFirstData = (data) => {
      pending = pending ? Buffer.concat([pending, data]) : data;
      const needMore = (pending[0] === 0x16 && pending[1] === 0x03 && pending.length >= 5 && pending.length < pending.readUInt16BE(3) + 5)
        || (pending.length < 16 && 'PRI * HTTP/2.0\r\n'.startsWith(pending.toString('latin1')));
      if (needMore) {
        if (!waitTimer) waitTimer = setTimeout(() => {
          socket.removeListener('data', onFirstData);
          socket.pause();
          route(pending);
        }, 400);
        return;
      }
      if (waitTimer) clearTimeout(waitTimer);
      socket.removeListener('data', onFirstData);
      socket.pause();
      route(pending);
    };
    socket.on('data', onFirstData);
  }

  stop() {
    if (this.server) { try { this.server.close(); } catch {} }
    if (this.httpsServer) { try { this.httpsServer.close(); } catch {} }
    for (const s of this.extraServers) { try { s.close(); } catch {} }
  }
}

module.exports = TcpRouter;
