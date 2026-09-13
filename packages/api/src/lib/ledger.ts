import { and, asc, desc, eq, gt, inArray, lt, sql } from 'drizzle-orm';
import { AnsError, canonicalize, feeForPrice, generateId, sha256hex, type CreditClass } from 'ans-core';
import { db } from '../db';
import {
  ledgerAccounts,
  ledgerEntries,
  ledgerTxns,
  systemFlags,
  type LedgerClass,
  type LedgerKind,
  type LedgerOwnerType,
  type LedgerTxnType,
} from '../db/schema';
import { alert } from './alerts';

/**
 * Double-entry, append-only ledger in integer USD micros (docs/DESIGN.md section 6).
 *
 * All amounts are bigint end to end. drizzle maps bigint columns to JS bigint
 * on typed queries; raw `db.execute` rows return int8 as strings and are
 * converted explicitly with `toBig`.
 */

export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type DbClient = typeof db | Tx;

export type LedgerAccountRow = typeof ledgerAccounts.$inferSelect;
export type LedgerTxnRow = typeof ledgerTxns.$inferSelect;
export type LedgerEntryRow = typeof ledgerEntries.$inferSelect;

export const LEDGER_LOCK_KEY = 7;

/**
 * Fixed ids of the system accounts inserted by migration 0007. Its two sandbox
 * accounts (acc_sys_sandbox_source, acc_sys_fee_burn) are unused: there is no
 * sandbox credit, only cash.
 */
export const SYSTEM_ACCOUNTS = {
  fee_revenue: { id: 'acc_sys_fee_revenue', kind: 'available', klass: 'cash' },
  stripe_clearing: { id: 'acc_sys_stripe_clearing', kind: 'available', klass: 'cash' },
  payout_clearing: { id: 'acc_sys_payout_clearing', kind: 'available', klass: 'cash' },
} as const satisfies Record<string, { id: string; kind: LedgerKind; klass: LedgerClass }>;

export type SystemAccountName = keyof typeof SYSTEM_ACCOUNTS;

export function systemAccountId(name: SystemAccountName): string {
  return SYSTEM_ACCOUNTS[name].id;
}

export function toBig(v: bigint | string | number | null | undefined): bigint {
  if (typeof v === 'bigint') return v;
  if (v === null || v === undefined) return 0n;
  return BigInt(v);
}

function isTx(client: DbClient): client is Tx {
  return client !== db && typeof (client as { rollback?: unknown }).rollback === 'function';
}

/** Run fn inside `client` if it is already a transaction, else open one. */
export function inTransaction<T>(client: DbClient, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return isTx(client) ? fn(client) : client.transaction(fn);
}

// ---------------------------------------------------------------------------
// Freeze flag
// ---------------------------------------------------------------------------

export async function isLedgerFrozen(client: DbClient = db): Promise<boolean> {
  const row = await client.select({ value: systemFlags.value }).from(systemFlags).where(eq(systemFlags.key, 'ledger_frozen'));
  return row[0]?.value === true;
}

export async function setLedgerFrozen(frozen: boolean, client: DbClient = db): Promise<void> {
  await client
    .insert(systemFlags)
    .values({ key: 'ledger_frozen', value: frozen, updatedAt: new Date() })
    .onConflictDoUpdate({ target: systemFlags.key, set: { value: frozen, updatedAt: new Date() } });
}

/** Throws 503 ledger_frozen when reconciliation has frozen the ledger. */
export async function assertLedgerOpen(client: DbClient = db): Promise<void> {
  if (await isLedgerFrozen(client)) {
    throw new AnsError('ledger_frozen', 'The ledger is frozen pending reconciliation; money endpoints are unavailable', {
      fix: { docs: 'https://ans-registry.org/docs/money' },
    });
  }
}

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------

