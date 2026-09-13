import { describe, it, expect } from 'vitest';
import { canonicalize, sha256hex, canonicalHash } from '../canonical';

describe('canonicalize (RFC 8785)', () => {
  it('sorts object keys by code unit and emits no whitespace', () => {
    expect(canonicalize({ b: 1, a: 2, C: 3 })).toBe('{"C":3,"a":2,"b":1}');
  });

  it('sorts nested objects and keeps array order', () => {
    const out = canonicalize({ z: { y: [3, { b: 1, a: 0 }, 1], x: 'q' }, a: [] });
    expect(out).toBe('{"a":[],"z":{"x":"q","y":[3,{"a":0,"b":1},1]}}');
  });

  it('escapes strings like JSON, control chars as lowercase \\u00xx, unicode kept', () => {
    const input = 'a"b\\c\n' + String.fromCharCode(1) + 'é😀';
    expect(canonicalize({ s: input })).toBe('{"s":"a\\"b\\\\c\\n\\u0001é😀"}');
  });

  it('sorts unicode keys by UTF-16 code units', () => {
    // 'é' (U+00E9) sorts after 'z' (U+007A); '😀' (surrogate pair D83D DE00) sorts after 'é'
    expect(canonicalize({ '😀': 1, é: 2, z: 3 })).toBe('{"z":3,"é":2,"😀":1}');
  });

  it('omits undefined properties and turns undefined array items into null', () => {
    expect(canonicalize({ a: undefined, b: 1, c: [undefined, 2] })).toBe('{"b":1,"c":[null,2]}');
  });

  it('serializes numbers as shortest round trip, -0 as 0', () => {
    expect(canonicalize([1, 1.5, 1e21, 1e-7, -0, 0.1 + 0.2])).toBe('[1,1.5,1e+21,1e-7,0,0.30000000000000004]');
  });

  it('rejects NaN, Infinity and bigint', () => {
    expect(() => canonicalize({ a: NaN })).toThrow(/non-finite/);
    expect(() => canonicalize({ a: Infinity })).toThrow(/non-finite/);
    expect(() => canonicalize({ a: 10n })).toThrow(/bigint/);
  });

  it('handles null, booleans and Dates (via toJSON)', () => {
    expect(canonicalize({ n: null, t: true, d: new Date('2026-01-02T03:04:05.000Z') })).toBe(
      '{"d":"2026-01-02T03:04:05.000Z","n":null,"t":true}'
    );
  });

  it('is stable regardless of insertion order', () => {
    const a = canonicalize({ x: 1, y: { p: 1, q: 2 } });
    const b = canonicalize({ y: { q: 2, p: 1 }, x: 1 });
    expect(a).toBe(b);
    expect(canonicalHash({ x: 1, y: { p: 1, q: 2 } })).toBe(canonicalHash({ y: { q: 2, p: 1 }, x: 1 }));
  });
});

describe('sha256hex', () => {
  it('matches known vectors', () => {
    expect(sha256hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(sha256hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(sha256hex(new TextEncoder().encode('abc'))).toBe(sha256hex('abc'));
  });
});
