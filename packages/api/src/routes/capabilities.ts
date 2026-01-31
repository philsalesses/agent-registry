import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { db } from '../db';
import { capabilities, agentCapabilities } from '../db/schema';
import { generateId } from 'ans-core';

const capabilitiesRouter = new Hono();

// Create a new capability definition
const createCapabilitySchema = z.object({
  id: z.string().min(1).max(64),
  description: z.string(),
  version: z.string().default('1.0.0'),
  inputSchema: z.record(z.unknown()).optional(),
  outputSchema: z.record(z.unknown()).optional(),
});

capabilitiesRouter.post('/', zValidator('json', createCapabilitySchema), async (c) => {
  const body = c.req.valid('json');

  const [capability] = await db.insert(capabilities).values(body).returning();
  return c.json(capability, 201);
});

// Get capability by ID
capabilitiesRouter.get('/:id', async (c) => {
  const id = c.req.param('id');
  
  const capability = await db.query.capabilities.findFirst({
    where: eq(capabilities.id, id),
  });

  if (!capability) {
    return c.json({ error: 'Capability not found' }, 404);
  }

  return c.json(capability);
});

// List all capabilities
capabilitiesRouter.get('/', async (c) => {
  const results = await db.query.capabilities.findMany({
    orderBy: (capabilities, { asc }) => [asc(capabilities.id)],
  });

  return c.json({ capabilities: results });
});

// Register an agent's capability
const registerAgentCapabilitySchema = z.object({
  agentId: z.string(),
  capabilityId: z.string(),
  endpoint: z.string().url().optional(),
});

capabilitiesRouter.post('/agent', zValidator('json', registerAgentCapabilitySchema), async (c) => {
  const body = c.req.valid('json');
  const id = generateId('ac_', 16);

  const [agentCapability] = await db.insert(agentCapabilities).values({
    id,
    ...body,
  }).returning();

  return c.json(agentCapability, 201);
});

// Get agents with a specific capability
capabilitiesRouter.get('/:id/agents', async (c) => {
  const capabilityId = c.req.param('id');
  const minScore = parseInt(c.req.query('minScore') || '0', 10);

  const results = await db.query.agentCapabilities.findMany({
    where: eq(agentCapabilities.capabilityId, capabilityId),
    with: {
      // Would need to set up relations in schema
    },
  });

  return c.json({ agents: results });
});

export { capabilitiesRouter };
