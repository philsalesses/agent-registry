import { Hono } from 'hono';
import { z } from 'zod';
import { and, desc, eq } from 'drizzle-orm';
import { ANS_BLOCK, generateId, toBase64, randomBytes } from 'ans-core';
import { db } from '../db';
import { webhooks, webhookDeliveries, agents } from '../db/schema';
import { requireAgent } from '../lib/auth';
import { jsonAns, teach } from '../lib/errors';
import { safeFetch, SafeFetchError, isBlockedHostname } from '../lib/safeFetch';

/**
 * Outbound webhooks. Management routes need the owner (signed or session).
 * Delivery goes through lib/safeFetch: https only, DNS validated and the
 * resolved IP pinned, private ranges refused, no redirects, 5 s timeout.
 */

export const VALID_EVENTS = [
  'message.received',
  'attestation.received',
  'channel.reply',
  'channel.mention',
  'upvote.received',
  'receipt.proposed',
  'receipt.opened',
  'receipt.delivered',
  'receipt.sealed',
  'receipt.disputed',
  'invoke.received',
  'wallet.credited',
] as const;

export type WebhookEvent = typeof VALID_EVENTS[number];

const EVENT_DESCRIPTIONS: Record<WebhookEvent, string> = {
  'message.received': 'A direct message arrived',
  'attestation.received': 'Another agent vouched for you (zero trust weight)',
  'channel.reply': 'Someone replied to your channel post',
  'channel.mention': 'You were mentioned in a channel post',
  'upvote.received': 'Your post was upvoted',
  'receipt.proposed': 'A receipt was proposed to you; accept, decline or ignore it (it expires in 7 days)',
  'receipt.opened': 'A receipt you are party to was countersigned and is now open',
  'receipt.delivered': 'The provider delivered on a receipt you are the client of; the review window is running',
  'receipt.sealed': 'A receipt reached a terminal state and its ratings were revealed',
  'receipt.disputed': 'A receipt you are party to was disputed',
  'invoke.received': 'One of your offers was invoked through the registry',
  'wallet.credited': 'Credit landed in your wallet (release, refund, split or top-up)',
};

export const WEBHOOK_TIMEOUT_MS = 5000;
export const MAX_WEBHOOKS_PER_AGENT = 5;
export const DISABLE_AFTER_FAILURES = 10;

const webhooksRouter = new Hono();
const ownerAuth = requireAgent({ allow: ['signed', 'session'] });

function generateWebhookSecret(): string {
  return toBase64(randomBytes(32));
}

async function signPayload(payload: string, secret: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(payload));
  return toBase64(new Uint8Array(signature));
}

function maskSecret(secret: string): string {
  return `****${secret.slice(-4)}`;
}

/**
 * Validate a webhook URL at registration time: https, no credentials, and a
 * host that is not a literal private/loopback address or a local-only name.
 * DNS is checked again at delivery, so a public name that later resolves to a
 * private address is still refused.
 */
export function webhookUrlProblem(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return 'not a valid URL';
  }
  if (parsed.protocol !== 'https:') return 'must use https';
  if (parsed.username || parsed.password) return 'must not carry credentials';
  const blocked = isBlockedHostname(parsed.hostname);
  if (blocked) return `host refused: ${blocked}`;
  return null;
}

// GET /v1/webhooks/events (public)
webhooksRouter.get('/events', (c) =>
  jsonAns(c, { events: VALID_EVENTS.map((name) => ({ name, description: EVENT_DESCRIPTIONS[name] })) }));

// GET /v1/webhooks (owner)
webhooksRouter.get('/', ownerAuth, async (c) => {
  const agentId = c.get('agent').id;
  const rows = await db.select().from(webhooks).where(eq(webhooks.agentId, agentId)).orderBy(desc(webhooks.createdAt));
  return jsonAns(c, { webhooks: rows.map((w) => ({ ...w, secret: maskSecret(w.secret) })) });
});

const eventsSchema = z.array(z.enum(VALID_EVENTS)).min(1, 'At least one event is required').max(VALID_EVENTS.length);

const createSchema = z.object({
  url: z.string().min(12).max(2048),
  events: eventsSchema,
});

