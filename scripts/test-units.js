/** Unit tests for Aral Neon core modules (run with node scripts/test-units.js). */
'use strict';
const assert = require('assert');
const path = require('path');
const root = path.join(__dirname, '..');

// ---- QR encoder: known vector + structure ----
const qr = require(path.join(root, 'lib/qr'));
{
  const enc = qr.encode('https://example.com/sub/abc123');
  assert.strictEqual(enc.size, enc.version * 4 + 17, 'QR size formula');
  assert.ok(enc.version >= 1 && enc.version <= 11, 'QR version range');
  // finder patterns must be dark at the three corners
  assert.strictEqual(enc.matrix[0][0], 1);
  assert.strictEqual(enc.matrix[0][enc.size - 1], 1);
  assert.strictEqual(enc.matrix[enc.size - 1][0], 1);
  const svg = qr.toSvg('hello');
  assert.ok(svg.startsWith('<svg') && svg.includes('path'), 'SVG output');
  console.log('QR: OK (v' + enc.version + ', ' + enc.size + 'x' + enc.size + ')');
}

// ---- TLS ClientHello parser: synthetic record with SNI + ALPN ----
const { parseClientHello } = require(path.join(root, 'lib/tls-sni'));
{
  const sni = 'sub.example.com';
  const sniBytes = Buffer.from(sni, 'utf8');
  const extSni = Buffer.concat([
    Buffer.from([0x00, 0x00]),            // type server_name
    Buffer.from([0x00, sniBytes.length + 5 > 255 ? 2 : 1]) // placeholder, fixed below
  ]);
  // build properly with lengths
  const sniBody = Buffer.concat([Buffer.from([0x00]), Buffer.from([sniBytes.length >> 8, sniBytes.length & 0xff]), sniBytes]);
  const sniList = Buffer.concat([Buffer.from([sniBody.length >> 8, sniBody.length & 0xff]), sniBody]);
  const extSniFull = Buffer.concat([Buffer.from([0x00, 0x00]), Buffer.from([sniList.length >> 8, sniList.length & 0xff]), sniList]);
  const alpn1 = Buffer.from('h2');
  const alpnBody = Buffer.concat([Buffer.from([alpn1.length]), alpn1]);
  const alpnList = Buffer.concat([Buffer.from([alpnBody.length >> 8, alpnBody.length & 0xff]), alpnBody]);
  const extAlpn = Buffer.concat([Buffer.from([0x00, 0x10]), Buffer.from([alpnList.length >> 8, alpnList.length & 0xff]), alpnList]);
  const exts = Buffer.concat([extSniFull, extAlpn]);

  const session = Buffer.from([]);
  const ciphers = Buffer.from([0x13, 0x01]);
  const comp = Buffer.from([0x00]);
  const body = Buffer.concat([
    Buffer.from([0x01]),                     // handshake type ClientHello
    Buffer.from([0x00, 0x00, 0x00]),         // length placeholder (not parsed)
    Buffer.from([0x03, 0x03]),               // legacy version
    Buffer.alloc(32, 0xab),                  // random
    Buffer.from([session.length]), session,
    Buffer.from([ciphers.length >> 8, ciphers.length & 0xff]), ciphers,
    Buffer.from([comp.length]), comp,
    Buffer.from([exts.length >> 8, exts.length & 0xff]), exts
  ]);
  const record = Buffer.concat([Buffer.from([0x16, 0x03, 0x01]), Buffer.from([body.length >> 8, body.length & 0xff]), body]);
  const parsed = parseClientHello(record);
  assert.strictEqual(parsed.sni, sni, 'SNI parsed');
  assert.deepStrictEqual(parsed.alpn, ['h2'], 'ALPN parsed');
  console.log('TLS parser: OK (' + parsed.sni + ', alpn=' + parsed.alpn.join(',') + ')');
}

// ---- nodes generator ----
const nodesLib = require(path.join(root, 'lib/nodes'));
{
  const built = nodesLib.generate({
    domain: 'cdn.example.com',
    settings: { httpsPorts: [443, 2053], prefix: 'Neon', maxNodes: 150 },
    addresses: ['cdn.example.com', '104.17.1.1', '172.64.2.2']
  });
  assert.strictEqual(built.nodes.length, 6, '3 addresses × 2 ports');
  assert.strictEqual(built.nodes[0].port, 443);
  assert.ok(built.nodes[0].tls);
  assert.strictEqual(built.nodes[0].sni, 'cdn.example.com');
  const s = nodesLib.summarise(built.nodes);
  assert.strictEqual(s.addresses, 3);
  assert.strictEqual(s.ports, 2);
  const capped = nodesLib.generate({ domain: 'x.com', settings: { httpsPorts: [443], maxNodes: 2 }, addresses: ['a.com', 'b.com', 'c.com'] });
  assert.strictEqual(capped.nodes.length, 2);
  assert.ok(capped.truncated);
  const unproxied = nodesLib.usablePorts({ httpsPorts: [443, 2053] }, false);
  assert.deepStrictEqual(unproxied.https, [443], 'unproxied keeps only 443');
  console.log('Nodes: OK (6 nodes, caps, port filter)');
}

