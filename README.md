<div dir="rtl">

# ✨ Aral Neon

**یک پورت، همهٔ پروتکل‌ها، درخشش طلایی.**

پنل پروکسی نسل جدید — ترکیب معماری تک‌پورت و چند-پروتکلی [Aral-Pars](https://github.com/Aral-Dev/Aral-Pars) با سیستم مدیریت کلاینت، Node Generator کلادفلر و سابسکریپشن هوشمند [RailPanel](https://github.com/F0rc3Run/RailPanel). با تم اختصاصی **Barberry Gold Neon**، رابط کاملاً فارسی (RTL) + انگلیسی و بدون هیچ وابستگی npm.

---

## 🚀 اجرا

### Railway (پیشنهادی)

1. مخزن را به Railway وصل کنید (Deploy from GitHub).
2. Railway خودش `PORT` را تزریق می‌کند — همین کافی است.
3. پنل: `https://<app>.up.railway.app/neon`
4. اولین ورود = ساخت رمز (حداقل ۸ کاراکتر).

### VPS / Pterodactyl

```bash
# نیازمند Node.js 20+
node server.js
```

برای نودهای Cloudflare روی پورت‌های جایگزین، پورت‌های TLS اضافه را باز کنید:

```bash
EXTRA_TLS_PORTS=2053,2083,2087,2096,8443 PORT=443 node server.js
```

### Docker

```bash
docker build -t aral-neon .
docker run -d --name neon -p 8080:8080 -p 2053:2053 -p 8443:8443 \
  -v neon-data:/app/neon-data aral-neon
```

---

## 📡 پروتکل‌ها (همه روی یک پورت)

| پروتکل | ترنسپورت | موتور |
|---|---|---|
| VLESS-WS / VLESS-WS-TLS | WebSocket | sing-box |
| VMess-WS / VMess-WS-TLS | WebSocket | sing-box |
| Trojan-WS / Trojan-WS-TLS | WebSocket | sing-box |
| VLESS / VMess / Trojan-HTTPUpgrade | HTTPUpgrade | sing-box |
| VLESS-gRPC (h2c) | gRPC | sing-box |
| VLESS-gRPC-TLS | gRPC + ALPN h2 | sing-box |
| Shadowsocks-WS | WebSocket (v2ray-plugin) | Xray |
| VLESS-XHTTP | XHTTP (packet-up/stream-up) | Xray |

- **معماری تک‌پورت:** یک `net` router بایت‌های اول هر اتصال را می‌خواند؛ TLS ClientHello با SNI/ALPN به terminator داخلی یا gRPC می‌رود، preface يادداشت HTTP/2 cleartext به gRPC h2c، و HTTP ساده به پنل/سابسکریپشن.
- **Dual Engine:** sing-box + Xray-core هر دو هنگام اولین اجرا دانلود می‌شوند (بدون وابستگی، استخراج zip دستی، تأیید SHA-256 برای Xray).
- **موتورها فقط روی 127.0.0.1 گوش می‌دهند** — هیچ پورت داخلی در معرض نیست.

## 👥 مدیریت کلاینت

- کلاینت **نامحدود**؛ هر کلاینت: نام/تگ، UUID اختصاصی، سهمیه GB، تاریخ انقضا (تاریخ مشخص / مدت / شروع با اولین استفاده)، enable/disable
- **اعمال زنده:** حلقه ۳۰ ثانیه‌ای کانترهای per-user را از Stats API ایکس‌ری می‌خواند، سهمیه و انقضا را اعمال می‌کند و فقط وقتی مجموعه کلاینت‌های فعال عوض شد موتورها را rebuild می‌کند
- ریست ترافیک، کپی لینک، QR، لینک سابسکریپشن اختصاصی `/sub/<id>`

## ☁️ Node Generator (Cloudflare)

- دامنه پشت Cloudflare را تأیید کنید؛ پنل رکوردهای A را می‌خواند و تشخیص می‌دهد proxied است یا DNS-only
- IPهای تمیز دلخواه + پورت‌های HTTPS کلادفلر (443, 2053, 2083, 2087, 2096, 8443)
- Remark قابل تغییر، پیشوند نام دلخواه، سقف تعداد نود
- **Self-test از خود سرور:** برای هر نود handshake TLS به address:port آزمایش می‌شود

## 🔗 سابسکریپشن هوشمند

یک لینک `https://host/sub/<id>` برای همه:

| کلاینت | فرمت |
|---|---|
| v2rayNG / v2rayN / Streisand / Shadowrocket | base64 لینک‌ها |
| Clash Meta / Mihomo / Stash | YAML کامل (proxies + groups + rules) |
| sing-box / Hiddify | JSON کامل (dns + inbounds + selector/urltest) |
| مرورگر | صفحه HTML با باقیمانده ترافیک، انقضا، QR و دکمه‌های import |

تشخیص از روی User-Agent؛ بدون query string. هدر `Subscription-Userinfo` برای نمایش نوار مصرف در کلاینت‌ها.

## 🎨 پنل (Barberry Gold Neon)

- پالت: زرشکی `#701C2B` · طلایی نئون `#D4AF37` · عمیق `#260810` · کرم `#FBF8F2` روی زمینه `#0A0508`
- Glassmorphism قوی، glow طلایی روی دکمه‌ها و کارت‌ها، انیمیشن‌های rise/glow-pulse
- **۵ dial دایره‌ای:** ترافیک، CPU، حافظه، کلاینت‌ها، نودها + نمودار ترافیک زنده (canvas)
- فونت‌ها: **Vazirmatn** (فارسی) + **Space Grotesk** (اعداد/لاتین)
- RTL کامل + سوییچ فارسی/انگلیسی و تیره/روشن از داخل پنل
- موبایل: سایدبار کشویی، جداول اسکرولی، dialهای فشرده

## 🛡️ امنیت و عملیات

- رمز scrypt + کوکی امضاشده HMAC (۱۴ روز) + throttle لاگین (۸ تلاش / ۱۵ دقیقه)
- مخفی‌سازی پنل با `PANEL_PATH` — خارج از مسیر، پاسخ خالی 200
- گواهی self-signed با پین `pcs=` (Xray 26.2+) و `fingerprint` در Clash
- **Backup/Restore کامل JSON** (کلاینت‌ها، نودها، تنظیمات — توکن تلگرام حذف می‌شود)
- **Telegram Bot:** هشدار اتمام سهمیه/انقضا/لاگین/خرابی موتور + بکاپ روزانه
- آمار زنده سیستم (CPU از /proc، memory، uptime)

## 🗂️ ساختار

```
aral-neon/
├── server.js              # نقطه ورود: بوت، پورت‌ها، موتورها، enforce
├── lib/
│   ├── constants.js       # برند، مسیرها، پالت پورت‌های CF
│   ├── config.js          # merge: defaults ← env
│   ├── store.js           # state پایدار (panel.json، atomic write)
│   ├── logger.js  sysinfo.js  traffic.js  qr.js
│   ├── cert.js            # گواهی self-signed + پین SHA-256
│   ├── tls-sni.js         # پارسر ClientHello (SNI/ALPN)
│   ├── binaries.js        # دانلود sing-box / Xray
│   ├── mux/tcp-router.js  # multiplexer تک‌پورت
│   ├── engines/singbox.js engines/xray.js
│   ├── xray-stats.js      # کانترهای per-user
│   ├── enforce.js         # حلقه سهمیه/انقضا
│   ├── nodes.js           # تولید نود Cloudflare
│   ├── links.js           # URI + Clash + sing-box
│   ├── subpage.js         # صفحه HTML سابسکریپشن
│   ├── telegram.js  selftest.js
│   └── panel/api.js  panel/server.js
├── web/
│   ├── index.html  login.html
│   ├── app.js             # SPA بدون وابستگی
│   └── assets/neon.css    # تم Barberry Gold Neon
└── neon-data/             # (runtime) state، باینری‌ها، گواهی، لاگ‌ها
```

## ⚙️ متغیرهای محیطی

| متغیر | پیش‌فرض | توضیح |
|---|---|---|
| `PORT` / `NEON_PORT` | `8080` | پورت عمومی (Railway خودش می‌دهد) |
| `PANEL_PATH` | `neon` | مسیر مخفی پنل |
| `EXTRA_TLS_PORTS` | — | پورت‌های TLS اضافه برای CF (VPS) |
| `DOMAIN` | — | دامنه برای SNI/لینک‌ها |
| `FORCE_HOST` | — | اجبار host لینک‌ها |
| `ENABLE_*` | `1` | خاموش/روشن کردن هر پروتکل (مثل `ENABLE_XHTTP=0`) |
| `SS_METHOD` | `aes-256-gcm` | رمزنگاری Shadowsocks |
| `SINGBOX_VERSION` / `XRAY_VERSION` | latest | نسخه موتورها |
| `LINK_FP` / `LINK_ALPN` | `chrome` / `http/1.1` | uTLS fingerprint و ALPN لینک‌ها |
| `NEON_DATA_DIR` | `./neon-data` | مسیر داده |

## 🧭 نکته‌های استقرار

- **Railway بدون volume:** داده‌ها با هر ری‌استارت ریست می‌شوند؛ برای ماندگاری یک Volume به `/app/neon-data` وصل کنید.
- **Pterodactyl:** پورت اختصاصی egg را در `PORT` بدهید؛ `EXTRA_TLS_PORTS` فقط وقتی چند پورت مجاز دارید.
- **Cloudflare proxied:** برای لینک مستقیم پنل، پورت باید در لیست CF باشد (443 توصیه می‌شود).
- مصرف کلاینت در هر دو موتور شمرده می‌شود اما کانتر دقیق per-user از Stats API ایکس‌ری می‌آید (این‌باند‌های nodeset/core/xhttp).

---

</div>

<div dir="ltr">

# ✨ Aral Neon (English)

**One port. Every protocol. Neon gold.**

A next-generation proxy panel combining the single-port multi-protocol architecture of [Aral-Pars](https://github.com/Aral-Dev/Aral-Pars) with the client management, Cloudflare node generator and smart subscriptions of [RailPanel](https://github.com/F0rc3Run/RailPanel) — wrapped in the **Barberry Gold Neon** theme, fully RTL Persian + English, with zero npm dependencies.

## Quick start

- **Railway:** connect the repo, done — Railway injects `PORT`. Panel at `/<PANEL_PATH>` (default `/neon`).
- **VPS:** `node server.js` (Node.js 20+). For alternate Cloudflare TLS ports: `EXTRA_TLS_PORTS=2053,2083,2087,2096,8443 PORT=443 node server.js`
- **Docker:** build and run, mount a volume at `/app/neon-data`.

First visit creates the admin password (min 8 chars).

## Highlights

- **Single-port mux:** raw TCP router reads the first bytes — TLS ClientHello (SNI/ALPN) → internal HTTPS terminator or gRPC; HTTP/2 cleartext preface → gRPC h2c; plain HTTP → panel & subscriptions.
- **Dual engine:** sing-box (VLESS/VMess/Trojan-WS, HTTPUpgrade ×3, gRPC ±TLS) + Xray-core (XHTTP, Shadowsocks-WS, nodeset, core inbounds), auto-downloaded with SHA-256 verification.
- **Unlimited clients** with UUID, GB quota, expiry (date / duration / start-on-first-use), live enforcement every 30 s, per-user counters via Xray Stats Service.
- **Cloudflare node generator:** verify a proxied domain, pick clean IPs and CF HTTPS ports, self-test nodes from the server.
- **Smart subscription:** one `/sub/<id>` URL serves base64 (v2ray family), Clash Meta YAML, or sing-box JSON by User-Agent; browsers get a beautiful page with remaining traffic, expiry, QR and import buttons.
- **Ops:** full JSON backup/restore, Telegram alerts (quota/expiry/login/engine-down) + daily backup delivery, hidden panel path, self-signed cert with `pcs=` pin.
- **UI:** Barberry Gold Neon glassmorphism, 5 circular dials, live traffic chart, Vazirmatn + Space Grotesk, RTL/LTR and dark/light switches, fully responsive.

See the Persian section above for the environment variable table and project structure. Data lives in `neon-data/` — mount it on a volume to survive restarts.

</div>
