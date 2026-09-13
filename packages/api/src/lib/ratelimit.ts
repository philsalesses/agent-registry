import type { Context, MiddlewareHandler } from 'hono';
import { getConnInfo } from '@hono/node-server/conninfo';
import { sql } from 'drizzle-orm';
import { ANS_BLOCK } from 'ans-core';
import { db } from '../db';
import { config } from '../config';
import { teach } from './errors';

/**
 * Postgres-backed fixed-window rate limiter (docs/DESIGN.md 14.1, section 10).
 * One row per key in `rate_limits`: count and reset_at. A single
 * INSERT ... ON CONFLICT DO UPDATE ... RETURNING both bumps and reads.
 */

export interface RateLimitResult {
  allowed: boolean;
  count: number;
  limit: number;
  resetAt: Date;
  retryAfterSec: number;
}

export interface NamedLimit {
  max: number;
  windowSec: number;
}

/** Named limits (section 4 and 14.9). */
export const LIMITS = {
  global: { max: 300, windowSec: 60 },
  'register:ip': { max: 5, windowSec: 3600 },
  'receipt:pair': { max: 10, windowSec: 3600 },
  'hint:day': { max: 20, windowSec: 86400 },
} as const satisfies Record<string, NamedLimit>;

export type LimitName = keyof typeof LIMITS;

/** Parse a `timestamp without time zone` text value as UTC. */
function pgTimestampToDate(text: string): Date {
  return new Date(text.replace(' ', 'T') + 'Z');
}

/**
 * Count one hit against `key`. Fixed window: the first hit opens a window of
 * windowSec; hits after reset_at start a fresh window.
 */
export async function consume(key: string, max: number, windowSec: number, now: Date = new Date()): Promise<RateLimitResult> {
  const nowIso = now.toISOString();
  const resetIso = new Date(now.getTime() + windowSec * 1000).toISOString();
  const rows = await db.execute(sql`
    insert into rate_limits (key, count, reset_at)
    values (${key}, 1, ${resetIso}::timestamp)
    on conflict (key) do update set
      count = case when rate_limits.reset_at <= ${nowIso}::timestamp then 1 else rate_limits.count + 1 end,
      reset_at = case when rate_limits.reset_at <= ${nowIso}::timestamp then ${resetIso}::timestamp else rate_limits.reset_at end
    returning count, reset_at::text as reset_at_text
  `);
  const row = rows[0] as { count: number; reset_at_text: string };
  const count = Number(row.count);
  const resetAt = pgTimestampToDate(row.reset_at_text);
  const retryAfterSec = Math.max(1, Math.ceil((resetAt.getTime() - now.getTime()) / 1000));
  return { allowed: count <= max, count, limit: max, resetAt, retryAfterSec };
}

/** Check a named limit for an id (e.g. checkNamedLimit('receipt:pair', `${a}:${b}`)). */
export function checkNamedLimit(name: LimitName, id: string, now?: Date): Promise<RateLimitResult> {
  const limit = LIMITS[name];
  return consume(`${name}:${id}`, limit.max, limit.windowSec, now);
}

/** Delete expired windows. Called by the nightly job; safe to call any time. */
export async function pruneRateLimits(now: Date = new Date()): Promise<number> {
  const rows = await db.execute(sql`delete from rate_limits where reset_at < ${now.toISOString()}::timestamp returning key`);
  return rows.length;
}

/**
 * The client IP: with TRUST_PROXY_HOPS = n, the n-th address from the END of
 * X-Forwarded-For (the last hop before our proxies, never the client-supplied
 * first value); with 0 hops, or no header, the socket address.
 */
export function clientIp(c: Context): string {
  const hops = config.trustProxyHops;
  if (hops > 0) {
    const xff = c.req.header('x-forwarded-for');
    if (xff) {
      const parts = xff.split(',').map((s) => s.trim()).filter(Boolean);
      if (parts.length > 0) {
        const idx = Math.max(0, parts.length - hops);
        return parts[idx];
      }
    }
  }
  try {
    const info = getConnInfo(c);
    if (info.remote.address) return info.remote.address;
  } catch {
    // not running under @hono/node-server (tests use app.request)
  }
  return 'unknown';
}

export function setRateLimitHeaders(c: Context, result: RateLimitResult): void {
  c.header('X-RateLimit-Limit', String(result.limit));
  c.header('X-RateLimit-Remaining', String(Math.max(0, result.limit - result.count)));
  c.header('X-RateLimit-Reset', String(Math.ceil(result.resetAt.getTime() / 1000)));
}

/** The 429 teaching envelope, with retryAfter at the top level and in details. */
export function rateLimited(c: Context, result: RateLimitResult, what: string = 'requests'): Response {
  setRateLimitHeaders(c, result);
  c.header('Retry-After', String(result.retryAfterSec));
  return teach(c, 429, 'rate_limited', `Too many ${what}: limit ${result.limit} per window; retry in ${result.retryAfterSec}s`, {
    details: { retryAfter: result.retryAfterSec, limit: result.limit, resetAt: result.resetAt.toISOString() },
    fix: { docs: ANS_BLOCK.docs },
    extra: { retryAfter: result.retryAfterSec },
  });
}

/**
 * Middleware: keyFn returns the limit key (or null to skip). Fails OPEN on a
 * database error so a Postgres hiccup does not take down public reads.
 */
export function rateLimit(
  keyFn: (c: Context) => string | null | Promise<string | null>,
  max: number,
  windowSec: number,
  what: string = 'requests',
): MiddlewareHandler {
  return async (c, next) => {
    const key = await keyFn(c);
    if (!key) return next();
    let result: RateLimitResult;
    try {
      result = await consume(key, max, windowSec);
    } catch (err) {
      console.error('[ratelimit] failing open:', err instanceof Error ? err.message : err);
      return next();
    }
    if (!result.allowed) return rateLimited(c, result, what);
    setRateLimitHeaders(c, result);
    return next();
  };
}

/** Global default: 300 requests per minute per client IP. Skips /health. */
export function globalRateLimit(): MiddlewareHandler {
  return rateLimit(
    (c) => (c.req.path === '/health' ? null : `global:${clientIp(c)}`),
    LIMITS.global.max,
    LIMITS.global.windowSec,
  );
}

/** register:ip 5 per hour */
export function registerIpLimit(): MiddlewareHandler {
  return rateLimit((c) => `register:ip:${clientIp(c)}`, LIMITS['register:ip'].max, LIMITS['register:ip'].windowSec, 'registrations from this address');
}
