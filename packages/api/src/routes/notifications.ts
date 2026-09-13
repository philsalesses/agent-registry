import { Hono } from 'hono';
import { and, count, desc, eq } from 'drizzle-orm';
import { generateId } from 'ans-core';
import { db } from '../db';
import { notifications } from '../db/schema';
import { requireAgent } from '../lib/auth';
import { jsonAns, teach } from '../lib/errors';

/**
 * Per-agent inbox. Every route needs an authenticated agent: signed, session
 * or an api key with scope `read` (the inbox is read and managed by the
 * agent that owns it; there are no writes on behalf of others here).
 */

export type NotificationType = 'attestation_received' | 'message_received' | 'mention' | 'system';

export type NotificationRow = typeof notifications.$inferSelect;

/**
 * Create a notification for an agent (internal use by other routes: vouches,
 * messages, channels, receipts). Never throws to the caller's request path
 * unless the insert itself fails.
 */
export async function createNotification(
  agentId: string,
  type: NotificationType,
  payload: Record<string, unknown>,
): Promise<NotificationRow> {
  const [row] = await db.insert(notifications).values({
    id: generateId('notif_', 16),
    agentId,
    type,
    payload,
    read: false,
  }).returning();
  return row;
}

const notificationsRouter = new Hono();

const inboxAuth = requireAgent({ allow: ['signed', 'session', 'apikey'], scopes: ['read'] });
notificationsRouter.use('*', inboxAuth);

function intQuery(value: string | undefined, fallback: number, min: number, max: number): number {
  const n = parseInt(value ?? '', 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

async function unreadCount(agentId: string): Promise<number> {
  const [row] = await db.select({ n: count() }).from(notifications).where(and(eq(notifications.agentId, agentId), eq(notifications.read, false)));
  return Number(row?.n ?? 0);
}

// GET /v1/notifications?limit&offset&unread=true
notificationsRouter.get('/', async (c) => {
  const agentId = c.get('agent').id;
  const limit = intQuery(c.req.query('limit'), 50, 1, 100);
  const offset = intQuery(c.req.query('offset'), 0, 0, 100_000);
  const unreadOnly = c.req.query('unread') === 'true';

  const where = unreadOnly
    ? and(eq(notifications.agentId, agentId), eq(notifications.read, false))
    : eq(notifications.agentId, agentId);

  const [rows, unread] = await Promise.all([
    db.select().from(notifications).where(where).orderBy(desc(notifications.createdAt)).limit(limit).offset(offset),
    unreadCount(agentId),
  ]);

  return jsonAns(c, { notifications: rows, unreadCount: unread, limit, offset });
});

// GET /v1/notifications/count
notificationsRouter.get('/count', async (c) => {
  const agentId = c.get('agent').id;
  return jsonAns(c, { unreadCount: await unreadCount(agentId) });
});

// PATCH /v1/notifications/read-all (registered before /:id/read so the literal wins)
notificationsRouter.patch('/read-all', async (c) => {
  const agentId = c.get('agent').id;
  const updated = await db
    .update(notifications)
    .set({ read: true })
    .where(and(eq(notifications.agentId, agentId), eq(notifications.read, false)))
    .returning({ id: notifications.id });
  return jsonAns(c, { success: true, marked: updated.length });
});

// PATCH /v1/notifications/:id/read
notificationsRouter.patch('/:id/read', async (c) => {
  const agentId = c.get('agent').id;
  const id = c.req.param('id');
  const existing = await db.query.notifications.findFirst({ where: eq(notifications.id, id) });
  if (!existing) return teach(c, 404, 'not_found', `Notification ${id} not found`);
  if (existing.agentId !== agentId) return teach(c, 403, 'forbidden', 'This notification belongs to another agent');
  const [updated] = await db.update(notifications).set({ read: true }).where(eq(notifications.id, id)).returning();
  return jsonAns(c, { notification: updated });
});

// DELETE /v1/notifications/:id
notificationsRouter.delete('/:id', async (c) => {
  const agentId = c.get('agent').id;
  const id = c.req.param('id');
  const existing = await db.query.notifications.findFirst({ where: eq(notifications.id, id) });
  if (!existing) return teach(c, 404, 'not_found', `Notification ${id} not found`);
  if (existing.agentId !== agentId) return teach(c, 403, 'forbidden', 'This notification belongs to another agent');
  await db.delete(notifications).where(eq(notifications.id, id));
  return jsonAns(c, { success: true, id });
});

export { notificationsRouter };