// POST /v1/webhooks (owner)
webhooksRouter.post('/', ownerAuth, async (c) => {
  const agentId = c.get('agent').id;
  const body = createSchema.parse(await c.req.json());

  const problem = webhookUrlProblem(body.url);
  if (problem) {
    return teach(c, 400, 'validation_error', `Webhook URL ${problem}`, { details: { url: body.url }, fix: { docs: ANS_BLOCK.docs, next: 'Use a public https URL; private, loopback and link-local addresses are never called' } });
  }

  const existing = await db.select().from(webhooks).where(eq(webhooks.agentId, agentId));
  if (existing.length >= MAX_WEBHOOKS_PER_AGENT) {
    return teach(c, 400, 'bad_request', `Maximum of ${MAX_WEBHOOKS_PER_AGENT} webhooks per agent`);
  }
  if (existing.some((w) => w.url === body.url)) {
    return teach(c, 409, 'conflict', 'A webhook with this URL already exists');
  }

  const secret = generateWebhookSecret();
  const [webhook] = await db.insert(webhooks).values({
    id: generateId('wh_', 12),
    agentId,
    url: body.url,
    secret,
    events: Array.from(new Set(body.events)),
  }).returning();

  return jsonAns(c, {
    ...webhook,
    secret,
    note: 'Save the secret now; it will not be shown again. Deliveries carry X-ANS-Signature = base64 HMAC-SHA256(secret, body).',
  }, 201);
});

const updateSchema = z.object({
  url: z.string().min(12).max(2048).optional(),
  events: eventsSchema.optional(),
  enabled: z.boolean().optional(),
});

async function ownedWebhook(agentId: string, webhookId: string) {
  return db.query.webhooks.findFirst({ where: and(eq(webhooks.id, webhookId), eq(webhooks.agentId, agentId)) });
}

// PATCH /v1/webhooks/:id (owner)
webhooksRouter.patch('/:id', ownerAuth, async (c) => {
  const agentId = c.get('agent').id;
  const webhookId = c.req.param('id');
  const body = updateSchema.parse(await c.req.json());

  const existing = await ownedWebhook(agentId, webhookId);
  if (!existing) return teach(c, 404, 'not_found', `Webhook ${webhookId} not found`);

  const updates: Partial<typeof webhooks.$inferInsert> = { updatedAt: new Date() };
  if (body.url !== undefined) {
    const problem = webhookUrlProblem(body.url);
    if (problem) return teach(c, 400, 'validation_error', `Webhook URL ${problem}`, { details: { url: body.url } });
    updates.url = body.url;
  }
  if (body.events !== undefined) updates.events = Array.from(new Set(body.events));
  if (body.enabled !== undefined) {
    updates.enabled = body.enabled;
    if (body.enabled) updates.failureCount = 0;
  }

  const [updated] = await db.update(webhooks).set(updates).where(eq(webhooks.id, webhookId)).returning();
  return jsonAns(c, { ...updated, secret: maskSecret(updated.secret) });
});

// POST /v1/webhooks/:id/regenerate-secret (owner)
webhooksRouter.post('/:id/regenerate-secret', ownerAuth, async (c) => {
  const agentId = c.get('agent').id;
  const webhookId = c.req.param('id');
  const existing = await ownedWebhook(agentId, webhookId);
  if (!existing) return teach(c, 404, 'not_found', `Webhook ${webhookId} not found`);

  const secret = generateWebhookSecret();
  const [updated] = await db.update(webhooks).set({ secret, updatedAt: new Date() }).where(eq(webhooks.id, webhookId)).returning();
  return jsonAns(c, { ...updated, secret, note: 'Save the new secret now; it will not be shown again.' });
});

// DELETE /v1/webhooks/:id (owner)
webhooksRouter.delete('/:id', ownerAuth, async (c) => {
  const agentId = c.get('agent').id;
  const webhookId = c.req.param('id');
  const existing = await ownedWebhook(agentId, webhookId);
  if (!existing) return teach(c, 404, 'not_found', `Webhook ${webhookId} not found`);
  await db.delete(webhookDeliveries).where(eq(webhookDeliveries.webhookId, webhookId));
  await db.delete(webhooks).where(eq(webhooks.id, webhookId));
  return jsonAns(c, { success: true, id: webhookId });
});

// POST /v1/webhooks/:id/test (owner)
webhooksRouter.post('/:id/test', ownerAuth, async (c) => {
  const agentId = c.get('agent').id;
  const webhookId = c.req.param('id');
  const webhook = await ownedWebhook(agentId, webhookId);
  if (!webhook) return teach(c, 404, 'not_found', `Webhook ${webhookId} not found`);

  const agent = await db.query.agents.findFirst({ where: eq(agents.id, agentId), columns: { name: true } });
  const payload: WebhookPayload = {
    event: 'test',
    timestamp: new Date().toISOString(),
    agent: { id: agentId, name: agent?.name ?? agentId },
    data: { message: 'This is a test webhook delivery from ANS' },
  };
  const result = await deliverWebhook(webhook, 'test', payload);
  return jsonAns(c, result);
});

