import { describe, it, expect } from 'vitest';
import { toBase64, fromBase64, toBase64Url, fromBase64Url, toHex, fromHex, randomBytes, generateId } from '../crypto';

describe('base64 without Buffer', () => {
  it('round trips every length 0..64', () => {
    for (let len = 0; len <= 64; len++) {
      const bytes = randomBytes(len);
      const b64 = toBase64(bytes);
      expect(b64.length % 4).toBe(0);
      expect(Array.from(fromBase64(b64))).toEqual(Array.from(bytes));
      const url = toBase64Url(bytes);
      expect(url).not.toMatch(/[+/=]/);
      expect(Array.from(fromBase64Url(url))).toEqual(Array.from(bytes));
    }
  });

  it('matches known encodings', () => {
    const enc = new TextEncoder();
    expect(toBase64(enc.encode('f'))).toBe('Zg==');
    expect(toBase64(enc.encode('fo'))).toBe('Zm8=');
    expect(toBase64(enc.encode('foo'))).toBe('Zm9v');
    expect(toBase64(enc.encode('foob'))).toBe('Zm9vYg==');
    expect(toBase64(new Uint8Array([0xfb, 0xff]))).toBe('+/8=');
    expect(toBase64Url(new Uint8Array([0xfb, 0xff]))).toBe('-_8');
    expect(new TextDecoder().decode(fromBase64('Zm9vYg=='))).toBe('foob');
    expect(new TextDecoder().decode(fromBase64('Zm9vYg'))).toBe('foob');
  });

  it('rejects invalid characters', () => {
    expect(() => fromBase64('Zm9v!')).toThrow();
  });

  it('hex round trips', () => {
    const bytes = randomBytes(33);
    expect(Array.from(fromHex(toHex(bytes)))).toEqual(Array.from(bytes));
    expect(toHex(new Uint8Array([0, 255, 16]))).toBe('00ff10');
  });

  it('generateId has the prefix and length', () => {
    const id = generateId('ag_', 16);
    expect(id).toMatch(/^ag_[A-Za-z0-9]{16}$/);
  });
});
