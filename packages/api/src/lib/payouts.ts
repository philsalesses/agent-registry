import { and, desc, eq, gt, gte, ne, sql } from 'drizzle-orm';
import { ANS_BLOCK, AnsError, PAYOUT_HOLD_DAYS, formatUsd, generateId } from 'ans-core';
import { db } from '../db';
import { agents, ledgerAccounts, ledgerEntries, ledgerTxns, payoutRequests } from '../db/schema';
import { config } from '../config';
import { alert } from './alerts';
import type { AgentRow } from './auth';
import { LEDGER_LOCK_KEY, SYSTEM_ACCOUNTS, assertLedgerOpen, getOrCreateAccount, postTxn, toBig, type DbClient, type Tx } from './ledger';
import { outstandingShortfallMicros } from './rails-stripe';

/**
 * Manual payouts (docs/DESIGN.md 14.12). Until Stripe Connect ships, a payout
 * request moves cash available -> cash held (`hold` txn, refType payout) and
 * alerts the founder. The admin approves it, pays by hand to the agent's
 * registered payment method, and marks it paid, which posts a `payout` txn
 * cash held -> payout_clearing. A rejection posts a `refund` txn back to
 * cash available.
 *
 *   pending -> approved -> paid
 *   pending | approved -> rejected
 *
 * Every transition runs in one transaction with the payout row locked. Ledger
 * lock order is always pg_advisory_xact_lock(7) first, then the payout row.
 */

export type PayoutRow = typeof payoutRequests.$inferSelect;
export type PayoutStatus = PayoutRow['status'];
export type PaymentMethodRow = NonNullable<AgentRow['paymentMethods']>[number];

export const PAYOUT_STATUSES: readonly PayoutStatus[] = ['pending', 'approved', 'paid', 'rejected'];

const MS_PER_DAY = 86_400_000;
const NOTE_MAX = 500;

function moneyFix(next?: string) {
  return { docs: ANS_BLOCK.docs, url: `${config.publicWebUrl}/docs/money`, ...(next ? { next } : {}) };
}

// ---------------------------------------------------------------------------
// Eligibility
// ---------------------------------------------------------------------------

export interface PayoutEligibility {
  agentId: string;
  cashAvailableMicros: bigint;
  /** cash credited to available inside the hold window (releases, splits, top-ups); refunds of existing money are not counted */
  heldBackMicros: bigint;
  /** unpaid shortfalls from Stripe refunds and disputes */
  owedMicros: bigint;
  eligibleMicros: bigint;
  holdDays: number;
  asOf: Date;
}

/**
 * Payout-eligible cash = cash available, minus cash credited to it in the
 * last PAYOUT_HOLD_DAYS days, minus anything owed from Stripe reversals.
 * Never negative. `now` moves the hold window (tests).
 */
export async function payoutEligibility(agentId: string, opts: { now?: Date; client?: DbClient } = {}): Promise<PayoutEligibility> {
  const client = opts.client ?? db;
  const asOf = opts.now ?? new Date();
  const cutoff = new Date(asOf.getTime() - PAYOUT_HOLD_DAYS * MS_PER_DAY);
  const owedMicros = await outstandingShortfallMicros(agentId, client);

  const [account] = await client
    .select({ id: ledgerAccounts.id, balance: ledgerAccounts.balanceMicros })
    .from(ledgerAccounts)
    .where(and(eq(ledgerAccounts.ownerType, 'agent'), eq(ledgerAccounts.ownerId, agentId), eq(ledgerAccounts.kind, 'available'), eq(ledgerAccounts.klass, 'cash')));
  if (!account) {
    return { agentId, cashAvailableMicros: 0n, heldBackMicros: 0n, owedMicros, eligibleMicros: 0n, holdDays: PAYOUT_HOLD_DAYS, asOf };
  }

  const [recent] = await client
    .select({ total: sql<string>`coalesce(sum(${ledgerEntries.amountMicros}), 0)::text` })
    .from(ledgerEntries)
    .innerJoin(ledgerTxns, eq(ledgerTxns.id, ledgerEntries.txnId))
    .where(and(
      eq(ledgerEntries.accountId, account.id),
      gt(ledgerEntries.amountMicros, 0n),
      ne(ledgerTxns.type, 'refund'),
      gte(ledgerTxns.createdAt, cutoff),
    ));
  const heldBackMicros = toBig(recent?.total ?? '0');
  const raw = account.balance - heldBackMicros - owedMicros;
  return {
    agentId,
    cashAvailableMicros: account.balance,
    heldBackMicros,
    owedMicros,
    eligibleMicros: raw > 0n ? raw : 0n,
    holdDays: PAYOUT_HOLD_DAYS,
    asOf,
  };
}

