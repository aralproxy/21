/* ============================================================
   Aral Neon — panel SPA logic
   Barberry Gold Neon · RTL fa / en · zero dependencies
   ============================================================ */
'use strict';

(function () {
  var BASE = window.__NEON_BASE || '';
  var state = {
    lang: 'fa',
    theme: 'dark',
    health: null,
    clients: [],
    nodeset: null,
    nodeSettings: null,
    domain: null,
    coreInbounds: [],
    chartData: []
  };

  /* ---------------- i18n ---------------- */
  var I18N = {
    fa: {
      nav_dashboard: 'داشبورد', nav_clients: 'کلاینت‌ها', nav_nodes: 'نودها (Cloudflare)',
      nav_inbounds: 'این‌باند‌های دستی', nav_protocols: 'پروتکل‌ها', nav_settings: 'تنظیمات',
      logout: 'خروج', footer: 'یک پورت، همهٔ پروتکل‌ها',
      dash_sub: 'نمای کلی سیستم', clients_sub: 'مدیریت کلاینت‌ها و سهمیه‌ها',
      nodes_sub: 'تولید نود از IPهای تمیز و پورت‌های Cloudflare',
      inbounds_sub: 'این‌باند‌های دستی روی همان پورت', protocols_sub: 'فعال/غیرفعال‌سازی پروتکل‌ها',
      settings_sub: 'امنیت، تلگرام، بکاپ و سیستم',
      dial_traffic: 'ترافیک', dial_cpu: 'پردازنده', dial_memory: 'حافظه', dial_clients: 'کلاینت‌ها', dial_nodes: 'نودها',
      active: 'فعال', total: 'کل',
      live_traffic: 'ترافیک زنده', upload: 'آپلود', download: 'دانلود', active_conn: 'اتصالات فعال',
      summary: 'خلاصه', today: 'امروز', month: 'این ماه', all_time: 'کل',
      clients_notice: 'هر کلاینت UUID اختصاصی، سهمیه ترافیک و تاریخ انقضای خودش را دارد. سهمیه و انقضا به‌صورت زنده اعمال می‌شوند.',
      add_client: 'کلاینت جدید', edit: 'ویرایش', del: 'حذف', links: 'لینک‌ها',
      th_name: 'نام / تگ', th_status: 'وضعیت', th_traffic: 'ترافیک', th_expiry: 'انقضا', th_sub: 'سابسکریپشن',
      th_remark: 'نام', th_protocol: 'پروتکل', th_network: 'ترنسپورت', th_path: 'مسیر',
      unlimited: 'نامحدود', never: 'هرگز', remaining: 'باقی‌مانده',
      quota: 'اتمام سهمیه', expired: 'منقضی', manual: 'غیرفعال دستی',
      reset_traffic: 'ریست ترافیک', enable: 'فعال', disable: 'غیرفعال',
      copy: 'کپی', copied: 'کپی شد!',
      client_tag: 'نام / تگ', client_limit: 'سهمیه ترافیک (GB)', client_expiry: 'تاریخ انقضا',
      client_duration: 'مدت (روز)', client_start_first_use: 'شروع با اولین استفاده',
      client_comment: 'یادداشت (اختیاری)', save: 'ذخیره', cancel: 'انصراف',
      cf_domain: 'دامنه پشت Cloudflare', verify: 'تأیید دامنه',
      domain_hint: 'دامنه باید در Cloudflare پروکسی (ابر نارنجی) شده باشد تا پورت‌های جایگزین کار کنند.',
      gen_settings: 'تنظیمات تولید', clean_ips: 'IPهای تمیز (اختیاری، هر خط یک آدرس)',
      prefix: 'پیشوند نام', max_nodes: 'حداکثر نود', ports: 'پورت‌های HTTPS کلادفلر',
      node_set: 'مجموعه نود', generate: 'تولید نودها', selftest: 'تست از سرور', delete_nodes: 'حذف',
      no_nodes: 'هنوز نودی تولید نشده است. دامنه را تأیید کنید و «تولید نودها» را بزنید.',
      inbounds_notice: 'این‌باند‌های دستی (حداکثر ۴): پروتکل و ترنسپورت دلخواه روی همان پورت اصلی. برای نودهای Cloudflare از بخش «نودها» استفاده کنید.',
      add_inbound: 'این‌باند جدید',
      protocols_notice: 'هر پروتکل را می‌توانید جداگانه فعال/غیرفعال کنید. تغییرات بلافاصله روی موتورها اعمال می‌شود.',
      security: 'امنیت', new_password: 'رمز عبور جدید', change_password: 'تغییر رمز',
      tg_enable: 'فعال‌سازی ربات هشدار', tg_verify: 'اتصال و تست', tg_backup: 'ارسال بکاپ',
      tg_hint: 'هشدارها: اتمام سهمیه، انقضا، لاگین، خرابی موتور + بکاپ روزانه.',
      backup: 'بکاپ / بازیابی', download_backup: 'دانلود بکاپ (JSON)', restore_backup: 'بازیابی از فایل',
      backup_hint: 'بکاپ شامل کلاینت‌ها، نودها، تنظیمات و سهمیه‌هاست (توکن تلگرام حذف می‌شود).',
      system: 'سیستم', confirm_delete: 'مطمئنید؟', saved: 'ذخیره شد',
      sub_url: 'لینک سابسکریپشن', all_links: 'همه لینک‌ها', close: 'بستن',
      test_ok: 'تست موفق', test_fail: 'تست ناموفق', ms: 'میلی‌ثانیه'
    },
    en: {
      nav_dashboard: 'Dashboard', nav_clients: 'Clients', nav_nodes: 'Nodes (Cloudflare)',
      nav_inbounds: 'Core Inbounds', nav_protocols: 'Protocols', nav_settings: 'Settings',
      logout: 'Sign out', footer: 'One port, every protocol',
      dash_sub: 'System overview', clients_sub: 'Clients & quotas',
      nodes_sub: 'Generate nodes from clean IPs and Cloudflare ports',
      inbounds_sub: 'Manual inbounds on the same port', protocols_sub: 'Enable/disable protocols',
      settings_sub: 'Security, Telegram, backup & system',
      dial_traffic: 'Traffic', dial_cpu: 'CPU', dial_memory: 'Memory', dial_clients: 'Clients', dial_nodes: 'Nodes',
      active: 'active', total: 'total',
      live_traffic: 'Live traffic', upload: 'Up', download: 'Down', active_conn: 'Active connections',
      summary: 'Summary', today: 'Today', month: 'This month', all_time: 'All time',
      clients_notice: 'Every client has its own UUID, traffic quota and expiry. Quota and expiry are enforced live.',
      add_client: 'New client', edit: 'Edit', del: 'Delete', links: 'Links',
      th_name: 'Name / tag', th_status: 'Status', th_traffic: 'Traffic', th_expiry: 'Expiry', th_sub: 'Subscription',
      th_remark: 'Name', th_protocol: 'Protocol', th_network: 'Transport', th_path: 'Path',
      unlimited: 'unlimited', never: 'never', remaining: 'left',
      quota: 'quota used up', expired: 'expired', manual: 'disabled',
      reset_traffic: 'Reset traffic', enable: 'Enable', disable: 'Disable',
      copy: 'Copy', copied: 'Copied!',
      client_tag: 'Name / tag', client_limit: 'Traffic quota (GB)', client_expiry: 'Expiry date',
      client_duration: 'Duration (days)', client_start_first_use: 'Start on first use',
      client_comment: 'Comment (optional)', save: 'Save', cancel: 'Cancel',
      cf_domain: 'Domain behind Cloudflare', verify: 'Verify',
      domain_hint: 'The domain must be proxied (orange cloud) for alternate ports to work.',
      gen_settings: 'Generation settings', clean_ips: 'Clean IPs (optional, one per line)',
      prefix: 'Name prefix', max_nodes: 'Max nodes', ports: 'Cloudflare HTTPS ports',
      node_set: 'Node set', generate: 'Generate nodes', selftest: 'Self-test', delete_nodes: 'Delete',
      no_nodes: 'No nodes yet. Verify a domain and press Generate.',
      inbounds_notice: 'Core inbounds (max 4): any protocol/transport on the same public port. For Cloudflare nodes use the Nodes section.',
      add_inbound: 'New inbound',
      protocols_notice: 'Toggle each protocol independently. Changes apply to the engines immediately.',
      security: 'Security', new_password: 'New password', change_password: 'Change password',
      tg_enable: 'Enable alert bot', tg_verify: 'Connect & test', tg_backup: 'Send backup',
      tg_hint: 'Alerts: quota, expiry, login, engine down + daily backup.',
      backup: 'Backup / Restore', download_backup: 'Download backup (JSON)', restore_backup: 'Restore from file',
      backup_hint: 'Backup contains clients, nodes, settings and quotas (Telegram token stripped).',
      system: 'System', confirm_delete: 'Are you sure?', saved: 'Saved',
      sub_url: 'Subscription URL', all_links: 'All links', close: 'Close',
      test_ok: 'passed', test_fail: 'failed', ms: 'ms'
    }
  };
  function t(key) { return (I18N[state.lang] && I18N[state.lang][key]) || I18N.fa[key] || key; }

  /* ---------------- helpers ---------------- */
  function $(id) { return document.getElementById(id); }
  function api(path, opts) {
    opts = opts || {};
    opts.headers = Object.assign({ 'Content-Type': 'application/json', 'x-neon-req': '1' }, opts.headers || {});
    if (opts.body && typeof opts.body !== 'string') opts.body = JSON.stringify(opts.body);
    return fetch(BASE + path, opts).then(function (r) {
      if (r.status === 401 && path !== '/api/login') { location.href = BASE + '/login.html'; throw new Error('auth'); }
      return r.json();
    });
  }
  function fmtBytes(n) {
    var v = Number(n || 0);
    if (v <= 0) return '0 B';
    var units = ['B', 'KB', 'MB', 'GB', 'TB'];
    var i = 0;
    while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
    return (v < 10 ? v.toFixed(1) : Math.round(v)) + ' ' + units[i];
  }
  function fmtBps(n) { return fmtBytes(n) + '/s'; }
  function fmtDate(iso) {
    if (!iso) return t('never');
    try { return new Date(iso).toISOString().slice(0, 10); } catch (e) { return '-'; }
  }
  function daysLeft(iso) {
    if (!iso) return null;
    var ms = new Date(iso).getTime() - Date.now();
    return ms <= 0 ? 0 : Math.ceil(ms / 86400000);
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function toast(msg, kind) {
    var n = document.createElement('div');
    n.className = 'notice ' + (kind || 'ok');
    n.style.cssText = 'position:fixed;inset-inline:0;bottom:18px;margin:auto;width:fit-content;z-index:99;padding:11px 22px;border-radius:14px;animation:rise .3s';
    n.textContent = msg;
    document.body.appendChild(n);
    setTimeout(function () { n.remove(); }, 2600);
  }
  async function copyText(text) {
    try { await navigator.clipboard.writeText(text); return true; }
    catch (e) {
      var a = document.createElement('textarea');
      a.value = text; a.style.cssText = 'position:fixed;opacity:0';
      document.body.appendChild(a); a.select();
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (e2) {}
      a.remove();
      return ok;
    }
  }

  /* ---------------- dial component ---------------- */
  function dialSVG(pct, valText, capText, danger) {
    var R = 48, C = 2 * Math.PI * R;
    var p = Math.max(0, Math.min(100, pct || 0));
    var off = C * (1 - p / 100);
    var stroke = danger ? 'var(--bad)' : 'url(#neonGrad)';
    var s = document.createElement('div');
    s.className = 'dial card';
    s.innerHTML =
      '<svg viewBox="0 0 120 120">' +
      '<defs><linearGradient id="neonGrad" x1="0" y1="0" x2="1" y2="1">' +
      '<stop offset="0" stop-color="#701C2B"/><stop offset="1" stop-color="#D4AF37"/>' +
      '</linearGradient></defs>' +
      '<circle class="track" cx="60" cy="60" r="' + R + '" stroke-width="7"/>' +
      '<circle class="bar" cx="60" cy="60" r="' + R + '" stroke-width="7" stroke="' + stroke + '"' +
      ' stroke-dasharray="' + C + '" stroke-dashoffset="' + off + '" transform="rotate(-90 60 60)"/>' +
      '<text class="val" x="60" y="60" text-anchor="middle" dominant-baseline="central">' + esc(valText) + '</text>' +
      '</svg>' +
      '<div class="lbl"></div><div class="cap"></div>';
    return s;
  }

  /* ---------------- chart ---------------- */
  function drawChart() {
    var cv = $('chart');
    if (!cv) return;
    var dpr = window.devicePixelRatio || 1;
    var w = cv.clientWidth || 300;
    var h = cv.clientHeight || 150;
    cv.width = w * dpr; cv.height = h * dpr;
    var ctx = cv.getContext('2d');
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);

    var data = state.chartData.slice(-60);
    if (data.length < 2) {
      ctx.fillStyle = 'rgba(251,248,242,.3)';
      ctx.font = '12px Vazirmatn';
      ctx.textAlign = 'center';
      ctx.fillText(state.lang === 'en' ? 'waiting for traffic…' : 'در انتظار ترافیک…', w / 2, h / 2);
      return;
    }
    var max = 1;
    for (var i = 0; i < data.length; i++) {
      max = Math.max(max, data[i].upBps || 0, data[i].downBps || 0);
    }
    max = max * 1.2;
    var step = w / (data.length - 1);

    function line(points, color, fillTo) {
      ctx.beginPath();
      for (var j = 0; j < points.length; j++) {
        var x = j * step;
        var y = h - (points[j] / max) * (h - 8) - 4;
        if (j === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      if (fillTo) {
        ctx.lineTo(w, h); ctx.lineTo(0, h); ctx.closePath();
        var g = ctx.createLinearGradient(0, 0, 0, h);
        g.addColorStop(0, fillTo); g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g;
        ctx.fill();
        ctx.beginPath();
        for (var k = 0; k < points.length; k++) {
          var x2 = k * step, y2 = h - (points[k] / max) * (h - 8) - 4;
          if (k === 0) ctx.moveTo(x2, y2); else ctx.lineTo(x2, y2);
        }
      }
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.shadowColor = color;
      ctx.shadowBlur = 8;
      ctx.stroke();
      ctx.shadowBlur = 0;
    }
    line(data.map(function (d) { return d.downBps || 0; }), '#D4AF37', 'rgba(212,175,55,.18)');
    line(data.map(function (d) { return d.upBps || 0; }), '#a04358', 'rgba(112,28,43,.25)');
  }

  window.addEventListener('resize', drawChart);

  /* ---------------- loaders ---------------- */
  function loadHealth() {
    return api('/api/health').then(function (h) {
      state.health = h;
      if (h.lang) state.lang = h.lang;
      if (h.theme) state.theme = h.theme;
      return h;
    });
  }

  function loadDashboard() {
    return api('/api/dashboard').then(function (d) {
      var box = $('dials');
      box.innerHTML = '';
      var D = d.dials;

      var trafficPct = D.traffic.limit ? Math.min(100, D.traffic.used / D.traffic.limit * 100) : 0;
      var el1 = dialSVG(trafficPct, D.traffic.limit ? Math.round(trafficPct) + '%' : '∞', t('dial_traffic') + ' · ' + D.traffic.label, trafficPct >= 90);
      el1.querySelector('.lbl').textContent = t('dial_traffic');
      el1.querySelector('.cap').textContent = D.traffic.label + (D.traffic.limit ? ' / ' + fmtBytes(D.traffic.limit) : '');
      box.appendChild(el1);

      var el2 = dialSVG(D.cpu.percent, D.cpu.percent + '%', '');
      el2.querySelector('.lbl').textContent = t('dial_cpu');
      el2.querySelector('.cap').textContent = state.lang === 'en' ? 'live' : 'زنده';
      box.appendChild(el2);

      var el3 = dialSVG(D.memory.percent, D.memory.percent + '%', '');
      el3.querySelector('.lbl').textContent = t('dial_memory');
      el3.querySelector('.cap').textContent = D.memory.usedMB + ' / ' + D.memory.totalMB + ' MB';
      box.appendChild(el3);

      var el4 = dialSVG(D.clients.total ? D.clients.active / D.clients.total * 100 : 0, D.clients.active + '/' + D.clients.total, '');
      el4.querySelector('.lbl').textContent = t('dial_clients');
      el4.querySelector('.cap').textContent = t('active') + ' / ' + t('total');
      box.appendChild(el4);

      var el5 = dialSVG(D.nodes.total ? 100 : 0, String(D.nodes.total), '');
      el5.querySelector('.lbl').textContent = t('dial_nodes');
      el5.querySelector('.cap').textContent = 'Cloudflare';
      box.appendChild(el5);

      $('liveUp').textContent = fmtBps(d.live.upBps);
      $('liveDown').textContent = fmtBps(d.live.downBps);
      var conn = 0;
      var traffic = d.traffic;
      $('activeConn').textContent = String(conn);
      state.chartData = d.history || [];
      drawChart();

      $('dayTraffic').textContent = fmtBytes(traffic.day ? traffic.day.total : 0);
      $('monthTraffic').textContent = fmtBytes(traffic.month ? traffic.month.total : 0);
      $('allTimeTraffic').textContent = fmtBytes(traffic.allTime ? traffic.allTime.total : 0);

      var up = Math.floor(d.uptime / 86400), uh = Math.floor(d.uptime % 86400 / 3600);
      var lines = [
        [state.lang === 'en' ? 'Uptime' : 'آپتایم سرور', up + 'd ' + uh + 'h'],
        [state.lang === 'en' ? 'Panel uptime' : 'آپتایم پنل', Math.floor(d.processUptime / 3600) + 'h'],
        [state.lang === 'en' ? 'sing-box engine' : 'موتور sing-box', state.health && state.health.engines.singbox ? '● OK' : '● OFF'],
        [state.lang === 'en' ? 'Xray engine' : 'موتور Xray', state.health && state.health.engines.xray ? '● OK' : '● OFF'],
        [state.lang === 'en' ? 'Certificate pin' : 'پین گواهی', state.health && state.health.tls.pcs ? 'pcs ✓' : '—']
      ];
      $('summaryLines').innerHTML = lines.map(function (l) {
        return '<div class="stat-line"><span>' + l[0] + '</span><b class="mono">' + l[1] + '</b></div>';
      }).join('');
    });
  }

  function loadClients() {
    return api('/api/clients').then(function (r) {
      state.clients = r.clients || [];
      $('navClientCount').textContent = String(state.clients.length);
      renderClients();
    });
  }

  function renderClients() {
    var q = ($('clientSearch').value || '').toLowerCase();
    var body = $('clientsBody');
    body.innerHTML = '';
    var list = state.clients.filter(function (c) {
      return !q || (c.tag || '').toLowerCase().indexOf(q) !== -1 || (c.uuid || '').indexOf(q) !== -1;
    });
    if (!list.length) {
      body.innerHTML = '<tr><td colspan="6"><div class="empty"><div class="ico">✦</div><div class="t">' +
        (state.lang === 'en' ? 'No clients yet' : 'هنوز کلاینتی نیست') + '</div></div></td></tr>';
      return;
    }
    for (var i = 0; i < list.length; i++) {
      (function (c) {
        var tr = document.createElement('tr');
        var used = Number(c.usedBytes || 0);
        var limit = Number(c.limitBytes || 0);
        var pct = limit ? Math.min(100, Math.round(used / limit * 100)) : 0;
        var left = daysLeft(c.effectiveExpiry);
        var statusTag = c.enabled === false
          ? '<span class="tag bad">' + (c.disabledReason === 'quota' ? t('quota') : c.disabledReason === 'expired' ? t('expired') : t('manual')) + '</span>'
          : '<span class="tag ok">' + t('active') + '</span>';
        tr.innerHTML =
          '<td><b>' + esc(c.tag) + '</b><div class="tiny mono">' + esc(c.uuid.slice(0, 13)) + '…</div></td>' +
          '<td>' + statusTag + '</td>' +
          '<td style="min-width:130px"><div class="mono" style="font-size:12px">' + fmtBytes(used) + (limit ? ' / ' + fmtBytes(limit) : '') + '</div>' +
          (limit ? '<div class="bar"><i style="width:' + pct + '%"></i></div>' : '<div class="tiny">' + t('unlimited') + '</div>') + '</td>' +
          '<td><div class="mono" style="font-size:12px">' + fmtDate(c.effectiveExpiry) + '</div>' +
          (left !== null ? '<div class="tiny">' + (left > 0 ? left + ' ' + (state.lang === 'en' ? 'days' : 'روز') : t('expired')) + '</div>' : '') + '</td>' +
          '<td><button class="btn ghost sm" data-sub>' + t('copy') + '</button></td>' +
          '<td><div class="row-flex" style="gap:5px">' +
          '<button class="btn ghost sm" data-links>' + t('links') + '</button>' +
          '<button class="btn ghost sm" data-edit>' + t('edit') + '</button>' +
          '<button class="btn danger sm" data-del>' + t('del') + '</button>' +
          '</div></td>';
        tr.querySelector('[data-sub]').onclick = function () {
          var host = location.host;
          var proto = location.protocol;
          copyText(proto + '//' + host + '/sub/' + c.subId).then(function () { toast(t('copied')); });
        };
        tr.querySelector('[data-links]').onclick = function () { showLinks(c.id); };
        tr.querySelector('[data-edit]').onclick = function () { showClientModal(c); };
        tr.querySelector('[data-del]').onclick = function () {
          if (!confirm(t('confirm_delete') + ' — ' + c.tag)) return;
          api('/api/clients/' + c.id, { method: 'DELETE' }).then(function () { loadClients(); toast(t('saved')); });
        };
        body.appendChild(tr);
      })(list[i]);
    }
  }

  // ===== part 2: boot + remaining views =====
  window.__NEON_PART2__ = function (state, api, t, $, fmtBytes, fmtBps, fmtDate, daysLeft, esc, toast, copyText, dialSVG, drawChart, loadHealth, loadDashboard, loadClients, renderClients, I18N) {
    /* ---------- navigation ---------- */
    var VIEWS = {
      dashboard: ['داشبورد', 'نمای کلی سیستم', 'Dashboard', 'System overview'],
      clients: ['کلاینت‌ها', 'مدیریت کلاینت‌ها و سهمیه‌ها', 'Clients', 'Clients & quotas'],
      nodes: ['نودها (Cloudflare)', 'تولید نود از IPهای تمیز و پورت‌های Cloudflare', 'Nodes (Cloudflare)', 'Generate nodes from clean IPs and Cloudflare ports'],
      inbounds: ['این‌باند‌های دستی', 'این‌باند‌های دستی روی همان پورت', 'Core Inbounds', 'Manual inbounds on the same port'],
      protocols: ['پروتکل‌ها', 'فعال/غیرفعال‌سازی پروتکل‌ها', 'Protocols', 'Enable/disable protocols'],
      settings: ['تنظیمات', 'امنیت، تلگرام، بکاپ و سیستم', 'Settings', 'Security, Telegram, backup & system']
    };
    function switchView(name) {
      document.querySelectorAll('.nav-item').forEach(function (n) {
        n.classList.toggle('on', n.dataset.view === name);
      });
      document.querySelectorAll('.view').forEach(function (v) {
        v.classList.toggle('on', v.id === 'view-' + name);
      });
      var fa = state.lang === 'fa';
      var v = VIEWS[name] || VIEWS.dashboard;
      $('viewTitle').textContent = fa ? v[0] : v[2];
      $('viewSub').textContent = fa ? v[1] : v[3];
      $('sidebar').classList.remove('open');
      $('scrim').classList.remove('on');
      if (name === 'dashboard') loadDashboard();
      if (name === 'clients') loadClients();
      if (name === 'nodes') loadNodes();
      if (name === 'inbounds') loadInbounds();
      if (name === 'protocols') loadProtocols();
      if (name === 'settings') loadSettings();
    }

    /* ---------- modal ---------- */
    function modal(html) {
      $('modalBox').innerHTML = html;
      $('modalBack').classList.add('on');
    }
    function closeModal() { $('modalBack').classList.remove('on'); }
    $('modalBack').addEventListener('click', function (e) {
      if (e.target === this) closeModal();
    });

    /* ---------- client modal ---------- */
    function showClientModal(c) {
      var isNew = !c;
      var fa = state.lang === 'fa';
      var limitGB = c && c.limitBytes ? (c.limitBytes / 1073741824) : '';
      var exp = c && c.expiry ? c.expiry.slice(0, 10) : '';
      var dur = c && c.durationMinutes ? Math.round(c.durationMinutes / 1440) : '';
      modal(
        '<h3>' + (fa ? (isNew ? 'کلاینت جدید' : 'ویرایش کلاینت') : (isNew ? 'New client' : 'Edit client')) + '</h3>' +
        '<div class="field"><label>' + t('client_tag') + '</label><input id="mTag" value="' + esc(c ? c.tag : '') + '" maxlength="48"></div>' +
        '<div class="row2">' +
        '<div class="field"><label>' + t('client_limit') + '</label><input class="ltr" id="mLimit" type="number" step="0.1" min="0" value="' + limitGB + '" placeholder="∞"></div>' +
        '<div class="field"><label>' + t('client_expiry') + '</label><input class="ltr" id="mExpiry" type="date" value="' + exp + '"></div>' +
        '</div>' +
        '<div class="row2">' +
        '<div class="field"><label>' + t('client_duration') + '</label><input class="ltr" id="mDur" type="number" min="0" step="0.5" value="' + dur + '" placeholder="0"></div>' +
        '<div class="field" style="justify-content:flex-end"><label style="visibility:hidden">.</label>' +
        '<label class="switch" style="align-self:center;margin-top:14px"><input type="checkbox" id="mStartFirst"' + (c && c.startAfterFirstUse ? ' checked' : '') + '><span class="sl"></span></label>' +
        '<span class="tiny" style="margin-inline-start:8px;margin-top:14px">' + t('client_start_first_use') + '</span></div>' +
        '</div>' +
        '<div class="field"><label>' + t('client_comment') + '</label><input id="mComment" value="' + esc(c ? c.comment : '') + '" maxlength="200"></div>' +
        (c ? '<div class="stat-line"><span>UUID</span><b class="mono" style="font-size:10px">' + esc(c.uuid) + '</b></div>' : '') +
        '<div class="foot-actions">' +
        '<button class="btn ghost" id="mCancel">' + t('cancel') + '</button>' +
        '<button class="btn" id="mSave">' + t('save') + '</button>' +
        '</div>');
      $('mCancel').onclick = closeModal;
      $('mSave').onclick = function () {
        var body = {
          tag: $('mTag').value,
          limitGB: $('mLimit').value === '' ? 0 : $('mLimit').value,
          expiry: $('mExpiry').value || null,
          durationDays: $('mDur').value === '' ? 0 : Number($('mDur').value),
          startAfterFirstUse: $('mStartFirst').checked,
          comment: $('mComment').value,
          tzOffset: new Date().getTimezoneOffset()
        };
        var p = isNew ? api('/api/clients', { method: 'POST', body: body }) : api('/api/clients/' + c.id, { method: 'PUT', body: body });
        p.then(function (r) {
          if (r.ok) { closeModal(); loadClients(); toast(t('saved')); }
          else toast(r.error || 'error', 'err');
        });
      };
    }
    $('btnAddClient').onclick = function () { showClientModal(null); };

    /* ---------- links modal ---------- */
    function showLinks(clientId) {
      api('/api/clients/' + clientId + '/links').then(function (r) {
        if (!r.ok) return toast(r.error, 'err');
        var fa = state.lang === 'fa';
        var items = r.links.concat(r.nodeset || []).map(function (l) {
          return '<div class="lnk"><span class="nm">' + esc(l.name) + '</span>' +
            '<span class="ur">' + esc(l.uri) + '</span>' +
            '<button class="btn sm" data-uri="' + esc(l.uri) + '">' + t('copy') + '</button></div>';
        }).join('');
        modal(
          '<h3>' + esc(r.client.tag) + ' · ' + t('links') + '</h3>' +
          '<div class="stat-line"><span>' + t('sub_url') + '</span></div>' +
          '<div class="lnk" style="display:flex;gap:8px;align-items:center;margin:8px 0 14px">' +
          '<span class="ur mono" style="flex:1;font-size:11px">' + esc(location.origin + '/sub/' + r.client.subId) + '</span>' +
          '<button class="btn sm" id="mCopySub">' + t('copy') + '</button></div>' +
          '<div class="qr-box">' + r.qr + '</div>' +
          '<div class="copy-grid">' + items + '</div>' +
          '<div class="foot-actions"><button class="btn ghost" id="mClose">' + t('close') + '</button></div>');
        $('mCopySub').onclick = function () { copyText(location.origin + '/sub/' + r.client.subId).then(function () { toast(t('copied')); }); };
        $('mClose').onclick = closeModal;
        document.querySelectorAll('[data-uri]').forEach(function (b) {
          b.onclick = function () { copyText(b.dataset.uri).then(function () { toast(t('copied')); }); };
        });
      });
    }

    /* ---------- nodes view ---------- */
    function loadNodes() {
      api('/api/nodes').then(function (r) {
        state.nodeset = r.nodeset;
        state.nodeSettings = r.settings;
        state.domain = r.domain;
        if (r.domain && r.domain.node) $('cfDomain').value = r.domain.node;
        if (r.settings) {
          $('cleanIPs').value = (r.settings.cleanIPs || []).join('\n');
          $('nodePrefix').value = r.settings.prefix || 'Neon';
          $('maxNodes').value = r.settings.maxNodes || 150;
          renderPortToggles(r.settings.httpsPorts || []);
        }
        renderNodeset();
      });
    }
    function renderPortToggles(on) {
      var box = $('portToggles');
      box.innerHTML = '';
      [443, 2053, 2083, 2087, 2096, 8443].forEach(function (port) {
        var l = document.createElement('label');
        l.className = 'tag' + (on.indexOf(port) !== -1 ? ' gold' : '');
        l.style.cursor = 'pointer';
        l.innerHTML = '<input type="checkbox" value="' + port + '"' + (on.indexOf(port) !== -1 ? ' checked' : '') + ' style="display:none">' + port;
        l.onclick = function (e) {
          e.preventDefault();
          var cb = l.querySelector('input');
          cb.checked = !cb.checked;
          l.classList.toggle('gold', cb.checked);
          saveNodeSettings();
        };
        box.appendChild(l);
      });
    }
    function saveNodeSettings() {
      var ports = [];
      document.querySelectorAll('#portToggles input:checked').forEach(function (i) { ports.push(Number(i.value)); });
      api('/api/nodes/settings', {
        method: 'POST',
        body: {
          httpsPorts: ports,
          cleanIPs: $('cleanIPs').value,
          prefix: $('nodePrefix').value,
          maxNodes: Number($('maxNodes').value) || 150
        }
      }).then(function (r) { if (r.ok) state.nodeSettings = r.settings; });
    }
    function renderNodeset() {
      var info = $('nodesetInfo');
      var list = $('nodesList');
      var ns = state.nodeset;
      if (!ns) {
        info.textContent = state.lang === 'en' ? 'No node set.' : 'مجموعه‌ای وجود ندارد.';
        list.innerHTML = '<div class="empty"><div class="ico">☁</div><div class="t">' + t('no_nodes') + '</div></div>';
        return;
      }
      info.textContent = ns.name + ' · ' + ns.summary.total + ' nodes · ' + ns.summary.addresses + ' addresses · ' + ns.summary.ports + ' ports';
      var rows = ns.nodes.slice(0, 200).map(function (n) {
        return '<div class="stat-line"><span class="mono" style="font-size:11px">' + esc(n.address) + ':' + n.port + '</span>' +
          '<b class="mono tiny">' + esc(n.remark) + (n.tls ? ' · TLS' : '') + '</b></div>';
      }).join('');
      list.innerHTML = '<div class="table-wrap" style="max-height:340px;overflow-y:auto">' + rows + '</div>';
    }
    $('btnVerifyDomain').onclick = function () {
      api('/api/domain', { method: 'POST', body: { domain: $('cfDomain').value } }).then(function (r) {
        if (r.ok) {
          $('domainTag').textContent = r.proxied ? '✓ proxied' : '✓ dns only';
          $('domainTag').className = 'tag ' + (r.proxied ? 'ok' : 'warn');
          toast(t('saved'));
        } else { $('domainTag').textContent = '✗'; $('domainTag').className = 'tag bad'; toast(r.error, 'err'); }
      });
    };
    $('btnGenerate').onclick = function () {
      saveNodeSettings();
      var btn = this;
      btn.disabled = true; btn.textContent = '...';
      api('/api/nodes/generate', { method: 'POST' }).then(function (r) {
        btn.disabled = false; btn.textContent = t('generate');
        if (r.ok) { toast(t('saved') + ' — ' + r.summary.total + ' nodes'); loadNodes(); }
        else toast(r.error, 'err');
      });
    };
    $('btnSelfTest').onclick = function () {
      var btn = this;
      btn.disabled = true; btn.textContent = '...';
      api('/api/nodes/selftest', { method: 'POST' }).then(function (r) {
        btn.disabled = false; btn.textContent = t('selftest');
        if (!r.ok) return toast(r.error, 'err');
        var okPct = r.tested ? Math.round(r.ok / r.tested * 100) : 0;
        toast((state.lang === 'en' ? 'Self-test: ' : 'تست: ') + r.ok + '/' + r.tested + ' ' + t('test_ok') + ' (' + okPct + '%)', okPct > 50 ? 'ok' : 'err');
        var fails = r.results.filter(function (x) { return !x.ok; }).slice(0, 8).map(function (x) {
          return '<div class="stat-line"><span class="mono" style="font-size:11px">' + esc(x.node.address) + ':' + x.node.port + '</span><b class="tag bad">' + esc(x.detail || 'fail') + '</b></div>';
        }).join('');
        if (fails) $('nodesList').innerHTML = '<div class="eyebrow" style="margin-bottom:8px">' + (state.lang === 'en' ? 'Failed nodes' : 'نودهای ناموفق') + '</div>' + fails;
      });
    };
    $('btnDeleteNodes').onclick = function () {
      if (!confirm(t('confirm_delete'))) return;
      api('/api/nodes/delete', { method: 'POST' }).then(function (r) {
        if (r.ok) { toast(t('saved')); loadNodes(); } else toast(r.error, 'err');
      });
    };

    /* ---------- inbounds view ---------- */
    function loadInbounds() {
      api('/api/core').then(function (r) {
        state.coreInbounds = r.inbounds || [];
        $('navCoreCount').textContent = String(state.coreInbounds.length);
        var body = $('inboundsBody');
        body.innerHTML = '';
        if (!state.coreInbounds.length) {
          body.innerHTML = '<tr><td colspan="6"><div class="empty"><div class="ico">⇄</div><div class="t">' +
            (state.lang === 'en' ? 'No core inbounds' : 'این‌باندی نیست') + '</div></div></td></tr>';
          return;
        }
        state.coreInbounds.forEach(function (ib) {
          var tr = document.createElement('tr');
          tr.innerHTML =
            '<td><b>' + esc(ib.remark) + '</b></td>' +
            '<td><span class="tag gold">' + esc(ib.protocol) + '</span></td>' +
            '<td><span class="tag">' + esc(ib.network) + '</span></td>' +
            '<td class="mono tiny">' + esc(ib.path) + '</td>' +
            '<td>' + (ib.enabled !== false ? '<span class="tag ok">' + t('active') + '</span>' : '<span class="tag bad">' + t('manual') + '</span>') + '</td>' +
            '<td><div class="row-flex" style="gap:5px">' +
            '<button class="btn ghost sm" data-tg>' + (ib.enabled !== false ? t('disable') : t('enable')) + '</button>' +
            '<button class="btn danger sm" data-del>' + t('del') + '</button></div></td>';
          tr.querySelector('[data-tg]').onclick = function () {
            api('/api/core/' + ib.id, { method: 'PUT', body: { enabled: ib.enabled === false } }).then(loadInbounds);
          };
          tr.querySelector('[data-del]').onclick = function () {
            if (!confirm(t('confirm_delete'))) return;
            api('/api/core/' + ib.id, { method: 'DELETE' }).then(loadInbounds);
          };
          body.appendChild(tr);
        });
      });
    }
    $('btnAddInbound').onclick = function () {
      var fa = state.lang === 'fa';
      modal(
        '<h3>' + (fa ? 'این‌باند جدید' : 'New inbound') + '</h3>' +
        '<div class="field"><label>' + t('th_remark') + '</label><input id="ibRemark" placeholder="my-inbound"></div>' +
        '<div class="row2">' +
        '<div class="field"><label>' + t('th_protocol') + '</label><select id="ibProto" class="ltr"><option>vless</option><option>vmess</option><option>trojan</option></select></div>' +
        '<div class="field"><label>' + t('th_network') + '</label><select id="ibNet" class="ltr"><option>ws</option><option>grpc</option></select></div>' +
        '</div>' +
        '<div class="foot-actions"><button class="btn ghost" id="mCancel">' + t('cancel') + '</button>' +
        '<button class="btn" id="mSave">' + t('save') + '</button></div>');
      $('mCancel').onclick = closeModal;
      $('mSave').onclick = function () {
        api('/api/core', {
          method: 'POST',
          body: { remark: $('ibRemark').value, protocol: $('ibProto').value, network: $('ibNet').value }
        }).then(function (r) {
          if (r.ok) { closeModal(); loadInbounds(); toast(t('saved')); }
          else toast(r.error, 'err');
        });
      };
    };

    /* ---------- protocols view ---------- */
    var PROTO_META = {
      vlessWs: ['WS', 'VLESS-WS / WS-TLS · WebSocket'],
      vmessWs: ['VM', 'VMess-WS / WS-TLS'],
      trojanWs: ['TJ', 'Trojan-WS / WS-TLS'],
      vlessWsTls: ['W+', 'VLESS-WS-TLS link variant'],
      vmessWsTls: ['V+', 'VMess-WS-TLS link variant'],
      trojanWsTls: ['T+', 'Trojan-WS-TLS link variant'],
      vlessHu: ['HU', 'VLESS-HTTPUpgrade'],
      vmessHu: ['VH', 'VMess-HTTPUpgrade'],
      trojanHu: ['TH', 'Trojan-HTTPUpgrade'],
      vlessGrpc: ['GR', 'VLESS-gRPC (h2c)'],
      vlessGrpcTls: ['GT', 'VLESS-gRPC-TLS (ALPN h2)'],
      ssWs: ['SS', 'Shadowsocks over WebSocket'],
      vlessXhttp: ['XH', 'VLESS-XHTTP (Xray clients)']
    };
    function loadProtocols() {
      var box = $('protoGrid');
      box.innerHTML = '';
      var list = (state.health && state.health.protocols) || [];
      list.forEach(function (p) {
        var meta = PROTO_META[p.key] || ['??', p.label];
        var d = document.createElement('div');
        d.className = 'proto-card' + (p.enabled ? '' : ' off');
        d.innerHTML =
          '<div class="ico">' + meta[0] + '</div>' +
          '<div class="info"><div class="nm">' + esc(p.label) + '</div><div class="ds">' + esc(p.group) + '</div></div>' +
          '<label class="switch"><input type="checkbox"' + (p.enabled ? ' checked' : '') + '><span class="sl"></span></label>';
        d.querySelector('input').onchange = function () {
          var body = { enable: {} };
          body.enable[p.key] = this.checked;
          api('/api/settings/protocols', { method: 'POST', body: body }).then(function (r) {
            if (r.ok) { d.classList.toggle('off', !d.querySelector('input').checked); toast(t('saved')); }
          });
        };
        box.appendChild(d);
      });
    }

    /* ---------- settings view ---------- */
    function loadSettings() {
      loadHealth().then(function () {
        if (state.health && state.health.tls && state.health.tls.pcs) $('certPin').textContent = '✓ ' + state.health.tls.pcs.slice(0, 16) + '…';
      });
      api('/api/system').then(function (r) {
        var s = r.sys;
        var lines = [
          ['Host', s.hostname + ' · ' + s.platform],
          ['CPU', s.cpu.model.trim().slice(0, 28) + ' × ' + s.cpu.cores],
          ['Load', s.cpu.load.join(' / ')],
          ['Memory', s.memory.usedMB + ' / ' + s.memory.totalMB + ' MB'],
          ['Node.js', s.node]
        ];
        $('sysLines').innerHTML = lines.map(function (l) {
          return '<div class="stat-line"><span>' + l[0] + '</span><b class="mono" style="font-size:11px">' + esc(String(l[1])) + '</b></div>';
        }).join('');
      });
      api('/api/telegram').then(function (r) {
        if (!r.ok) return;
        var c = r.config;
        $('tgEnabled').checked = !!c.enabled;
        $('tgChat').value = c.chatId || '';
        if (c.hasToken) $('tgToken').placeholder = '•••• saved';
      });
    }
    $('btnChangePw').onclick = function () {
      var pw = $('newPw').value;
      if (pw.length < 8) return toast(state.lang === 'en' ? 'min 8 chars' : 'حداقل ۸ کاراکتر', 'err');
      api('/api/settings/password', { method: 'POST', body: { password: pw } }).then(function (r) {
        if (r.ok) { $('newPw').value = ''; toast(t('saved')); } else toast(r.error, 'err');
      });
    };
    $('btnTgVerify').onclick = function () {
      api('/api/telegram', {
        method: 'POST',
        body: { verify: true, botToken: $('tgToken').value, chatId: $('tgChat').value }
      }).then(function (r) {
        if (r.ok && r.bot) toast('✓ @' + r.bot);
        else toast((r.error || r.message) || 'failed', 'err');
      });
    };
    $('btnTgBackup').onclick = function () {
      api('/api/telegram/backup', { method: 'POST' }).then(function (r) {
        r.ok ? toast(t('saved')) : toast(r.error, 'err');
      });
    };
    $('tgEnabled').onchange = function () {
      api('/api/telegram', { method: 'POST', body: { enabled: this.checked, chatId: $('tgChat').value } });
    };
    $('btnBackupDl').onclick = function () {
      location.href = BASE + '/api/backup';
    };
    $('backupFile').onchange = function () {
      var f = this.files[0];
      if (!f) return;
      f.text().then(function (txt) {
        try {
          var json = JSON.parse(txt);
          if (!confirm(t('confirm_delete') + ' — ' + (json.clients || []).length + ' clients')) return;
          return api('/api/backup', { method: 'POST', body: json });
        } catch (e) { throw e; }
      }).then(function (r) {
        if (r && r.ok) { toast(t('saved') + ' ✓ ' + r.clients + ' clients'); loadHealth().then(switchView0); }
        else if (r) toast(r.error, 'err');
      }).catch(function () { toast('invalid file', 'err'); });
    };

    /* ---------- language / theme ---------- */
    function applyLang() {
      var fa = state.lang === 'fa';
      document.documentElement.lang = fa ? 'fa' : 'en';
      document.documentElement.dir = fa ? 'rtl' : 'ltr';
      document.querySelectorAll('[data-t]').forEach(function (el) {
        if (I18N[state.lang][el.dataset.t]) el.textContent = I18N[state.lang][el.dataset.t];
      });
      $('btnLang').textContent = fa ? 'EN' : 'فا';
    }
    function applyTheme() {
      document.documentElement.dataset.theme = state.theme;
      $('btnTheme').textContent = state.theme === 'dark' ? '☀' : '☾';
    }
    $('btnLang').onclick = function () {
      state.lang = state.lang === 'fa' ? 'en' : 'fa';
      api('/api/settings/prefs', { method: 'POST', body: { lang: state.lang } });
      applyLang();
      var current = document.querySelector('.nav-item.on');
      if (current) switchView(current.dataset.view);
    };
    $('btnTheme').onclick = function () {
      state.theme = state.theme === 'dark' ? 'light' : 'dark';
      api('/api/settings/prefs', { method: 'POST', body: { theme: state.theme } });
      applyTheme();
      drawChart();
    };
    $('btnLogout').onclick = function () {
      api('/api/logout', { method: 'POST' }).then(function () {
        location.href = BASE + '/login.html';
      });
    };

    /* ---------- responsive sidebar ---------- */
    $('burger').onclick = function () {
      $('sidebar').classList.add('open');
      $('scrim').classList.add('on');
    };
    $('scrim').onclick = function () {
      $('sidebar').classList.remove('open');
      $('scrim').classList.remove('on');
    };

    /* ---------- wire nav ---------- */
    document.querySelectorAll('.nav-item').forEach(function (n) {
      n.onclick = function () { switchView(n.dataset.view); };
    });
    $('clientSearch').oninput = renderClients;

    function switchView0() { switchView('dashboard'); }

    /* ---------- auth gate + boot ---------- */
    loadHealth()
      .then(function (h) {
        state.lang = (h && h.lang) || 'fa';
        state.theme = (h && h.theme) || 'dark';
        applyLang();
        applyTheme();
        return h;
      })
      .catch(function () { return null; })
      .then(function (h) {
        if (h && h.setup === false) {
          // no password yet → login page creates it
          location.href = BASE + '/login.html';
          return;
        }
        switchView0();
        setInterval(function () {
          var on = document.querySelector('.view.on');
          if (on && on.id === 'view-dashboard') loadDashboard();
        }, 4000);
        setInterval(loadHealth, 30000);
      });
  };

  // invoke part 2 immediately with part-1 helpers
  window.__NEON_PART2__(state, api, t, $, fmtBytes, fmtBps, fmtDate, daysLeft, esc, toast, copyText, dialSVG, drawChart,
    loadHealth, loadDashboard, loadClients, renderClients, I18N);
})();
