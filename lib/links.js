/**
 * Aral Neon — share links & profile builder.
 * For every enabled protocol produces: the v2ray URI, the Clash Meta (mihomo)
 * proxy entry and the sing-box outbound. Self-signed cert links carry
 * allowInsecure=1 plus the pcs=<sha256> pin (Xray 26.2+) and the Clash
 * "fingerprint" pin.
 */
'use strict';

const { PATHS, BRAND, CF_HTTPS_PORTS } = require('./constants');
const { certSha256, ensureTlsCertificates } = require('./cert');

function urlSafeEncode(str) { return encodeURIComponent(str); }
function yamlQ(str) { return `"${String(str).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`; }

const FP_LIST = ['chrome', 'firefox', 'safari', 'edge', 'ios', 'android', 'random', 'randomized', '360', 'qq', 'wechat_os', 'wechat_android', 'wechat_mac'];

class LinkBuilder {
  constructor(cfg, store, host) {
    this.cfg = cfg;
    this.store = store;
    this.enable = store.data.enable;
    this.host = cfg.forceHost || host || cfg.domain || '127.0.0.1';
    this.port = parseInt(process.env.LINK_PORT || '', 10) || cfg.publicPort;
    // Cert may not exist yet on a fresh boot (the mux creates it during start);
    // links need the pin, so make sure one exists before hashing it.
    ensureTlsCertificates(cfg.paths.certPath, cfg.paths.keyPath, cfg.domain || this.host || 'localhost');
    this.pcs = certSha256(cfg.paths.certPath);
    this.keepAllowInsecure = true; // self-signed cert
    this.fp = normalizeFp(process.env.LINK_FP || 'chrome');
    this.alpn = String(process.env.LINK_ALPN || 'http/1.1').split(',').map((x) => x.trim()).filter(Boolean);
    this.sni = cfg.domain || this.host;
    this.wsHost = cfg.domain || this.host;
    this.name = (t) => `${BRAND.short} • ${t}`;
    this.ssMethod = cfg.shadowsocks.method || 'aes-256-gcm';
    this.ssPassword = store.data.ssPassword || '';
  }

  _uriTls(alpnOverride) {
    let q = '&sni=' + urlSafeEncode(this.sni);
    if (this.fp) q += '&fp=' + urlSafeEncode(this.fp);
    q += '&alpn=' + urlSafeEncode((alpnOverride || this.alpn).join(','));
    q += this._uriInsecure();
    return q;
  }
  _uriInsecure() {
    let q = '';
    if (this.keepAllowInsecure) q += '&allowInsecure=1';
    if (this.pcs) q += '&pcs=' + this.pcs;
    return q;
  }
  _sbTls(alpnOverride) {
    const t = { enabled: true, server_name: this.sni, insecure: true, alpn: alpnOverride || (this.alpn.length ? this.alpn.slice() : ['http/1.1']) };
    if (this.fp) t.utls = { enabled: true, fingerprint: this.fp };
    return t;
  }
  _clashTls(obj, sniKey = 'servername', alpnOverride) {
    obj.tls = true;
    obj[sniKey] = this.sni;
    obj['skip-cert-verify'] = true;
    if (this.pcs) obj.fingerprint = this.pcs;
    if (this.fp) obj['client-fingerprint'] = this.fp === 'randomized' ? 'random' : this.fp;
    obj.alpn = alpnOverride || (this.alpn.length ? this.alpn.slice() : ['http/1.1']);
    return obj;
  }

