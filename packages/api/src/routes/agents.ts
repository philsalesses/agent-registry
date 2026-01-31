import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { db } from '../db';
import { agents } from '../db/schema';
import { generateId } from '@agent-registry/core';

const agentsRouter = new Hono();

// Register a new agent
const registerSchema = z.object({
  name: z.string().min(1).max(64),
  publicKey: z.string(),
  type: z.enum(['assistant', 'autonomous', 'tool', 'service']),
  // Contact
  endpoint: z.string().url().optional(),
  protocols: z.array(z.enum(['a2a', 'mcp', 'http', 'websocket', 'grpc'])).optional(),
  // Profile
  description: z.string().max(500).optional(),
  avatar: z.string().url().optional(),
  homepage: z.string().url().optional(),
  tags: z.array(z.string()).optional(),
  // Accountability
  operatorId: z.string().optional(),
  operatorName: z.string().optional(),
  // Payment (operator-controlled)
  paymentMethods: z.array(z.object({
    type: z.enum(['bitcoin', 'lightning', 'ethereum', 'usdc', 'other']),
    address: z.string(),
    label: z.string().optional(),
  })).optional(),
  // Meta
  metadata: z.record(z.unknown()).optional(),
});

agentsRouter.post('/', zValidator('json', registerSchema), async (c) => {
  const body = c.req.valid('json');
  const id = generateId('ag_', 16);

  const [agent] = await db.insert(agents).values({
    id,
    name: body.name,
    publicKey: body.publicKey,
    type: body.type,
    metadata: body.metadata,
  }).returning();

  return c.json(agent, 201);
});

// Get agent by ID
agentsRouter.get('/:id', async (c) => {
  const id = c.req.param('id');
  
  const agent = await db.query.agents.findFirst({
    where: eq(agents.id, id),
  });

  if (!agent) {
    return c.json({ error: 'Agent not found' }, 404);
  }

  return c.json(agent);
});

// Update agent
const updateSchema = z.object({
  name: z.string().min(1).max(64).optional(),
  endpoint: z.string().url().optional(),
  protocols: z.array(z.enum(['a2a', 'mcp', 'http', 'websocket', 'grpc'])).optional(),
  description: z.string().max(500).optional(),
  avatar: z.string().url().optional(),
  homepage: z.string().url().optional(),
  tags: z.array(z.string()).optional(),
  operatorName: z.string().optional(),
  paymentMethods: z.array(z.object({
    type: z.enum(['bitcoin', 'lightning', 'ethereum', 'usdc', 'other']),
    address: z.string(),
    label: z.string().optional(),
  })).optional(),
  status: z.enum(['online', 'offline', 'maintenance', 'unknown']).optional(),
  metadata: z.record(z.unknown()).optional(),
});

agentsRouter.patch('/:id', zValidator('json', updateSchema), async (c) => {
  const id = c.req.param('id');
  const body = c.req.valid('json');

  const [updated] = await db.update(agents)
    .set({ ...body, updatedAt: new Date() })
    .where(eq(agents.id, id))
    .returning();

  if (!updated) {
    return c.json({ error: 'Agent not found' }, 404);
  }

  return c.json(updated);
});

// List agents
agentsRouter.get('/', async (c) => {
  const limit = parseInt(c.req.query('limit') || '20', 10);
  const offset = parseInt(c.req.query('offset') || '0', 10);

  const results = await db.query.agents.findMany({
    limit,
    offset,
    orderBy: (agents, { desc }) => [desc(agents.createdAt)],
  });

  return c.json({
    agents: results,
    limit,
    offset,
  });
});

// Heartbeat - agent reports it's alive
agentsRouter.post('/:id/heartbeat', async (c) => {
  const id = c.req.param('id');
  
  const [updated] = await db.update(agents)
    .set({ 
      status: 'online',
      lastSeen: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(agents.id, id))
    .returning();

  if (!updated) {
    return c.json({ error: 'Agent not found' }, 404);
  }

  return c.json({ status: 'ok', lastSeen: updated.lastSeen });
});

// Set status explicitly
agentsRouter.post('/:id/status', async (c) => {
  const id = c.req.param('id');
  const { status } = await c.req.json();
  
  if (!['online', 'offline', 'maintenance', 'unknown'].includes(status)) {
    return c.json({ error: 'Invalid status' }, 400);
  }

  const [updated] = await db.update(agents)
    .set({ 
      status,
      lastSeen: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(agents.id, id))
    .returning();

  if (!updated) {
    return c.json({ error: 'Agent not found' }, 404);
  }

  return c.json({ status: updated.status });
});

export { agentsRouter };
