import { and, eq, inArray, isNotNull, or, sql } from 'drizzle-orm';
import {
  computeTrust,
  isTerminal,
  outcomeFor,
  TRUST_V1,
  UNCONFIRMED_STATES,
  type ReceiptCounts,
  type ReceiptState,
  type TrustReceiptInput,
  type TrustResult,
} from 'ans-core';
import { db } from '../db';
import { agents, ratings, receiptEvents, receipts } from '../db/schema';

/**
 * Trust materialization (docs/DESIGN.md section 5). The formula lives in
 * ans-core (`computeTrust`); this module loads an agent's confirmed terminal
 * receipts, computes, and writes agents.trust_* and agents.receipt_counts.
 */

export type TrustSnapshot = TrustResult & { computedAt: Date; receiptCounts: ReceiptCounts };

type ReceiptRow = typeof receipts.$inferSelect;

/** Confirmed receipts: both signatures present and the counterparty bound. */
function isConfirmed(r: ReceiptRow): boolean {
  return !!r.initiatorSig && !!r.counterpartySig && !!r.clientId && !!r.providerId && !UNCONFIRMED_STATES.has(r.state);
}

async function loadAgentReceipts(agentId: string): Promise<ReceiptRow[]> {
  return db.select().from(receipts).where(or(eq(receipts.clientId, agentId), eq(receipts.providerId, agentId), eq(receipts.initiatorId, agentId)));
}

async function loadRatingsReceived(agentId: string, receiptIds: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (receiptIds.length === 0) return out;
  const rows = await db
    .select({ receiptId: ratings.receiptId, score: ratings.score })
    .from(ratings)
    // Only revealed ratings count: a sealed rating must not move a score (that would leak it)
    .where(and(eq(ratings.subjectId, agentId), inArray(ratings.receiptId, receiptIds), isNotNull(ratings.revealedAt)));
  for (const r of rows) out.set(r.receiptId, r.score);
  return out;
}

async function loadDisputed(receiptIds: string[]): Promise<Set<string>> {
  const out = new Set<string>();
  if (receiptIds.length === 0) return out;
  const rows = await db
    .selectDistinct({ receiptId: receiptEvents.receiptId })
    .from(receiptEvents)
    .where(and(inArray(receiptEvents.receiptId, receiptIds), eq(receiptEvents.toState, 'disputed' as ReceiptState)));
  for (const r of rows) out.add(r.receiptId);
  return out;
}

/** Build the ans-core inputs for one agent from its confirmed terminal receipts. */
export async function loadTrustInputs(agentId: string): Promise<{ inputs: TrustReceiptInput[]; counts: ReceiptCounts }> {
  const rows = await loadAgentReceipts(agentId);
  const confirmed = rows.filter(isConfirmed);
  const terminal = confirmed.filter((r) => isTerminal(r.state));
  const ids = terminal.map((r) => r.id);
  const [ratingsReceived, disputed] = await Promise.all([loadRatingsReceived(agentId, ids), loadDisputed(ids)]);

  const inputs: TrustReceiptInput[] = terminal.map((r) => {
    const role = r.clientId === agentId ? 'client' : 'provider';
    // denormalized columns are written only at reveal time
    const denormalized = r.ratingsRevealedAt ? (role === 'client' ? r.clientRating : r.providerRating) : null;
    return {
      id: r.id,
      role,
      state: r.state,
      sealedAt: r.sealedAt ?? r.verdictAt ?? r.deliveredAt ?? r.createdAt,
      priceMicros: r.priceMicros.toString(),
      creditClass: r.creditClass,
      counterpartyId: role === 'client' ? r.providerId : r.clientId,
      via: r.via,
      ratingReceived: ratingsReceived.get(r.id) ?? denormalized ?? null,
      outputValidated: r.via === 'proxy' && r.outputHash !== null && r.state !== 'output_invalid',
      disputed: disputed.has(r.id),
      delivered: r.deliveredAt !== null,
      sharedFingerprint: false,
    };
  });

  let negative = 0;
  let unreviewed = 0;
  let noReview = 0;
  for (const i of inputs) {
    const outcome = outcomeFor(i);
    if (outcome && outcome.weight > 0 && outcome.value < 50) negative += 1;
    if (i.state === 'unreviewed' && i.role === 'provider') unreviewed += 1;
    if (i.state === 'unreviewed' && i.role === 'client') noReview += 1;
  }
  const unconfirmed = rows.filter((r) => r.initiatorId === agentId && !isConfirmed(r)).length;

  return {
    inputs,
    counts: { confirmed: confirmed.length, unconfirmed, unreviewed, negative, noReview },
  };
}