  /** All nodes for ONE client uuid (multi-user). */
  nodesFor(uuid, tag = '') {
    const out = [];
    const push = (node) => { if (node) out.push(node); };
    const suffix = tag ? ` · ${tag}` : '';

    // ===== VLESS-WS-TLS / VLESS-WS =====
    if (this.enable.vlessWs) {
      const name = this.name('VLESS-WS-TLS') + suffix;
      const clash = this._clashTls({
        name, type: 'vless', server: this.host, port: this.port, uuid, network: 'ws',
        'ws-opts': { path: PATHS.vlessWs, headers: { Host: this.wsHost } }
      });
      const sb = {
        type: 'vless', tag: name, server: this.host, server_port: this.port, uuid,
        tls: this._sbTls(),
        transport: { type: 'ws', path: PATHS.vlessWs, headers: { Host: this.wsHost }, early_data_header_name: 'Sec-WebSocket-Protocol' }
      };
      push({
        name, type: 'VLESS-WS-TLS', uri: `vless://${uuid}@${this.host}:${this.port}?encryption=none&security=tls${this._uriTls()}&type=ws&host=${urlSafeEncode(this.wsHost)}&path=${urlSafeEncode(PATHS.vlessWs)}#${urlSafeEncode(name)}`,
        clash, sbOut: [sb]
      });
      if (this.enable.vlessWsTls !== false) {
        // plain VLESS-WS only when the non-TLS variant is meaningful (same inbound)
      }
      const nameP = this.name('VLESS-WS') + suffix;
      push({
        name: nameP, type: 'VLESS-WS',
        uri: `vless://${uuid}@${this.host}:${this.port}?encryption=none&security=none&type=ws&host=${urlSafeEncode(this.wsHost)}&path=${urlSafeEncode(PATHS.vlessWs)}#${urlSafeEncode(nameP)}`,
        clash: {
          name: nameP, type: 'vless', server: this.host, port: this.port, uuid, network: 'ws', tls: false,
          'ws-opts': { path: PATHS.vlessWs, headers: { Host: this.wsHost } }
        },
        sbOut: [{ type: 'vless', tag: nameP, server: this.host, server_port: this.port, uuid, transport: { type: 'ws', path: PATHS.vlessWs, headers: { Host: this.wsHost } } }]
      });
    }

    // ===== VMess-WS-TLS / VMess-WS =====
    if (this.enable.vmessWs) {
      const mk = (tls) => {
        const name = this.name(tls ? 'VMess-WS-TLS' : 'VMess-WS') + suffix;
        const v = { v: '2', ps: name, add: this.host, port: String(this.port), id: uuid, aid: '0', scy: 'auto', net: 'ws', type: 'none', host: this.wsHost, path: PATHS.vmessWs, tls: tls ? 'tls' : '' };
        if (tls) {
          v.sni = this.sni;
          if (this.fp) v.fp = this.fp;
          if (this.alpn.length) v.alpn = this.alpn.join(',');
          if (this.keepAllowInsecure) v.allowInsecure = true;
          if (this.pcs) v.pcs = this.pcs;
        }
        const clash = tls
          ? this._clashTls({ name, type: 'vmess', server: this.host, port: this.port, uuid, alterId: 0, cipher: 'auto', network: 'ws', 'ws-opts': { path: PATHS.vmessWs, headers: { Host: this.wsHost } } })
          : { name, type: 'vmess', server: this.host, port: this.port, uuid, alterId: 0, cipher: 'auto', network: 'ws', tls: false, 'ws-opts': { path: PATHS.vmessWs, headers: { Host: this.wsHost } } };
        const sb = {
          type: 'vmess', tag: name, server: this.host, server_port: this.port, uuid, alter_id: 0, security: 'auto',
          transport: { type: 'ws', path: PATHS.vmessWs, headers: { Host: this.wsHost }, early_data_header_name: 'Sec-WebSocket-Protocol' }
        };
        if (tls) sb.tls = this._sbTls();
        return { name, type: tls ? 'VMess-WS-TLS' : 'VMess-WS', uri: 'vmess://' + Buffer.from(JSON.stringify(v)).toString('base64'), clash, sbOut: [sb] };
      };
      push(mk(true));
      push(mk(false));
    }

    // ===== Trojan-WS-TLS / Trojan-WS =====
    if (this.enable.trojanWs) {
      const mk = (tls) => {
        const name = this.name(tls ? 'Trojan-WS-TLS' : 'Trojan-WS') + suffix;
        const base = { name, type: 'trojan', server: this.host, port: this.port, password: uuid, network: 'ws', 'ws-opts': { path: PATHS.trojanWs, headers: { Host: this.wsHost } } };
        const clash = tls ? this._clashTls({ ...base }, 'sni') : { ...base, tls: false };
        const sb = { type: 'trojan', tag: name, server: this.host, server_port: this.port, password: uuid, transport: { type: 'ws', path: PATHS.trojanWs, headers: { Host: this.wsHost } } };
        if (tls) sb.tls = this._sbTls();
        const uri = tls
          ? `trojan://${uuid}@${this.host}:${this.port}?security=tls${this._uriTls()}&type=ws&host=${urlSafeEncode(this.wsHost)}&path=${urlSafeEncode(PATHS.trojanWs)}#${urlSafeEncode(name)}`
          : `trojan://${uuid}@${this.host}:${this.port}?security=none&type=ws&host=${urlSafeEncode(this.wsHost)}&path=${urlSafeEncode(PATHS.trojanWs)}#${urlSafeEncode(name)}`;
        return { name, type: tls ? 'Trojan-WS-TLS' : 'Trojan-WS', uri, clash, sbOut: [sb] };
      };
      push(mk(true));
      push(mk(false));
    }

    // ===== HTTPUpgrade ×3 =====
    const hu = (proto, enabled, pathVal, type) => {
      if (!enabled) return null;
      const name = this.name(type) + suffix;
      const sbT = { type: 'httpupgrade', path: pathVal, host: this.wsHost };
      let uri, clash, sb;
      if (proto === 'vless') {
        uri = `vless://${uuid}@${this.host}:${this.port}?encryption=none&security=none&type=httpupgrade&host=${urlSafeEncode(this.wsHost)}&path=${urlSafeEncode(pathVal)}#${urlSafeEncode(name)}`;
        clash = { name, type: 'vless', server: this.host, port: this.port, uuid, network: 'ws', tls: false, 'ws-opts': { path: pathVal, headers: { Host: this.wsHost }, 'v2ray-http-upgrade': true } };
        sb = { type: 'vless', tag: name, server: this.host, server_port: this.port, uuid, transport: sbT };
      } else if (proto === 'vmess') {
        const v = { v: '2', ps: name, add: this.host, port: String(this.port), id: uuid, aid: '0', scy: 'auto', net: 'httpupgrade', type: 'none', host: this.wsHost, path: pathVal, tls: '' };
        uri = 'vmess://' + Buffer.from(JSON.stringify(v)).toString('base64');
        clash = { name, type: 'vmess', server: this.host, port: this.port, uuid, alterId: 0, cipher: 'auto', network: 'ws', tls: false, 'ws-opts': { path: pathVal, headers: { Host: this.wsHost }, 'v2ray-http-upgrade': true } };
        sb = { type: 'vmess', tag: name, server: this.host, server_port: this.port, uuid, alter_id: 0, security: 'auto', transport: sbT };
      } else {
        uri = `trojan://${uuid}@${this.host}:${this.port}?security=none&type=httpupgrade&host=${urlSafeEncode(this.wsHost)}&path=${urlSafeEncode(pathVal)}#${urlSafeEncode(name)}`;
        clash = { name, type: 'trojan', server: this.host, port: this.port, password: uuid, network: 'ws', tls: false, 'ws-opts': { path: pathVal, headers: { Host: this.wsHost }, 'v2ray-http-upgrade': true } };
        sb = { type: 'trojan', tag: name, server: this.host, server_port: this.port, password: uuid, transport: sbT };
      }
      return { name, type, uri, clash, sbOut: [sb] };
    };
    push(hu('vless', this.enable.vlessHu, PATHS.vlessHu, 'VLESS-HTTPUpgrade'));
    push(hu('vmess', this.enable.vmessHu, PATHS.vmessHu, 'VMess-HTTPUpgrade'));
    push(hu('trojan', this.enable.trojanHu, PATHS.trojanHu, 'Trojan-HTTPUpgrade'));

    // ===== gRPC / gRPC-TLS =====
    if (this.enable.vlessGrpc) {
      const name = this.name('VLESS-gRPC') + suffix;
      const svc = PATHS.grpcService;
      push({
        name, type: 'VLESS-gRPC',
        uri: `vless://${uuid}@${this.host}:${this.port}?encryption=none&security=none&type=grpc&serviceName=${urlSafeEncode(svc)}&mode=gun#${urlSafeEncode(name)}`,
        clash: { name, type: 'vless', server: this.host, port: this.port, uuid, network: 'grpc', tls: false, 'grpc-opts': { 'grpc-service-name': svc } },
        sbOut: [{ type: 'vless', tag: name, server: this.host, server_port: this.port, uuid, transport: { type: 'grpc', service_name: svc } }]
      });
    }
    if (this.enable.vlessGrpcTls) {
      const name = this.name('VLESS-gRPC-TLS') + suffix;
      const svc = PATHS.grpcService;
      push({
        name, type: 'VLESS-gRPC-TLS',
        uri: `vless://${uuid}@${this.host}:${this.port}?encryption=none&security=tls${this._uriTls(['h2'])}&type=grpc&serviceName=${urlSafeEncode(svc)}&mode=gun#${urlSafeEncode(name)}`,
        clash: this._clashTls({ name, type: 'vless', server: this.host, port: this.port, uuid, network: 'grpc', 'grpc-opts': { 'grpc-service-name': svc } }, 'servername', ['h2']),
        sbOut: [{ type: 'vless', tag: name, server: this.host, server_port: this.port, uuid, tls: this._sbTls(['h2']), transport: { type: 'grpc', service_name: svc } }]
      });
    }

    // ===== Shadowsocks-WS (SIP002 + v2ray-plugin) =====
    if (this.enable.ssWs && this.ssPassword) {
      const name = this.name('Shadowsocks-WS') + suffix;
      const userinfo = /^2022-/i.test(this.ssMethod)
        ? urlSafeEncode(this.ssMethod) + ':' + urlSafeEncode(this.ssPassword)
        : Buffer.from(`${this.ssMethod}:${this.ssPassword}`).toString('base64url');
      const pluginOpts = `mode=websocket;host=${this.wsHost};path=${PATHS.ssWs};mux=0`;
      push({
        name, type: 'Shadowsocks-WS',
        uri: `ss://${userinfo}@${this.host}:${this.port}/?plugin=${urlSafeEncode('v2ray-plugin;' + pluginOpts)}#${urlSafeEncode(name)}`,
        clash: { name, type: 'ss', server: this.host, port: this.port, cipher: this.ssMethod, password: this.ssPassword, plugin: 'v2ray-plugin', 'plugin-opts': { mode: 'websocket', path: PATHS.ssWs, host: this.wsHost, tls: false } },
        sbOut: [{ type: 'shadowsocks', tag: name, server: this.host, server_port: this.port, method: this.ssMethod, password: this.ssPassword, transport: { type: 'ws', path: PATHS.ssWs } }]
      });
    }

    // ===== VLESS-XHTTP =====
    if (this.enable.vlessXhttp && this.xhttpAvailable) {
      const name = this.name('VLESS-XHTTP') + suffix;
      const mode = 'auto';
      push({
        name, type: 'VLESS-XHTTP',
        uri: `vless://${uuid}@${this.host}:${this.port}?encryption=none&security=none&type=xhttp&host=${urlSafeEncode(this.wsHost)}&path=${urlSafeEncode(PATHS.xhttp)}&mode=${mode}#${urlSafeEncode(name)}`,
        clash: null,
        sbOut: null,
        note: 'Xray-core clients (v2rayN / v2rayNG / Hiddify with xray core)'
      });
    }

    return out;
  }

