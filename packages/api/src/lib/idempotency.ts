import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { and, eq, lt } from 'drizzle-orm';
import { sha256hex } from 'ans-core';
import { db } from '../db';
import { idempotencyKeys } from '../db/schema';
import { getRawBody } from './auth';
import { teach } from './errors';

/**
 * Idempotency-Key support (docs/DESIGN.md section 3 IdempotencyKey).
 * Keyed (agent_id, key) with the request hash; a replay with the same hash
 * returns the stored status and body, a different hash is 409
 * idempotency_mismatch. Entries live 24 hours.
 */

export const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;
export const IDEMPOTENCY_HEADER = 'Idempotency-Key';

export function idempotencyKeyFrom(c: Context): string | undefined {
  const v = c.req.header(IDEMPOTENCY_HEADER);
  if (!v) return undefined;
  const key = v.trim();
  return key.length > 0 && key.length <= 200 ? key : undefined;
}

export async function requestHashFor(c: Context): Promise<string> {
  const body = await getRawBody(c);
  return sha256hex(`${c.req.method}:${c.req.path}:${body}`);
}

let lastPrune = 0;

export async function pruneIdempotencyKeys(now: Date = new Date()): Promise<void> {
  await db.delete(idempotencyKeys).where(lt(idempotencyKeys.createdAt, new Date(now.getTime() - IDEMPOTENCY_TTL_MS)));
}

/**
 * Run `handler` once per (agentId, key). When key is empty the handler simply runs.
 * Only JSON responses with status < 500 are stored.
 */
export async function withIdempotency(
  c: Context,
  agentId: string,
  key: string | null | undefined,
  handler: () => Promise<Response>,
): Promise<Response> {
  if (!key) return handler();
  const now = new Date();
  const requestHash = await requestHashFor(c);

  const existing = await db.query.idempotencyKeys.findFirst({
    where: and(eq(idempotencyKeys.agentId, agentId), eq(idempotencyKeys.key, key)),
  });
  if (existing) {
    const expired = now.getTime() - existing.createdAt.getTime() > IDEMPOTENCY_TTL_MS;
    if (!expired) {
      if (existing.requestHash !== requestHash) {
        return teach(c, 409, 'idempotency_mismatch', 'Idempotency-Key was already used with a different request', {
          details: { key },
          fix: { docs: 'https://ans-registry.org/skill.md', next: 'Use a new Idempotency-Key for a different request, or resend the original request unchanged' },
        });
      }
      c.header('Idempotent-Replayed', 'true');
      return c.json(existing.response as object, existing.status as ContentfulStatusCode);
    }
    await db.delete(idempotencyKeys).where(and(eq(idempotencyKeys.agentId, agentId), eq(idempotencyKeys.key, key)));
  }

  const res = await handler();
  const contentType = res.headers.get('content-type') ?? '';
  if (res.status < 500 && contentType.includes('application/json')) {
    try {
      const body = await res.clone().json();
      await db
        .insert(idempotencyKeys)
        .values({ agentId, key, requestHash, status: res.status, response: body, createdAt: now })
        .onConflictDoNothing();
    } catch {
      // unparseable body: do not store
    }
  }
  if (now.getTime() - lastPrune > 60 * 60 * 1000) {
    lastPrune = now.getTime();
    void pruneIdempotencyKeys(now).catch(() => undefined);
  }
  return res;
}