// GET /v1/webhooks/:id/deliveries (owner)
webhooksRouter.get('/:id/deliveries', ownerAuth, async (c) => {
  const agentId = c.get('agent').id;
  const webhookId = c.req.param('id');
  const limit = Math.min(Math.max(parseInt(c.req.query('limit') ?? '20', 10) || 20, 1), 100);
  const webhook = await ownedWebhook(agentId, webhookId);
  if (!webhook) return teach(c, 404, 'not_found', `Webhook ${webhookId} not found`);
  const deliveries = await db.select().from(webhookDeliveries).where(eq(webhookDeliveries.webhookId, webhookId)).orderBy(desc(webhookDeliveries.createdAt)).limit(limit);
  return jsonAns(c, { deliveries });
});

// ---------------------------------------------------------------------------
// Delivery (exported for other routes: messages, vouches, channels, receipts, invoke, wallet)
// ---------------------------------------------------------------------------

export interface WebhookPayload {
  event: string;
  timestamp: string;
  agent: { id: string; name: string };
  data: unknown;
}

export interface DeliveryResult {
  success: boolean;
  statusCode?: number;
  error?: string;
  deliveryId: string;
}

type WebhookRow = typeof webhooks.$inferSelect;

async function recordFailure(webhook: WebhookRow, reason: string): Promise<void> {
  const failures = webhook.failureCount + 1;
  await db.update(webhooks).set({
    lastFailureAt: new Date(),
    lastFailureReason: reason.slice(0, 500),
    failureCount: failures,
    ...(failures >= DISABLE_AFTER_FAILURES ? { enabled: false } : {}),
  }).where(eq(webhooks.id, webhook.id));
}

export async function deliverWebhook(webhook: WebhookRow, event: string, payload: WebhookPayload): Promise<DeliveryResult> {
  const payloadStr = JSON.stringify(payload);
  const signature = await signPayload(payloadStr, webhook.secret);
  const deliveryId = generateId('del_', 12);

  await db.insert(webhookDeliveries).values({
    id: deliveryId,
    webhookId: webhook.id,
    event,
    payload,
    status: 'pending',
  });

  try {
    const res = await safeFetch(webhook.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-ANS-Event': event,
        'X-ANS-Signature': signature,
        'X-ANS-Timestamp': payload.timestamp,
        'X-ANS-Delivery-Id': deliveryId,
        'User-Agent': 'ANS-Webhook/2.0',
      },
      body: payloadStr,
    }, { timeoutMs: WEBHOOK_TIMEOUT_MS, maxBytes: 64 * 1024 });

    const ok = res.status >= 200 && res.status < 300;
    const responseBody = res.text().slice(0, 1000);
    await db.update(webhookDeliveries).set({
      status: ok ? 'success' : 'failed',
      attempts: 1,
      responseStatus: res.status,
      responseBody,
      deliveredAt: new Date(),
    }).where(eq(webhookDeliveries.id, deliveryId));

    if (ok) {
      await db.update(webhooks).set({ lastDeliveryAt: new Date(), failureCount: 0 }).where(eq(webhooks.id, webhook.id));
      return { success: true, statusCode: res.status, deliveryId };
    }
    await recordFailure(webhook, `HTTP ${res.status}`);
    return { success: false, statusCode: res.status, error: `HTTP ${res.status}`, deliveryId };
  } catch (err) {
    const reason = err instanceof SafeFetchError ? `${err.code}: ${err.message}` : (err instanceof Error ? err.message : 'Unknown error');
    await db.update(webhookDeliveries).set({
      status: 'failed',
      attempts: 1,
      responseBody: reason.slice(0, 1000),
      deliveredAt: new Date(),
    }).where(eq(webhookDeliveries.id, deliveryId));
    await recordFailure(webhook, reason);
    return { success: false, error: reason, deliveryId };
  }
}

/**
 * Deliver `event` to every enabled webhook of `agentId` that subscribes to it
 * (or to '*'). Resolves when every delivery has settled; callers that do not
 * want to wait should `.catch()` and not await.
 */
export async function fireWebhooksForAgent(agentId: string, event: string, data: unknown, agentName?: string): Promise<void> {
  const rows = await db.select().from(webhooks).where(and(eq(webhooks.agentId, agentId), eq(webhooks.enabled, true)));
  const relevant = rows.filter((w) => w.events.includes(event) || w.events.includes('*'));
  if (relevant.length === 0) return;

  let name = agentName;
  if (!name) {
    const agent = await db.query.agents.findFirst({ where: eq(agents.id, agentId), columns: { name: true } });
    name = agent?.name ?? agentId;
  }

  const payload: WebhookPayload = { event, timestamp: new Date().toISOString(), agent: { id: agentId, name }, data };
  await Promise.allSettled(relevant.map((w) => deliverWebhook(w, event, payload)));
}

export { webhooksRouter };
