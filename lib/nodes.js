/**
 * Aral Neon — Cloudflare node generation (RailPanel model).
 * nodes = clean addresses × Cloudflare ports. Alternate CF ports only answer
 * for a proxied (orange-cloud) hostname, so unproxied domains drop them.
 */
'use strict';

const { Resolver } = require('node:dns/promises');
const { CF_HTTPS_PORTS, CF_HTTP_PORTS } = require('./constants');

function isIPv4(value) {
  return /^(\d{1,3}\.){3}\d{1,3}$/.test(value)
    && value.split('.').every((n) => Number(n) >= 0 && Number(n) <= 255);
}
function isIPv6(value) {
  return value.includes(':') && /^[0-9a-fA-F:]+$/.test(value);
}

function parseAddressList(raw) {
  return String(raw || '')
    .split(/[\s,;]+/)
    .map((v) => v.trim())
    .filter(Boolean)
    .filter((v) => isIPv4(v) || isIPv6(v) || v.includes('.'));
}

/** Resolve the domain's own A/AAAA records — already several distinct CF edges. */
async function resolveDomain(domain, { includeIPv6 = false } = {}) {
  const resolver = new Resolver({ timeout: 4000, tries: 2 });
  const out = { v4: [], v6: [], error: null };
  try {
    out.v4 = await resolver.resolve4(domain);
  } catch (err) {
    out.error = err.code || err.message;
  }
  if (includeIPv6) {
    try { out.v6 = await resolver.resolve6(domain); } catch { /* often absent */ }
  }
  return out;
}

async function collectAddresses(domain, settings) {
  const manual = parseAddressList(settings.cleanIPs);
  const addresses = [domain, ...manual];

  if (manual.length === 0) {
    const resolved = await resolveDomain(domain, { includeIPv6: settings.includeIPv6 });
    if (resolved.error && resolved.v4.length === 0) {
      // Falling back to one address would fake diversity — say what went wrong.
      return { addresses: [domain], resolved, warning: 'dns-failed' };
    }
    addresses.push(...resolved.v4);
    if (settings.includeIPv6) addresses.push(...resolved.v6.map((ip) => `[${ip}]`));
    return { addresses: dedupe(addresses), resolved, warning: null };
  }
  return { addresses: dedupe(addresses), resolved: null, warning: null };
}

function dedupe(list) {
  return [...new Set(list.map((v) => v.trim()).filter(Boolean))];
}

/** CF alternate ports are dead unless the hostname is proxied. */
function usablePorts(settings, proxied) {
  if (proxied) return { https: settings.httpsPorts || [], http: [] };
  return {
    https: (settings.httpsPorts || []).includes(443) ? [443] : [],
    http: []
  };
}

/** nodes = addresses × ports; all ports of one address stay together. */
function generate({ domain, settings, addresses }) {
  const httpsPorts = (settings.httpsPorts || []).filter((p) => CF_HTTPS_PORTS.includes(Number(p)));
  const ports = httpsPorts.map((port) => ({ port: Number(port), tls: true }));
  if (!ports.length) return { nodes: [], truncated: false, reason: 'no-ports' };
  if (!addresses.length) return { nodes: [], truncated: false, reason: 'no-addresses' };

  const cap = Number(settings.maxNodes || 150);
  const prefix = (settings.prefix || 'Neon').trim() || 'Neon';
  const nodes = [];
  for (const address of addresses) {
    for (const { port, tls } of ports) {
      if (nodes.length >= cap) return { nodes, truncated: true, reason: null };
      nodes.push({
        address, port, tls,
        sni: domain, host: domain,
        remark: `${prefix}-${String(nodes.length + 1).padStart(2, '0')}`
      });
    }
  }
  return { nodes, truncated: false, reason: null };
}

function summarise(nodes) {
  return {
    total: nodes.length,
    addresses: new Set(nodes.map((n) => n.address)).size,
    ports: new Set(nodes.map((n) => n.port)).size
  };
}

module.exports = {
  CF_HTTPS_PORTS, CF_HTTP_PORTS,
  parseAddressList, resolveDomain, collectAddresses,
  usablePorts, generate, summarise
};