  /** Links for the Cloudflare nodeset: address × port × protocol variants. */
  nodesetLinks(client) {
    const ns = this.store.data.nodeset;
    if (!ns || !ns.nodes?.length) return [];
    const out = [];
    const uuid = client.uuid;
    const s = this.store.data.nodesSettings;

    for (const node of ns.nodes) {
      const name = `${node.remark}`;
      const params = new URLSearchParams({
        encryption: 'none', type: 'ws',
        host: node.host, path: ns.path
      });
      if (node.tls) {
        params.set('security', 'tls');
        params.set('sni', node.sni);
        if (s.fingerprint) params.set('fp', s.fingerprint);
        if (s.alpn) params.set('alpn', s.alpn);
      } else {
        params.set('security', 'none');
      }
      const authority = node.address.includes(':') && !node.address.startsWith('[') ? `[${node.address}]` : node.address;
      const query = params.toString().replace(/\+/g, '%20');
      out.push({
        name, type: 'NodeSet',
        uri: `vless://${uuid}@${authority}:${node.port}?${query}#${urlSafeEncode(name)}`,
        clash: {
          name, type: 'vless', server: authority, port: node.port, uuid, udp: true,
          tls: !!node.tls,
          ...(node.tls ? {
            servername: node.sni,
            'client-fingerprint': s.fingerprint || 'chrome',
            alpn: [s.alpn || 'http/1.1']
          } : {}),
          network: 'ws',
          'ws-opts': { path: ns.path, headers: { Host: node.host } }
        },
        sbOut: {
          type: 'vless', tag: name, server: authority, server_port: node.port, uuid,
          ...(node.tls ? { tls: { enabled: true, server_name: node.sni, utls: { enabled: true, fingerprint: s.fingerprint || 'chrome' }, alpn: [s.alpn || 'http/1.1'] } } : {}),
          transport: { type: 'ws', path: String(ns.path).split('?')[0], headers: { Host: node.host }, early_data_header_name: 'Sec-WebSocket-Protocol' }
        }
      });
    }
    return out;
  }

