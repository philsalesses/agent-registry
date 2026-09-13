import { describe, it, expect } from 'vitest';
import { generateApiKey, isApiKey, hashApiKey, apiKeyPrefix } from '../apikeys';
import { sha256hex } from '../canonical';

describe('api keys', () => {
  it('generates ak_ + 32 url-safe chars with prefix and hash', () => {
    const k = generateApiKey();
    expect(k.key).toMatch(/^ak_[A-Za-z0-9_-]{32}$/);
    expect(k.prefix).toBe(k.key.slice(0, 11));
    expect(k.prefix).toHaveLength(11);
    expect(k.hash).toBe(sha256hex(k.key));
    expect(hashApiKey(k.key)).toBe(k.hash);
    expect(apiKeyPrefix(k.key)).toBe(k.prefix);
    expect(isApiKey(k.key)).toBe(true);
    expect(generateApiKey().key).not.toBe(k.key);
  });

  it('isApiKey rejects other shapes', () => {
    expect(isApiKey('ak_short')).toBe(false);
    expect(isApiKey('sk_' + 'a'.repeat(32))).toBe(false);
    expect(isApiKey('ak_' + 'a'.repeat(32) + '!')).toBe(false);
    expect(isApiKey(42)).toBe(false);
  });
});
