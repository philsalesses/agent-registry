import { Hono } from 'hono';
import { eq, and, gt, avg, count } from 'drizzle-orm';
import { db } from '../db';
import { attestations, agents, agentCapabilities } from '../db/schema';

const reputationRouter = new Hono();

/**
 * Compute reputation score for an agent based on attestations
 * 
 * Score is computed from:
 * - Behavior attestations (direct trust ratings)
 * - Capability attestations (verified skills)
 * - Number of unique attesters (breadth of trust)
 * - Recency of attestations (newer = more relevant)
 */
reputationRouter.get('/:id', async (c) => {
  const agentId = c.req.param('id');

  // Get the agent
  const agent = await db.query.agents.findFirst({
    where: eq(agents.id, agentId),
  });

  if (!agent) {
    return c.json({ error: 'Agent not found' }, 404);
  }

  // Get all valid attestations for this agent
  const now = new Date();
  const allAttestations = await db.query.attestations.findMany({
    where: eq(attestations.subjectId, agentId),
  });

  // Filter out expired attestations
  const validAttestations = allAttestations.filter(a => 
    !a.expiresAt || new Date(a.expiresAt) > now
  );

  // Separate by type
  const behaviorAttestations = validAttestations.filter(a => a.claimType === 'behavior');
  const capabilityAttestations = validAttestations.filter(a => a.claimType === 'capability');
  const identityAttestations = validAttestations.filter(a => a.claimType === 'identity');

  // Calculate behavior score (average of all behavior ratings)
  let behaviorScore = 50; // default neutral
  if (behaviorAttestations.length > 0) {
    const scores = behaviorAttestations
      .map(a => {
        const val = a.claimValue;
        return typeof val === 'number' ? val : 50;
      })
      .filter(v => v >= 0 && v <= 100);
    
    if (scores.length > 0) {
      behaviorScore = scores.reduce((a, b) => a + b, 0) / scores.length;
    }
  }

  // Calculate capability score (percentage of positive capability attestations)
  let capabilityScore = 0;
  if (capabilityAttestations.length > 0) {
    const positive = capabilityAttestations.filter(a => a.claimValue === true).length;
    capabilityScore = (positive / capabilityAttestations.length) * 100;
  }

  // Count unique attesters (more attesters = more trustworthy)
  const uniqueAttesters = new Set(validAttestations.map(a => a.attesterId)).size;
  const attesterBonus = Math.min(uniqueAttesters * 5, 25); // Max 25 point bonus

  // Compute overall trust score
  // Weight: 60% behavior, 30% capabilities, 10% attester bonus
  const rawScore = (behaviorScore * 0.6) + (capabilityScore * 0.3) + attesterBonus;
  const trustScore = Math.min(Math.max(Math.round(rawScore), 0), 100);

  // Get verified capabilities
  const verifiedCapabilities = capabilityAttestations
    .filter(a => a.claimValue === true && a.claimCapabilityId)
    .map(a => a.claimCapabilityId);

  return c.json({
    agentId,
    trustScore,
    breakdown: {
      behaviorScore: Math.round(behaviorScore),
      capabilityScore: Math.round(capabilityScore),
      attesterBonus,
      uniqueAttesters,
    },
    attestationCounts: {
      total: validAttestations.length,
      behavior: behaviorAttestations.length,
      capability: capabilityAttestations.length,
      identity: identityAttestations.length,
    },
    verifiedCapabilities: [...new Set(verifiedCapabilities)],
  });
});

/**
 * Get top-rated agents
 */
reputationRouter.get('/leaderboard', async (c) => {
  const limit = parseInt(c.req.query('limit') || '10', 10);

  // Get all agents with their attestation counts
  const allAgents = await db.query.agents.findMany({
    orderBy: (agents, { desc }) => [desc(agents.createdAt)],
  });

  // Compute scores for each (simplified for leaderboard)
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
        ...agent,
        trustScore: Math.round(avgBehavior * 0.8 + Math.min(uniqueAttesters * 4, 20)),
        attestationCount: agentAttestations.length,
      };
    })
  );

  // Sort by trust score and return top N
  const leaderboard = scored
    .sort((a, b) => b.trustScore - a.trustScore)
    .slice(0, limit);

  return c.json({ leaderboard });
});

export { reputationRouter };
