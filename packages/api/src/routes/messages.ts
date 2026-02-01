import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { eq, and, or, desc } from 'drizzle-orm';
import { db } from '../db';
import { messages, agents } from '../db/schema';
import { generateId } from 'ans-core';
import { createNotification } from './notifications';
import { verifySessionToken } from './auth';
import { fireWebhooksForAgent } from './webhooks';

const messagesRouter = new Hono();

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

// POST /v1/messages - Send a message
const sendMessageSchema = z.object({
  toAgentId: z.string(),
  content: z.string().min(1).max(5000),
});

messagesRouter.post('/', zValidator('json', sendMessageSchema), async (c) => {
  const fromAgentId = await verifyAgentAuth(c);
  
  if (!fromAgentId) {
    return c.json({ error: 'Authentication required' }, 401);
  }

  const body = c.req.valid('json');

  // Verify recipient exists
  const toAgent = await db.query.agents.findFirst({
    where: eq(agents.id, body.toAgentId),
  });

  if (!toAgent) {
    return c.json({ error: 'Recipient agent not found' }, 404);
  }

  // Get sender info for notification
  const fromAgent = await db.query.agents.findFirst({
    where: eq(agents.id, fromAgentId),
  });

  // Can't message yourself
  if (fromAgentId === body.toAgentId) {
    return c.json({ error: 'Cannot send message to yourself' }, 400);
  }

  const id = generateId('msg_', 16);
  const [message] = await db.insert(messages).values({
    id,
    fromAgentId,
    toAgentId: body.toAgentId,
    content: body.content,
  }).returning();

  // Create notification for recipient
  await createNotification(body.toAgentId, 'message_received', {
    messageId: id,
    fromAgentId,
    fromAgentName: fromAgent?.name || fromAgentId,
    content: body.content.substring(0, 100) + (body.content.length > 100 ? '...' : ''),
  });

  // Fire webhooks for recipient (async, don't wait)
  fireWebhooksForAgent(body.toAgentId, 'message.received', {
    messageId: id,
    fromAgent: {
      id: fromAgentId,
      name: fromAgent?.name || fromAgentId,
    },
    content: body.content,
    createdAt: message.createdAt,
  }, toAgent.name).catch(console.error);

  return c.json(message, 201);
});

// GET /v1/messages - Get inbox (messages received) for authenticated agent
messagesRouter.get('/', async (c) => {
  const agentId = await verifyAgentAuth(c);
  
  if (!agentId) {
    return c.json({ error: 'Authentication required' }, 401);
  }

  const limit = parseInt(c.req.query('limit') || '50', 10);
  const offset = parseInt(c.req.query('offset') || '0', 10);
  const view = c.req.query('view') || 'inbox'; // inbox, sent, all

  let whereClause;
  if (view === 'sent') {
    whereClause = eq(messages.fromAgentId, agentId);
  } else if (view === 'all') {
    whereClause = or(eq(messages.toAgentId, agentId), eq(messages.fromAgentId, agentId));
  } else {
    // inbox (default)
    whereClause = eq(messages.toAgentId, agentId);
  }

  const results = await db.query.messages.findMany({
    where: whereClause,
    orderBy: [desc(messages.createdAt)],
    limit: Math.min(limit, 100),
    offset,
  });

  // Enrich with agent names
  const agentIds = [...new Set([
    ...results.map(m => m.fromAgentId),
    ...results.map(m => m.toAgentId),
  ])];
  
  const agentList = await Promise.all(
    agentIds.map(id => db.query.agents.findFirst({ where: eq(agents.id, id) }))
  );
  
  const agentMap: Record<string, string> = {};
  agentList.forEach(a => {
    if (a) agentMap[a.id] = a.name;
  });

  const enrichedMessages = results.map(m => ({
    ...m,
    fromAgentName: agentMap[m.fromAgentId] || m.fromAgentId,
    toAgentName: agentMap[m.toAgentId] || m.toAgentId,
  }));

  return c.json({
    messages: enrichedMessages,
    limit,
    offset,
  });
});

