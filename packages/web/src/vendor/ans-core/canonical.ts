import { sha256 } from '@noble/hashes/sha2';
import { toHex, utf8ToBytes } from './crypto';

/**
 * RFC 8785 (JSON Canonicalization Scheme) serialization.
 *
 * Rules implemented:
 * - object keys sorted by UTF-16 code unit order (what RFC 8785 specifies)
 * - no whitespace
 * - numbers serialized via ES Number::toString (shortest round-trip), -0 as 0
 * - strings escaped per JSON (JSON.stringify), which matches RFC 8785 escaping
 * - properties whose value is undefined (or a function or symbol) are omitted
 * - arrays keep their order; undefined array elements become null
 * - NaN, Infinity and bigint are rejected with a clear error
 *   (bigint amounts must be passed as decimal strings)
 * - objects with a toJSON method (Date) are serialized through it
 */
export function canonicalize(value: unknown): string {
  const out = serialize(value, '$');
  if (out === undefined) {
    throw new Error('canonicalize: top-level value cannot be undefined, a function or a symbol');
  }
  return out;
}

function serialize(value: unknown, path: string): string | undefined {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'string':
      return JSON.stringify(value);
    case 'boolean':
      return value ? 'true' : 'false';
    case 'number':
      if (!Number.isFinite(value)) {
        throw new Error(`canonicalize: non-finite number at ${path} (NaN and Infinity are not allowed)`);
      }
      return JSON.stringify(value);
    case 'bigint':
      throw new Error(`canonicalize: bigint at ${path}; pass money amounts as decimal strings`);
    case 'undefined':
    case 'function':
    case 'symbol':
      return undefined;
    case 'object':
      break;
    default:
      throw new Error(`canonicalize: unsupported type ${typeof value} at ${path}`);
  }

  const obj = value as Record<string, unknown> & { toJSON?: (key?: string) => unknown };
  if (typeof obj.toJSON === 'function') {
    return serialize(obj.toJSON(), path);
  }

  if (Array.isArray(obj)) {
    const parts: string[] = [];
    for (let i = 0; i < obj.length; i++) {
      const s = serialize(obj[i], `${path}[${i}]`);
      parts.push(s === undefined ? 'null' : s);
    }
    return '[' + parts.join(',') + ']';
  }

  // Plain object: sort keys by UTF-16 code units (default JS string comparison)
  const keys = Object.keys(obj).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const parts: string[] = [];
  for (const key of keys) {
    const s = serialize(obj[key], `${path}.${key}`);
    if (s === undefined) continue;
    parts.push(JSON.stringify(key) + ':' + s);
  }
  return '{' + parts.join(',') + '}';
}

/**
 * SHA-256 of a string (UTF-8) or bytes, as lowercase hex
 */
export function sha256hex(input: string | Uint8Array): string {
  const bytes = typeof input === 'string' ? utf8ToBytes(input) : input;
  return toHex(sha256(bytes));
}

/**
 * SHA-256 of a string or bytes, as raw bytes
 */
export function sha256bytes(input: string | Uint8Array): Uint8Array {
  const bytes = typeof input === 'string' ? utf8ToBytes(input) : input;
  return sha256(bytes);
}

/**
 * sha256hex(canonicalize(value)): the hash used for schema hashes, terms hashes, etc.
 */
export function canonicalHash(value: unknown): string {
  return sha256hex(canonicalize(value));
}
