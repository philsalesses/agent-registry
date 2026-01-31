import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { eq, and, desc } from 'drizzle-orm';
import { db } from '../db';
import { notifications, agents } from '../db/schema';
import { generateId } from 'ans-core';
import { verifySessionToken } from './auth';

const notificationsRouter = new Hono();

/**
 * Verify agent authentication
 * Returns the agent ID if authenticated, null otherwise
 * Supports: Bearer token (preferred), private key + agent ID
 */
async function verifyAgentAuth(c: any): Promise<string | null> {
  // Method 1: Bearer token (session)
  const authHeader = c.req.header('Authorization');
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice(7);
    const result = await verifySessionToken(token);
    if (result.valid && result.agentId) {
      return result.agentId;
    }
  }

  // Method 2: Private key + Agent ID (legacy)
  const privateKeyHeader = c.req.header('X-Agent-Private-Key');
  const agentId = c.req.header('X-Agent-Id');
  
  if (!privateKeyHeader || !agentId) {
    return null;
  }

  const agent = await db.query.agents.findFirst({
    where: eq(agents.id, agentId),
  });
  
  if (!agent) return null;

  try {
    const { sign, fromBase64, verify } = await import('ans-core');
    const testMessage = new TextEncoder().encode('verify');
    const privateKey = fromBase64(privateKeyHeader);
    const sig = await sign(testMessage, privateKey);
    const publicKey = fromBase64(agent.publicKey);
    const isValid = await verify(sig, testMessage, publicKey);
    return isValid ? agentId : null;
  } catch {
    return null;
  }
}

// Create a notification (internal use)
export async function createNotification(
  agentId: string,
  type: 'attestation_received' | 'message_received' | 'mention' | 'system',
  payload: Record<string, any>
): Promise<void> {
  const id = generateId('notif_', 16);
  await db.insert(notifications).values({
    id,
    agentId,
    type,
    payload,
    read: false,
  });
}

// GET /v1/notifications - Get notifications for authenticated agent
notificationsRouter.get('/', async (c) => {
  const agentId = await verifyAgentAuth(c);
  
  if (!agentId) {
    return c.json({ error: 'Authentication required' }, 401);
  }

  const limit = parseInt(c.req.query('limit') || '50', 10);
  const offset = parseInt(c.req.query('offset') || '0', 10);
  const unreadOnly = c.req.query('unread') === 'true';

  const whereClause = unreadOnly
    ? and(eq(notifications.agentId, agentId), eq(notifications.read, false))
    : eq(notifications.agentId, agentId);

  const results = await db.query.notifications.findMany({
    where: whereClause,
    orderBy: [desc(notifications.createdAt)],
    limit: Math.min(limit, 100),
    offset,
  });

  // Count unread
  const unreadNotifications = await db.query.notifications.findMany({
    where: and(eq(notifications.agentId, agentId), eq(notifications.read, false)),
  });

  return c.json({
    notifications: results,
    unreadCount: unreadNotifications.length,
    limit,
    offset,
  });
});

// GET /v1/notifications/count - Get unread count for authenticated agent
notificationsRouter.get('/count', async (c) => {
  const agentId = await verifyAgentAuth(c);
  
  if (!agentId) {
    return c.json({ error: 'Authentication required' }, 401);
  }

  const unreadNotifications = await db.query.notifications.findMany({
    where: and(eq(notifications.agentId, agentId), eq(notifications.read, false)),
  });

  return c.json({ unreadCount: unreadNotifications.length });
});

// PATCH /v1/notifications/:id/read - Mark a notification as read
notificationsRouter.patch('/:id/read', async (c) => {
  const agentId = await verifyAgentAuth(c);
  
  if (!agentId) {
    return c.json({ error: 'Authentication required' }, 401);
  }

  const notificationId = c.req.param('id');

  // Verify notification belongs to agent
  const notification = await db.query.notifications.findFirst({
    where: eq(notifications.id, notificationId),
  });

  if (!notification) {
    return c.json({ error: 'Notification not found' }, 404);
  }

  if (notification.agentId !== agentId) {
    return c.json({ error: 'Unauthorized' }, 403);
  }

  const [updated] = await db.update(notifications)
    .set({ read: true })
    .where(eq(notifications.id, notificationId))
    .returning();

  return c.json(updated);
});

// PATCH /v1/notifications/read-all - Mark all notifications as read
notificationsRouter.patch('/read-all', async (c) => {
  const agentId = await verifyAgentAuth(c);
  
  if (!agentId) {
    return c.json({ error: 'Authentication required' }, 401);
  }

  await db.update(notifications)
    .set({ read: true })
    .where(and(eq(notifications.agentId, agentId), eq(notifications.read, false)));

  return c.json({ success: true });
});

// DELETE /v1/notifications/:id - Delete a notification
notificationsRouter.delete('/:id', async (c) => {
  const agentId = await verifyAgentAuth(c);
  
  if (!agentId) {
    return c.json({ error: 'Authentication required' }, 401);
  }

  const notificationId = c.req.param('id');

  // Verify notification belongs to agent
  const notification = await db.query.notifications.findFirst({
    where: eq(notifications.id, notificationId),
  });

  if (!notification) {
    return c.json({ error: 'Notification not found' }, 404);
  }

  if (notification.agentId !== agentId) {
    return c.json({ error: 'Unauthorized' }, 403);
  }

  await db.delete(notifications).where(eq(notifications.id, notificationId));

  return c.json({ success: true });
});

export { notificationsRouter };