// GET /v1/messages/:id - Get a specific message
messagesRouter.get('/:id', async (c) => {
  const agentId = await verifyAgentAuth(c);
  
  if (!agentId) {
    return c.json({ error: 'Authentication required' }, 401);
  }

  const messageId = c.req.param('id');

  const message = await db.query.messages.findFirst({
    where: eq(messages.id, messageId),
  });

  if (!message) {
    return c.json({ error: 'Message not found' }, 404);
  }

  // Only sender or recipient can view
  if (message.fromAgentId !== agentId && message.toAgentId !== agentId) {
    return c.json({ error: 'Unauthorized' }, 403);
  }

  // Mark as read if recipient is viewing
  if (message.toAgentId === agentId && !message.readAt) {
    await db.update(messages)
      .set({ readAt: new Date() })
      .where(eq(messages.id, messageId));
  }

  // Get agent names
  const [fromAgent, toAgent] = await Promise.all([
    db.query.agents.findFirst({ where: eq(agents.id, message.fromAgentId) }),
    db.query.agents.findFirst({ where: eq(agents.id, message.toAgentId) }),
  ]);

  return c.json({
    ...message,
    fromAgentName: fromAgent?.name || message.fromAgentId,
    toAgentName: toAgent?.name || message.toAgentId,
  });
});

// GET /v1/messages/conversation/:agentId - Get conversation with a specific agent
messagesRouter.get('/conversation/:otherAgentId', async (c) => {
  const agentId = await verifyAgentAuth(c);
  
  if (!agentId) {
    return c.json({ error: 'Authentication required' }, 401);
  }

  const otherAgentId = c.req.param('otherAgentId');
  const limit = parseInt(c.req.query('limit') || '50', 10);
  const offset = parseInt(c.req.query('offset') || '0', 10);

  const results = await db.query.messages.findMany({
    where: or(
      and(eq(messages.fromAgentId, agentId), eq(messages.toAgentId, otherAgentId)),
      and(eq(messages.fromAgentId, otherAgentId), eq(messages.toAgentId, agentId))
    ),
    orderBy: [desc(messages.createdAt)],
    limit: Math.min(limit, 100),
    offset,
  });

  // Get agent names
  const [currentAgent, otherAgent] = await Promise.all([
    db.query.agents.findFirst({ where: eq(agents.id, agentId) }),
    db.query.agents.findFirst({ where: eq(agents.id, otherAgentId) }),
  ]);

  const enrichedMessages = results.map(m => ({
    ...m,
    fromAgentName: m.fromAgentId === agentId 
      ? (currentAgent?.name || agentId) 
      : (otherAgent?.name || otherAgentId),
    toAgentName: m.toAgentId === agentId 
      ? (currentAgent?.name || agentId) 
      : (otherAgent?.name || otherAgentId),
  }));

  return c.json({
    messages: enrichedMessages,
    limit,
    offset,
  });
});

// PATCH /v1/messages/:id/read - Mark message as read
messagesRouter.patch('/:id/read', async (c) => {
  const agentId = await verifyAgentAuth(c);
  
  if (!agentId) {
    return c.json({ error: 'Authentication required' }, 401);
  }

  const messageId = c.req.param('id');

  const message = await db.query.messages.findFirst({
    where: eq(messages.id, messageId),
  });

  if (!message) {
    return c.json({ error: 'Message not found' }, 404);
  }

  // Only recipient can mark as read
  if (message.toAgentId !== agentId) {
    return c.json({ error: 'Unauthorized' }, 403);
  }

  const [updated] = await db.update(messages)
    .set({ readAt: new Date() })
    .where(eq(messages.id, messageId))
    .returning();

  return c.json(updated);
});

export { messagesRouter };
