import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { Hono } from 'hono';
import { requestId } from 'hono/request-id';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { PAYOUT_HOLD_DAYS, feeForPrice, signRequest } from 'ans-core';
import { db } from '../db';
import { agents, ledgerEntries, ledgerTxns, notifications, offers, payoutRequests } from '../db/schema';
import { onError } from '../lib/errors';
import { createSessionToken } from '../lib/auth';
import { alert } from '../lib/alerts';
import { SYSTEM_ACCOUNTS, balances, getOrCreateAccount, hold, postTxn, release, setLedgerFrozen, verifyChain } from '../lib/ledger';
import {
  approvePayout,
  getPayout,
  listPayouts,
  markPayoutPaid,
  payoutEligibility,
  rejectPayout,
  requestPayout,
  type PayoutStatus,
} from '../lib/payouts';
import { SHORTFALL_FLAG_PREFIX } from '../lib/rails-stripe';
import { createWalletRouter, walletRouter } from '../routes/wallet';
import { agentAccountIds, createTestAgent, deleteTestAgents, purgeLedger, body as parse, type TestAgent } from './helpers';

vi.mock('../lib/alerts', () => ({ alert: vi.fn(async () => undefined) }));

const DAY_MS = 86_400_000;
const PRICE = 20_000_000n;
const FEE_BPS = 50;
const EARNED = PRICE - feeForPrice(PRICE, FEE_BPS); // 19_900_000

async function cleanupAgents(agentIds: string[]): Promise<void> {
  if (agentIds.length === 0) return;
  const accountIds = await agentAccountIds(agentIds);
  const txnIds = accountIds.length
    ? (await db.selectDistinct({ id: ledgerEntries.txnId }).from(ledgerEntries).where(inArray(ledgerEntries.accountId, accountIds))).map((r) => r.id)
    : [];
  await purgeLedger({ txnIds, accountIds });
  await db.delete(payoutRequests).where(inArray(payoutRequests.agentId, agentIds));
  await db.delete(notifications).where(inArray(notifications.agentId, agentIds));
  await db.delete(offers).where(inArray(offers.agentId, agentIds));
  for (const id of agentIds) {
    const prefix = `${SHORTFALL_FLAG_PREFIX}${id}:`;
    await db.execute(sql`delete from system_flags where left(key, ${prefix.length}) = ${prefix}`);
  }
  await deleteTestAgents(agentIds);
}

function testApp(wallet: Hono) {
  const app = new Hono();
  app.use('*', requestId());
  app.route('/v1/wallet', wallet);
  app.onError(onError);
  return app;
}

async function session(agent: TestAgent, extra: Record<string, string> = {}) {
  return { Authorization: `Bearer ${await createSessionToken(agent.id)}`, 'Content-Type': 'application/json', ...extra };
}

async function txnByKey(key: string) {
  const [txn] = await db.select().from(ledgerTxns).where(eq(ledgerTxns.idempotencyKey, key));
  if (!txn) return null;
  const entries = await db.select().from(ledgerEntries).where(eq(ledgerEntries.txnId, txn.id));
  return { txn, entries };
}

