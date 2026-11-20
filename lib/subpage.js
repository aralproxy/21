/**
 * Aral Neon — the HTML page a person sees when opening /sub/<id> in a browser.
 * Barberry Gold Neon theme, RTL Persian + English fallback, live traffic/expiry,
 * QR (inline SVG), per-app import buttons. Proxy clients still get the raw list
 * (content negotiation happens in the panel router before this renders).
 */
'use strict';

const { toSvg } = require('./qr');
const { BRAND, fmtBytes } = require('./constants');

function esc(v) {
  return String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function timeLeft(expiry, fa) {
  if (!expiry) return null;
  const ms = Math.max(0, new Date(expiry).getTime() - Date.now());
  const unit = (n, f, e) => ({ value: n, unit: fa ? f : e, expired: false });
  if (ms >= 2 * 86400000) { const d = Math.ceil(ms / 86400000); return unit(d, d === 1 ? 'روز باقی‌مانده' : 'روز باقی‌مانده', d === 1 ? 'day left' : 'days left'); }
  if (ms >= 3600000) { const h = Math.floor(ms / 3600000); return unit(h, h === 1 ? 'ساعت باقی‌مانده' : 'ساعت باقی‌مانده', h === 1 ? 'hour left' : 'hours left'); }
  if (ms > 0) { const m = Math.max(1, Math.floor(ms / 60000)); return unit(m, 'دقیقه باقی‌مانده', 'minutes left'); }
  return { value: 0, unit: fa ? 'منقضی شده' : 'expired', expired: true };
}

function render({ client, subUrl, links, nodesetName, lang = 'fa' }) {
  const fa = lang !== 'en';
  const limit = Number(client.limitBytes || 0);
  const used = Number(client.usedBytes || 0);
  const remaining = limit ? Math.max(0, limit - used) : null;
  const usedPct = limit ? Math.min(100, Math.round(used / limit * 100)) : 0;
  const realExpiry = client.effectiveExpiry || client.expiry;
  const left = timeLeft(realExpiry, fa);
  const expired = left ? left.expired : false;
  const overQuota = limit > 0 && used >= limit;
  const qr = toSvg(subUrl, { scale: 5, quiet: 3, dark: 'currentColor' });

  const T = fa ? {
    eyebrow: nodesetName || BRAND.name,
    active: 'فعال', expired: 'منقضی', quota: 'سهمیه تمام شد',
    trafficLeft: limit ? `از ${fmtBytes(limit)}` : 'ترافیک نامحدود',
    noLimit: 'نامحدود', timeLeft: 'بدون محدودیت زمانی',
    used: 'مصرف‌شده', expires: 'انقضا', never: 'هرگز',
    scan: 'برای import اسکن کنید',
    copy: 'کپی', copied: 'کپی شد!',
    copyAll: (n) => `کپی همه ${n} سرور`,
    clientFor: 'لینک سابسکریپشن با کلاینت انتخاب‌شده‌ی شما سازگار است',
    hint: 'همین یک لینک برای همه کار می‌کند — اپ شما را تشخیص می‌دهد و فرمت درست را می‌دهد. اگر اشتباه تشخیص داد از آدرس صریح استفاده کنید.',
    servers: 'سرورها', updated: 'به‌روزرسانی',
    pending: 'با اولین اتصال شروع می‌شود',
    dir: 'rtl'
  } : {
    eyebrow: nodesetName || BRAND.name,
    active: 'active', expired: 'expired', quota: 'quota used up',
    trafficLeft: limit ? `of ${fmtBytes(limit)}` : 'unlimited traffic',
    noLimit: '∞', timeLeft: 'no time limit',
    used: 'used', expires: 'expires', never: 'never',
    scan: 'Scan to import',
    copy: 'Copy', copied: 'Copied!',
    copyAll: (n) => `Copy all ${n} servers`,
    clientFor: 'The subscription link matches your selected client',
    hint: 'The one link above works for all of them — it detects your app and serves the right format. If it guesses wrong, use the explicit URL.',
    servers: 'Servers', updated: 'Updated',
    pending: 'starts on first use',
    dir: 'ltr'
  };

  const APPS = [
    { key: 'v2ray', name: 'v2rayNG / v2rayN' },
    { key: 'clash', name: 'Clash Meta / Mihomo' },
    { key: 'singbox', name: 'sing-box / Hiddify' }
  ];

  return `<!DOCTYPE html>
<html lang="${fa ? 'fa' : 'en'}" dir="${T.dir}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex, nofollow">
<title>${esc(client.tag)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Vazirmatn:wght@400;500;700;900&family=Space+Grotesk:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
:root{
  --primary:#701C2B; --accent:#D4AF37; --deep:#260810; --cream:#FBF8F2;
  --bg:#0A0508; --bg2:#12080C;
  --glass:rgba(212,175,55,.055); --glass2:rgba(212,175,55,.09);
  --line:rgba(212,175,55,.22); --line-soft:rgba(212,175,55,.12);
  --ink:#FBF8F2; --ink-dim:rgba(251,248,242,.62); --ink-faint:rgba(251,248,242,.36);
  --ok:#3DDC97; --bad:#FF5C5C;
  --glow:0 0 28px -6px rgba(212,175,55,.45);
  --sheen:linear-gradient(140deg,rgba(255,255,255,.07),rgba(255,255,255,0) 46%);
}
*{box-sizing:border-box;margin:0;padding:0;-webkit-tap-highlight-color:transparent}
body{
  background:
    radial-gradient(70% 55% at 15% 0%, rgba(112,28,43,.38), transparent 60%),
    radial-gradient(60% 50% at 85% 100%, rgba(212,175,55,.14), transparent 62%),
    var(--bg);
  background-attachment:fixed;color:var(--ink);
  font-family:Vazirmatn,"Space Grotesk",system-ui,sans-serif;
  font-size:14px;line-height:1.7;padding:18px 14px 40px;-webkit-font-smoothing:antialiased}
.mono{font-family:"Space Grotesk",ui-monospace,monospace;font-variant-numeric:tabular-nums;direction:ltr}
.wrap{max-width:520px;margin:0 auto;display:grid;gap:12px}
.card{background:linear-gradient(160deg,var(--glass),rgba(38,8,16,.45));
  border:1px solid var(--line-soft);border-radius:22px;padding:18px;position:relative;overflow:hidden;
  backdrop-filter:blur(18px) saturate(150%);-webkit-backdrop-filter:blur(18px) saturate(150%);
  box-shadow:var(--glow)}
.card::before{content:"";position:absolute;inset:0;pointer-events:none;background:var(--sheen)}
.card>*{position:relative}
.eyebrow{font-family:"Space Grotesk",monospace;font-size:9.5px;font-weight:500;letter-spacing:.19em;
  text-transform:uppercase;color:var(--accent);opacity:.85}
.head{display:flex;align-items:center;gap:12px;margin-bottom:4px}
.mark{width:44px;height:44px;border-radius:50%;flex:none;position:relative;display:grid;place-items:center;
  background:conic-gradient(from 140deg,var(--accent),var(--primary),var(--accent));
  box-shadow:0 0 18px -2px rgba(212,175,55,.5)}
.mark::after{content:"";position:absolute;inset:2px;border-radius:50%;background:var(--deep)}
.mark b{position:relative;z-index:1;font-size:14px;font-family:"Space Grotesk";color:var(--accent);text-shadow:0 0 10px rgba(212,175,55,.8)}
.name{font-size:20px;font-weight:800;letter-spacing:-.02em}
.tag{display:inline-flex;align-items:center;gap:6px;padding:4px 11px;border-radius:99px;font-size:11px;
  background:var(--glass2);border:1px solid var(--line);color:var(--ink-dim)}
.tag.ok{color:var(--ok);border-color:rgba(61,220,151,.4)}
.tag.bad{color:var(--bad);border-color:rgba(255,92,92,.45)}
.stats{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:16px}
.stat .big{font-size:26px;font-weight:900;letter-spacing:-.04em;line-height:1.2;
  background:linear-gradient(100deg,var(--accent),#f0d78c);-webkit-background-clip:text;background-clip:text;color:transparent}
.stat .sub{font-size:11px;color:var(--ink-faint);margin-top:2px}
.bar{height:8px;border-radius:99px;background:rgba(212,175,55,.13);overflow:hidden;margin-top:12px}
.bar i{display:block;height:100%;border-radius:99px;background:linear-gradient(90deg,var(--primary),var(--accent));
  box-shadow:0 0 10px rgba(212,175,55,.6)}
.note{margin-top:12px;padding:11px 13px;border-radius:14px;background:var(--glass2);border:1px solid var(--line);
  font-size:12.5px;color:var(--ink-dim);white-space:pre-wrap}
.qr{display:grid;place-items:center;padding:16px 0 6px;color:var(--ink)}
.qr svg{width:min(232px,64vw);height:auto;background:#fff;padding:10px;border-radius:14px;color:#000;
  box-shadow:0 0 24px -6px rgba(212,175,55,.55)}
.row{display:flex;gap:8px;align-items:center;margin-top:10px}
.row input{flex:1;min-width:0;padding:10px 12px;border-radius:13px;background:rgba(10,5,8,.6);
  border:1px solid var(--line);color:var(--ink);font-family:"Space Grotesk",monospace;font-size:11px}
.btn{padding:10px 15px;border-radius:13px;border:0;font:inherit;font-size:12.5px;font-weight:700;color:var(--deep);
  background:linear-gradient(100deg,var(--accent),#f0d78c);cursor:pointer;flex:none;box-shadow:0 0 16px -4px rgba(212,175,55,.6)}
.btn.ghost{background:none;border:1px solid var(--line);color:var(--ink-dim);font-weight:500;box-shadow:none}
.btn:active{transform:scale(.97)}
.apps{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:8px;margin-top:12px}
.apps a{display:block;padding:11px 13px;border-radius:13px;background:var(--glass2);border:1px solid var(--line);
  color:var(--ink-dim);text-decoration:none;font-size:12.5px;text-align:center;transition:.16s}
.apps a:hover{color:var(--ink);border-color:var(--accent)}
.apps a.on{color:var(--deep);border-color:transparent;background:linear-gradient(100deg,var(--accent),#f0d78c);
  box-shadow:0 0 16px -4px rgba(212,175,55,.6)}
.rows{display:grid;gap:8px;margin-top:12px}
.rows div{display:flex;justify-content:space-between;gap:12px;font-size:12.5px}
.rows span:first-child{color:var(--ink-dim)}
.hint{margin-top:10px;font-size:11.5px;color:var(--ink-faint);line-height:1.8}
.hint code{font-family:"Space Grotesk",monospace;font-size:10px;color:var(--ink-dim);word-break:break-all;
  background:var(--glass2);padding:1px 5px;border-radius:6px;direction:ltr;unicode-bidi:embed}
.foot{text-align:center;color:var(--ink-faint);font-size:11px;margin-top:6px}
.foot b{font-weight:700;background:linear-gradient(120deg,var(--accent),#f0d78c);-webkit-background-clip:text;background-clip:text;color:transparent}
@media (prefers-reduced-motion:reduce){*{transition:none!important}}
</style>
</head>
<body>
<div class="wrap">
  <div class="card">
    <div class="head">
      <div class="mark"><b>AN</b></div>
      <div>
        <div class="name">${esc(client.tag)}</div>
        <div class="eyebrow">${esc(T.eyebrow)}</div>
      </div>
      <div style="margin-inline-start:auto">
        <span class="tag ${expired || overQuota ? 'bad' : 'ok'}">${expired ? T.expired : overQuota ? T.quota : T.active}</span>
      </div>
    </div>
    <div class="stats">
      <div class="stat">
        <div class="big mono">${limit ? fmtBytes(remaining) : T.noLimit}</div>
        <div class="sub">${T.trafficLeft}</div>
      </div>
      <div class="stat">
        <div class="big mono">${left ? left.value : '∞'}</div>
        <div class="sub">${left ? left.unit : T.timeLeft}</div>
      </div>
    </div>
    ${limit ? `<div class="bar"><i style="width:${usedPct}%"></i></div>` : ''}
    ${client.comment ? `<div class="note">${esc(client.comment)}</div>` : ''}
  </div>

  <div class="card">
    <div class="eyebrow">${T.scan}</div>
    <div class="qr">${qr}</div>
    <div class="row">
      <input id="subUrl" value="${esc(subUrl)}" readonly onclick="this.select()">
      <button class="btn" data-copy="#subUrl">${T.copy}</button>
    </div>
    <div class="row">
      <button class="btn ghost" id="copyAll" style="flex:1">${T.copyAll(links.length)}</button>
    </div>
  </div>

  <div class="card">
    <div class="eyebrow">${T.clientFor}</div>
    <div class="apps">
      ${APPS.map((a) => `<a class="${a.key === (client.clientApp || 'v2ray') ? 'on' : ''}" href="?client=${a.key}">${esc(a.name)}</a>`).join('')}
    </div>
    <div class="hint">${T.hint}</div>
  </div>

  <div class="card">
    <div class="eyebrow">${T.servers}</div>
    <div class="rows">
      <div><span>${T.servers}</span><b class="mono">${links.length}</b></div>
      <div><span>${T.used}</span><b class="mono">${fmtBytes(used)}</b></div>
      <div><span>${T.expires}</span><b class="mono">${realExpiry ? esc(realExpiry.slice(0, 10)) : T.never}</b></div>
    </div>
  </div>

  <div class="foot">${BRAND.name} · <b>${fa ? 'یک پورت، همهٔ پروتکل‌ها' : 'One port, every protocol'}</b></div>
</div>

<script>
const ALL_LINKS = ${JSON.stringify(links.map((l) => l.uri))};
async function copyText(text, button) {
  const original = button.textContent;
  let ok = false;
  try { await navigator.clipboard.writeText(text); ok = true; }
  catch {
    const area = document.createElement('textarea');
    area.value = text; area.style.position = 'fixed'; area.style.opacity = '0';
    document.body.appendChild(area); area.select();
    try { ok = document.execCommand('copy'); } catch {}
    area.remove();
  }
  button.textContent = ok ? '${T.copied}' : button.textContent;
  setTimeout(() => { button.textContent = original; }, 1600);
}
document.querySelectorAll('[data-copy]').forEach((b) => {
  b.onclick = () => copyText(document.querySelector(b.dataset.copy).value, b);
});
document.getElementById('copyAll').onclick = (e) => copyText(ALL_LINKS.join('\\n'), e.currentTarget);
</script>
</body>
</html>`;
}

module.exports = { render };
