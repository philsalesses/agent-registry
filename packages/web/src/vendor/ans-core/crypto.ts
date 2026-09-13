import * as ed25519 from '@noble/ed25519';
import { sha512 } from '@noble/hashes/sha512';

// Configure ed25519 to use sha512 (required by @noble/ed25519 v2 for sync ops)
ed25519.etc.sha512Sync = (...m) => sha512(ed25519.etc.concatBytes(...m));

/**
 * Generate a new Ed25519 keypair for agent identity
 */
export async function generateKeypair(): Promise<{
  privateKey: Uint8Array;
  publicKey: Uint8Array;
}> {
  const privateKey = ed25519.utils.randomPrivateKey();
  const publicKey = await ed25519.getPublicKeyAsync(privateKey);
  return { privateKey, publicKey };
}

/**
 * Sign a message with a private key
 */
export async function sign(
  message: Uint8Array,
  privateKey: Uint8Array
): Promise<Uint8Array> {
  return ed25519.signAsync(message, privateKey);
}

/**
 * Verify a signature
 */
export async function verify(
  signature: Uint8Array,
  message: Uint8Array,
  publicKey: Uint8Array
): Promise<boolean> {
  try {
    return await ed25519.verifyAsync(signature, message, publicKey);
  } catch {
    return false;
  }
}

// =============================================================================
// Base64 (browser and Node safe, no Buffer)
// =============================================================================

const B64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const B64_LOOKUP: Int16Array = (() => {
  const table = new Int16Array(256).fill(-1);
  for (let i = 0; i < B64_ALPHABET.length; i++) table[B64_ALPHABET.charCodeAt(i)] = i;
  // Accept base64url characters on decode too
  table['-'.charCodeAt(0)] = 62;
  table['_'.charCodeAt(0)] = 63;
  return table;
})();

/**
 * Encode bytes to standard base64 (with padding)
 */
export function toBase64(bytes: Uint8Array): string {
  let out = '';
  const len = bytes.length;
  let i = 0;
  for (; i + 2 < len; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    out +=
      B64_ALPHABET[(n >> 18) & 63] +
      B64_ALPHABET[(n >> 12) & 63] +
      B64_ALPHABET[(n >> 6) & 63] +
      B64_ALPHABET[n & 63];
  }
  if (i < len) {
    const remaining = len - i;
    const n = (bytes[i] << 16) | (remaining === 2 ? bytes[i + 1] << 8 : 0);
    out += B64_ALPHABET[(n >> 18) & 63] + B64_ALPHABET[(n >> 12) & 63];
    out += remaining === 2 ? B64_ALPHABET[(n >> 6) & 63] : '=';
    out += '=';
  }
  return out;
}

/**
 * Decode base64 (standard or url-safe, padded or not) to bytes.
 * Throws on characters outside the alphabet.
 */
export function fromBase64(str: string): Uint8Array {
  // Strip whitespace and padding
  let clean = '';
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    if (ch === '=' || ch === ' ' || ch === '\n' || ch === '\r' || ch === '\t') continue;
    clean += ch;
  }
  const len = clean.length;
  if (len % 4 === 1) throw new Error('Invalid base64 length');
  const outLen = Math.floor((len * 3) / 4);
  const out = new Uint8Array(outLen);
  let o = 0;
  let acc = 0;
  let bits = 0;
  for (let i = 0; i < len; i++) {
    const v = B64_LOOKUP[clean.charCodeAt(i)];
    if (v === undefined || v < 0) throw new Error(`Invalid base64 character at ${i}`);
    acc = (acc << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[o++] = (acc >> bits) & 0xff;
    }
  }
  return out;
}

/**
 * Encode bytes to base64url (RFC 4648 section 5, no padding)
 */
export function toBase64Url(bytes: Uint8Array): string {
  return toBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Decode base64url to bytes (padding optional)
 */
export function fromBase64Url(str: string): Uint8Array {
  return fromBase64(str);
}

// =============================================================================
// Hex
// =============================================================================

const HEX = '0123456789abcdef';

/**
 * Encode bytes to lowercase hex
 */
export function toHex(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    out += HEX[bytes[i] >> 4] + HEX[bytes[i] & 15];
  }
  return out;
}

/**
 * Decode hex to bytes
 */
export function fromHex(hex: string): Uint8Array {
  const s = hex.startsWith('0x') ? hex.slice(2) : hex;
  if (s.length % 2 !== 0) throw new Error('Invalid hex length');
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) {
    const b = parseInt(s.slice(i * 2, i * 2 + 2), 16);
    if (Number.isNaN(b)) throw new Error(`Invalid hex at ${i * 2}`);
    out[i] = b;
  }
  return out;
}

// =============================================================================
// Random and text helpers
// =============================================================================

/**
 * Cryptographically random bytes (Web Crypto, available in browsers and Node 19+)
 */
export function randomBytes(length: number): Uint8Array {
  const out = new Uint8Array(length);
  globalThis.crypto.getRandomValues(out);
  return out;
}

/**
 * UTF-8 encode a string
 */
export function utf8ToBytes(str: string): Uint8Array {
  return new TextEncoder().encode(str);
}

/**
 * UTF-8 decode bytes
 */
export function bytesToUtf8(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

/**
 * Generate a random ID with prefix
 */
export function generateId(prefix: string, length: number = 12): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = randomBytes(length);
  let result = prefix;
  for (const byte of bytes) {
    result += chars[byte % chars.length];
  }
  return result;
}

/**
 * Hash data using SHA-512
 */
export function hash(data: Uint8Array): Uint8Array {
  return sha512(data);
}