  /** Clash Meta YAML profile from node objects with clash entries. */
  clashYaml(nodes, title = BRAND.name) {
    const lines = [];
    const names = [];
    for (const n of nodes) {
      if (!n.clash) continue;
      const c = n.clash;
      names.push(c.name);
      const L = (k, v) => lines.push(`    ${k}: ${typeof v === 'string' ? yamlQ(v) : v}`);
      lines.push(`  - name: ${yamlQ(c.name)}`);
      lines.push(`    type: ${c.type}`);
      lines.push(`    server: ${yamlQ(c.server)}`);
      lines.push(`    port: ${c.port}`);
      if (c.uuid) L('uuid', c.uuid);
      if (c.password) L('password', c.password);
      if (c.alterId !== undefined) L('alterId', c.alterId);
      if (c.cipher) L('cipher', c.cipher);
      if (c.fingerprint) L('fingerprint', c.fingerprint);
      if (c['client-fingerprint']) L('client-fingerprint', c['client-fingerprint']);
      if (c.servername) L('servername', c.servername);
      if (c.sni) L('sni', c.sni);
      if (c['skip-cert-verify'] !== undefined) L('skip-cert-verify', c['skip-cert-verify']);
      if (c.alpn) lines.push(`    alpn: [${c.alpn.map(yamlQ).join(', ')}]`);
      if (c.network) L('network', c.network);
      if (c.tls !== undefined) L('tls', c.tls);
      if (c.plugin) {
        L('plugin', c.plugin);
        lines.push(`    plugin-opts:`);
        for (const [k, v] of Object.entries(c['plugin-opts'] || {})) {
          lines.push(`      ${k}: ${typeof v === 'string' ? yamlQ(v) : v}`);
        }
      }
      if (c['ws-opts']) {
        lines.push(`    ws-opts:`);
        lines.push(`      path: ${yamlQ(c['ws-opts'].path)}`);
        if (c['ws-opts'].headers) {
          lines.push(`      headers:`);
          for (const [k, v] of Object.entries(c['ws-opts'].headers)) lines.push(`        ${k}: ${yamlQ(v)}`);
        }
        if (c['ws-opts']['v2ray-http-upgrade']) lines.push(`      v2ray-http-upgrade: true`);
      }
      if (c['grpc-opts']) lines.push(`    grpc-opts:\n      grpc-service-name: ${yamlQ(c['grpc-opts']['grpc-service-name'])}`);
    }
    if (!names.length) return null;
    const proxyList = names.map((n) => `      - ${yamlQ(n)}`).join('\n');
    return `# ${title} — Clash Meta (Mihomo)
# ${names.length} servers

mixed-port: 7890
allow-lan: false
mode: rule
log-level: warning

proxies:
${lines.join('\n')}

proxy-groups:
  - name: ${yamlQ(BRAND.name)}
    type: select
    proxies:
      - "Auto"
${proxyList}
  - name: "Auto"
    type: url-test
    url: "http://www.gstatic.com/generate_204"
    interval: 300
    tolerance: 50
    proxies:
${proxyList}

rules:
  - GEOIP,PRIVATE,DIRECT,no-resolve
  - MATCH,${yamlQ(BRAND.name)}
`;
  }