export async function payoutEligibleMicros(agentId: string, opts: { now?: Date; client?: DbClient } = {}): Promise<bigint> {
  return (await payoutEligibility(agentId, opts)).eligibleMicros;
}

// ---------------------------------------------------------------------------
// Serialization
// ---------------------------------------------------------------------------

export interface WirePayoutRequest {
  id: string;
  agentId: string;
  amountMicros: string;
  destinationIndex: number;
  /** The agent's payment method at destinationIndex as it is now (payout rows do not snapshot it) */
  destination: { type: string; address: string; label: string | null } | null;
  status: PayoutStatus;
  holdTxnId: string | null;
  payoutTxnId: string | null;
  note: string | null;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
}

export function serializePayout(row: PayoutRow, paymentMethods?: PaymentMethodRow[] | null): WirePayoutRequest {
  const method = paymentMethods?.[row.destinationIndex];
  return {
    id: row.id,
    agentId: row.agentId,
    amountMicros: row.amountMicros.toString(),
    destinationIndex: row.destinationIndex,
    destination: method ? { type: method.type, address: method.address, label: method.label ?? null } : null,
    status: row.status,
    holdTxnId: row.holdTxnId,
    payoutTxnId: row.payoutTxnId,
    note: row.note,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    resolvedAt: row.resolvedAt ? row.resolvedAt.toISOString() : null,
  };
}

// ---------------------------------------------------------------------------
// Request (agent)
// ---------------------------------------------------------------------------

export interface RequestPayoutInput {
  amountMicros: bigint;
  /** index into agents.payment_methods */
  destinationIndex: number;
  note?: string | null;
  /** clock for the hold window (tests) */
  now?: Date;
}

export interface RequestedPayout {
  payout: PayoutRow;
  destination: PaymentMethodRow;
  eligibility: PayoutEligibility;
}

/**
 * Create a pending payout request: validate the destination and the amount
 * against payout eligibility, hold the cash (available -> held, idempotency
 * key `payout-hold:<id>`), insert the row, alert the founder.
 * Errors: 400 validation_error (amount, destination), 402 insufficient_credit
 * (above eligibility), 404 not_found, 503 ledger_frozen.
 */
