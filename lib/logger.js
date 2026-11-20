/** Aral Neon — console logger with Barberry Gold palette. */
'use strict';

const C = {
  gold: (s) => `\x1b[38;5;178m${s}\x1b[0m`,
  wine: (s) => `\x1b[38;5;131m${s}\x1b[0m`,
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  ok: (s) => `\x1b[32m${s}\x1b[0m`,
  warn: (s) => `\x1b[33m${s}\x1b[0m`,
  err: (s) => `\x1b[31m${s}\x1b[0m`
};

const ts = () => new Date().toISOString().slice(11, 19);

const Logger = {
  info: (msg) => console.log(`${C.dim(ts())} ${C.gold('◈')} ${msg}`),
  ok: (msg) => console.log(`${C.dim(ts())} ${C.ok('✓')} ${msg}`),
  warn: (msg) => console.warn(`${C.dim(ts())} ${C.warn('⚠')} ${msg}`),
  error: (msg) => console.error(`${C.dim(ts())} ${C.err('✗')} ${msg}`),
  item: (k, v) => console.log(`${C.dim(ts())}   ${C.wine(k.padEnd(18))} ${C.gold(String(v))}`),
  step: (msg) => console.log(`${C.dim(ts())} ${C.wine('⟐')} ${msg}`),
  section: (t) => console.log(`\n${C.wine('──')} ${C.gold(t)} ${C.wine('──')}`),
  banner() {
    const line = C.gold('═'.repeat(52));
    console.log(`\n${line}`);
    console.log(C.gold('  ╔═╗ ╔╗╔ ╔═╗ ╔═╗ ╔╦╗ ╦═╗ ╦ ╦  ╔╦╗ ╔═╗ ╔╦╗ ╦'));
    console.log(C.gold('  ╠═╣ ║║║ ╠═╣ ║╣   ║  ╠╦╝ ╠═╣  ║║║ ║╣   ║  ║'));
    console.log(C.gold('  ╩ ╩ ╝╚╝ ╩ ╩ ╚═╝  ╩  ╩╚═ ╩ ╩  ╩ ╩ ╚═╝  ╩  ╩═╝'));
    console.log(C.wine('      Aral Neon · یک پورت، همهٔ پروتکل‌ها'));
    console.log(`${line}\n`);
  }
};

module.exports = Logger;
