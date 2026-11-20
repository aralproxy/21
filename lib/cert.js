/**
 * Aral Neon — self-signed TLS certificate (pure Node, openssl optional).
 * The SHA-256 of the cert feeds the "pcs=" pin in share links (Xray 26.2+)
 * and the "fingerprint" pin in Clash Meta configs.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

// ---- minimal ASN.1 DER builders ----
function asn1(tag, ...children) {
  const content = Buffer.concat(children);
  let len;
  if (content.length < 128) len = Buffer.from([content.length]);
  else if (content.length < 256) len = Buffer.from([0x81, content.length]);
  else if (content.length < 65536) len = Buffer.from([0x82, (content.length >> 8) & 0xff, content.length & 0xff]);
  else len = Buffer.from([0x83, (content.length >> 16) & 0xff, (content.length >> 8) & 0xff, content.length & 0xff]);
  return Buffer.concat([Buffer.from([tag]), len, content]);
}
const seq = (...ch) => asn1(0x30, ...ch);
const int = (val) => asn1(0x02, Buffer.isBuffer(val) ? val : Buffer.from([val]));
const oid = (bytes) => asn1(0x06, Buffer.from(bytes));
const utf8 = (str) => asn1(0x0c, Buffer.from(str, 'utf8'));
function utcTime(d) {
  const pad = (n) => String(n).padStart(2, '0');
  const s = String(d.getUTCFullYear()).slice(2) + pad(d.getUTCMonth() + 1) + pad(d.getUTCDate()) + pad(d.getUTCHours()) + pad(d.getUTCMinutes()) + pad(d.getUTCSeconds()) + 'Z';
  return asn1(0x17, Buffer.from(s, 'ascii'));
}

function generateSelfSignedCert(commonName = 'localhost') {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const spkiDer = publicKey.export({ type: 'spki', format: 'der' });
  const sigAlg = seq(oid([0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x0b]), Buffer.from([0x05, 0x00])); // sha256WithRSAEncryption
  const name = seq(asn1(0x31, seq(oid([0x55, 0x04, 0x03]), utf8(commonName))));
  const now = new Date();
  const notAfter = new Date(now.getTime() + 365 * 24 * 3600 * 1000);
  const serial = crypto.randomBytes(8);
  serial[0] &= 0x7f;
  const tbs = seq(asn1(0xa0, int(2)), int(serial), sigAlg, name, seq(utcTime(now), utcTime(notAfter)), name, spkiDer);
  const sig = crypto.sign('sha256', tbs, privateKey);
  const certDer = seq(tbs, sigAlg, asn1(0x03, Buffer.concat([Buffer.from([0x00]), sig])));
  return {
    certPem: '-----BEGIN CERTIFICATE-----\n' + certDer.toString('base64').match(/.{1,64}/g).join('\n') + '\n-----END CERTIFICATE-----\n',
    keyPem: privateKey.export({ type: 'pkcs8', format: 'pem' })
  };
}

/** Ensure a cert exists; renew when < 3 days remain. openssl first, pure-JS fallback. */
function ensureTlsCertificates(certPath, keyPath, cn = 'localhost') {
  try {
    if (fs.existsSync(certPath) && fs.existsSync(keyPath)) {
      const c = fs.readFileSync(certPath, 'utf8');
      const k = fs.readFileSync(keyPath, 'utf8');
      if (c.includes('BEGIN CERTIFICATE') && k.includes('PRIVATE KEY')) {
        let expiring = false;
        try { expiring = new Date(new crypto.X509Certificate(c).validTo).getTime() - Date.now() < 3 * 86400000; } catch {}
        if (!expiring) return { cert: c, key: k };
      }
    }
  } catch {}

  try { fs.mkdirSync(path.dirname(certPath), { recursive: true }); } catch {}

  try {
    const res = spawnSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-subj', `/CN=${cn}`, '-keyout', keyPath, '-out', certPath, '-days', '365'], { timeout: 15000 });
    if (res.status === 0 && fs.existsSync(certPath) && fs.existsSync(keyPath)) {
      return { cert: fs.readFileSync(certPath, 'utf8'), key: fs.readFileSync(keyPath, 'utf8') };
    }
  } catch {}

  try {
    const { certPem, keyPem } = generateSelfSignedCert(cn);
    fs.writeFileSync(keyPath, keyPem, 'utf8');
    fs.writeFileSync(certPath, certPem, 'utf8');
    return { cert: certPem, key: keyPem };
  } catch {
    return null;
  }
}

/** SHA-256 (hex) of the served certificate, cached by mtime. */
function certSha256(certPath) {
  try {
    const st = fs.statSync(certPath);
    if (certSha256._c && certSha256._c.m === st.mtimeMs && certSha256._c.p === certPath) return certSha256._c.v;
    const v = new crypto.X509Certificate(fs.readFileSync(certPath)).fingerprint256.replace(/:/g, '').toLowerCase();
    certSha256._c = { p: certPath, m: st.mtimeMs, v };
    return v;
  } catch {
    return '';
  }
}

module.exports = { ensureTlsCertificates, certSha256, generateSelfSignedCert };
