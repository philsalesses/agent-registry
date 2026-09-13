import { parseUsdToMicros, toMicros } from 'ans-core';
import { AnsApiError } from './errors';
import type { FetchLike } from './types';

/** Default registry API */
export const DEFAULT_BASE_URL = 'https://api.ans-registry.org';

export const HEX64 = /^[0-9a-f]{64}$/;

/** Five minutes, the signed-request and invoke-forward timestamp window */
export const FIVE_MINUTES_MS = 5 * 60 * 1000;

export function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

export function trimBaseUrl(url: string): string {
  return url.replace(/\/+$/, '');
}

/** The global fetch, looked up at call time so late polyfills still work */
export function resolveFetch(custom?: FetchLike): FetchLike {
  if (custom) return custom;
  return (input, init) => {
    const f = (globalThis as { fetch?: FetchLike }).fetch;
    if (typeof f !== 'function') {
      throw new Error('ans-sdk: no global fetch is available; pass `fetch` in the options');
    }
    return f(input, init);
  };
}

/** Encode a path segment, keeping `@` readable (handles) */
export function seg(value: string): string {
  return encodeURIComponent(value).replace(/%40/g, '@');
}

/**
 * The pathname exactly as a Hono server reports `c.req.path`, which is what the
 * registry verifies signatures against: percent escapes are decoded with
 * decodeURI (reserved characters stay escaped) when the path contains any.
 */
export function serverPath(pathname: string): string {
  if (!pathname.includes('%')) return pathname;
  try {
    return decodeURI(pathname.replace(/%25/g, '%2525'));
  } catch {
    return pathname;
  }
}

/** Control characters other than tab, newline and carriage return */
const CONTROL_CHARS = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g;

/**
 * The registry's text normalization for task and hint names: control characters
 * other than tab, newline and carriage return are removed, then the ends trimmed.
 * Signed terms must carry the normalized text.
 */
export function cleanText(s: string): string {
  return s.replace(CONTROL_CHARS, '').trim();
}

export type MicrosLike = bigint | number | string;

/** A non-negative micros amount as a decimal string */
export function microsString(value: MicrosLike, field: string): string {
  let m: bigint;
  try {
    m = toMicros(value);
  } catch {
    throw localError(400, 'validation_error', `${field} must be an integer number of USD micros ($1 = 1000000)`);
  }
  if (m < 0n) throw localError(400, 'validation_error', `${field} must not be negative`);
  return m.toString();
}

/** Dollars ('1.25', 1.25, '$1.25') as a non-negative micros decimal string */
export function usdMicrosString(value: number | string, field: string): string {
  let m: bigint;
  try {
    m = parseUsdToMicros(typeof value === 'number' ? usdNumberString(value) : value);
  } catch {
    throw localError(400, 'validation_error', `${field} must be a dollar amount with at most 6 decimals`);
  }
  if (m < 0n) throw localError(400, 'validation_error', `${field} must not be negative`);
  return m.toString();
}

function usdNumberString(n: number): string {
  if (!Number.isFinite(n)) return 'NaN';
  // No exponent notation and no binary noise past micro precision
  return n.toFixed(6);
}

/** Pick priceMicros or priceUsd (micros wins when both are given) */
export function priceFrom(input: { priceMicros?: MicrosLike | null; priceUsd?: number | string | null }, field = 'price'): string {
  if (input.priceMicros !== undefined && input.priceMicros !== null) return microsString(input.priceMicros, `${field}Micros`);
  if (input.priceUsd !== undefined && input.priceUsd !== null) return usdMicrosString(input.priceUsd, `${field}Usd`);
  return '0';
}

/** Whole-second ISO 8601 UTC, the only deadline format the registry accepts */
export function wholeSecondIso(d: Date): string {
  return new Date(Math.floor(d.getTime() / 1000) * 1000).toISOString();
}

/** An error raised before any request was sent */
export function localError(status: number, code: string, message: string, details?: unknown): AnsApiError {
  return new AnsApiError({ status, code, message, details, requestId: null, fix: { docs: 'https://ans-registry.org/skill.md' } });
}

// ---------------------------------------------------------------------------
// Tiny structural JSON Schema check (no ajv): top-level type, required keys,
// and the declared type of each present top-level property.
// ---------------------------------------------------------------------------

export interface OutputCheck {
  ok: boolean;
  errors: string[];
}

function typeOk(expected: unknown, value: unknown): boolean {
  if (Array.isArray(expected)) return expected.some((t) => typeOk(t, value));
  switch (expected) {
    case 'string':
      return typeof value === 'string';
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'integer':
      return typeof value === 'number' && Number.isInteger(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'null':
      return value === null;
    case 'array':
      return Array.isArray(value);
    case 'object':
      return typeof value === 'object' && value !== null && !Array.isArray(value);
    default:
      // no type, or one this check does not know: do not fail on it
      return true;
  }
}

function describeType(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

export function checkAgainstSchema(schema: unknown, value: unknown): OutputCheck {
  const errors: string[] = [];
  if (!isPlainObject(schema)) return { ok: true, errors };
  if (schema.type !== undefined && !typeOk(schema.type, value)) {
    errors.push(`expected ${JSON.stringify(schema.type)} at the top level, got ${describeType(value)}`);
    return { ok: false, errors };
  }
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    const required = Array.isArray(schema.required) ? schema.required.filter((k): k is string => typeof k === 'string') : [];
    for (const key of required) {
      if (!Object.prototype.hasOwnProperty.call(obj, key)) errors.push(`missing required property "${key}"`);
    }
    if (isPlainObject(schema.properties)) {
      for (const [key, sub] of Object.entries(schema.properties)) {
        if (!Object.prototype.hasOwnProperty.call(obj, key) || !isPlainObject(sub) || sub.type === undefined) continue;
        if (!typeOk(sub.type, obj[key])) {
          errors.push(`property "${key}" should be ${JSON.stringify(sub.type)}, got ${describeType(obj[key])}`);
        }
      }
    }
  }
  return { ok: errors.length === 0, errors };
}
