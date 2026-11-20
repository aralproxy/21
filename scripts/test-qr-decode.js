/** Verify the in-repo QR encoder against a real decoder (pyzbar via a rendered PNG). */
'use strict';
const path = require('path');
const { execSync } = require('child_process');
const qr = require(path.join(__dirname, '..', 'lib', 'qr'));

const samples = [
  'https://example.com/sub/abcdef123456',
  'vless://feffa6b2-d3be-47d0-80e5-f6a1931df4fe@47.57.232.232:18080?encryption=none&security=tls&sni=example.com&fp=chrome&alpn=http%2F1.1&allowInsecure=1&pcs=90b2b4f94a5e7106f0e224d2e4885368060a45de66267a0f1d5a34fea1dada71&type=ws&host=example.com&path=%2F%40AralNeon--ws#Neon%20%E2%80%A2%20VLESS-WS-TLS%20%C2%B7%20ali-test-long-name-here',
  'A'.repeat(400),      // pushes a high version
  'پرچم تست فارسی ✨'    // multibyte UTF-8
];

const tmp = path.join(__dirname, 'qr-sample.svg');
for (const text of samples) {
  const svg = qr.toSvg(text, { scale: 6, quiet: 4, dark: '#000', light: '#fff' });
  require('fs').writeFileSync(tmp, svg);
  const out = execSync(`python3 - <<'PY'
from PIL import Image
import cairosvg, io, pyzbar.pyzbar as pyzbar
with open(${JSON.stringify(tmp)}, 'rb') as f:
    png = cairosvg.svg2png(bytestring=f.read())
img = Image.open(io.BytesIO(png))
res = pyzbar.decode(img)
if not res:
    raise SystemExit('DECODE-FAILED')
print(res[0].data.decode('utf-8'))
PY`, { encoding: 'utf8' }).trim();
  const ok = out === text;
  const enc = qr.encode(text);
  console.log(`${ok ? 'OK ' : 'FAIL'} v${String(enc.version).padStart(2)} ${text.length}b ${text.slice(0, 40)}${text.length > 40 ? '…' : ''}`);
  if (!ok) { console.log('  decoded: ' + out.slice(0, 80)); process.exit(1); }
}
require('fs').unlinkSync(tmp);
console.log('✓ QR round-trip decode passed for all samples.');
