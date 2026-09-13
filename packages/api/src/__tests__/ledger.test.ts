import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq, inArray } from 'drizzle-orm';
import { AnsError, feeForPrice, SANDBOX_GRANT_MICROS } from 'ans-core';
import { db } from '../db';
import { ledgerAccounts, ledgerTxns } from '../db/schema';
import {
  postTxn,
  hold,
  release,
  refund,
  split,
  grantSandbox,
  balances,
  ledgerFor,
  verifyChain,
  reconcile,
  isLedgerFrozen,
  setLedgerFrozen,
  getOrCreateAccount,
  SYSTEM_ACCOUNTS,
  assertLedgerOpen,
  type PostedTxn,
} from '../lib/ledger';
import { createTestAgent, deleteTestAgents, agentAccountIds, purgeLedger, type TestAgent } from './helpers';

describe('ledger', () => {
  let client: TestAgent;
  let provider: TestAgent;
  const txnIds: string[] = [];
  const track = <T extends PostedTxn | null>(p: T): T => {
    if (p) txnIds.push(p.txn.id);
    return p;
  };

  beforeAll(async () => {
    client = await createTestAgent('ledger-c');
    provider = await createTestAgent('ledger-p');
    await setLedgerFrozen(false);
  });

  afterAll(async () => {
    await setLedgerFrozen(false);
    const accountIds = await agentAccountIds([client.id, provider.id]);
    await purgeLedger({ txnIds, accountIds });
    await deleteTestAgents([client.id, provider.id]);
  });

  it('grants sandbox credit once (idempotent) and reports balances as bigint', async () => {
    const first = track(await grantSandbox(client.id))!;
    expect(first.replayed).toBe(false);
    const again = await grantSandbox(client.id);
    expect(again.replayed).toBe(true);
    expect(again.txn.id).toBe(first.txn.id);
    const b = await balances(client.id);
    expect(b.sandbox.available).toBe(SANDBOX_GRANT_MICROS);
    expect(typeof b.sandbox.available).toBe('bigint');
    expect(b.cash.available).toBe(0n);
  });

  it('rejects unbalanced and zero entries before touching the database', async () => {
    const acc = await getOrCreateAccount('agent', client.id, 'available', 'sandbox');
    await expect(
      postTxn(db, { type: 'grant', idempotencyKey: `t:unbalanced:${client.id}`, entries: [{ accountId: SYSTEM_ACCOUNTS.sandbox_source.id, amountMicros: -5n }, { accountId: acc.id, amountMicros: 4n }] }),
    ).rejects.toThrow(/sum to zero/);
    await expect(
      postTxn(db, { type: 'grant', idempotencyKey: `t:zero:${client.id}`, entries: [{ accountId: SYSTEM_ACCOUNTS.sandbox_source.id, amountMicros: 0n }, { accountId: acc.id, amountMicros: 0n }] }),
    ).rejects.toThrow(/cannot be zero/);
  });

  it('refuses to take an agent account negative with 402 insufficient_credit', async () => {
    const receipt = { id: `rc_test_${client.id}`, clientId: client.id, providerId: provider.id, priceMicros: SANDBOX_GRANT_MICROS + 1n, creditClass: 'sandbox' as const, feeBps: 300 };
    let err: unknown;
    try {
      await hold(receipt);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(AnsError);
    expect((err as AnsError).code).toBe('insufficient_credit');
    expect((err as AnsError).status).toBe(402);
    const b = await balances(client.id);
    expect(b.sandbox.available).toBe(SANDBOX_GRANT_MICROS);
  });

  it('hold -> release moves price minus fee to the provider and the fee to fee_burn (sandbox)', async () => {
    const price = 1_234_567n; // odd number to exercise ceil rounding: fee = ceil(1234567 * 300 / 10000) = 37038
    const receipt = { id: `rc_rel_${client.id}`, clientId: client.id, providerId: provider.id, priceMicros: price, creditClass: 'sandbox' as const, feeBps: 300 };
    const fee = feeForPrice(price, 300);
    expect(fee).toBe(37_038n);

    const [burnBefore] = await db.select().from(ledgerAccounts).where(eq(ledgerAccounts.id, SYSTEM_ACCOUNTS.fee_burn.id));

    track(await hold(receipt));
    let b = await balances(client.id);
    expect(b.sandbox.available).toBe(SANDBOX_GRANT_MICROS - price);
    expect(b.sandbox.held).toBe(price);

    // hold is idempotent per receipt
    const again = track(await release(receipt))!;
    expect(again.replayed).toBe(false);
    const replay = await release(receipt);
    expect(replay!.replayed).toBe(true);

    b = await balances(client.id);
    expect(b.sandbox.held).toBe(0n);
    const p = await balances(provider.id);
    expect(p.sandbox.available).toBe(price - fee);
    const [burnAfter] = await db.select().from(ledgerAccounts).where(eq(ledgerAccounts.id, SYSTEM_ACCOUNTS.fee_burn.id));
    expect(burnAfter.balanceMicros - burnBefore.balanceMicros).toBe(fee);
    expect(again.entries).toHaveLength(3);
    expect(again.entries.reduce((s, e) => s + e.amountMicros, 0n)).toBe(0n);
  });

  it('hold -> refund returns the full price to the client', async () => {
    const price = 500_000n;
    const receipt = { id: `rc_ref_${client.id}`, clientId: client.id, providerId: provider.id, priceMicros: price, creditClass: 'sandbox' as const, feeBps: 300 };
    const before = await balances(client.id);
    track(await hold(receipt));
    track(await refund(receipt));
    const after = await balances(client.id);
    expect(after.sandbox.available).toBe(before.sandbox.available);
    expect(after.sandbox.held).toBe(0n);
  });

  it('hold -> split charges the fee on the whole and halves the remainder', async () => {
    const price = 1_000_001n; // fee = ceil(300.0003) = 30001; remainder 970000 -> 485000 each
    const receipt = { id: `rc_split_${client.id}`, clientId: client.id, providerId: provider.id, priceMicros: price, creditClass: 'sandbox' as const, feeBps: 300 };
    const fee = feeForPrice(price, 300);
    expect(fee).toBe(30_001n);
    const cBefore = await balances(client.id);
    const pBefore = await balances(provider.id);
    track(await hold(receipt));
    const posted = track(await split(receipt))!;
    const cAfter = await balances(client.id);
    const pAfter = await balances(provider.id);
    const remainder = price - fee;
    expect(pAfter.sandbox.available - pBefore.sandbox.available).toBe(remainder / 2n);
    expect(cBefore.sandbox.available - cAfter.sandbox.available).toBe(price - (remainder - remainder / 2n));
    expect(cAfter.sandbox.held).toBe(0n);
    expect(posted.entries.reduce((s, e) => s + e.amountMicros, 0n)).toBe(0n);
  });

  it('free receipts (price 0 or class none) post nothing', async () => {
    expect(await hold({ id: 'rc_free', clientId: client.id, providerId: provider.id, priceMicros: 0n, creditClass: 'sandbox', feeBps: 300 })).toBeNull();
    expect(await release({ id: 'rc_free', clientId: client.id, providerId: provider.id, priceMicros: 100n, creditClass: 'none', feeBps: 300 })).toBeNull();
  });

  it('keeps a continuous hash chain and lists the agent ledger newest first', async () => {
    const chain = await verifyChain();
    expect(chain.ok).toBe(true);
    expect(chain.checked).toBeGreaterThanOrEqual(txnIds.length);

    const page = await ledgerFor(client.id, null, 3);
    expect(page.txns.length).toBe(3);
    expect(BigInt(page.txns[0].seq) > BigInt(page.txns[1].seq)).toBe(true);
    expect(page.nextCursor).not.toBeNull();
    const next = await ledgerFor(client.id, page.nextCursor, 50);
    expect(next.txns.every((t) => BigInt(t.seq) < BigInt(page.nextCursor!))).toBe(true);
    for (const t of [...page.txns, ...next.txns]) {
      expect(t.entries.reduce((s, e) => s + BigInt(e.amountMicros), 0n)).toBe(0n);
    }

    // every txn we posted points at the hash of the one before it
    const ours = await db.select().from(ledgerTxns).where(inArray(ledgerTxns.id, txnIds)).orderBy(ledgerTxns.seq);
    for (let i = 1; i < ours.length; i++) {
      if (ours[i].seq - ours[i - 1].seq === 1n) expect(ours[i].prevHash).toBe(ours[i - 1].hash);
    }
  });

  it('the database refuses updates and deletes on ledger rows', async () => {
    await expect(db.update(ledgerTxns).set({ type: 'topup' }).where(eq(ledgerTxns.id, txnIds[0]))).rejects.toThrow(/append-only/);
    await expect(db.delete(ledgerTxns).where(eq(ledgerTxns.id, txnIds[0]))).rejects.toThrow(/append-only/);
  });

  it('reconcile detects a tampered balance, freezes the ledger, and postTxn answers 503 ledger_frozen', async () => {
    const clean = await reconcile();
    expect(clean.ok).toBe(true);
    expect(await isLedgerFrozen()).toBe(false);

    const acc = await getOrCreateAccount('agent', provider.id, 'available', 'sandbox');
    await db.update(ledgerAccounts).set({ balanceMicros: acc.balanceMicros + 1n }).where(eq(ledgerAccounts.id, acc.id));
    try {
      const bad = await reconcile();
      expect(bad.ok).toBe(false);
      expect(bad.frozen).toBe(true);
      expect(bad.mismatches.map((m) => m.accountId)).toContain(acc.id);
      expect(await isLedgerFrozen()).toBe(true);
      await expect(assertLedgerOpen()).rejects.toMatchObject({ code: 'ledger_frozen', status: 503 });
      await expect(grantSandbox(provider.id)).rejects.toMatchObject({ code: 'ledger_frozen' });
    } finally {
      await db.update(ledgerAccounts).set({ balanceMicros: acc.balanceMicros }).where(eq(ledgerAccounts.id, acc.id));
      await setLedgerFrozen(false);
    }
    const fixed = await reconcile();
    expect(fixed.ok).toBe(true);
    expect(await isLedgerFrozen()).toBe(false);
  });
});
