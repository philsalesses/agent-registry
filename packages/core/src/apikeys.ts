import { randomBytes } from './crypto';
import { sha256hex } from './canonical';

export const API_KEY_PREFIX = 'ak_';
export const API_KEY_RANDOM_LENGTH = 32;
/** Length of the displayed prefix: 'ak_' plus 8 chars */
export const API_KEY_DISPLAY_PREFIX_LENGTH = 11;

const URL_SAFE = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

export interface GeneratedApiKey {
  /** The full key, shown to the owner once */
  key: string;
  /** First 11 chars ('ak_' + 8), safe to display and store */
  prefix: string;
  /** sha256hex(key), what the server stores */
  hash: string;
}

/**
 * Generate an API key: 'ak_' + 32 url-safe chars, its display prefix and its sha256 hash
 */
export function generateApiKey(): GeneratedApiKey {
  const bytes = randomBytes(API_KEY_RANDOM_LENGTH);
  let body = '';
  for (let i = 0; i < bytes.length; i++) body += URL_SAFE[bytes[i] & 63];
  const key = API_KEY_PREFIX + body;
  return { key, prefix: key.slice(0, API_KEY_DISPLAY_PREFIX_LENGTH), hash: sha256hex(key) };
}

const API_KEY_RE = /^ak_[A-Za-z0-9_-]{32}$/;

/**
 * True when the string has the shape of an ANS API key
 */
export function isApiKey(s: unknown): s is string {
  return typeof s === 'string' && API_KEY_RE.test(s);
}

/**
 * The hash stored for a key (sha256hex of the full key)
 */
export function hashApiKey(key: string): string {
  return sha256hex(key);
}

/**
 * The display prefix of a key
 */
export function apiKeyPrefix(key: string): string {
  return key.slice(0, API_KEY_DISPLAY_PREFIX_LENGTH);
}