export async function requestPayout(agentId: string, input: RequestPayoutInput): Promise<RequestedPayout> {
  if (typeof input.amountMicros !== 'bigint' || input.amountMicros <= 0n) {
    throw new AnsError('validation_error', 'amountMicros must be a positive integer of USD micros', {
      details: { amountMicros: String(input.amountMicros) },
      fix: moneyFix(),
    });
  }
  const agent = await db.query.agents.findFirst({ where: eq(agents.id, agentId), columns: { id: true, handle: true, paymentMethods: true } });
  if (!agent) throw new AnsError('not_found', `Agent ${agentId} not found`);

  const methods = agent.paymentMethods ?? [];
  const destination = Number.isInteger(input.destinationIndex) && input.destinationIndex >= 0 ? methods[input.destinationIndex] : undefined;
  if (!destination) {
    throw new AnsError(
      'validation_error',
      methods.length === 0
        ? 'Add a payment method to your agent before requesting a payout'
        : `destinationIndex ${input.destinationIndex} does not name one of your ${methods.length} payment method(s)`,
      {
        details: { destinationIndex: input.destinationIndex, paymentMethods: methods.length },
        fix: moneyFix(`PATCH /v1/agents/${agentId} {"paymentMethods": [{"type": "lightning", "address": "you@example.com"}]} (signed or session), then send that entry's index as destinationIndex`),
      },
    );
  }
  const note = input.note && input.note.trim() ? input.note.trim().slice(0, NOTE_MAX) : null;

  await assertLedgerOpen();
  const id = generateId('po_', 16);

  const { payout, eligibility } = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(${LEDGER_LOCK_KEY})`);
    const eligibility = await payoutEligibility(agentId, { now: input.now, client: tx });
    if (input.amountMicros > eligibility.eligibleMicros) {
      throw new AnsError('insufficient_credit', `Only ${formatUsd(eligibility.eligibleMicros)} of cash is payout-eligible right now`, {
        details: {
          requestedMicros: input.amountMicros.toString(),
          eligibleMicros: eligibility.eligibleMicros.toString(),
          cashAvailableMicros: eligibility.cashAvailableMicros.toString(),
          heldBackMicros: eligibility.heldBackMicros.toString(),
          owedMicros: eligibility.owedMicros.toString(),
          holdDays: eligibility.holdDays,
        },
        fix: moneyFix(`Cash credited in the last ${PAYOUT_HOLD_DAYS} days is held before it can be paid out. Request at most eligibleMicros (GET /v1/wallet shows payoutEligibleMicros).`),
      });
    }
    const available = await getOrCreateAccount('agent', agentId, 'available', 'cash', tx);
    const held = await getOrCreateAccount('agent', agentId, 'held', 'cash', tx);
    const posted = await postTxn(tx, {
      type: 'hold',
      refType: 'payout',
      refId: id,
      idempotencyKey: `payout-hold:${id}`,
      actorAgentId: agentId,
      entries: [
        { accountId: available.id, amountMicros: -input.amountMicros },
        { accountId: held.id, amountMicros: input.amountMicros },
      ],
    });
    const now = new Date();
    const [row] = await tx
      .insert(payoutRequests)
      .values({
        id,
        agentId,
        amountMicros: input.amountMicros,
        destinationIndex: input.destinationIndex,
        status: 'pending',
        holdTxnId: posted.txn.id,
        note,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    return { payout: row, eligibility };
  });

  const label = agent.handle ? `@${agent.handle} (${agentId})` : agentId;
  const notify = alert(
    `Payout request ${id}: ${formatUsd(payout.amountMicros)} cash for ${label} to ${destination.type} ${destination.address}. Approve it, pay by hand, then mark it paid.`,
    {
      payoutId: id,
      agentId,
      amountMicros: payout.amountMicros.toString(),
      destinationIndex: payout.destinationIndex,
      destination,
      note,
      holdTxnId: payout.holdTxnId,
    },
  ).catch((err) => console.error('[payouts] alert failed:', err instanceof Error ? err.message : err));
  // alert() waits up to 5 s on the webhook; only tests (ANS_DISABLE_JOBS=1) wait for it, as lib/receipts.ts does
  if (process.env.ANS_DISABLE_JOBS === '1') await notify;

  return { payout, destination, eligibility };
}

// ---------------------------------------------------------------------------
// Admin transitions
// ---------------------------------------------------------------------------

async function lockPayout(tx: Tx, id: string): Promise<PayoutRow> {
  const [row] = await tx.select().from(payoutRequests).where(eq(payoutRequests.id, id)).for('update');
  if (!row) throw new AnsError('not_found', `Payout request ${id} not found`);
  return row;
}

function assertStatus(row: PayoutRow, allowed: PayoutStatus[], action: string): void {
  if (!allowed.includes(row.status)) {
    throw new AnsError('invalid_state', `Cannot ${action} payout request ${row.id}: it is ${row.status}`, {
      details: { id: row.id, status: row.status, allowedFrom: allowed },
    });
  }
}

function withAdminNote(existing: string | null, note: string | null | undefined): string | null {
  const add = note?.trim();
  if (!add) return existing;
  const line = `admin: ${add.slice(0, NOTE_MAX)}`;
  return existing ? `${existing}\n${line}` : line;
}

async function lockLedger(tx: Tx): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(${LEDGER_LOCK_KEY})`);
}

/** pending -> approved. 404 not_found, 409 invalid_state. */
export async function approvePayout(id: string): Promise<PayoutRow> {
  return db.transaction(async (tx) => {
    const row = await lockPayout(tx, id);
    assertStatus(row, ['pending'], 'approve');
    const [updated] = await tx
      .update(payoutRequests)
      .set({ status: 'approved', updatedAt: new Date() })
      .where(eq(payoutRequests.id, id))
      .returning();
    return updated;
  });
}

