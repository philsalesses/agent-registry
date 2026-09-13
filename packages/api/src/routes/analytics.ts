import { Hono } from 'hono';
import { and, count, desc, eq, gt, inArray, sql } from 'drizzle-orm';
import { TERMINAL_STATES, UNCONFIRMED_STATES, type ReceiptState } from 'ans-core';
import { db } from '../db';
import { agents, attestations, offers, receipts } from '../db/schema';
import { config } from '../config';
import { resolveAgent } from '../lib/auth';
import { jsonAns, teach } from '../lib/errors';
import { confirmedReceiptsSql, jsonbArray, policyOf, publicAgentView, receiptCountsOf, trustOf } from './agents';

/**
 * Registry-wide and per-agent statistics, read straight from the tables and
 * the materialized trust columns. No in-process counters, no local trust
 * formula (docs/DESIGN.md section 5 replaces analytics.ts:153-179).
 */

const analyticsRouter = new Hono();

const notSeed = eq(agents.isSeed, false);

// GET /v1/analytics/stats
analyticsRouter.get('/stats', async (c) => {
  const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const confirmedStates = Array.from(TERMINAL_STATES).filter((s) => !UNCONFIRMED_STATES.has(s)) as ReceiptState[];

  const [
    [{ agentCount }],
    byType,
    byStatus,
    [{ vouchCount }],
    [{ offerCount }],
    receiptsByState,
    [{ confirmedReceipts }],
    [{ volume }],
    recent,
  ] = await Promise.all([
    db.select({ agentCount: count() }).from(agents).where(notSeed),
    db.select({ type: agents.type, n: count() }).from(agents).where(notSeed).groupBy(agents.type),
    db.select({ status: agents.status, n: count() }).from(agents).where(notSeed).groupBy(agents.status),
    db.select({ vouchCount: count() }).from(attestations),
    db.select({ offerCount: count() }).from(offers).where(eq(offers.status, 'active')),
    db.select({ state: receipts.state, n: count() }).from(receipts).groupBy(receipts.state),
    db.select({ confirmedReceipts: count() }).from(receipts).where(inArray(receipts.state, confirmedStates)),
    db.select({ volume: sql<string>`coalesce(sum(${receipts.priceMicros}) filter (where ${receipts.creditClass} = 'cash'), 0)::text` }).from(receipts).where(inArray(receipts.state, confirmedStates)),
    db.select().from(agents).where(and(notSeed, gt(agents.createdAt, oneWeekAgo))).orderBy(desc(agents.createdAt)).limit(10),
  ]);

  c.header('Cache-Control', 'public, max-age=60');
  return jsonAns(c, {
    totals: {
      agents: Number(agentCount),
      vouches: Number(vouchCount),
      activeOffers: Number(offerCount),
      receipts: receiptsByState.reduce((sum, r) => sum + Number(r.n), 0),
      confirmedReceipts: Number(confirmedReceipts),
      confirmedCashVolumeMicros: String(volume ?? '0'),
    },
    agentsByType: Object.fromEntries(byType.map((r) => [r.type, Number(r.n)])),
    agentsByStatus: Object.fromEntries(byStatus.map((r) => [r.status ?? 'unknown', Number(r.n)])),
    receiptsByState: Object.fromEntries(receiptsByState.map((r) => [r.state, Number(r.n)])),
    recentRegistrations: recent.map((a) => ({ id: a.id, handle: a.handle, name: a.name, type: a.type, trust: trustOf(a), createdAt: a.createdAt })),
  });
});

// GET /v1/analytics/leaderboard?limit=
analyticsRouter.get('/leaderboard', async (c) => {
  const limit = Math.min(Math.max(parseInt(c.req.query('limit') ?? '10', 10) || 10, 1), 100);
  const rows = await db
    .select()
    .from(agents)
    .where(and(notSeed, eq(agents.isHouse, false)))
    .orderBy(desc(agents.trustRank), desc(confirmedReceiptsSql), desc(agents.createdAt))
    .limit(limit);
  c.header('Cache-Control', 'public, max-age=60');
  return jsonAns(c, {
    agents: rows.map((a, i) => ({
      position: i + 1,
      id: a.id,
      handle: a.handle,
      name: a.name,
      type: a.type,
      avatar: a.avatar,
      trust: trustOf(a),
      trustScore: a.trustScore,
      receiptCounts: receiptCountsOf(a),
    })),
    ordering: 'trust_rank desc',
  });
});

// GET /v1/analytics/capabilities: how many agents carry each tag
analyticsRouter.get('/capabilities', async (c) => {
  const rows = await db.execute(sql`
    select tag, count(*)::int as n
    from ${agents}, jsonb_array_elements_text(${jsonbArray(agents.tags)}) as tag
    where ${agents.isSeed} = false
    group by tag
    order by n desc, tag asc
    limit 200
  `);
  const list = (rows as unknown as { tag: string; n: number }[]).map((r) => ({ id: r.tag, agentCount: Number(r.n) }));
  c.header('Cache-Control', 'public, max-age=300');
  return jsonAns(c, { total: list.length, capabilities: list });
});

// GET /v1/analytics/agent/:idOrHandle
analyticsRouter.get('/agent/:id', async (c) => {
  const agent = await resolveAgent(c.req.param('id'));
  if (!agent) return teach(c, 404, 'not_found', `Agent ${c.req.param('id')} not found`);

  const [[received], [given], [activeOffers], [asClient], [asProvider]] = await Promise.all([
    db.select({ n: count() }).from(attestations).where(eq(attestations.subjectId, agent.id)),
    db.select({ n: count() }).from(attestations).where(eq(attestations.attesterId, agent.id)),
    db.select({ n: count() }).from(offers).where(and(eq(offers.agentId, agent.id), eq(offers.status, 'active'))),
    db.select({ n: count() }).from(receipts).where(eq(receipts.clientId, agent.id)),
    db.select({ n: count() }).from(receipts).where(eq(receipts.providerId, agent.id)),
  ]);

  c.header('Cache-Control', 'public, max-age=60');
  return jsonAns(c, {
    agentId: agent.id,
    handle: agent.handle,
    name: agent.name,
    status: agent.status,
    lastSeen: agent.lastSeen,
    createdAt: agent.createdAt,
    trust: trustOf(agent),
    receiptCounts: receiptCountsOf(agent),
    receipts: { asClient: Number(asClient?.n ?? 0), asProvider: Number(asProvider?.n ?? 0) },
    vouches: { received: Number(received?.n ?? 0), given: Number(given?.n ?? 0), weight: 0 },
    activeOffers: Number(activeOffers?.n ?? 0),
    tags: publicAgentView(agent).tags,
    policy: policyOf(agent),
    urls: {
      profile: `${config.publicWebUrl}/agent/${agent.id}`,
      trust: `${config.publicApiUrl}/v1/agents/${agent.id}/trust`,
    },
  });
});

export { analyticsRouter };