  /** sing-box client JSON profile. */
  singboxJson(nodes) {
    const outbounds = [];
    const tags = [];
    for (const n of nodes) {
      if (Array.isArray(n.sbOut)) {
        for (const ob of n.sbOut) outbounds.push(ob);
        tags.push(n.name);
      }
    }
    if (!tags.length) return null;
    const all = [
      { type: 'selector', tag: BRAND.name, outbounds: ['Auto', ...tags], default: 'Auto' },
      { type: 'urltest', tag: 'Auto', outbounds: tags, url: 'http://www.gstatic.com/generate_204', interval: '5m' },
      ...outbounds,
      { type: 'direct', tag: 'direct' }
    ];
    return JSON.stringify({
      log: { level: 'warn' },
      dns: {
        servers: [
          { tag: 'remote', address: 'https://1.1.1.1/dns-query', detour: BRAND.name },
          { tag: 'local', address: 'local', detour: 'direct' }
        ],
        final: 'remote', strategy: 'prefer_ipv4'
      },
      inbounds: [{ type: 'mixed', tag: 'mixed-in', listen: '127.0.0.1', listen_port: 2080 }],
      outbounds: all,
      route: {
        rules: [{ protocol: 'dns', action: 'hijack-dns' }, { ip_is_private: true, outbound: 'direct' }],
        final: BRAND.name,
        auto_detect_interface: true
      }
    }, null, 2);
  }
}

function normalizeFp(fp) {
  fp = String(fp || '').trim().toLowerCase();
  if (/^(none|off|false)$/.test(fp)) return '';
  return FP_LIST.includes(fp) ? fp : 'chrome';
}

module.exports = { LinkBuilder };
