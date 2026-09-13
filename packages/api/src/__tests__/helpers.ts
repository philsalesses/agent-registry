import { inArray, sql, eq } from 'drizzle-orm';
import { generateKeypair, toBase64, generateId } from 'ans-core';
import { db } from '../db';
import { agents, apiKeys, ledgerAccounts, ledgerEntries, ledgerTxns, requestNonces, rateLimits, idempotencyKeys } from '../db/schema';
import { getOrCreateAccount, postTxn, SYSTEM_ACCOUNTS, type PostedTxn } from '../lib/ledger';

/**
 * Shared test helpers. Every test cleans up the rows it creates; the ledger
 * is append-only, so its cleanup temporarily disables triggers (superuser on
 * the local Postgres.app instance) and only ever removes the tail it wrote.
 */

export interface TestAgent {
  id: string;
  handle: string;
  publicKey: string;
  privateKey: string;
}

export async function createTestAgent(prefix = 'test'): Promise<TestAgent> {
  const pair = await generateKeypair();
  const id = generateId('ag_', 16);
  const handle = `${prefix}-${id.slice(3, 11).toLowerCase()}`.replace(/[^a-z0-9-]/g, 'x');
  await db.insert(agents).values({
    id,
    name: `Test ${handle}`,
    handle,
    publicKey: toBase64(pair.publicKey),
    type: 'assistant',
    status: 'unknown',
  });
  return { id, handle, publicKey: toBase64(pair.publicKey), privateKey: toBase64(pair.privateKey) };
}

/** What fundCash puts in a wallet by default: $25 */
export const TEST_FUND_MICROS = 25_000_000n;

/**
 * Test money: a top-up posted to the agent's cash wallet the way a settled card
 * payment would be. Idempotent per agent, so a second call replays the first.
 */
export async function fundCash(agentId: string, amountMicros: bigint = TEST_FUND_MICROS): Promise<PostedTxn> {
  return db.transaction(async (tx) => {
    const available = await getOrCreateAccount('agent', agentId, 'available', 'cash', tx);
    return postTxn(tx, {
      type: 'topup',
      refType: 'agent',
      refId: agentId,
      idempotencyKey: `topup:test:${agentId}`,
      actorAgentId: null,
      entries: [
        { accountId: SYSTEM_ACCOUNTS.stripe_clearing.id, amountMicros: -amountMicros },
        { accountId: available.id, amountMicros },
      ],
    });
  });
}

export async function deleteTestAgents(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await db.delete(requestNonces).where(inArray(requestNonces.agentId, ids));
  await db.delete(apiKeys).where(inArray(apiKeys.agentId, ids));
  await db.delete(idempotencyKeys).where(inArray(idempotencyKeys.agentId, ids));
  await db.delete(agents).where(inArray(agents.id, ids));
}

export async function agentAccountIds(agentIds: string[]): Promise<string[]> {
  if (agentIds.length === 0) return [];
  const rows = await db.select({ id: ledgerAccounts.id }).from(ledgerAccounts).where(inArray(ledgerAccounts.ownerId, agentIds));
  return rows.map((r) => r.id);
}

/**
 * Remove ledger rows written by a test. Deletes the given txns (and their
 * entries), the given agent accounts, and recomputes system account balances
 * from the surviving entries so reconcile() stays clean.
 */
export async function purgeLedger(opts: { txnIds: string[]; accountIds: string[] }): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.execute(sql`set local session_replication_role = replica`);
    if (opts.txnIds.length > 0) {
      await tx.delete(ledgerEntries).where(inArray(ledgerEntries.txnId, opts.txnIds));
      await tx.delete(ledgerTxns).where(inArray(ledgerTxns.id, opts.txnIds));
    }
    if (opts.accountIds.length > 0) {
      await tx.delete(ledgerEntries).where(inArray(ledgerEntries.accountId, opts.accountIds));
      await tx.delete(ledgerAccounts).where(inArray(ledgerAccounts.id, opts.accountIds));
    }
    await tx.execute(sql`
      update ledger_accounts a set balance_micros = coalesce((select sum(e.amount_micros) from ledger_entries e where e.account_id = a.id), 0)
      where a.owner_type = 'system'
    `);
  });
}

export async function deleteRateLimitKeys(prefixes: string[]): Promise<void> {
  for (const p of prefixes) {
    await db.execute(sql`delete from rate_limits where key like ${p + '%'}`);
  }
}

export async function rateLimitRow(key: string) {
  const [row] = await db.select().from(rateLimits).where(eq(rateLimits.key, key));
  return row ?? null;
}

/** Parse a JSON response as any for assertions. */
export const body = (res: Response): Promise<any> => res.json() as Promise<any>;