/** Recompute and persist trust for one agent. Returns the snapshot written. */
export async function recomputeTrust(agentId: string, now: Date = new Date()): Promise<TrustSnapshot> {
  const { inputs, counts } = await loadTrustInputs(agentId);
  const result = computeTrust({ receipts: inputs, now });
  await db
    .update(agents)
    .set({
      trustScore: result.score,
      trustConfidence: result.confidence,
      trustRank: result.rank,
      trustComputedAt: now,
      receiptCounts: counts,
      updatedAt: now,
    })
    .where(eq(agents.id, agentId));
  return { ...result, computedAt: now, receiptCounts: counts };
}

/** Nightly: recompute every agent (decay moves scores even with no new receipts). */
export async function recomputeAll(now: Date = new Date(), batchSize: number = 200): Promise<{ agents: number; failed: string[] }> {
  const failed: string[] = [];
  let count = 0;
  let lastId = '';
  for (;;) {
    const page = await db
      .select({ id: agents.id })
      .from(agents)
      .where(sql`${agents.id} > ${lastId}`)
      .orderBy(agents.id)
      .limit(batchSize);
    if (page.length === 0) break;
    for (const { id } of page) {
      try {
        await recomputeTrust(id, now);
        count += 1;
      } catch (err) {
        failed.push(id);
        console.error(`[trust] recompute failed for ${id}:`, err instanceof Error ? err.message : err);
      }
      lastId = id;
    }
    if (page.length < batchSize) break;
  }
  return { agents: count, failed };
}

export interface TrustBreakdownView {
  version: typeof TRUST_V1.version;
  score: number;
  confidence: number;
  rank: number;
  n: number;
  sumWeight: number;
  byOutcome: TrustResult['breakdown']['byOutcome'];
  freeWeightUsed: number;
  unreviewedWeightUsed: number;
  receiptCounts: ReceiptCounts;
  lastComputed: string | null;
  /** the values currently stored on the agent row (may lag the live numbers until the next recompute) */
  stored: { score: number; confidence: number; rank: number };
}

/** GET /v1/agents/:id/trust: a live computation plus the stored snapshot. */
export async function getTrustBreakdown(agentId: string, now: Date = new Date()): Promise<TrustBreakdownView | null> {
  const [agent] = await db
    .select({ trustScore: agents.trustScore, trustConfidence: agents.trustConfidence, trustRank: agents.trustRank, trustComputedAt: agents.trustComputedAt })
    .from(agents)
    .where(eq(agents.id, agentId));
  if (!agent) return null;
  const { inputs, counts } = await loadTrustInputs(agentId);
  const result = computeTrust({ receipts: inputs, now });
  return {
    version: TRUST_V1.version,
    score: result.score,
    confidence: result.confidence,
    rank: result.rank,
    n: result.n,
    sumWeight: result.sumWeight,
    byOutcome: result.breakdown.byOutcome,
    freeWeightUsed: result.breakdown.freeWeightUsed,
    unreviewedWeightUsed: result.breakdown.unreviewedInvokeWeightUsed,
    receiptCounts: counts,
    lastComputed: agent.trustComputedAt ? agent.trustComputedAt.toISOString() : null,
    stored: { score: agent.trustScore, confidence: agent.trustConfidence, rank: agent.trustRank },
  };
}
