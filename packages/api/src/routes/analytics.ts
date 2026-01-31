import { Hono } from 'hono';
import { eq, sql, desc, count } from 'drizzle-orm';
import { db } from '../db';
import { agents, attestations, capabilities, agentCapabilities } from '../db/schema';

const analyticsRouter = new Hono();

// Simple in-memory analytics (in production, use Redis or a proper analytics DB)
const stats = {
  apiCalls: new Map<string, number>(),
  agentViews: new Map<string, number>(),
  searches: 0,
  registrations: 0,
  attestationsCreated: 0,
};

/**
 * Track an event (internal use)
 */
export function trackEvent(event: string, agentId?: string): void {
  switch (event) {
    case 'api_call':
      stats.apiCalls.set(agentId || 'global', (stats.apiCalls.get(agentId || 'global') || 0) + 1);
      break;
    case 'agent_view':
      if (agentId) {
        stats.agentViews.set(agentId, (stats.agentViews.get(agentId) || 0) + 1);
      }
      break;
    case 'search':
      stats.searches++;
      break;
    case 'registration':
      stats.registrations++;
      break;
    case 'attestation':
      stats.attestationsCreated++;
      break;
  }
}

/**
 * Get registry-wide statistics
 */
analyticsRouter.get('/stats', async (c) => {
  // Count agents
  const agentCount = await db.select({ count: count() }).from(agents);
  
  // Count by type
  const byType = await db.select({
    type: agents.type,
    count: count(),
  }).from(agents).groupBy(agents.type);
  
  // Count by status
  const byStatus = await db.select({
    status: agents.status,
    count: count(),
  }).from(agents).groupBy(agents.status);
  
  // Count attestations
  const attestationCount = await db.select({ count: count() }).from(attestations);
  
  // Count capabilities
  const capabilityCount = await db.select({ count: count() }).from(capabilities);
  
  // Recent registrations (last 7 days)
  const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const recentAgents = await db.query.agents.findMany({
    where: sql`${agents.createdAt} > ${oneWeekAgo}`,
    orderBy: desc(agents.createdAt),
    limit: 10,
  });

  return c.json({
    totals: {
      agents: agentCount[0]?.count || 0,
      attestations: attestationCount[0]?.count || 0,
      capabilities: capabilityCount[0]?.count || 0,
    },
    agentsByType: Object.fromEntries(byType.map(r => [r.type, r.count])),
    agentsByStatus: Object.fromEntries(byStatus.map(r => [r.status, r.count])),
    recentRegistrations: recentAgents.map(a => ({
      id: a.id,
      name: a.name,
      type: a.type,
      createdAt: a.createdAt,
    })),
    session: {
      apiCalls: Array.from(stats.apiCalls.entries()).reduce((sum, [_, v]) => sum + v, 0),
      searches: stats.searches,
      registrations: stats.registrations,
      attestationsCreated: stats.attestationsCreated,
    },
  });
});

/**
 * Get statistics for a specific agent
 */
analyticsRouter.get('/agent/:id', async (c) => {
  const agentId = c.req.param('id');

  const agent = await db.query.agents.findFirst({
    where: eq(agents.id, agentId),
  });

  if (!agent) {
    return c.json({ error: 'Agent not found' }, 404);
  }

  // Count attestations received
  const attestationsReceived = await db.select({ count: count() })
    .from(attestations)
    .where(eq(attestations.subjectId, agentId));

  // Count attestations made
  const attestationsMade = await db.select({ count: count() })
    .from(attestations)
    .where(eq(attestations.attesterId, agentId));

  // Get capabilities
  const agentCaps = await db.query.agentCapabilities.findMany({
    where: eq(agentCapabilities.agentId, agentId),
  });

  // Views from session
  const views = stats.agentViews.get(agentId) || 0;

  return c.json({
    agentId,
    name: agent.name,
    createdAt: agent.createdAt,
    attestationsReceived: attestationsReceived[0]?.count || 0,
    attestationsMade: attestationsMade[0]?.count || 0,
    capabilities: agentCaps.length,
    sessionViews: views,
    status: agent.status,
    lastSeen: agent.lastSeen,
  });
});

/**
 * Get top agents by trust score
 */
analyticsRouter.get('/leaderboard', async (c) => {
  const limit = parseInt(c.req.query('limit') || '10', 10);

  const allAgents = await db.query.agents.findMany({
    orderBy: desc(agents.createdAt),
  });

  // Compute trust scores (simplified)
  const scored = await Promise.all(
    allAgents.map(async (agent) => {
      const agentAttestations = await db.query.attestations.findMany({
        where: eq(attestations.subjectId, agent.id),
      });

      const behaviorScores = agentAttestations
        .filter(a => a.claimType === 'behavior')
        .map(a => typeof a.claimValue === 'number' ? a.claimValue : 50);

      const avgBehavior = behaviorScores.length > 0
        ? behaviorScores.reduce((a, b) => a + b, 0) / behaviorScores.length
        : 50;

      const uniqueAttesters = new Set(agentAttestations.map(a => a.attesterId)).size;

      return {
        id: agent.id,
        name: agent.name,
        type: agent.type,
        trustScore: Math.round(avgBehavior * 0.8 + Math.min(uniqueAttesters * 4, 20)),
        attestationCount: agentAttestations.length,
        verified: (agent.metadata as any)?.verified === true,
      };
    })
  );

  const leaderboardAgents = scored
    .filter(a => a.trustScore > 0 || a.attestationCount > 0)
    .sort((a, b) => b.trustScore - a.trustScore)
    .slice(0, limit);

  return c.json({ agents: leaderboardAgents });
});

/**
 * Get capability statistics
 */
analyticsRouter.get('/capabilities', async (c) => {
  const allCaps = await db.query.capabilities.findMany();
  
  // Count agents per capability
  const capStats = await Promise.all(
    allCaps.map(async (cap) => {
      const capAgents = await db.select({ count: count() })
        .from(agentCapabilities)
        .where(eq(agentCapabilities.capabilityId, cap.id));
      
      return {
        id: cap.id,
        description: cap.description,
        agentCount: capAgents[0]?.count || 0,
      };
    })
  );

  return c.json({
    total: allCaps.length,
    capabilities: capStats.sort((a, b) => b.agentCount - a.agentCount),
  });
});

export { analyticsRouter };
