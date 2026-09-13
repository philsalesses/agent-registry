import { describe, it, expect, afterAll } from 'vitest';
import { Hono } from 'hono';
import { requestId } from 'hono/request-id';
import { eq } from 'drizzle-orm';
import { db } from '../db';
import { body as parse } from './helpers';
import { idempotencyKeys } from '../db/schema';
import { withIdempotency, idempotencyKeyFrom } from '../lib/idempotency';

const agentId = `ag_idem_${Date.now().toString(36)}`;

describe('idempotency', () => {
  afterAll(async () => {
    await db.delete(idempotencyKeys).where(eq(idempotencyKeys.agentId, agentId));
  });

  it('replays the stored response for the same key and body, 409s on a different body', async () => {
    let calls = 0;
    const app = new Hono();
    app.use('*', requestId());
    app.post('/do', (c) =>
      withIdempotency(c, agentId, idempotencyKeyFrom(c), async () => {
        calls += 1;
        const body = await c.req.json();
        return c.json({ calls, echo: body }, 201);
      }),
    );
    const headers = { 'Content-Type': 'application/json', 'Idempotency-Key': 'k-1' };
    const first = await app.request('/do', { method: 'POST', headers, body: '{"a":1}' });
    expect(first.status).toBe(201);
    expect(await parse(first)).toEqual({ calls: 1, echo: { a: 1 } });

    const replay = await app.request('/do', { method: 'POST', headers, body: '{"a":1}' });
    expect(replay.status).toBe(201);
    expect(replay.headers.get('Idempotent-Replayed')).toBe('true');
    expect(await parse(replay)).toEqual({ calls: 1, echo: { a: 1 } });
    expect(calls).toBe(1);

    const mismatch = await app.request('/do', { method: 'POST', headers, body: '{"a":2}' });
    expect(mismatch.status).toBe(409);
    expect((await parse(mismatch)).error).toBe('idempotency_mismatch');

    const noKey = await app.request('/do', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"a":3}' });
    expect(noKey.status).toBe(201);
    expect(calls).toBe(2);
  });
});
