import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { sql, eq, gte, and, or, ilike, inArray } from 'drizzle-orm';
import { db } from '../db';
import { agents, agentCapabilities, attestations } from '../db/schema';

const discoveryRouter = new Hono();

// Discover agents with filters
const discoverSchema = z.object({
  capabilities: z.array(z.string()).optional(),
  minTrustScore: z.number().min(0).max(100).optional(),
  types: z.array(z.enum(['assistant', 'autonomous', 'tool', 'service'])).optional(),
  protocols: z.array(z.enum(['a2a', 'mcp', 'http', 'websocket', 'grpc'])).optional(),
  tags: z.array(z.string()).optional(),
  status: z.array(z.enum(['online', 'offline', 'maintenance', 'unknown'])).optional(),
  query: z.string().optional(),
  limit: z.number().min(1).max(100).default(20),
  offset: z.number().min(0).default(0),
});

discoveryRouter.post('/', zValidator('json', discoverSchema), async (c) => {
  const body = c.req.valid('json');

  // If filtering by capabilities, get matching agent IDs first
  let capabilityAgentIds: string[] | null = null;
  if (body.capabilities && body.capabilities.length > 0) {
    const capResults = await db
      .select({ agentId: agentCapabilities.agentId })
      .from(agentCapabilities)
      .where(inArray(agentCapabilities.capabilityId, body.capabilities));
    capabilityAgentIds = [...new Set(capResults.map(r => r.agentId))];
    
    // If no agents have these capabilities, return empty
    if (capabilityAgentIds.length === 0) {
      return c.json({ agents: [], total: 0, hasMore: false });
    }
  }

  // Build where conditions
  const conditions: any[] = [];
  
  if (capabilityAgentIds) {
    conditions.push(inArray(agents.id, capabilityAgentIds));
  }
  
  if (body.types && body.types.length > 0) {
    conditions.push(inArray(agents.type, body.types));
  }
  
  if (body.status && body.status.length > 0) {
    conditions.push(inArray(agents.status, body.status));
  }
  
  if (body.query) {
    const q = `%${body.query}%`;
    conditions.push(or(
      ilike(agents.name, q),
      ilike(agents.description, q)
    ));
  }

  // Execute query
  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
  
  const results = await db.query.agents.findMany({
    where: whereClause,
    limit: body.limit,
    offset: body.offset,
    orderBy: (agents, { desc }) => [desc(agents.createdAt)],
  });

  // Post-filter for protocols and tags (stored as JSON arrays)
  let filtered = results;
  
  if (body.protocols && body.protocols.length > 0) {
    filtered = filtered.filter(a => {
      const agentProtocols = (a.protocols as string[]) || [];
      return body.protocols!.some(p => agentProtocols.includes(p));
    });
  }

  if (body.tags && body.tags.length > 0) {
    filtered = filtered.filter(a => {
      const agentTags = (a.tags as string[]) || [];
      return body.tags!.some(t => agentTags.includes(t));
    });
  }

  // Get trust scores for results
  const agentIds = filtered.map(a => a.id);
  const trustScores: Record<string, number> = {};
  const verified: Record<string, boolean> = {};
  
  if (agentIds.length > 0) {
    // Get behavior attestations for trust scores
    const behaviorAttestations = await db
      .select({
        subjectId: attestations.subjectId,
        value: attestations.claimValue,
      })
      .from(attestations)
      .where(and(
        inArray(attestations.subjectId, agentIds),
        eq(attestations.claimType, 'behavior')
      ));

    // Calculate average trust score per agent
    const scores: Record<string, number[]> = {};
    for (const att of behaviorAttestations) {
      if (!scores[att.subjectId]) scores[att.subjectId] = [];
      scores[att.subjectId].push(att.value as number);
    }
    for (const [id, vals] of Object.entries(scores)) {
      trustScores[id] = Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
    }
    
    // Check verified status
    for (const agent of filtered) {
      verified[agent.id] = (agent.metadata as any)?.verified === true;
    }
  }

  // Filter by minTrustScore if specified
  if (body.minTrustScore) {
    filtered = filtered.filter(a => (trustScores[a.id] || 0) >= body.minTrustScore!);
  }

  // Count total (for pagination)
  const countResult = await db.select({ count: sql<number>`count(*)` })
    .from(agents)
    .where(whereClause);
  const total = Number(countResult[0]?.count || 0);

  return c.json({
    agents: filtered.map(a => ({
      ...a,
      trustScore: trustScores[a.id] || 0,
      verified: verified[a.id] || false,
    })),
    total,
    hasMore: body.offset + filtered.length < total,
  });
});

// Quick search endpoint - searches name AND description
discoveryRouter.get('/search', async (c) => {
  const query = c.req.query('q') || '';
  const limit = parseInt(c.req.query('limit') || '20', 10);
  const offset = parseInt(c.req.query('offset') || '0', 10);

  if (!query) {
    return c.json({ agents: [], total: 0 });
  }

  const q = `%${query}%`;
  
  const results = await db.query.agents.findMany({
    where: or(
      ilike(agents.name, q),
      ilike(agents.description, q)
    ),
    limit,
    offset,
    orderBy: (agents, { desc }) => [desc(agents.createdAt)],
  });

  // Get trust scores
  const agentIds = results.map(a => a.id);
  const trustScores: Record<string, number> = {};
  
  if (agentIds.length > 0) {
    const behaviorAttestations = await db
      .select({
        subjectId: attestations.subjectId,
        value: attestations.claimValue,
      })
      .from(attestations)
      .where(and(
        inArray(attestations.subjectId, agentIds),
        eq(attestations.claimType, 'behavior')
      ));

    const scores: Record<string, number[]> = {};
    for (const att of behaviorAttestations) {
      if (!scores[att.subjectId]) scores[att.subjectId] = [];
      scores[att.subjectId].push(att.value as number);
    }
    for (const [id, vals] of Object.entries(scores)) {
      trustScores[id] = Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
    }
  }

  return c.json({
    agents: results.map(a => ({
      ...a,
      trustScore: trustScores[a.id] || 0,
      verified: (a.metadata as any)?.verified === true,
    })),
    total: results.length,
  });
});

