import { describe, it, expect, afterAll } from 'vitest';
import { Hono } from 'hono';
import { requestId } from 'hono/request-id';
import { consume, checkNamedLimit, rateLimit, clientIp, pruneRateLimits, LIMITS } from '../lib/ratelimit';
import { deleteRateLimitKeys, rateLimitRow, body as parse } from './helpers';

const run = `t${Date.now().toString(36)}`;

describe('rate limiter', () => {
  afterAll(async () => {
    await deleteRateLimitKeys([`rl:${run}`, `receipt:pair:${run}`, `hint:day:${run}`]);
  });

  it('counts hits in a fixed window and opens a fresh window after reset_at', async () => {
    const key = `rl:${run}:basic`;
    const now = new Date();
    const a = await consume(key, 2, 60, now);
    expect(a).toMatchObject({ allowed: true, count: 1, limit: 2 });
    expect(a.resetAt.getTime()).toBe(Math.floor((now.getTime() + 60_000) / 1000) * 1000 + (now.getMilliseconds()));
    const b = await consume(key, 2, 60, now);
    expect(b.count).toBe(2);
    expect(b.allowed).toBe(true);
    const c = await consume(key, 2, 60, now);
    expect(c.count).toBe(3);
    expect(c.allowed).toBe(false);
    expect(c.retryAfterSec).toBeGreaterThan(0);
    expect(c.retryAfterSec).toBeLessThanOrEqual(60);

    const later = new Date(now.getTime() + 61_000);
    const d = await consume(key, 2, 60, later);
    expect(d.count).toBe(1);
    expect(d.allowed).toBe(true);
    expect(d.resetAt.getTime()).toBeGreaterThan(later.getTime());

    const row = await rateLimitRow(key);
    expect(row?.count).toBe(1);
  });

  it('named limits use their configured windows', async () => {
    const r = await checkNamedLimit('receipt:pair', `${run}:a:b`);
    expect(r.limit).toBe(LIMITS['receipt:pair'].max);
    const h = await checkNamedLimit('hint:day', `${run}:x`);
    expect(h.limit).toBe(20);
    expect(h.resetAt.getTime() - Date.now()).toBeGreaterThan(86_000_000);
  });

  it('middleware answers 429 with the teaching envelope, retryAfter and headers', async () => {
    const app = new Hono();
    app.use('*', requestId());
    app.get('/x', rateLimit(() => `rl:${run}:mw`, 2, 60, 'test hits'), (c) => c.json({ ok: true }));
    expect((await app.request('/x')).status).toBe(200);
    const second = await app.request('/x');
    expect(second.status).toBe(200);
    expect(second.headers.get('X-RateLimit-Remaining')).toBe('0');
    const third = await app.request('/x');
    expect(third.status).toBe(429);
    expect(third.headers.get('Retry-After')).toMatch(/^\d+$/);
    expect(third.headers.get('Link')).toContain('rel="help"');
    const json = await parse(third);
    expect(json.error).toBe('rate_limited');
    expect(json.retryAfter).toBeGreaterThan(0);
    expect(json.details.retryAfter).toBe(json.retryAfter);
    expect(json.requestId).toBeTruthy();
  });

  it('takes the last X-Forwarded-For hop before the trusted proxy, never the first', async () => {
    const app = new Hono();
    app.get('/ip', (c) => c.text(clientIp(c)));
    const res = await app.request('/ip', { headers: { 'x-forwarded-for': '1.1.1.1, 2.2.2.2, 3.3.3.3' } });
    expect(await res.text()).toBe('3.3.3.3'); // TRUST_PROXY_HOPS default 1
    const none = await app.request('/ip');
    expect(await none.text()).toBe('unknown');
  });

  it('prunes expired windows', async () => {
    const key = `rl:${run}:old`;
    await consume(key, 5, 1, new Date(Date.now() - 10_000));
    expect(await rateLimitRow(key)).not.toBeNull();
    await pruneRateLimits();
    expect(await rateLimitRow(key)).toBeNull();
  });
});
