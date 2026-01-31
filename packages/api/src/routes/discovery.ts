import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { sql, eq, gte, and, or, ilike } from 'drizzle-orm';
import { db } from '../db';
import { agents, agentCapabilities } from '../db/schema';

const discoveryRouter = new Hono();

// Discover agents
const discoverSchema = z.object({
  capabilities: z.array(z.string()).optional(),
  minTrustScore: z.number().min(0).max(100).optional(),
  types: z.array(z.enum(['assistant', 'autonomous', 'tool', 'service'])).optional(),
  query: z.string().optional(),
  limit: z.number().min(1).max(100).default(20),
  offset: z.number().min(0).default(0),
});

discoveryRouter.post('/', zValidator('json', discoverSchema), async (c) => {
  const body = c.req.valid('json');

  // Build the query dynamically based on filters
  let results = await db.query.agents.findMany({
    limit: body.limit,
    offset: body.offset,
    orderBy: (agents, { desc }) => [desc(agents.createdAt)],
  });

  // TODO: Implement proper filtering with joins
  // For now, return all agents (will refine when we have more data)

  // Filter by type if specified
  if (body.types && body.types.length > 0) {
    results = results.filter(a => body.types!.includes(a.type as any));
  }

  // Filter by query if specified
  if (body.query) {
    const q = body.query.toLowerCase();
    results = results.filter(a => a.name.toLowerCase().includes(q));
  }

  return c.json({
    agents: results,
    total: results.length,
    hasMore: results.length === body.limit,
  });
});

// Quick search endpoint
discoveryRouter.get('/search', async (c) => {
  const query = c.req.query('q') || '';
  const limit = parseInt(c.req.query('limit') || '10', 10);

  if (!query) {
    return c.json({ agents: [] });
  }

  const results = await db.query.agents.findMany({
    where: ilike(agents.name, `%${query}%`),
    limit,
  });

  return c.json({ agents: results });
});

// Get agents by capability
discoveryRouter.get('/capability/:id', async (c) => {
  const capabilityId = c.req.param('id');
  const minScore = parseInt(c.req.query('minScore') || '0', 10);

  const results = await db
    .select({
      agent: agents,
      trustScore: agentCapabilities.trustScore,
      verified: agentCapabilities.verified,
    })
    .from(agentCapabilities)
    .innerJoin(agents, eq(agentCapabilities.agentId, agents.id))
    .where(
      and(
        eq(agentCapabilities.capabilityId, capabilityId),
        gte(agentCapabilities.trustScore, minScore)
      )
    )
    .orderBy(sql`${agentCapabilities.trustScore} DESC`);

  return c.json({
    agents: results.map(r => ({
      ...r.agent,
      trustScore: r.trustScore,
      verified: r.verified,
    })),
  });
});

export { discoveryRouter };
