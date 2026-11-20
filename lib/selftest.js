/**
 * Aral Neon — node self-test from the panel's own host.
 * For each generated node, attempts a TLS (or plain TCP) connection to
 * address:port and, when TLS, checks that a handshake with the configured SNI
 * completes. Nothing here proves the proxy path works end-to-end (that needs a
 * client with credentials), but it catches dead addresses and closed ports —
 * the two failures a node list actually suffers from.
 */
'use strict';

const net = require('net');
const tls = require('tls');

function testNode(node, timeoutMs = 5000) {
  return new Promise((resolve) => {
    const host = node.address.replace(/^\[|\]$/g, '');
    const done = (ok, detail) => {
      try { sock.destroy(); } catch {}
      resolve({ ok, detail: detail || null, ms: Date.now() - t0 });
    };
    const t0 = Date.now();
    let sock;
    const onTimeout = () => done(false, 'timeout');
    try {
      if (node.tls) {
        sock = tls.connect({
          host, port: node.port, servername: node.sni || host,
          rejectUnauthorized: false, ALPNProtocols: ['http/1.1']
        }, () => done(true));
        sock.once('secureConnect', () => done(true));
      } else {
        sock = net.connect({ host, port: node.port }, () => done(true));
      }
      sock.setTimeout(timeoutMs, onTimeout);
      sock.once('error', (err) => done(false, err.code || err.message));
    } catch (err) {
      resolve({ ok: false, detail: err.message, ms: 0 });
    }
  });
}

/** Test up to `limit` nodes in parallel batches of 12. */
async function testNodes(nodes, limit = 36) {
  const slice = nodes.slice(0, limit);
  const results = [];
  const BATCH = 12;
  for (let i = 0; i < slice.length; i += BATCH) {
    const batch = slice.slice(i, i + BATCH);
    const settled = await Promise.all(batch.map(async (n) => ({ node: n, ...(await testNode(n)) })));
    results.push(...settled);
  }
  return {
    tested: results.length,
    skipped: Math.max(0, nodes.length - slice.length),
    ok: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
    results
  };
}

module.exports = { testNode, testNodes };
