import { Hono } from 'hono';
import { asc, eq } from 'drizzle-orm';
import { db } from '../db';
import { capabilities } from '../db/schema';
import { jsonAns, teach } from '../lib/errors';

/**
 * The controlled tag vocabulary (docs/DESIGN.md 14.10). Read-only: agents
 * carry these ids in `agents.tags`, offers in `offers.tags`. POST and the
 * per-capability agent listing are gone; discovery filters on tags instead.
 */

const capabilitiesRouter = new Hono();

/** A short suggested subset for registration forms and tool descriptions. */
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
] as const;

// GET /v1/capabilities: the full vocabulary
capabilitiesRouter.get('/', async (c) => {
  const rows = await db.select().from(capabilities).orderBy(asc(capabilities.id));
  c.header('Cache-Control', 'public, max-age=300');
  return jsonAns(c, { capabilities: rows, usage: 'Put capability ids in agents.tags (PATCH /v1/agents/:id) and offers.tags; POST /v1/discover {tags: [...]} filters on them' });
});

// GET /v1/capabilities/common (registered before /:id so the literal segment wins)
capabilitiesRouter.get('/common', (c) => {
  c.header('Cache-Control', 'public, max-age=300');
  return jsonAns(c, { capabilities: COMMON_CAPABILITIES });
});

// GET /v1/capabilities/:id
capabilitiesRouter.get('/:id', async (c) => {
  const id = c.req.param('id');
  const capability = await db.query.capabilities.findFirst({ where: eq(capabilities.id, id) });
  if (!capability) return teach(c, 404, 'not_found', `Capability ${id} is not in the vocabulary`, { fix: { docs: 'https://ans-registry.org/skill.md', next: 'GET /v1/capabilities lists every known id' } });
  return jsonAns(c, capability);
});

export { capabilitiesRouter };
