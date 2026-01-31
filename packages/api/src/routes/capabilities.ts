import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { eq, and } from 'drizzle-orm';
import { db } from '../db';
import { capabilities, agentCapabilities, agents } from '../db/schema';
import { generateId } from 'ans-core';
import { verifySessionToken } from './auth';

const capabilitiesRouter = new Hono();

// Common capability IDs that agents can use
export const COMMON_CAPABILITIES = [
  { id: 'text-generation', description: 'Generate text content, articles, summaries' },
  { id: 'code-generation', description: 'Write and generate code in various languages' },
  { id: 'code-execution', description: 'Execute code in a sandboxed environment' },
  { id: 'code-review', description: 'Review and analyze code for issues' },
  { id: 'web-search', description: 'Search the web for information' },
  { id: 'web-browsing', description: 'Navigate and interact with websites' },
  { id: 'image-generation', description: 'Generate images from text descriptions' },
  { id: 'image-analysis', description: 'Analyze and describe images' },
  { id: 'data-analysis', description: 'Analyze datasets and extract insights' },
  { id: 'reasoning', description: 'Complex reasoning and problem solving' },
  { id: 'memory', description: 'Persistent memory across conversations' },
  { id: 'file-management', description: 'Read, write, and manage files' },
  { id: 'api-integration', description: 'Integrate with external APIs' },
  { id: 'scheduling', description: 'Schedule tasks and reminders' },
  { id: 'email-management', description: 'Read and send emails' },
  { id: 'calendar-management', description: 'Manage calendar events' },
  { id: 'translation', description: 'Translate between languages' },
  { id: 'audio-transcription', description: 'Transcribe audio to text' },
  { id: 'text-to-speech', description: 'Convert text to spoken audio' },
  { id: 'agent-coordination', description: 'Coordinate with other AI agents' },
];

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

// Get list of common/suggested capabilities
capabilitiesRouter.get('/common', async (c) => {
  return c.json({ capabilities: COMMON_CAPABILITIES });
});

// Get agents with a specific capability
capabilitiesRouter.get('/:id/agents', async (c) => {
  const capabilityId = c.req.param('id');
  const minScore = parseInt(c.req.query('minScore') || '0', 10);

  const results = await db.query.agentCapabilities.findMany({
    where: eq(agentCapabilities.capabilityId, capabilityId),
  });

  // Get agent details
  const agentIds = results.map(r => r.agentId);
  const agentList = await Promise.all(
    agentIds.map(id => db.query.agents.findFirst({ where: eq(agents.id, id) }))
  );

  const enriched = results.map((r, i) => ({
    ...r,
    agent: agentList[i] ? {
      id: agentList[i]!.id,
      name: agentList[i]!.name,
      type: agentList[i]!.type,
      description: agentList[i]!.description,
    } : null,
  })).filter(r => r.agent);

  return c.json({ capability: capabilityId, agents: enriched });
});

export { capabilitiesRouter };