/**
 * approved -> paid: posts a `payout` txn agent cash held -> payout_clearing
 * (idempotency key `payout:<id>`) and records payoutTxnId. Call it after the
 * money has actually been sent. 404 not_found, 409 invalid_state, 503 ledger_frozen.
 */
export async function markPayoutPaid(id: string, note?: string | null): Promise<PayoutRow> {
  return db.transaction(async (tx) => {
    await lockLedger(tx);
    const row = await lockPayout(tx, id);
    assertStatus(row, ['approved'], 'mark paid');
    if (!row.holdTxnId) {
      throw new AnsError('invalid_state', `Payout request ${id} has no hold txn; its cash was never moved to held`, { details: { id } });
    }
    const held = await getOrCreateAccount('agent', row.agentId, 'held', 'cash', tx);
    const posted = await postTxn(tx, {
      type: 'payout',
      refType: 'payout',
      refId: id,
      idempotencyKey: `payout:${id}`,
      actorAgentId: null,
      entries: [
        { accountId: held.id, amountMicros: -row.amountMicros },
        { accountId: SYSTEM_ACCOUNTS.payout_clearing.id, amountMicros: row.amountMicros },
      ],
    });
    const now = new Date();
    const [updated] = await tx
      .update(payoutRequests)
      .set({ status: 'paid', payoutTxnId: posted.txn.id, note: withAdminNote(row.note, note), resolvedAt: now, updatedAt: now })
      .where(eq(payoutRequests.id, id))
      .returning();
    return updated;
  });
}

/**
 * pending | approved -> rejected: posts a `refund` txn agent cash held ->
 * cash available (refType payout, idempotency key `payout-refund:<id>`).
 * 404 not_found, 409 invalid_state, 503 ledger_frozen.
 */
export async function rejectPayout(id: string, note?: string | null): Promise<PayoutRow> {
  return db.transaction(async (tx) => {
    await lockLedger(tx);
    const row = await lockPayout(tx, id);
    assertStatus(row, ['pending', 'approved'], 'reject');
    if (row.holdTxnId) {
      const held = await getOrCreateAccount('agent', row.agentId, 'held', 'cash', tx);
      const available = await getOrCreateAccount('agent', row.agentId, 'available', 'cash', tx);
      await postTxn(tx, {
        type: 'refund',
        refType: 'payout',
        refId: id,
        idempotencyKey: `payout-refund:${id}`,
        actorAgentId: null,
        entries: [
          { accountId: held.id, amountMicros: -row.amountMicros },
          { accountId: available.id, amountMicros: row.amountMicros },
        ],
      });
    }
    const now = new Date();
    const [updated] = await tx
      .update(payoutRequests)
      .set({ status: 'rejected', note: withAdminNote(row.note, note), resolvedAt: now, updatedAt: now })
      .where(eq(payoutRequests.id, id))
      .returning();
    return updated;
  });
}

export async function getPayout(id: string): Promise<PayoutRow | null> {
  const [row] = await db.select().from(payoutRequests).where(eq(payoutRequests.id, id));
  return row ?? null;
}

/** Payout requests newest first, optionally filtered by status and agent. limit 1..500, default 200. */
export async function listPayouts(status?: PayoutStatus, opts: { agentId?: string; limit?: number } = {}): Promise<PayoutRow[]> {
  if (status !== undefined && !PAYOUT_STATUSES.includes(status)) {
    throw new AnsError('validation_error', `status must be one of ${PAYOUT_STATUSES.join(', ')}`, { details: { status } });
  }
  const conditions = [];
  if (status) conditions.push(eq(payoutRequests.status, status));
  if (opts.agentId) conditions.push(eq(payoutRequests.agentId, opts.agentId));
  const limit = Math.min(Math.max(Math.trunc(opts.limit ?? 200), 1), 500);
  return db
    .select()
    .from(payoutRequests)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(payoutRequests.createdAt), desc(payoutRequests.id))
    .limit(limit);
}
