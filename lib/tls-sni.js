/** Aral Neon — TLS ClientHello SNI / ALPN parser (RFC 5246 / 8446 / 7301). */
'use strict';

/**
 * Extracts { sni, alpn } from a raw TLS ClientHello record.
 * Tolerates truncated records (returns what it found) and never throws.
 */
function parseClientHello(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 42) return { sni: null, alpn: [] };
  try {
    if (buf[0] !== 0x16 || buf[1] !== 0x03) return { sni: null, alpn: [] };

    let offset = 5;
    if (buf[offset] !== 0x01) return { sni: null, alpn: [] }; // not a ClientHello

    offset += 1 + 3 + 2 + 32; // handshake header + version + random
    if (offset >= buf.length) return { sni: null, alpn: [] };

    const sessionIdLen = buf[offset];
    offset += 1 + sessionIdLen;
    if (offset + 2 > buf.length) return { sni: null, alpn: [] };

    const cipherSuitesLen = buf.readUInt16BE(offset);
    offset += 2 + cipherSuitesLen;
    if (offset + 1 > buf.length) return { sni: null, alpn: [] };

    const compMethodsLen = buf[offset];
    offset += 1 + compMethodsLen;
    if (offset + 2 > buf.length) return { sni: null, alpn: [] };

    const extTotalLen = buf.readUInt16BE(offset);
    offset += 2;
    const extLimit = Math.min(offset + extTotalLen, buf.length);

    let sni = null;
    const alpn = [];

    while (offset + 4 <= extLimit) {
      const extType = buf.readUInt16BE(offset);
      const extLen = buf.readUInt16BE(offset + 2);
      offset += 4;

      if (extType === 0x0000 && !sni) {
        // server_name
        if (offset + 2 <= extLimit) {
          const sniListLen = buf.readUInt16BE(offset);
          let so = offset + 2;
          const sl = Math.min(so + sniListLen, extLimit);
          while (so + 3 <= sl) {
            const nameType = buf[so];
            const nameLen = buf.readUInt16BE(so + 1);
            so += 3;
            if (nameType === 0x00 && so + nameLen <= buf.length) {
              sni = buf.toString('utf8', so, so + nameLen);
              break;
            }
            so += nameLen;
          }
        }
      } else if (extType === 0x0010) {
        // ALPN
        if (offset + 2 <= extLimit) {
          const alpnListLen = buf.readUInt16BE(offset);
          let ao = offset + 2;
          const al = Math.min(ao + alpnListLen, extLimit);
          while (ao + 1 <= al) {
            const pLen = buf[ao];
            ao++;
            if (ao + pLen <= al) alpn.push(buf.toString('utf8', ao, ao + pLen));
            ao += pLen;
          }
        }
      }

      offset += extLen;
    }

    return { sni, alpn };
  } catch {
    return { sni: null, alpn: [] };
  }
}

module.exports = { parseClientHello };