export async function getOrCreateAccount(
  ownerType: LedgerOwnerType,
  ownerId: string,
  kind: LedgerKind,
  klass: LedgerClass,
  client: DbClient = db,
): Promise<LedgerAccountRow> {
  const where = and(
    eq(ledgerAccounts.ownerType, ownerType),
    eq(ledgerAccounts.ownerId, ownerId),
    eq(ledgerAccounts.kind, kind),
    eq(ledgerAccounts.klass, klass),
  );
  const existing = await client.select().from(ledgerAccounts).where(where);
  if (existing[0]) return existing[0];
  await client
    .insert(ledgerAccounts)
    .values({ id: generateId('acc_', 16), ownerType, ownerId, kind, klass, balanceMicros: 0n })
    .onConflictDoNothing();
  const created = await client.select().from(ledgerAccounts).where(where);
  return created[0];
}

/** The agent's two cash accounts, created on demand. */
export async function agentAccounts(agentId: string, client: DbClient = db) {
  const [cashAvailable, cashHeld] = await Promise.all([
    getOrCreateAccount('agent', agentId, 'available', 'cash', client),
    getOrCreateAccount('agent', agentId, 'held', 'cash', client),
  ]);
  return { cashAvailable, cashHeld };
}

// ---------------------------------------------------------------------------
// postTxn
// ---------------------------------------------------------------------------

export interface PostEntry {
  accountId: string;
  amountMicros: bigint;
}

export interface PostTxnInput {
  type: LedgerTxnType;
  refType?: string | null;
  refId?: string | null;
  idempotencyKey: string;
  actorAgentId?: string | null;
  entries: PostEntry[];
  /** for tests and admin reversals: post even while frozen */
  ignoreFreeze?: boolean;
}

export interface PostedTxn {
  txn: LedgerTxnRow;
  entries: LedgerEntryRow[];
  /** true when the idempotency key had already been posted and the stored txn was returned */
  replayed: boolean;
}

function canonicalEntries(entries: PostEntry[]): string {
  const rows = entries
    .map((e) => ({ accountId: e.accountId, amountMicros: e.amountMicros.toString() }))
    .sort((a, b) => (a.accountId === b.accountId ? a.amountMicros.localeCompare(b.amountMicros) : a.accountId < b.accountId ? -1 : 1));
  return canonicalize(rows);
}

/** hash = sha256(prev_hash | id | type | canonical entries | created_at ISO) */
export function txnHash(input: { prevHash: string | null; id: string; type: string; entries: PostEntry[]; createdAt: Date }): string {
  return sha256hex([input.prevHash ?? '', input.id, input.type, canonicalEntries(input.entries), input.createdAt.toISOString()].join('|'));
}

/** Second precision so the stored timestamp round-trips through drizzle exactly. */
function chainNow(): Date {
  return new Date(Math.floor(Date.now() / 1000) * 1000);
}

/**
 * Post one balanced transaction: SELECT FOR UPDATE on the touched accounts
 * ordered by id, refuse negative agent balances, insert txn and entries,
 * update balances, hash-chain under pg_advisory_xact_lock(7).
 * Idempotent on idempotencyKey (the stored txn is returned).
 */
