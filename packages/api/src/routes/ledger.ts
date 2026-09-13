import { Hono } from 'hono';
import { desc, sql } from 'drizzle-orm';
import { db } from '../db';
import { ledgerTxns } from '../db/schema';
import { withAns } from '../lib/errors';
import { verifyChain, type ChainVerifyResult } from '../lib/ledger';

/**
 * Public ledger audit surface (docs/DESIGN.md section 4 "Money"). Mounted at /v1/ledger.
 *
 *   GET /checkpoints  the 30 most recent UTC days with ledger activity, each
 *                     {date, lastTxnId, lastSeq, hash, txnCount}, plus a
 *                     verification of the whole hash chain. Public, cached 300 s.
 */

export const CHECKPOINT_DAYS = 30;

export const CHECKPOINTS_NOTE =
  'Self-audit checkpoints held by the registry, not third-party proof. Each hash is the head of the ledger hash chain at the end of that UTC day: save one now and compare it later to detect rewritten history. External anchoring is not in place yet.';

export interface LedgerCheckpoint {
  /** UTC day, YYYY-MM-DD */
  date: string;
  lastTxnId: string;
  lastSeq: string;
  /** hash of the last txn that day */
  hash: string;
  txnCount: number;
}

/** One checkpoint per UTC day that has txns, newest first (ledger created_at is stored as UTC). */
export async function ledgerCheckpoints(days: number = CHECKPOINT_DAYS): Promise<LedgerCheckpoint[]> {
  const rows = await db.execute(sql`
    with days as (
      select created_at::date as day, count(*)::int as txn_count, max(seq) as last_seq
      from ledger_txns
      group by 1
      order by 1 desc
      limit ${days}
    )
    select to_char(d.day, 'YYYY-MM-DD') as date, d.txn_count, d.last_seq::text as last_seq, t.id as last_txn_id, t.hash
    from days d
    join ledger_txns t on t.seq = d.last_seq
    order by d.day desc
  `);
  return (rows as unknown as { date: string; txn_count: number | string; last_seq: string; last_txn_id: string; hash: string }[]).map((r) => ({
    date: r.date,
    lastTxnId: r.last_txn_id,
    lastSeq: r.last_seq,
    hash: r.hash,
    txnCount: Number(r.txn_count),
  }));
}

export interface LedgerRouterDeps {
  /** Reuse the last snapshot while the chain head is unchanged and it is younger than this (ms). Default 60 s. */
  cacheMs?: number;
}

interface CheckpointSnapshot {
  headSeq: string | null;
  at: number;
  checkpoints: LedgerCheckpoint[];
  chain: ChainVerifyResult;
}

export function createLedgerRouter(deps: LedgerRouterDeps = {}): Hono {
  const cacheMs = deps.cacheMs ?? 60_000;
  let cached: CheckpointSnapshot | null = null;

  /**
   * verifyChain walks every txn and the checkpoint query groups the whole
   * ledger, so a public endpoint reuses its last answer until a new txn moves
   * the chain head or the snapshot ages out.
   */
  async function snapshot(): Promise<CheckpointSnapshot> {
    const [head] = await db.select({ seq: ledgerTxns.seq }).from(ledgerTxns).orderBy(desc(ledgerTxns.seq)).limit(1);
    const headSeq = head ? head.seq.toString() : null;
    if (cached && cached.headSeq === headSeq && Date.now() - cached.at < cacheMs) return cached;
    const [checkpoints, chain] = await Promise.all([ledgerCheckpoints(), verifyChain()]);
    cached = { headSeq, at: Date.now(), checkpoints, chain };
    return cached;
  }

  const router = new Hono();

  router.get('/checkpoints', async (c) => {
    const { checkpoints, chain, at } = await snapshot();
    c.header('Cache-Control', 'public, max-age=300');
    return c.json(withAns({
      checkpoints,
      chain: { ok: chain.ok, checked: chain.checked, ...(chain.breakAt ? { breakAt: chain.breakAt } : {}) },
      window: `the ${CHECKPOINT_DAYS} most recent UTC days with ledger activity`,
      note: CHECKPOINTS_NOTE,
      generatedAt: new Date(at).toISOString(),
    }));
  });

  return router;
}

export const ledgerRouter = createLedgerRouter();
export default ledgerRouter;
