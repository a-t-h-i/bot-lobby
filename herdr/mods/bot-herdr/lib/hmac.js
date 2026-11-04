// HMAC-SHA256 (RFC 2104) from a plain sha256 hash. herdr's "crypto" has
// createHash but no createHmac. The hash function is passed in so Node tests
// can run this with node:crypto and the mod with herdr's "crypto".

/** @param {string} hex */
function hexBytes(hex) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/** @param {Uint8Array} bytes */
export function base64url(bytes) {
  const abc = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    out += abc[(n >> 18) & 63] + abc[(n >> 12) & 63];
    if (i + 1 < bytes.length) out += abc[(n >> 6) & 63];
    if (i + 2 < bytes.length) out += abc[n & 63];
  }
  return out;
}

/** @param {string} text */
export function base64Bytes(text) {
  const abc = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const clean = text.replace(/[^A-Za-z0-9+/]/g, "");
  const out = [];
  for (let i = 0; i < clean.length; i += 4) {
    const n = (abc.indexOf(clean[i]) << 18) | (abc.indexOf(clean[i + 1]) << 12) | ((abc.indexOf(clean[i + 2] ?? "A") & 63) << 6) | (abc.indexOf(clean[i + 3] ?? "A") & 63);
    out.push((n >> 16) & 255);
    if (clean[i + 2] !== undefined) out.push((n >> 8) & 255);
    if (clean[i + 3] !== undefined) out.push(n & 255);
  }
  return new Uint8Array(out);
}

/**
 * @param {(alg: string) => { update(d: Uint8Array): any; digest(enc: string): any }} createHash
 * @param {Uint8Array} key
 * @param {string} message UTF-8 text (ASCII in practice)
 * @returns {Uint8Array}
 */
export function hmacSha256(createHash, key, message) {
  const sha = (/** @type {Uint8Array} */ data) => hexBytes(String(createHash("sha256").update(data).digest("hex")));
  let k = key.length > 64 ? sha(key) : key;
  const block = new Uint8Array(64);
  block.set(k);
  const msg = new TextEncoder().encode(message);
  const inner = new Uint8Array(64 + msg.length);
  const outer = new Uint8Array(64 + 32);
  for (let i = 0; i < 64; i++) { inner[i] = block[i] ^ 0x36; outer[i] = block[i] ^ 0x5c; }
  inner.set(msg, 64);
  outer.set(sha(inner), 64);
  return sha(outer);
}

/** The `bl_session` cookie value for a server secret (base64 text from web.json). */
export function sessionCookie(createHash, secretBase64) {
  return base64url(hmacSha256(createHash, base64Bytes(secretBase64), "bot-lobby session v1"));
}
