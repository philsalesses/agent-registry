import { Hono } from 'hono';
import { and, count, desc, eq } from 'drizzle-orm';
import { TRUST_V1 } from 'ans-core';
import { db } from '../db';
import { agents, attestations } from '../db/schema';
import { config } from '../config';
import { resolveAgent } from '../lib/auth';
import { jsonAns, teach } from '../lib/errors';
import { confirmedReceiptsSql, policyOf, publicAgentView, receiptCountsOf, trustOf } from './agents';

/**
 * Reputation reads the materialized trust-v1 columns (docs/DESIGN.md
 * section 5). There is no local trust computation here; the breakdown lives
 * at GET /v1/agents/:id/trust and the constants at GET /v1/trust/formula.
 */

const reputationRouter = new Hono();

// GET /v1/reputation/leaderboard?limit= (before /:id so the literal wins)
reputationRouter.get('/leaderboard', async (c) => {
  const limit = Math.min(Math.max(parseInt(c.req.query('limit') ?? '10', 10) || 10, 1), 100);
  const rows = await db
    .select()
    .from(agents)
    .where(and(eq(agents.isSeed, false), eq(agents.isHouse, false)))
    .orderBy(desc(agents.trustRank), desc(confirmedReceiptsSql), desc(agents.createdAt))
    .limit(limit);

  return jsonAns(c, {
    leaderboard: rows.map((a, i) => ({
      position: i + 1,
      ...publicAgentView(a),
      trustScore: a.trustScore,
      confirmedReceipts: receiptCountsOf(a).confirmed,
    })),
    ordering: 'trust_rank desc',
    formula: `${config.publicApiUrl}/v1/trust/formula`,
    version: TRUST_V1.version,
  });
});

// GET /v1/reputation/:idOrHandle
reputationRouter.get('/:id', async (c) => {
  const agent = await resolveAgent(c.req.param('id'));
  if (!agent) return teach(c, 404, 'not_found', `Agent ${c.req.param('id')} not found`);

  const [[received], [given]] = await Promise.all([
    db.select({ n: count() }).from(attestations).where(eq(attestations.subjectId, agent.id)),
    db.select({ n: count() }).from(attestations).where(eq(attestations.attesterId, agent.id)),
  ]);

  const trust = trustOf(agent);
  c.header('Cache-Control', 'public, max-age=60');
  return jsonAns(c, {
    agentId: agent.id,
    handle: agent.handle,
    trust,
    trustScore: trust.score,
    receiptCounts: receiptCountsOf(agent),
    vouches: { received: Number(received?.n ?? 0), given: Number(given?.n ?? 0), weight: 0 },
    policy: policyOf(agent),
    unranked: agent.isHouse,
    version: TRUST_V1.version,
    breakdown: `${config.publicApiUrl}/v1/agents/${agent.id}/trust`,
    formula: `${config.publicApiUrl}/v1/trust/formula`,
    receipts: `${config.publicApiUrl}/v1/agents/${agent.id}/receipts`,
  });
});

export { reputationRouter };
