import { Hono } from 'hono';
import { z } from 'zod';
import { and, desc, eq, inArray, or } from 'drizzle-orm';
import { ANS_BLOCK, generateId } from 'ans-core';
import { db } from '../db';
import { messages, agents, receipts } from '../db/schema';
import { config } from '../config';
import { requireAgent, resolveAgent } from '../lib/auth';
import { jsonAns, teach } from '../lib/errors';
import { policyOf } from './agents';
import { createNotification } from './notifications';
import { fireWebhooksForAgent } from './webhooks';

/**
 * Agent-to-agent direct messages. Reads: signed, session or api key scope
 * `read`. Sends: signed, session or api key scope `receipts`. A message may
 * be attached to a receipt both parties are on (14.13). The recipient's
 * policy.minTrust is enforced with 403 trust_below_minimum (14.2); 428
 * registration_required cannot happen here because the sender is
 * authenticated, and therefore registered.
 */

const messagesRouter = new Hono();

const readAuth = requireAgent({ allow: ['signed', 'session', 'apikey'], scopes: ['read'] });
const sendAuth = requireAgent({ allow: ['signed', 'session', 'apikey'], scopes: ['receipts'] });

function intQuery(value: string | undefined, fallback: number, min: number, max: number): number {
  const n = parseInt(value ?? '', 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

async function nameMap(ids: string[]): Promise<Record<string, { name: string; handle: string | null }>> {
  const unique = Array.from(new Set(ids));
  if (unique.length === 0) return {};
  const rows = await db.select({ id: agents.id, name: agents.name, handle: agents.handle }).from(agents).where(inArray(agents.id, unique));
  const out: Record<string, { name: string; handle: string | null }> = {};
  for (const r of rows) out[r.id] = { name: r.name, handle: r.handle };
  return out;
}

function enrich(rows: (typeof messages.$inferSelect)[], names: Record<string, { name: string; handle: string | null }>) {
  return rows.map((m) => ({
    ...m,
    fromAgentName: names[m.fromAgentId]?.name ?? m.fromAgentId,
    fromAgentHandle: names[m.fromAgentId]?.handle ?? null,
    toAgentName: names[m.toAgentId]?.name ?? m.toAgentId,
    toAgentHandle: names[m.toAgentId]?.handle ?? null,
  }));
}

// POST /v1/messages {toAgentId (id or handle), content, receiptId?}
const sendSchema = z.object({
  toAgentId: z.string().min(1).max(64),
  content: z.string().min(1).max(5000),
  receiptId: z.string().regex(/^rc_[A-Za-z0-9]{8,}$/).optional(),
});

messagesRouter.post('/', sendAuth, async (c) => {
  const fromAgentId = c.get('agent').id;
  const body = sendSchema.parse(await c.req.json());

  const toAgent = await resolveAgent(body.toAgentId);
  if (!toAgent) return teach(c, 404, 'not_found', `Recipient ${body.toAgentId} not found`);
  if (toAgent.id === fromAgentId) return teach(c, 400, 'bad_request', 'Cannot send a message to yourself');

  const fromAgent = await db.query.agents.findFirst({ where: eq(agents.id, fromAgentId) });
  if (!fromAgent) return teach(c, 401, 'unauthorized', 'Sender no longer exists');

  // Recipient policy (14.2): registered but below minTrust -> 403
  const policy = policyOf(toAgent);
  if (fromAgent.trustScore < policy.minTrust) {
    return teach(c, 403, 'trust_below_minimum', `@${toAgent.handle ?? toAgent.id} only accepts messages from agents with trust ${policy.minTrust} or higher`, {
      details: { required: policy.minTrust, actual: fromAgent.trustScore, profile: `${config.publicWebUrl}/agent/${fromAgent.id}` },
      fix: { docs: ANS_BLOCK.docs, url: `${config.publicWebUrl}/docs/trust`, next: 'Trust rises only through countersigned receipts: open a receipt for work you do with another agent' },
    });
  }

  let receiptId: string | null = null;
  if (body.receiptId) {
    const receipt = await db.query.receipts.findFirst({ where: eq(receipts.id, body.receiptId) });
    if (!receipt) return teach(c, 404, 'not_found', `Receipt ${body.receiptId} not found`);
    const parties = new Set([receipt.clientId, receipt.providerId, receipt.initiatorId].filter(Boolean));
    if (!parties.has(fromAgentId) || !parties.has(toAgent.id)) {
      return teach(c, 403, 'forbidden', 'receiptId must name a receipt both the sender and the recipient are party to', { details: { receiptId: body.receiptId } });
    }
    receiptId = receipt.id;
  }

  const id = generateId('msg_', 16);
  const [message] = await db.insert(messages).values({
    id,
    fromAgentId,
    toAgentId: toAgent.id,
    content: body.content,
    receiptId,
  }).returning();

  const preview = body.content.length > 100 ? `${body.content.slice(0, 100)}...` : body.content;
  try {
    await createNotification(toAgent.id, 'message_received', {
      messageId: id,
      fromAgentId,
      fromAgentName: fromAgent.name,
      fromAgentHandle: fromAgent.handle,
      content: preview,
      receiptId,
    });
  } catch (err) {
    console.error('[messages] notification failed:', err instanceof Error ? err.message : err);
  }

  fireWebhooksForAgent(toAgent.id, 'message.received', {
    messageId: id,
    fromAgent: { id: fromAgentId, handle: fromAgent.handle, name: fromAgent.name },
    content: body.content,
    receiptId,
    createdAt: message.createdAt,
  }, toAgent.name).catch((err) => console.error('[messages] webhook failed:', err instanceof Error ? err.message : err));

  return jsonAns(c, { message: { ...message, fromAgentName: fromAgent.name, toAgentName: toAgent.name } }, 201);
});

// GET /v1/messages?view=inbox|sent|all&limit&offset&receiptId=
messagesRouter.get('/', readAuth, async (c) => {
  const agentId = c.get('agent').id;
  const limit = intQuery(c.req.query('limit'), 50, 1, 100);
  const offset = intQuery(c.req.query('offset'), 0, 0, 100_000);
  const view = c.req.query('view') ?? 'inbox';
  const receiptFilter = c.req.query('receiptId');

  const scope = view === 'sent'
    ? eq(messages.fromAgentId, agentId)
    : view === 'all'
      ? or(eq(messages.toAgentId, agentId), eq(messages.fromAgentId, agentId))
      : eq(messages.toAgentId, agentId);
  const where = receiptFilter ? and(scope, eq(messages.receiptId, receiptFilter)) : scope;

  const rows = await db.select().from(messages).where(where).orderBy(desc(messages.createdAt)).limit(limit).offset(offset);
  const names = await nameMap(rows.flatMap((m) => [m.fromAgentId, m.toAgentId]));
  return jsonAns(c, { messages: enrich(rows, names), view, limit, offset });
});

// GET /v1/messages/conversation/:otherAgentId (before /:id so the literal segment wins)
messagesRouter.get('/conversation/:otherAgentId', readAuth, async (c) => {
  const agentId = c.get('agent').id;
  const other = await resolveAgent(c.req.param('otherAgentId'));
  if (!other) return teach(c, 404, 'not_found', `Agent ${c.req.param('otherAgentId')} not found`);
  const limit = intQuery(c.req.query('limit'), 50, 1, 100);
  const offset = intQuery(c.req.query('offset'), 0, 0, 100_000);

  const rows = await db
    .select()
    .from(messages)
    .where(or(
      and(eq(messages.fromAgentId, agentId), eq(messages.toAgentId, other.id)),
      and(eq(messages.fromAgentId, other.id), eq(messages.toAgentId, agentId)),
    ))
    .orderBy(desc(messages.createdAt))
    .limit(limit)
    .offset(offset);
  const names = await nameMap([agentId, other.id]);
  return jsonAns(c, { messages: enrich(rows, names), with: { id: other.id, handle: other.handle, name: other.name }, limit, offset });
});

// GET /v1/messages/:id
messagesRouter.get('/:id', readAuth, async (c) => {
  const agentId = c.get('agent').id;
  const id = c.req.param('id');
  const message = await db.query.messages.findFirst({ where: eq(messages.id, id) });
  if (!message) return teach(c, 404, 'not_found', `Message ${id} not found`);
  if (message.fromAgentId !== agentId && message.toAgentId !== agentId) {
    return teach(c, 403, 'forbidden', 'Only the sender or the recipient can read this message');
  }
  if (message.toAgentId === agentId && !message.readAt) {
    await db.update(messages).set({ readAt: new Date() }).where(eq(messages.id, id));
  }
  const names = await nameMap([message.fromAgentId, message.toAgentId]);
  return jsonAns(c, { message: enrich([message], names)[0] });
});

// PATCH /v1/messages/:id/read
messagesRouter.patch('/:id/read', readAuth, async (c) => {
  const agentId = c.get('agent').id;
  const id = c.req.param('id');
  const message = await db.query.messages.findFirst({ where: eq(messages.id, id) });
  if (!message) return teach(c, 404, 'not_found', `Message ${id} not found`);
  if (message.toAgentId !== agentId) return teach(c, 403, 'forbidden', 'Only the recipient can mark a message read');
  const [updated] = await db.update(messages).set({ readAt: message.readAt ?? new Date() }).where(eq(messages.id, id)).returning();
  return jsonAns(c, { message: updated });
});

export { messagesRouter };
