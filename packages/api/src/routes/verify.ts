import { Hono } from 'hono';
import { inArray, or } from 'drizzle-orm';
import { ANS_BLOCK, REGISTER_FIX, HANDLE_REGEX, type WireVerify } from 'ans-core';
import { db } from '../db';
import { agents } from '../db/schema';
import { jsonAns } from '../lib/errors';
import { policyOf } from '../lib/policy';
import { resolveAgent, type AgentRow } from '../lib/auth';

/**
 * GET /v1/verify/:idOrHandle: the one call an agent makes before trusting another.
 * Always 200 so callers can branch on `registered` (docs/DESIGN.md sections 4 and 8.2).
 */
export const verifyRouter = new Hono();

function counts(a: AgentRow) {
  const c = (a.receiptCounts ?? {}) as Partial<Record<string, number>>;
  return {
    confirmed: Number(c.confirmed ?? 0),
    unconfirmed: Number(c.unconfirmed ?? 0),
    unreviewed: Number(c.unreviewed ?? 0),
    negative: Number(c.negative ?? 0),
    noReview: Number(c.noReview ?? 0),
  };
}

export function verifyView(a: AgentRow | null): WireVerify {
  if (!a || a.isSeed) {
    return {
      registered: false,
      id: null,
      handle: null,
      name: null,
      trust: null,
      receipts: null,
      tier: null,
      lastSeen: null,
      policy: null,
      isHouse: false,
      fix: { url: REGISTER_FIX.url!, command: REGISTER_FIX.command!, docs: REGISTER_FIX.docs },
      _ans: ANS_BLOCK,
    };
  }
  const policy = policyOf(a);
  return {
    registered: true,
    id: a.id,
    handle: a.handle ?? null,
    name: a.name,
    trust: { score: a.trustScore, confidence: Math.round(a.trustConfidence * 1000) / 1000, rank: Math.round(a.trustRank * 10) / 10 },
    receipts: counts(a),
    tier: a.verificationTier ?? 0,
    lastSeen: a.lastSeen ? a.lastSeen.toISOString() : null,
    policy: { requireRegistered: policy.requireRegistered, minTrust: policy.minTrust },
    isHouse: a.isHouse,
    fix: null,
    _ans: ANS_BLOCK,
  };
}

verifyRouter.get('/', async (c) => {
  const ids = (c.req.query('ids') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 50);
  if (ids.length === 0) return jsonAns(c, { results: [] });
  const byId = ids.filter((x) => x.startsWith('ag_'));
  const byHandle = ids.filter((x) => !x.startsWith('ag_')).map((x) => (x.startsWith('@') ? x.slice(1) : x).toLowerCase()).filter((h) => HANDLE_REGEX.test(h));
  const rows = byId.length || byHandle.length
    ? await db.select().from(agents).where(or(byId.length ? inArray(agents.id, byId) : undefined, byHandle.length ? inArray(agents.handle, byHandle) : undefined))
    : [];
  const results = ids.map((q) => {
    const h = (q.startsWith('@') ? q.slice(1) : q).toLowerCase();
    const row = rows.find((r) => r.id === q || r.handle === h) ?? null;
    return { query: q, ...verifyView(row) };
  });
  c.header('Cache-Control', 'public, max-age=60');
  return jsonAns(c, { results });
});

verifyRouter.get('/:idOrHandle', async (c) => {
  const row = await resolveAgent(c.req.param('idOrHandle'));
  c.header('Cache-Control', 'public, max-age=60');
  return c.json(verifyView(row));
});