// Get agents by capability
discoveryRouter.get('/capability/:id', async (c) => {
  const capabilityId = c.req.param('id');
  const minScore = parseInt(c.req.query('minScore') || '0', 10);
  const limit = parseInt(c.req.query('limit') || '20', 10);
  const offset = parseInt(c.req.query('offset') || '0', 10);

  const results = await db
    .select({
      agent: agents,
      capabilityTrustScore: agentCapabilities.trustScore,
      capabilityVerified: agentCapabilities.verified,
    })
    .from(agentCapabilities)
    .innerJoin(agents, eq(agentCapabilities.agentId, agents.id))
    .where(
      and(
        eq(agentCapabilities.capabilityId, capabilityId),
        gte(agentCapabilities.trustScore, minScore)
      )
    )
    .orderBy(sql`${agentCapabilities.trustScore} DESC`)
    .limit(limit)
    .offset(offset);

  return c.json({
    capability: capabilityId,
    agents: results.map(r => ({
      ...r.agent,
      trustScore: r.capabilityTrustScore,
      verified: r.capabilityVerified || (r.agent.metadata as any)?.verified === true,
    })),
    total: results.length,
  });
});

// Natural language capability search
discoveryRouter.get('/find', async (c) => {
  const query = c.req.query('q') || '';
  const limit = parseInt(c.req.query('limit') || '20', 10);

  if (!query) {
    return c.json({ agents: [], capabilities: [], suggestion: null });
  }

  // Common natural language → capability mappings
  const queryMappings: Record<string, string[]> = {
    'book flight': ['travel-booking', 'api-integration', 'payments'],
    'book travel': ['travel-booking', 'api-integration', 'payments'],
    'plane ticket': ['travel-booking', 'api-integration', 'payments'],
    'send email': ['email-management', 'messaging'],
    'write email': ['email-management', 'text-generation'],
    'code': ['code-generation', 'code-execution', 'code-review'],
    'coding': ['code-generation', 'code-execution', 'code-review'],
    'program': ['code-generation', 'code-execution'],
    'image': ['image-generation', 'image-analysis', 'image-editing'],
    'picture': ['image-generation', 'image-analysis'],
    'photo': ['image-generation', 'image-analysis', 'image-editing'],
    'search': ['web-search', 'web-browsing'],
    'browse': ['web-browsing', 'web-search'],
    'research': ['web-search', 'web-browsing', 'text-summarization'],
    'schedule': ['calendar-management', 'meeting-scheduling'],
    'meeting': ['meeting-scheduling', 'calendar-management'],
    'calendar': ['calendar-management', 'meeting-scheduling'],
    'pay': ['payments', 'crypto-operations'],
    'payment': ['payments', 'crypto-operations'],
    'money': ['payments', 'crypto-operations'],
    'translate': ['translation'],
    'speak': ['text-to-speech', 'audio-generation'],
    'voice': ['text-to-speech', 'audio-generation', 'audio-transcription'],
    'transcribe': ['audio-transcription'],
    'summarize': ['text-summarization'],
    'analyze': ['data-analysis', 'sentiment-analysis', 'reasoning'],
    'smart home': ['smart-home', 'iot-sensors'],
    'home': ['smart-home', 'iot-sensors'],
    'weather': ['weather'],
    'news': ['news', 'web-search'],
    'document': ['document-generation', 'pdf-processing'],
    'pdf': ['pdf-processing', 'document-generation'],
    'spreadsheet': ['spreadsheet-operations', 'data-analysis'],
    'excel': ['spreadsheet-operations', 'data-analysis'],
  };

  // Find matching capabilities
  const queryLower = query.toLowerCase();
  let matchedCapabilities: string[] = [];
  
  for (const [keyword, caps] of Object.entries(queryMappings)) {
    if (queryLower.includes(keyword)) {
      matchedCapabilities.push(...caps);
    }
  }
  matchedCapabilities = [...new Set(matchedCapabilities)];

  // If we found capability matches, search by those
  if (matchedCapabilities.length > 0) {
    const capResults = await db
      .select({ agentId: agentCapabilities.agentId })
      .from(agentCapabilities)
      .where(inArray(agentCapabilities.capabilityId, matchedCapabilities));
    
    const agentIds = [...new Set(capResults.map(r => r.agentId))];
    
    if (agentIds.length > 0) {
      const agentResults = await db.query.agents.findMany({
        where: inArray(agents.id, agentIds),
        limit,
      });

      return c.json({
        agents: agentResults.map(a => ({
          ...a,
          verified: (a.metadata as any)?.verified === true,
        })),
        capabilities: matchedCapabilities,
        suggestion: `Found agents with capabilities: ${matchedCapabilities.join(', ')}`,
      });
    }
  }

  // Fallback to text search
  const q = `%${query}%`;
  const textResults = await db.query.agents.findMany({
    where: or(
      ilike(agents.name, q),
      ilike(agents.description, q)
    ),
    limit,
  });

  return c.json({
    agents: textResults.map(a => ({
      ...a,
      verified: (a.metadata as any)?.verified === true,
    })),
    capabilities: [],
    suggestion: matchedCapabilities.length > 0 
      ? `Looking for: ${matchedCapabilities.join(', ')}. No agents found yet.`
      : null,
  });
});

export { discoveryRouter };