export async function postTxn(client: DbClient, input: PostTxnInput): Promise<PostedTxn> {
  if (input.entries.length < 2) throw new AnsError('bad_request', 'A ledger txn needs at least two entries');
  for (const e of input.entries) {
    if (typeof e.amountMicros !== 'bigint') throw new AnsError('bad_request', 'amountMicros must be bigint');
    if (e.amountMicros === 0n) throw new AnsError('bad_request', 'Ledger entries cannot be zero');
  }
  const sum = input.entries.reduce((acc, e) => acc + e.amountMicros, 0n);
  if (sum !== 0n) throw new AnsError('bad_request', `Ledger entries must sum to zero (got ${sum})`);

  return inTransaction(client, async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(${LEDGER_LOCK_KEY})`);
    if (!input.ignoreFreeze) await assertLedgerOpen(tx);

    const existing = await tx.select().from(ledgerTxns).where(eq(ledgerTxns.idempotencyKey, input.idempotencyKey));
    if (existing[0]) {
      const entries = await tx.select().from(ledgerEntries).where(eq(ledgerEntries.txnId, existing[0].id)).orderBy(asc(ledgerEntries.id));
      return { txn: existing[0], entries, replayed: true };
    }

    const deltas = new Map<string, bigint>();
    for (const e of input.entries) deltas.set(e.accountId, (deltas.get(e.accountId) ?? 0n) + e.amountMicros);
    const ids = Array.from(deltas.keys()).sort();

    const locked = await tx.select().from(ledgerAccounts).where(inArray(ledgerAccounts.id, ids)).orderBy(asc(ledgerAccounts.id)).for('update');
    if (locked.length !== ids.length) {
      const found = new Set(locked.map((a) => a.id));
      throw new AnsError('bad_request', `Unknown ledger account ${ids.filter((id) => !found.has(id)).join(', ')}`);
    }
    for (const account of locked) {
      const next = account.balanceMicros + (deltas.get(account.id) ?? 0n);
      if (account.ownerType === 'agent' && next < 0n) {
        throw new AnsError('insufficient_credit', 'Not enough money in the wallet', {
          details: {
            accountId: account.id,
            ownerId: account.ownerId,
            kind: account.kind,
            klass: account.klass,
            have: account.balanceMicros.toString(),
            need: (-(deltas.get(account.id) ?? 0n)).toString(),
          },
          fix: { url: 'https://ans-registry.org/wallet', docs: 'https://ans-registry.org/docs/money', next: 'Add money to the wallet at /wallet' },
        });
      }
    }

    const head = await tx.select({ hash: ledgerTxns.hash }).from(ledgerTxns).orderBy(desc(ledgerTxns.seq)).limit(1);
    const prevHash = head[0]?.hash ?? null;
    const id = generateId('ltx_', 16);
    const createdAt = chainNow();
    const hash = txnHash({ prevHash, id, type: input.type, entries: input.entries, createdAt });

    const [txn] = await tx
      .insert(ledgerTxns)
      .values({
        id,
        type: input.type,
        refType: input.refType ?? null,
        refId: input.refId ?? null,
        idempotencyKey: input.idempotencyKey,
        actorAgentId: input.actorAgentId ?? null,
        prevHash,
        hash,
        createdAt,
      })
      .returning();

    const entries = await tx
      .insert(ledgerEntries)
      .values(input.entries.map((e) => ({ id: generateId('le_', 16), txnId: id, accountId: e.accountId, amountMicros: e.amountMicros, createdAt })))
      .returning();

    for (const [accountId, delta] of deltas) {
      await tx.update(ledgerAccounts).set({ balanceMicros: sql`${ledgerAccounts.balanceMicros} + ${delta.toString()}::bigint` }).where(eq(ledgerAccounts.id, accountId));
    }

    return { txn, entries, replayed: false };
  });
}

// ---------------------------------------------------------------------------
// Receipt money movements (section 6 "Escrow")
// ---------------------------------------------------------------------------

/** The receipt fields the escrow functions need. */
export interface ReceiptMoney {
  id: string;
  clientId: string | null;
  providerId: string | null;
  priceMicros: bigint | string;
  creditClass: CreditClass;
  feeBps: number;
}

function klassOf(r: ReceiptMoney): LedgerClass | null {
  return r.creditClass === 'cash' ? 'cash' : null;
}

/** Fee for a receipt with its frozen fee_bps (ceil). */
export function receiptFee(r: Pick<ReceiptMoney, 'priceMicros' | 'feeBps'>): bigint {
  return feeForPrice(toBig(r.priceMicros), r.feeBps);
}

function needsMoney(r: ReceiptMoney): r is ReceiptMoney & { clientId: string; providerId: string } {
  return toBig(r.priceMicros) > 0n && klassOf(r) !== null;
}

/** hold: client available -> client held (same class). Null for free receipts. */
export async function hold(receipt: ReceiptMoney, client: DbClient = db): Promise<PostedTxn | null> {
  if (!needsMoney(receipt)) return null;
  if (!receipt.clientId) throw new AnsError('bad_request', 'Cannot hold: the receipt has no client yet');
  const klass = klassOf(receipt)!;
  const price = toBig(receipt.priceMicros);
  return inTransaction(client, async (tx) => {
    const available = await getOrCreateAccount('agent', receipt.clientId!, 'available', klass, tx);
    const held = await getOrCreateAccount('agent', receipt.clientId!, 'held', klass, tx);
    return postTxn(tx, {
      type: 'hold',
      refType: 'receipt',
      refId: receipt.id,
      idempotencyKey: `hold:${receipt.id}`,
      actorAgentId: receipt.clientId,
      entries: [
        { accountId: available.id, amountMicros: -price },
        { accountId: held.id, amountMicros: price },
      ],
    });
  });
}

/** release: client held -> provider available (price - fee), fee -> fee_revenue. */
export async function release(receipt: ReceiptMoney, client: DbClient = db): Promise<PostedTxn | null> {
  if (!needsMoney(receipt)) return null;
  if (!receipt.clientId || !receipt.providerId) throw new AnsError('bad_request', 'Cannot release: both parties must be bound');
  const klass = klassOf(receipt)!;
  const price = toBig(receipt.priceMicros);
  const fee = receiptFee(receipt);
  return inTransaction(client, async (tx) => {
    const held = await getOrCreateAccount('agent', receipt.clientId!, 'held', klass, tx);
    const providerAvailable = await getOrCreateAccount('agent', receipt.providerId!, 'available', klass, tx);
    const entries: PostEntry[] = [
      { accountId: held.id, amountMicros: -price },
      { accountId: providerAvailable.id, amountMicros: price - fee },
    ];
    if (fee > 0n) entries.push({ accountId: SYSTEM_ACCOUNTS.fee_revenue.id, amountMicros: fee });
    return postTxn(tx, { type: 'release', refType: 'receipt', refId: receipt.id, idempotencyKey: `release:${receipt.id}`, actorAgentId: receipt.providerId, entries });
  });
}

/** refund: client held -> client available, in full. */
export async function refund(receipt: ReceiptMoney, client: DbClient = db): Promise<PostedTxn | null> {
  if (!needsMoney(receipt)) return null;
  if (!receipt.clientId) throw new AnsError('bad_request', 'Cannot refund: the receipt has no client');
  const klass = klassOf(receipt)!;
  const price = toBig(receipt.priceMicros);
  return inTransaction(client, async (tx) => {
    const held = await getOrCreateAccount('agent', receipt.clientId!, 'held', klass, tx);
    const available = await getOrCreateAccount('agent', receipt.clientId!, 'available', klass, tx);
    return postTxn(tx, {
      type: 'refund',
      refType: 'receipt',
      refId: receipt.id,
      idempotencyKey: `refund:${receipt.id}`,
      actorAgentId: receipt.clientId,
      entries: [
        { accountId: held.id, amountMicros: -price },
        { accountId: available.id, amountMicros: price },
      ],
    });
  });
}

/**
 * split: fee on the whole price; the remainder is halved, the provider gets
 * floor((price - fee) / 2) and the client gets the rest back.
 */
export async function split(receipt: ReceiptMoney, client: DbClient = db): Promise<PostedTxn | null> {
  if (!needsMoney(receipt)) return null;
  if (!receipt.clientId || !receipt.providerId) throw new AnsError('bad_request', 'Cannot split: both parties must be bound');
  const klass = klassOf(receipt)!;
  const price = toBig(receipt.priceMicros);
  const fee = receiptFee(receipt);
  const remainder = price - fee;
  const providerShare = remainder / 2n;
  const clientShare = remainder - providerShare;
  return inTransaction(client, async (tx) => {
    const held = await getOrCreateAccount('agent', receipt.clientId!, 'held', klass, tx);
    const clientAvailable = await getOrCreateAccount('agent', receipt.clientId!, 'available', klass, tx);
    const providerAvailable = await getOrCreateAccount('agent', receipt.providerId!, 'available', klass, tx);
    const entries: PostEntry[] = [{ accountId: held.id, amountMicros: -price }];
    if (providerShare > 0n) entries.push({ accountId: providerAvailable.id, amountMicros: providerShare });
    if (clientShare > 0n) entries.push({ accountId: clientAvailable.id, amountMicros: clientShare });
    if (fee > 0n) entries.push({ accountId: SYSTEM_ACCOUNTS.fee_revenue.id, amountMicros: fee });
    return postTxn(tx, { type: 'split', refType: 'receipt', refId: receipt.id, idempotencyKey: `split:${receipt.id}`, actorAgentId: null, entries });
  });
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export interface Balances {
  cash: { available: bigint; held: bigint };
}

export async function balances(agentId: string, client: DbClient = db): Promise<Balances> {
  const rows = await client.select().from(ledgerAccounts).where(and(eq(ledgerAccounts.ownerType, 'agent'), eq(ledgerAccounts.ownerId, agentId)));
  const out: Balances = { cash: { available: 0n, held: 0n } };
  for (const r of rows) if (r.klass === 'cash') out.cash[r.kind] = r.balanceMicros;
  return out;
}

export function serializeBalances(b: Balances): { cash: { available: string; held: string } } {
  return {
    cash: { available: b.cash.available.toString(), held: b.cash.held.toString() },
  };
}

export interface LedgerEntryView {
  accountId: string;
  ownerType: LedgerOwnerType;
  ownerId: string;
  kind: LedgerKind;
  klass: LedgerClass;
  amountMicros: string;
}

export interface LedgerTxnView {
  id: string;
  seq: string;
  type: LedgerTxnType;
  refType: string | null;
  refId: string | null;
  actorAgentId: string | null;
  prevHash: string | null;
  hash: string;
  createdAt: string;
  entries: LedgerEntryView[];
}

/** Txns touching the agent's accounts, newest first. Cursor is the last seq seen. API-ready (amounts as strings). */
export async function ledgerFor(agentId: string, cursor?: string | null, limit: number = 50): Promise<{ txns: LedgerTxnView[]; nextCursor: string | null }> {
  const accounts = await db.select({ id: ledgerAccounts.id }).from(ledgerAccounts).where(and(eq(ledgerAccounts.ownerType, 'agent'), eq(ledgerAccounts.ownerId, agentId)));
  if (accounts.length === 0) return { txns: [], nextCursor: null };
  const accountIds = accounts.map((a) => a.id);
  const cursorSeq = cursor ? toBig(cursor) : null;
  const take = Math.min(Math.max(limit, 1), 200);

  const txnRows = await db
    .selectDistinct({ txn: ledgerTxns })
    .from(ledgerTxns)
    .innerJoin(ledgerEntries, eq(ledgerEntries.txnId, ledgerTxns.id))
    .where(cursorSeq === null ? inArray(ledgerEntries.accountId, accountIds) : and(inArray(ledgerEntries.accountId, accountIds), lt(ledgerTxns.seq, cursorSeq)))
    .orderBy(desc(ledgerTxns.seq))
    .limit(take + 1);

  const page = txnRows.slice(0, take).map((r) => r.txn);
  const nextCursor = txnRows.length > take ? page[page.length - 1].seq.toString() : null;
  if (page.length === 0) return { txns: [], nextCursor: null };

  const entryRows = await db
    .select({ entry: ledgerEntries, account: ledgerAccounts })
    .from(ledgerEntries)
    .innerJoin(ledgerAccounts, eq(ledgerAccounts.id, ledgerEntries.accountId))
    .where(inArray(ledgerEntries.txnId, page.map((t) => t.id)))
    .orderBy(asc(ledgerEntries.id));

  const byTxn = new Map<string, LedgerEntryView[]>();
  for (const { entry, account } of entryRows) {
    const list = byTxn.get(entry.txnId) ?? [];
    list.push({ accountId: account.id, ownerType: account.ownerType, ownerId: account.ownerId, kind: account.kind, klass: account.klass, amountMicros: entry.amountMicros.toString() });
    byTxn.set(entry.txnId, list);
  }

  return {
    txns: page.map((t) => ({
      id: t.id,
      seq: t.seq.toString(),
      type: t.type,
      refType: t.refType,
      refId: t.refId,
      actorAgentId: t.actorAgentId,
      prevHash: t.prevHash,
      hash: t.hash,
      createdAt: t.createdAt.toISOString(),
      entries: byTxn.get(t.id) ?? [],
    })),
    nextCursor,
  };
}

// ---------------------------------------------------------------------------
// Chain verification and reconciliation
// ---------------------------------------------------------------------------

export interface ChainVerifyResult {
  ok: boolean;
  checked: number;
  breakAt?: { id: string; seq: string; reason: string };
}

/** Recompute every txn hash in seq order and check prev_hash continuity. */
export async function verifyChain(client: DbClient = db): Promise<ChainVerifyResult> {
  const batch = 1000;
  let after = -1n;
  let prevHash: string | null = null;
  let checked = 0;
  for (;;) {
    const txns = await client.select().from(ledgerTxns).where(gt(ledgerTxns.seq, after)).orderBy(asc(ledgerTxns.seq)).limit(batch);
    if (txns.length === 0) break;
    const entries = await client.select().from(ledgerEntries).where(inArray(ledgerEntries.txnId, txns.map((t) => t.id)));
    const byTxn = new Map<string, PostEntry[]>();
    for (const e of entries) {
      const list = byTxn.get(e.txnId) ?? [];
      list.push({ accountId: e.accountId, amountMicros: e.amountMicros });
      byTxn.set(e.txnId, list);
    }
    for (const t of txns) {
      if ((t.prevHash ?? null) !== prevHash) {
        return { ok: false, checked, breakAt: { id: t.id, seq: t.seq.toString(), reason: 'prev_hash does not match the previous txn' } };
      }
      const expected = txnHash({ prevHash, id: t.id, type: t.type, entries: byTxn.get(t.id) ?? [], createdAt: t.createdAt });
      if (expected !== t.hash) {
        return { ok: false, checked, breakAt: { id: t.id, seq: t.seq.toString(), reason: 'hash does not match its contents' } };
      }
      prevHash = t.hash;
      checked += 1;
      after = t.seq;
    }
    if (txns.length < batch) break;
  }
  return { ok: true, checked };
}

export interface ReconcileResult {
  ok: boolean;
  checkedAccounts: number;
  mismatches: { accountId: string; balance: string; computed: string }[];
  chain: ChainVerifyResult;
  frozen: boolean;
}

/**
 * Nightly: recompute SUM(entries) per account and compare to balances, and
 * verify the hash chain. On any mismatch set system_flags.ledger_frozen and alert.
 */
export async function reconcile(): Promise<ReconcileResult> {
  const rows = await db.execute(sql`
    select a.id, a.balance_micros::text as balance, coalesce(sum(e.amount_micros), 0)::text as computed
    from ledger_accounts a
    left join ledger_entries e on e.account_id = a.id
    group by a.id, a.balance_micros
  `);
  const mismatches: ReconcileResult['mismatches'] = [];
  for (const r of rows as unknown as { id: string; balance: string; computed: string }[]) {
    if (toBig(r.balance) !== toBig(r.computed)) mismatches.push({ accountId: r.id, balance: r.balance, computed: r.computed });
  }
  const chain = await verifyChain();
  const ok = mismatches.length === 0 && chain.ok;
  let frozen = await isLedgerFrozen();
  if (!ok) {
    await setLedgerFrozen(true);
    frozen = true;
    await alert('LEDGER FROZEN: reconciliation mismatch', { mismatches, chain });
  }
  return { ok, checkedAccounts: rows.length, mismatches, chain, frozen };
}