describe('payouts', () => {
  let client: TestAgent;
  let provider: TestAgent;
  let bare: TestAgent;
  const agentIds: string[] = [];
  /** a clock past the 14-day hold for everything posted during this test run */
  const future = () => new Date(Date.now() + (PAYOUT_HOLD_DAYS + 1) * DAY_MS);

  beforeAll(async () => {
    await setLedgerFrozen(false);
    client = await createTestAgent('payout-c');
    provider = await createTestAgent('payout-p');
    bare = await createTestAgent('payout-b');
    agentIds.push(client.id, provider.id, bare.id);
    await db
      .update(agents)
      .set({ paymentMethods: [{ type: 'lightning', address: 'provider@example.com', label: 'main' }, { type: 'usdc', address: '0x00000000000000000000000000000000000000aa' }] })
      .where(eq(agents.id, provider.id));

    // The client buys $50 of cash, pays the provider $20 through escrow; the provider earns $19.90 after the 0.5% fee.
    const clientAvailable = await getOrCreateAccount('agent', client.id, 'available', 'cash');
    await postTxn(db, {
      type: 'topup',
      refType: 'test',
      refId: client.id,
      idempotencyKey: `test:payouts:topup:${client.id}`,
      entries: [
        { accountId: SYSTEM_ACCOUNTS.stripe_clearing.id, amountMicros: -50_000_000n },
        { accountId: clientAvailable.id, amountMicros: 50_000_000n },
      ],
    });
    const receipt = { id: `rc_payouts_${provider.id}`, clientId: client.id, providerId: provider.id, priceMicros: PRICE, creditClass: 'cash' as const, feeBps: FEE_BPS };
    await hold(receipt);
    await release(receipt);
  });

  afterAll(async () => {
    await setLedgerFrozen(false);
    await cleanupAgents(agentIds);
  });

  beforeEach(() => {
    vi.mocked(alert).mockClear();
  });

  it('holds back cash credited in the last 14 days: releases and top-ups are not payout-eligible yet', async () => {
    const p = await payoutEligibility(provider.id);
    expect(p.cashAvailableMicros).toBe(EARNED);
    expect(p.heldBackMicros).toBe(EARNED);
    expect(p.eligibleMicros).toBe(0n);
    expect((await payoutEligibility(provider.id, { now: future() })).eligibleMicros).toBe(EARNED);

    const c = await payoutEligibility(client.id);
    expect(c.cashAvailableMicros).toBe(30_000_000n);
    expect(c.eligibleMicros).toBe(0n); // the $50 top-up is inside the window
    expect((await payoutEligibility(client.id, { now: future() })).eligibleMicros).toBe(30_000_000n);

    const none = await payoutEligibility(bare.id);
    expect(none).toMatchObject({ cashAvailableMicros: 0n, eligibleMicros: 0n, holdDays: PAYOUT_HOLD_DAYS });

    const app = testApp(walletRouter);
    const wallet = await parse(await app.request('/v1/wallet', { headers: await session(provider) }));
    expect(wallet.cash).toEqual({ available: EARNED.toString(), held: '0' });
    expect(wallet.payoutEligibleMicros).toBe('0');
  });

  it('POST /v1/wallet/payout-request validates the body and the destination, and answers 402 above eligibility', async () => {
    const app = testApp(walletRouter);
    const post = async (agent: TestAgent, body: unknown) =>
      app.request('/v1/wallet/payout-request', { method: 'POST', headers: await session(agent), body: JSON.stringify(body) });

    const tooMuch = await post(provider, { amountMicros: '1000000', destinationIndex: 0 });
    expect(tooMuch.status).toBe(402);
    const tooMuchJson = await parse(tooMuch);
    expect(tooMuchJson.error).toBe('insufficient_credit');
    expect(tooMuchJson.details).toMatchObject({ requestedMicros: '1000000', eligibleMicros: '0', cashAvailableMicros: EARNED.toString(), heldBackMicros: EARNED.toString(), holdDays: 14 });
    expect(tooMuchJson.fix.docs).toBeTruthy();

    const noDestination = await post(provider, { amountMicros: '1000000', destinationIndex: 2 });
    expect(noDestination.status).toBe(400);
    expect((await parse(noDestination)).details).toEqual({ destinationIndex: 2, paymentMethods: 2 });

    const noMethods = await post(bare, { amountMicros: '1000000', destinationIndex: 0 });
    expect(noMethods.status).toBe(400);
    expect((await parse(noMethods)).message).toContain('Add a payment method');

    const missingIndex = await post(provider, { amountMicros: '1000000' });
    expect(missingIndex.status).toBe(400);
    expect((await parse(missingIndex)).error).toBe('validation_error');

    const zero = await post(provider, { amountMicros: '0', destinationIndex: 0 });
    expect(zero.status).toBe(400);
    expect((await parse(zero)).error).toBe('validation_error');

    expect(await db.select().from(payoutRequests).where(eq(payoutRequests.agentId, provider.id))).toHaveLength(0);
    expect(vi.mocked(alert)).not.toHaveBeenCalled();
    const b = await balances(provider.id);
    expect(b.cash).toEqual({ available: EARNED, held: 0n });
  });

  let firstId = '';

  it('after the hold a payout request moves cash available -> held, alerts the admin, and replays by Idempotency-Key', async () => {
    const app = testApp(createWalletRouter({ now: future }));
    const wallet = await parse(await app.request('/v1/wallet', { headers: await session(provider) }));
    expect(wallet.payoutEligibleMicros).toBe(EARNED.toString());

    const body = JSON.stringify({ amountMicros: '5000000', destinationIndex: 0, note: 'first payout' });
    const headers = await session(provider, { 'Idempotency-Key': 'payout-1' });
    const res = await app.request('/v1/wallet/payout-request', { method: 'POST', headers, body });
    expect(res.status).toBe(201);
    const json = await parse(res);
    firstId = json.id;
    expect(json.id).toMatch(/^po_/);
    expect(json).toMatchObject({
      agentId: provider.id,
      amountMicros: '5000000',
      destinationIndex: 0,
      destination: { type: 'lightning', address: 'provider@example.com', label: 'main' },
      status: 'pending',
      payoutTxnId: null,
      note: 'first payout',
      resolvedAt: null,
    });
    expect(json.holdTxnId).toMatch(/^ltx_/);

    const holdTxn = await txnByKey(`payout-hold:${json.id}`);
    expect(holdTxn!.txn).toMatchObject({ id: json.holdTxnId, type: 'hold', refType: 'payout', refId: json.id, actorAgentId: provider.id });
    expect(holdTxn!.entries.map((e) => e.amountMicros).sort()).toEqual([-5_000_000n, 5_000_000n]);

    let b = await balances(provider.id);
    expect(b.cash).toEqual({ available: EARNED - 5_000_000n, held: 5_000_000n });

    expect(vi.mocked(alert)).toHaveBeenCalledTimes(1);
    const [text, data] = vi.mocked(alert).mock.calls[0];
    expect(text).toContain(json.id);
    expect(text).toContain('$5.00');
    expect(text).toContain('lightning provider@example.com');
    expect(data).toMatchObject({ payoutId: json.id, agentId: provider.id, amountMicros: '5000000' });

    const replay = await app.request('/v1/wallet/payout-request', { method: 'POST', headers, body });
    expect(replay.status).toBe(201);
    expect(replay.headers.get('Idempotent-Replayed')).toBe('true');
    expect((await parse(replay)).id).toBe(json.id);
    expect(await db.select().from(payoutRequests).where(eq(payoutRequests.agentId, provider.id))).toHaveLength(1);
    b = await balances(provider.id);
    expect(b.cash).toEqual({ available: EARNED - 5_000_000n, held: 5_000_000n });

    // the rest of the eligible cash is the new ceiling
    const over = await app.request('/v1/wallet/payout-request', {
      method: 'POST',
      headers: await session(provider),
      body: JSON.stringify({ amountMicros: (EARNED - 5_000_000n + 1n).toString(), destination: 1 }),
    });
    expect(over.status).toBe(402);

    // signed requests work too, with the DESIGN 14.12 `destination` alias
    const signedBody = JSON.stringify({ amountMicros: '1000000', destination: 1 });
    const signed = await app.request('/v1/wallet/payout-request', {
      method: 'POST',
      headers: { ...(await signRequest(provider.privateKey, { method: 'POST', pathname: '/v1/wallet/payout-request', body: signedBody, agentId: provider.id })), 'Content-Type': 'application/json' },
      body: signedBody,
    });
    expect(signed.status).toBe(201);
    const signedJson = await parse(signed);
    expect(signedJson.destination).toEqual({ type: 'usdc', address: '0x00000000000000000000000000000000000000aa', label: null });
    await rejectPayout(signedJson.id, 'test cleanup');

    const list = await parse(await app.request('/v1/wallet/payout-requests', { headers: await session(provider) }));
    expect(list.payoutRequests.map((p: { id: string }) => p.id)).toEqual([signedJson.id, json.id]);
    const pending = await parse(await app.request('/v1/wallet/payout-requests?status=pending', { headers: await session(provider) }));
    expect(pending.payoutRequests.map((p: { id: string }) => p.id)).toEqual([json.id]);
    const bogus = await app.request('/v1/wallet/payout-requests?status=lost', { headers: await session(provider) });
    expect(bogus.status).toBe(400);
    const others = await parse(await app.request('/v1/wallet/payout-requests', { headers: await session(client) }));
    expect(others.payoutRequests).toEqual([]);
  });

  it('a frozen ledger refuses payout requests', async () => {
    await setLedgerFrozen(true);
    try {
      await expect(requestPayout(provider.id, { amountMicros: 1_000_000n, destinationIndex: 0, now: future() })).rejects.toMatchObject({ code: 'ledger_frozen', status: 503 });
    } finally {
      await setLedgerFrozen(false);
    }
  });

  it('approve then mark paid posts a payout txn from held to payout_clearing; every other transition is 409 invalid_state', async () => {
    expect(firstId).toMatch(/^po_/);
    await expect(markPayoutPaid(firstId)).rejects.toMatchObject({ code: 'invalid_state', status: 409 });

    const approved = await approvePayout(firstId);
    expect(approved.status).toBe('approved');
    expect(approved.resolvedAt).toBeNull();
    await expect(approvePayout(firstId)).rejects.toMatchObject({ code: 'invalid_state', status: 409 });

    const [clearingBefore] = await db.execute(sql`select balance_micros::text as b from ledger_accounts where id = ${SYSTEM_ACCOUNTS.payout_clearing.id}`) as unknown as { b: string }[];
    const paid = await markPayoutPaid(firstId, 'sent 5 USD over lightning');
    expect(paid.status).toBe('paid');
    expect(paid.payoutTxnId).toMatch(/^ltx_/);
    expect(paid.resolvedAt).toBeInstanceOf(Date);
    expect(paid.note).toBe('first payout\nadmin: sent 5 USD over lightning');

    const payoutTxn = await txnByKey(`payout:${firstId}`);
    expect(payoutTxn!.txn).toMatchObject({ id: paid.payoutTxnId, type: 'payout', refType: 'payout', refId: firstId });
    const held = await getOrCreateAccount('agent', provider.id, 'held', 'cash');
    expect(payoutTxn!.entries.find((e) => e.accountId === held.id)!.amountMicros).toBe(-5_000_000n);
    expect(payoutTxn!.entries.find((e) => e.accountId === SYSTEM_ACCOUNTS.payout_clearing.id)!.amountMicros).toBe(5_000_000n);
    const [clearingAfter] = await db.execute(sql`select balance_micros::text as b from ledger_accounts where id = ${SYSTEM_ACCOUNTS.payout_clearing.id}`) as unknown as { b: string }[];
    expect(BigInt(clearingAfter.b) - BigInt(clearingBefore.b)).toBe(5_000_000n);

    const b = await balances(provider.id);
    expect(b.cash).toEqual({ available: EARNED - 5_000_000n, held: 0n });

    await expect(markPayoutPaid(firstId)).rejects.toMatchObject({ code: 'invalid_state' });
    await expect(rejectPayout(firstId)).rejects.toMatchObject({ code: 'invalid_state' });
    await expect(approvePayout('po_doesnotexist0000')).rejects.toMatchObject({ code: 'not_found', status: 404 });
    expect((await getPayout(firstId))!.status).toBe('paid');
  });

  it('reject refunds held cash to available, from pending and from approved', async () => {
    const before = await balances(provider.id);

    const pending = await requestPayout(provider.id, { amountMicros: 2_000_000n, destinationIndex: 0, now: future() });
    expect((await balances(provider.id)).cash).toEqual({ available: before.cash.available - 2_000_000n, held: 2_000_000n });
    const rejected = await rejectPayout(pending.payout.id, 'wrong address');
    expect(rejected).toMatchObject({ status: 'rejected', note: 'admin: wrong address', payoutTxnId: null });
    expect(rejected.resolvedAt).toBeInstanceOf(Date);
    const refundTxn = await txnByKey(`payout-refund:${pending.payout.id}`);
    expect(refundTxn!.txn).toMatchObject({ type: 'refund', refType: 'payout', refId: pending.payout.id });
    expect((await balances(provider.id)).cash).toEqual(before.cash);

    const approvedFirst = await requestPayout(provider.id, { amountMicros: 1_000_000n, destinationIndex: 1, now: future() });
    await approvePayout(approvedFirst.payout.id);
    const rejectedLater = await rejectPayout(approvedFirst.payout.id);
    expect(rejectedLater.status).toBe('rejected');
    expect((await balances(provider.id)).cash).toEqual(before.cash);
    await expect(approvePayout(approvedFirst.payout.id)).rejects.toMatchObject({ code: 'invalid_state' });
  });

  it('refunded payout cash is not held back again by the 14-day window', async () => {
    // Space the refund at least one second (ledger timestamps have second precision) after the release.
    const [releaseTxn] = await db.select().from(ledgerTxns).where(eq(ledgerTxns.idempotencyKey, `release:rc_payouts_${provider.id}`));
    await new Promise((r) => setTimeout(r, 1100));
    const request = await requestPayout(provider.id, { amountMicros: 3_000_000n, destinationIndex: 0, now: future() });
    await rejectPayout(request.payout.id);
    const refund = await txnByKey(`payout-refund:${request.payout.id}`);
    expect(refund!.txn.createdAt.getTime()).toBeGreaterThan(releaseTxn.createdAt.getTime());

    // A clock whose window starts exactly at the refund: the release is old, the refund is inside the window.
    const now = new Date(refund!.txn.createdAt.getTime() + PAYOUT_HOLD_DAYS * DAY_MS);
    const e = await payoutEligibility(provider.id, { now });
    expect(e.heldBackMicros).toBe(0n);
    expect(e.eligibleMicros).toBe(e.cashAvailableMicros);
  });

  it('listPayouts filters by status and agent, newest first', async () => {
    const all = await listPayouts(undefined, { agentId: provider.id });
    expect(all.length).toBeGreaterThanOrEqual(5);
    for (let i = 1; i < all.length; i++) expect(all[i - 1].createdAt.getTime()).toBeGreaterThanOrEqual(all[i].createdAt.getTime());
    const paid = await listPayouts('paid', { agentId: provider.id });
    expect(paid.map((p) => p.id)).toEqual([firstId]);
    const rejected = await listPayouts('rejected', { agentId: provider.id });
    expect(rejected.every((p) => p.status === 'rejected')).toBe(true);
    expect((await listPayouts('paid')).some((p) => p.id === firstId)).toBe(true);
    await expect(listPayouts('lost' as PayoutStatus)).rejects.toMatchObject({ code: 'validation_error' });
    expect(await listPayouts(undefined, { agentId: client.id })).toEqual([]);

    const rows = await db.select().from(payoutRequests).where(and(eq(payoutRequests.agentId, provider.id), eq(payoutRequests.status, 'pending')));
    expect(rows).toEqual([]);
    const chain = await verifyChain();
    expect(chain.ok).toBe(true);
  });
});
