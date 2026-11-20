/**
 * Aral Neon — Telegram alerts + backup delivery (notifications only, one-way;
 * the bot never accepts commands, so a leaked chat id cannot drive the panel).
 */
'use strict';

const API = 'https://api.telegram.org/bot';
const TIMEOUT_MS = 10000;

async function call(token, method, body) {
  if (!token) return { ok: false, message: 'no bot token set' };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${API}${token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    const payload = await res.json().catch(() => null);
    if (!payload?.ok) return { ok: false, message: payload?.description || `Telegram answered ${res.status}` };
    return { ok: true, result: payload.result };
  } catch (err) {
    return { ok: false, message: err.name === 'AbortError' ? 'Telegram did not answer in time' : err.message };
  } finally {
    clearTimeout(timer);
  }
}

class Telegram {
  constructor(store) {
    this.store = store;
  }

  cfg() { return this.store.data.telegram; }

  /** Send a test message and return the bot username. */
  async verify(token, chatId) {
    const me = await call(token, 'getMe', {});
    if (!me.ok) return me;
    const sent = await call(token, 'sendMessage', {
      chat_id: chatId,
      text: '✨ Aral Neon connected. This chat will receive alerts and backups.'
    });
    if (!sent.ok) return sent;
    return { ok: true, bot: me.result?.username || null };
  }

  async send(text) {
    const c = this.cfg();
    if (!c.enabled || !c.chatId || !c.botToken) return { ok: false, message: 'notifications are off' };
    return call(c.botToken, 'sendMessage', { chat_id: c.chatId, text, parse_mode: 'HTML' });
  }

  /** Multipart upload by hand — Telegram will not take a file as JSON. */
  async sendDocument(buffer, filename, caption) {
    const c = this.cfg();
    if (!c.enabled || !c.chatId || !c.botToken) return { ok: false, message: 'notifications are off' };
    const boundary = '----AralNeon' + Math.random().toString(36).slice(2);
    const field = (name, value) =>
      `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`;
    const parts = [];
    parts.push(Buffer.from(field('chat_id', c.chatId), 'utf8'));
    if (caption) parts.push(Buffer.from(field('caption', caption), 'utf8'));
    parts.push(Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="document"; filename="${filename}"\r\n` +
      'Content-Type: application/json\r\n\r\n', 'utf8'));
    parts.push(Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer, 'utf8'));
    parts.push(Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8'));

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30000);
    try {
      const res = await fetch(`${API}${c.botToken}/sendDocument`, {
        method: 'POST',
        headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
        body: Buffer.concat(parts),
        signal: controller.signal
      });
      const payload = await res.json().catch(() => null);
      if (!payload?.ok) return { ok: false, message: payload?.description || `Telegram answered ${res.status}` };
      return { ok: true };
    } catch (err) {
      return { ok: false, message: err.message };
    } finally {
      clearTimeout(timer);
    }
  }

  /** Daily/weekly backup + threshold alerts, driven by the system monitor. */
  async backupNow() {
    const c = this.cfg();
    if (!c.enabled || !c.sendBackup) return { ok: false, message: 'backup delivery off' };
    const data = this.store.exportBackup();
    // Do not ship the bot token inside its own backup.
    const safe = { ...data, telegram: { ...data.telegram, botToken: null } };
    return this.sendDocument(Buffer.from(JSON.stringify(safe, null, 2)),
      `aral-neon-backup-${new Date().toISOString().slice(0, 10)}.json`,
      `💫 Aral Neon backup — ${data.clients.length} clients`);
  }
}

module.exports = { Telegram };