// ---- enforce.evaluate (pure) ----
const { evaluate } = require(path.join(root, 'lib/enforce'));
{
  const now = new Date('2026-01-15T00:00:00Z');
  const clients = [
    { id: 'a', enabled: true, usedBytes: 500, limitBytes: 1000, expiry: '2026-02-01T00:00:00Z' },        // fine
    { id: 'b', enabled: true, usedBytes: 2000, limitBytes: 1000, expiry: null },                          // over quota
    { id: 'c', enabled: true, usedBytes: 0, limitBytes: 1000, expiry: '2026-01-01T00:00:00Z' },           // expired
    { id: 'd', enabled: false, disabledReason: 'quota', usedBytes: 100, limitBytes: 1000, expiry: null }  // back in limits
  ];
  const { changed, events } = evaluate(clients, now);
  assert.strictEqual(clients[0].enabled, true, 'a stays enabled');
  assert.strictEqual(clients[1].enabled, false, 'b disabled');
  assert.strictEqual(clients[1].disabledReason, 'quota');
  assert.strictEqual(clients[2].disabledReason, 'expired');
  assert.strictEqual(clients[3].enabled, true, 'd re-enabled');
  assert.strictEqual(events.length, 2, 'two disable events');
  assert.ok(changed);
  console.log('Enforce: OK (quota, expiry, re-enable, events)');
}

// ---- store: parseSize / expiry / restore ----
const { Store, parseSize } = require(path.join(root, 'lib/store'));
{
  assert.strictEqual(parseSize('50GB'), 50 * 1024 ** 3);
  assert.strictEqual(parseSize('20mb'), 20 * 1024 ** 2);
  assert.strictEqual(parseSize(2), 2 * 1024 ** 3);
  assert.strictEqual(parseSize(''), 0);
  // start-after-first-use expiry
  const c = { startAfterFirstUse: true, firstUseAt: '2026-01-01T00:00:00Z', durationMinutes: 1440 };
  const { expiryOf } = require(path.join(root, 'lib/enforce'));
  assert.strictEqual(expiryOf(c), '2026-01-02T00:00:00.000Z');
  console.log('Store helpers: OK');
}

// ---- links builder (with a temp store) ----
{
  const os = require('os');
  const fs = require('fs');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'neon-test-'));
  const { buildConfig } = require(path.join(root, 'lib/config'));
  process.env.NEON_DATA_DIR = tmp;
  const cfg = buildConfig();
  const store = new Store(cfg);
  const client = store.newClient({ tag: 'test-user', limitGB: '10GB' });
  const { LinkBuilder } = require(path.join(root, 'lib/links'));
  const lb = new LinkBuilder(cfg, store, 'panel.example.com');
  const nodes = lb.nodesFor(client.uuid, client.tag);
  assert.ok(nodes.length >= 8, 'at least 8 protocol nodes, got ' + nodes.length);
  const vlessTls = nodes.find((n) => n.type === 'VLESS-WS-TLS');
  assert.ok(vlessTls.uri.startsWith('vless://' + client.uuid), 'vless uri embeds uuid');
  assert.ok(vlessTls.uri.includes('security=tls'), 'tls marker');
  assert.ok(vlessTls.uri.includes('pcs='), 'cert pin present');
  const vmessNode = nodes.find((n) => n.type === 'VMess-WS-TLS');
  const vmJson = JSON.parse(Buffer.from(vmessNode.uri.replace('vmess://', ''), 'base64').toString());
  assert.strictEqual(vmJson.add, 'panel.example.com');
  assert.strictEqual(vmJson.id, client.uuid);
  const ssNode = nodes.find((n) => n.type === 'Shadowsocks-WS');
  assert.ok(ssNode && ssNode.uri.startsWith('ss://'));
  // clash yaml + singbox json
  const yaml = lb.clashYaml(nodes);
  assert.ok(yaml.includes('proxies:') && yaml.includes('url-test'));
  const json = lb.singboxJson(nodes.map((n) => (Array.isArray(n.sbOut) ? n : { ...n, sbOut: [n.sbOut] })));
  const parsed = JSON.parse(json);
  assert.ok(parsed.outbounds.some((o) => o.type === 'selector'));
  // backup restore roundtrip
  const backup = store.exportBackup();
  const store2 = new Store(cfg);
  store2.restoreBackup(JSON.parse(JSON.stringify(backup)));
  assert.strictEqual(store2.data.clients.length, 1);
  assert.strictEqual(store2.data.clients[0].uuid, client.uuid);
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log('Links + backup: OK (' + nodes.length + ' nodes, clash + singbox + vmess uri)');
}

// ---- self-signed cert ----
{
  const os2 = require('os');
  const fs2 = require('fs');
  const crypto = require('crypto');
  const tmp2 = fs2.mkdtempSync(path.join(os2.tmpdir(), 'neon-cert-'));
  const { ensureTlsCertificates, certSha256 } = require(path.join(root, 'lib/cert'));
  const r = ensureTlsCertificates(path.join(tmp2, 'c.pem'), path.join(tmp2, 'k.pem'), 'x.example.com');
  assert.ok(r && r.cert && r.key);
  const x509 = new crypto.X509Certificate(r.cert);
  assert.strictEqual(x509.subject, 'CN=x.example.com');
  assert.strictEqual(certSha256(path.join(tmp2, 'c.pem')), x509.fingerprint256.replace(/:/g, '').toLowerCase());
  fs2.rmSync(tmp2, { recursive: true, force: true });
  console.log('Cert: OK (self-signed + sha256 pin)');
}

console.log('\n✓ All unit tests passed.');
