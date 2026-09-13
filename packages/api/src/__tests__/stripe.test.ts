import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { Hono } from 'hono';
import { requestId } from 'hono/request-id';
import Stripe from 'stripe';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { AnsError, generateId } from 'ans-core';
import { db } from '../db';
import { agents, ledgerEntries, ledgerTxns, notifications, offers, payoutRequests, systemFlags } from '../db/schema';
import { onError } from '../lib/errors';
import { alert } from '../lib/alerts';
import { SYSTEM_ACCOUNTS, balances, getOrCreateAccount, hold, postTxn, setLedgerFrozen, verifyChain } from '../lib/ledger';
import { getRail, listRails } from '../lib/rails';
import {
  SHORTFALL_FLAG_PREFIX,
  buildCheckoutSessionParams,
  constructStripeEvent,
  createStripeRail,
  handleStripeEvent,
  outstandingShortfallMicros,
  shortfallMarkers,
  stripeRail,
  type CheckoutSessionCreator,
} from '../lib/rails-stripe';
import { payoutEligibility } from '../lib/payouts';
import { createStripeRouter, stripeRouter } from '../routes/rails-stripe';
import { agentAccountIds, createTestAgent, deleteTestAgents, purgeLedger, body as parse, type TestAgent } from './helpers';

vi.mock('../lib/alerts', () => ({ alert: vi.fn(async () => undefined) }));

const SECRET = 'whsec_test_ans_wallet_secret';
const rand = () => generateId('', 14);

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

function sessionEvent(opts: {
  agentId: string;
  amountMicros?: string;
  sessionId?: string;
  paymentIntent?: string | null;
  paymentStatus?: string;
  type?: string;
  amountTotal?: number;
  metadata?: Record<string, string>;
}) {
  return {
    id: `evt_${rand()}`,
    object: 'event',
    api_version: '2026-08-27',
    created: Math.floor(Date.now() / 1000),
    livemode: false,
    type: opts.type ?? 'checkout.session.completed',
    data: {
      object: {
        id: opts.sessionId ?? `cs_test_${rand()}`,
        object: 'checkout.session',
        mode: 'payment',
        status: 'complete',
        payment_status: opts.paymentStatus ?? 'paid',
        currency: 'usd',
        amount_total: opts.amountTotal ?? 2088,
        client_reference_id: opts.agentId,
        payment_intent: opts.paymentIntent === undefined ? `pi_test_${rand()}` : opts.paymentIntent,
        metadata: opts.metadata ?? { agentId: opts.agentId, amountMicros: opts.amountMicros ?? '20000000' },
      },
    },
  };
}

function refundEvent(chargeId: string, paymentIntent: string, amountRefunded: number, metadata: Record<string, string> = {}) {
  return {
    id: `evt_${rand()}`,
    object: 'event',
    type: 'charge.refunded',
    data: { object: { id: chargeId, object: 'charge', amount: 2088, amount_refunded: amountRefunded, currency: 'usd', payment_intent: paymentIntent, metadata } },
  };
}

function disputeEvent(disputeId: string, chargeId: string, paymentIntent: string | null, amount: number) {
  return {
    id: `evt_${rand()}`,
    object: 'event',
    type: 'charge.dispute.created',
    data: { object: { id: disputeId, object: 'dispute', amount, currency: 'usd', charge: chargeId, payment_intent: paymentIntent, reason: 'fraudulent', status: 'needs_response', metadata: {} } },
  };
}

function signed(payload: unknown, secret = SECRET, timestamp?: number) {
  const body = JSON.stringify(payload);
  const header = Stripe.webhooks.generateTestHeaderString({ payload: body, secret, ...(timestamp ? { timestamp } : {}) });
  return { body, header };
}

async function metadataOf(agentId: string): Promise<Record<string, unknown>> {
  const row = await db.query.agents.findFirst({ where: eq(agents.id, agentId), columns: { metadata: true } });
  return (row?.metadata as Record<string, unknown> | null) ?? {};
}

async function reversalTxns(paymentIntent: string) {
  return db.select().from(ledgerTxns).where(and(eq(ledgerTxns.type, 'reversal'), eq(ledgerTxns.refId, paymentIntent)));
}

describe('stripe rail', () => {
  const agentIds: string[] = [];
  const track = async (prefix: string) => {
    const a = await createTestAgent(prefix);
    agentIds.push(a.id);
    return a;
  };

  beforeAll(async () => {
    await setLedgerFrozen(false);
  });

  afterAll(async () => {
    await setLedgerFrozen(false);
    await cleanupAgents(agentIds);
  });

  beforeEach(() => {
    vi.mocked(alert).mockClear();
  });

  it('the rail registry has stripe (disabled by config); lightning and usdc have no implementation', () => {
    expect(getRail('stripe')).toBe(stripeRail);
    expect(stripeRail.enabled()).toBe(false);
    expect(getRail('lightning')).toBeUndefined();
    expect(getRail('usdc')).toBeUndefined();
    expect(getRail('paypal')).toBeUndefined();
    expect(listRails().map((r) => r.id)).toEqual(['stripe']);
  });

  it('creates a Checkout Session with the credit and surcharge line items, metadata and wallet URLs', async () => {
    const agent = 'ag_checkout0000000001';
    const params = buildCheckoutSessionParams(agent, 50_000_000n, 'https://web.test/');
    expect(params.mode).toBe('payment');
    expect(params.payment_method_types).toEqual(['card']);
    expect(params.line_items).toHaveLength(2);
    expect(params.line_items![0]).toMatchObject({ quantity: 1, price_data: { currency: 'usd', unit_amount: 5000 } });
    expect(params.line_items![1]).toMatchObject({ quantity: 1, price_data: { currency: 'usd', unit_amount: 175, product_data: { name: 'Card processing surcharge' } } });
    expect(params.metadata).toEqual({ agentId: agent, amountMicros: '50000000', surchargeMicros: '1750000', totalMicros: '51750000', rail: 'stripe' });
    expect(params.payment_intent_data!.metadata).toEqual({ agentId: agent, amountMicros: '50000000' });
    expect(params.client_reference_id).toBe(agent);
    expect(params.success_url).toBe('https://web.test/wallet?topup=success&session_id={CHECKOUT_SESSION_ID}');
    expect(params.cancel_url).toBe('https://web.test/wallet?topup=cancelled');
    expect(JSON.stringify(params)).not.toContain('\u2014');

    const created: unknown[] = [];
    const client: CheckoutSessionCreator = {
      checkout: { sessions: { create: async (p) => { created.push(p); return { id: 'cs_test_1', url: 'https://checkout.stripe.test/cs_test_1' }; } } },
    };
    const rail = createStripeRail({ enabled: () => true, client: () => client, webUrl: () => 'https://web.test' });
    await expect(rail.topup(agent, 100_000_000n)).resolves.toEqual({ url: 'https://checkout.stripe.test/cs_test_1' });
    expect((created[0] as { line_items: { price_data: { unit_amount: number } }[] }).line_items.map((l) => l.price_data.unit_amount)).toEqual([10000, 320]);

    await expect(rail.topup(agent, 30_000_000n)).rejects.toMatchObject({ code: 'validation_error', status: 400 });
    await expect(stripeRail.topup(agent, 20_000_000n)).rejects.toMatchObject({ code: 'not_implemented', status: 503 });
    const noUrl = createStripeRail({ enabled: () => true, client: () => ({ checkout: { sessions: { create: async () => ({ id: 'cs_x', url: null }) } } }) });
    await expect(noUrl.topup(agent, 20_000_000n)).rejects.toMatchObject({ status: 502 });
  });

  it('constructStripeEvent verifies Stripe-Signature over the raw body', () => {
    const payload = sessionEvent({ agentId: 'ag_sig00000000000001' });
    const { body, header } = signed(payload);
    const event = constructStripeEvent(body, header, SECRET);
    expect(event.id).toBe(payload.id);
    expect(event.type).toBe('checkout.session.completed');

    expect(() => constructStripeEvent(body.replace('20000000', '90000000'), header, SECRET)).toThrow();
    expect(() => constructStripeEvent(body, signed(payload, 'whsec_other').header, SECRET)).toThrow();
    const stale = signed(payload, SECRET, Math.floor(Date.now() / 1000) - 3600);
    expect(() => constructStripeEvent(stale.body, stale.header, SECRET)).toThrow(/tolerance/i);
    expect(() => constructStripeEvent(body, header, undefined)).toThrow(AnsError);
  });

  it('webhook route: 503 while Stripe is disabled', async () => {
    const app = new Hono();
    app.use('*', requestId());
    app.route('/v1/rails/stripe', stripeRouter);
    app.onError(onError);
    const { body, header } = signed(sessionEvent({ agentId: 'ag_disabled000000001' }));
    const res = await app.request('/v1/rails/stripe/webhook', { method: 'POST', headers: { 'Stripe-Signature': header, 'Content-Type': 'application/json' }, body });
    expect(res.status).toBe(503);
    const json = await parse(res);
    expect(json.error).toBe('not_implemented');
    expect(json.requestId).toBeTruthy();
    expect(res.headers.get('Link')).toContain('rel="help"');
  });

  it('webhook route with a secret: 400 on a missing or bad signature, 200 and one credit for a good one', async () => {
    const agent = await track('stripe-wh');
    const app = new Hono();
    app.use('*', requestId());
    app.route('/v1/rails/stripe', createStripeRouter({ enabled: () => true, webhookSecret: () => SECRET }));
    app.onError(onError);
    const send = (body: string, header?: string) =>
      app.request('/v1/rails/stripe/webhook', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(header ? { 'Stripe-Signature': header } : {}) }, body });

    const payload = sessionEvent({ agentId: agent.id, paymentIntent: `pi_wh_${rand()}` });
    const { body, header } = signed(payload);

    const missing = await send(body);
    expect(missing.status).toBe(400);
    expect((await parse(missing)).error).toBe('invalid_signature');
    const forged = await send(body, signed(payload, 'whsec_attacker').header);
    expect(forged.status).toBe(400);
    const tampered = await send(body.replace('"paid"', '"paid" '), header);
    expect(tampered.status).toBe(400);
    const oversized = await send(JSON.stringify({ ...payload, padding: 'x'.repeat(1024 * 1024) }), header);
    expect(oversized.status).toBe(413);
    expect((await parse(oversized)).error).toBe('bad_request');
    expect((await balances(agent.id)).cash.available).toBe(0n);

    const ok = await send(body, header);
    expect(ok.status).toBe(200);
    expect(await parse(ok)).toMatchObject({ received: true, handled: true, action: 'credited', agentId: agent.id, amountMicros: '20000000', replayed: false, capExceeded: false });
    expect((await balances(agent.id)).cash).toEqual({ available: 20_000_000n, held: 0n });

    const again = signed(payload);
    const replay = await send(again.body, again.header);
    expect(replay.status).toBe(200);
    expect((await parse(replay)).replayed).toBe(true);
    expect((await balances(agent.id)).cash.available).toBe(20_000_000n);

    const ignoredType = signed({ id: `evt_${rand()}`, object: 'event', type: 'customer.created', data: { object: { id: 'cus_1' } } });
    const other = await send(ignoredType.body, ignoredType.header);
    expect(other.status).toBe(200);
    expect(await parse(other)).toMatchObject({ received: true, handled: false, action: 'ignored' });
  });

  it('handleStripeEvent credits checkout.session.completed once and emits wallet.credited', async () => {
    const agent = await track('stripe-cr');
    const pi = `pi_cr_${rand()}`;
    const event = sessionEvent({ agentId: agent.id, amountMicros: '50000000', amountTotal: 5175, paymentIntent: pi });

    const first = await handleStripeEvent(event);
    expect(first).toMatchObject({ handled: true, action: 'credited', agentId: agent.id, amountMicros: '50000000', replayed: false, eventId: event.id });
    const second = await handleStripeEvent(event);
    expect(second).toMatchObject({ handled: true, replayed: true, txnId: first.txnId });
    // the same session delivered again as async_payment_succeeded is still one credit
    const asyncDup = await handleStripeEvent({ ...event, type: 'checkout.session.async_payment_succeeded' });
    expect(asyncDup.replayed).toBe(true);

    expect((await balances(agent.id)).cash).toEqual({ available: 50_000_000n, held: 0n });
    const [txn] = await db.select().from(ledgerTxns).where(eq(ledgerTxns.idempotencyKey, `topup:stripe:${event.data.object.id}`));
    expect(txn).toMatchObject({ id: first.txnId, type: 'topup', refType: 'stripe_payment_intent', refId: pi, actorAgentId: agent.id });
    const entries = await db.select().from(ledgerEntries).where(eq(ledgerEntries.txnId, txn.id));
    expect(entries.find((e) => e.accountId === SYSTEM_ACCOUNTS.stripe_clearing.id)!.amountMicros).toBe(-50_000_000n);

    const notes = await db.select().from(notifications).where(eq(notifications.agentId, agent.id));
    expect(notes).toHaveLength(1);
    expect(notes[0].payload).toMatchObject({ kind: 'wallet.credited', agentId: agent.id, amountMicros: '50000000', rail: 'stripe', txnId: first.txnId });
    expect(vi.mocked(alert)).not.toHaveBeenCalled();
  });

  it('ignores unpaid, foreign, malformed and unknown-agent sessions without posting anything', async () => {
    const agent = await track('stripe-ig');
    const unpaid = sessionEvent({ agentId: agent.id, paymentStatus: 'unpaid' });
    expect(await handleStripeEvent(unpaid)).toMatchObject({ handled: false, action: 'ignored' });
    // the async payment settling later posts the credit
    const settled = await handleStripeEvent({ ...unpaid, type: 'checkout.session.async_payment_succeeded', data: { object: { ...unpaid.data.object, payment_status: 'paid' } } });
    expect(settled).toMatchObject({ handled: true, action: 'credited', replayed: false });
    expect((await balances(agent.id)).cash.available).toBe(20_000_000n);

    const foreign = sessionEvent({ agentId: agent.id, metadata: {} });
    expect(await handleStripeEvent(foreign)).toMatchObject({ handled: false, reason: expect.stringContaining('not an ANS top-up') });
    expect(vi.mocked(alert)).not.toHaveBeenCalled();

    const malformed = sessionEvent({ agentId: agent.id, metadata: { agentId: agent.id, amountMicros: '20.00' } });
    expect(await handleStripeEvent(malformed)).toMatchObject({ handled: false, reason: 'malformed ANS top-up metadata' });
    const unknown = sessionEvent({ agentId: 'ag_nobody0000000000' });
    expect(await handleStripeEvent(unknown)).toMatchObject({ handled: false, reason: 'unknown agent ag_nobody0000000000' });
    expect(vi.mocked(alert)).toHaveBeenCalledTimes(2);

    // a session that collected less than the credit (a discount outside ANS) credits only what was paid
    const discounted = await handleStripeEvent(sessionEvent({ agentId: agent.id, amountTotal: 1500 }));
    expect(discounted).toMatchObject({ handled: true, amountMicros: '15000000' });
    expect(vi.mocked(alert)).toHaveBeenCalledTimes(3);
    expect((await balances(agent.id)).cash.available).toBe(35_000_000n);

    await expect(handleStripeEvent({ nope: true })).rejects.toMatchObject({ code: 'bad_request' });
  });

  it('a top-up over the $500 cap is still credited, flags agents.metadata.capExceeded and alerts', async () => {
    const agent = await track('stripe-cap');
    const available = await getOrCreateAccount('agent', agent.id, 'available', 'cash');
    await postTxn(db, {
      type: 'topup',
      refType: 'test',
      refId: agent.id,
      idempotencyKey: `test:stripe:cap:${agent.id}`,
      entries: [
        { accountId: SYSTEM_ACCOUNTS.stripe_clearing.id, amountMicros: -450_000_000n },
        { accountId: available.id, amountMicros: 450_000_000n },
      ],
    });
    const event = sessionEvent({ agentId: agent.id, amountMicros: '100000000', amountTotal: 10320 });
    const result = await handleStripeEvent(event);
    expect(result).toMatchObject({ handled: true, action: 'credited', capExceeded: true, amountMicros: '100000000' });
    expect((await balances(agent.id)).cash.available).toBe(550_000_000n);
    const metadata = await metadataOf(agent.id);
    expect(metadata.capExceeded).toBe(true);
    expect(metadata.capExceededBalanceMicros).toBe('550000000');
    expect(vi.mocked(alert)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(alert).mock.calls[0][0]).toContain('cap exceeded');

    vi.mocked(alert).mockClear();
    expect((await handleStripeEvent(event)).replayed).toBe(true);
    expect(vi.mocked(alert)).not.toHaveBeenCalled();
  });

  it('charge.refunded reverses the credit, follows cumulative partial refunds and ignores redeliveries', async () => {
    const agent = await track('stripe-rf');
    const pi = `pi_rf_${rand()}`;
    const charge = `ch_rf_${rand()}`;
    await handleStripeEvent(sessionEvent({ agentId: agent.id, paymentIntent: pi }));

    const partial = await handleStripeEvent(refundEvent(charge, pi, 500));
    expect(partial).toMatchObject({ handled: true, action: 'reversed', agentId: agent.id, amountMicros: '5000000', reversedMicros: '5000000', shortfallMicros: '0', replayed: false });
    expect((await balances(agent.id)).cash.available).toBe(15_000_000n);
    expect((await handleStripeEvent(refundEvent(charge, pi, 500))).replayed).toBe(true);
    expect((await balances(agent.id)).cash.available).toBe(15_000_000n);

    // a second partial refund: amount_refunded is cumulative, so only the new $5 is reversed
    const second = await handleStripeEvent(refundEvent(charge, pi, 1000));
    expect(second).toMatchObject({ reversedMicros: '5000000', shortfallMicros: '0', replayed: false });
    expect((await balances(agent.id)).cash.available).toBe(10_000_000n);

    // the full refund ($20.88 incl. surcharge) claws back only what was credited
    const full = await handleStripeEvent(refundEvent(charge, pi, 2088));
    expect(full).toMatchObject({ reversedMicros: '10000000', shortfallMicros: '0', replayed: false });
    expect((await balances(agent.id)).cash.available).toBe(0n);
    expect((await handleStripeEvent(refundEvent(charge, pi, 2088))).replayed).toBe(true);
    // an older partial-refund event arriving late changes nothing
    expect((await handleStripeEvent(refundEvent(charge, pi, 500))).replayed).toBe(true);

    const txns = await reversalTxns(pi);
    expect(txns.map((t) => t.idempotencyKey).sort()).toEqual([`reversal:stripe:refund:${charge}:1000`, `reversal:stripe:refund:${charge}:2088`, `reversal:stripe:refund:${charge}:500`].sort());
    expect(txns.every((t) => t.refType === 'stripe_payment_intent')).toBe(true);
    const returned = await db
      .select({ amount: ledgerEntries.amountMicros })
      .from(ledgerEntries)
      .where(and(inArray(ledgerEntries.txnId, txns.map((t) => t.id)), eq(ledgerEntries.accountId, SYSTEM_ACCOUNTS.stripe_clearing.id)));
    expect(returned.reduce((s, r) => s + r.amount, 0n)).toBe(20_000_000n);
    expect(await outstandingShortfallMicros(agent.id)).toBe(0n);
    expect(vi.mocked(alert)).not.toHaveBeenCalled();
  });

  it('charge.refunded before its top-up is credited throws so Stripe retries; foreign charges are ignored', async () => {
    const pi = `pi_early_${rand()}`;
    await expect(handleStripeEvent(refundEvent(`ch_early_${rand()}`, pi, 2088, { agentId: 'ag_someone000000001' }))).rejects.toMatchObject({ code: 'conflict', status: 409 });
    expect(await handleStripeEvent(refundEvent(`ch_foreign_${rand()}`, `pi_foreign_${rand()}`, 1000))).toMatchObject({ handled: false, action: 'ignored' });
    expect(await handleStripeEvent(refundEvent(`ch_zero_${rand()}`, pi, 0))).toMatchObject({ handled: false });
  });

  it('charge.dispute.created after the credit was spent: reverses what exists, pauses offers, records the shortfall, alerts; redelivery changes nothing', async () => {
    const agent = await track('stripe-dp');
    const pi = `pi_dp_${rand()}`;
    const charge = `ch_dp_${rand()}`;
    const dispute = `dp_${rand()}`;
    const now = new Date();
    const offerBase = { agentId: agent.id, title: 'Test offer', inputSchema: { type: 'object' }, outputSchema: { type: 'object' }, inputSchemaHash: 'a'.repeat(64), outputSchemaHash: 'b'.repeat(64), publishSig: 'test-sig', createdAt: now, updatedAt: now };
    const activeId = generateId('of_', 16);
    const retiredId = generateId('of_', 16);
    await db.insert(offers).values([
      { ...offerBase, id: activeId, slug: 'active-offer', status: 'active' },
      { ...offerBase, id: retiredId, slug: 'retired-offer', status: 'retired' },
    ]);

    await handleStripeEvent(sessionEvent({ agentId: agent.id, paymentIntent: pi }));
    // spend $15 of the $20 on a receipt still in escrow
    await hold({ id: `rc_dispute_${agent.id}`, clientId: agent.id, providerId: agent.id, priceMicros: 15_000_000n, creditClass: 'cash', feeBps: 50 });
    expect((await balances(agent.id)).cash).toEqual({ available: 5_000_000n, held: 15_000_000n });

    const result = await handleStripeEvent(disputeEvent(dispute, charge, pi, 2088));
    expect(result).toMatchObject({ handled: true, action: 'reversed', agentId: agent.id, amountMicros: '20000000', reversedMicros: '5000000', shortfallMicros: '15000000', replayed: false, offersPaused: 1 });
    expect((await balances(agent.id)).cash).toEqual({ available: 0n, held: 15_000_000n });

    const statuses = await db.select({ id: offers.id, status: offers.status }).from(offers).where(eq(offers.agentId, agent.id));
    expect(Object.fromEntries(statuses.map((s) => [s.id, s.status]))).toEqual({ [activeId]: 'paused', [retiredId]: 'retired' });

    const metadata = await metadataOf(agent.id);
    expect(metadata.negativeBalanceMicros).toBe('15000000');
    expect(await outstandingShortfallMicros(agent.id)).toBe(15_000_000n);
    const markers = await shortfallMarkers(agent.id);
    expect(markers).toHaveLength(1);
    expect(markers[0]).toMatchObject({ paymentIntentId: pi, chargeId: charge, disputeId: dispute, eventKey: `reversal:stripe:dispute:${dispute}`, requestedMicros: '20000000', reversedMicros: '5000000', shortfallMicros: '15000000', txnId: result.txnId, pausedOfferIds: [activeId] });
    const [flag] = await db.select().from(systemFlags).where(eq(systemFlags.key, `${SHORTFALL_FLAG_PREFIX}${agent.id}:reversal:stripe:dispute:${dispute}`));
    expect(flag).toBeTruthy();

    expect(vi.mocked(alert)).toHaveBeenCalledTimes(1);
    const [text, data] = vi.mocked(alert).mock.calls[0];
    expect(text).toContain(dispute);
    expect(text).toContain('short by $15.00');
    expect(data).toMatchObject({ agentId: agent.id, shortfallMicros: '15000000', pausedOfferIds: [activeId] });

    // what is owed comes out of payout eligibility
    expect((await payoutEligibility(agent.id, { now: new Date(Date.now() + 30 * 86_400_000) })).owedMicros).toBe(15_000_000n);

    // redelivery: nothing moves, nothing is double counted
    vi.mocked(alert).mockClear();
    const replay = await handleStripeEvent(disputeEvent(dispute, charge, pi, 2088));
    expect(replay).toMatchObject({ replayed: true, reversedMicros: '5000000', shortfallMicros: '15000000' });
    expect(await reversalTxns(pi)).toHaveLength(1);
    expect((await metadataOf(agent.id)).negativeBalanceMicros).toBe('15000000');
    expect(await outstandingShortfallMicros(agent.id)).toBe(15_000_000n);
    expect(vi.mocked(alert)).not.toHaveBeenCalled();

    // a refund on the same payment later finds nothing left of the credit to claw back
    const refund = await handleStripeEvent(refundEvent(charge, pi, 2088));
    expect(refund).toMatchObject({ handled: true, reversedMicros: '0', shortfallMicros: '0', replayed: false });
    expect(await outstandingShortfallMicros(agent.id)).toBe(15_000_000n);
  });

  it('a dispute with nothing available records the whole shortfall and stays idempotent', async () => {
    const agent = await track('stripe-dz');
    const pi = `pi_dz_${rand()}`;
    const dispute = `dp_${rand()}`;
    await handleStripeEvent(sessionEvent({ agentId: agent.id, paymentIntent: pi }));
    await hold({ id: `rc_dz_${agent.id}`, clientId: agent.id, providerId: agent.id, priceMicros: 20_000_000n, creditClass: 'cash', feeBps: 50 });

    const first = await handleStripeEvent(disputeEvent(dispute, `ch_${rand()}`, pi, 2088));
    expect(first).toMatchObject({ reversedMicros: '0', shortfallMicros: '20000000', txnId: null, offersPaused: 0 });
    const again = await handleStripeEvent(disputeEvent(dispute, `ch_${rand()}`, pi, 2088));
    expect(again).toMatchObject({ replayed: true, shortfallMicros: '20000000' });
    expect(await reversalTxns(pi)).toHaveLength(0);
    expect(await outstandingShortfallMicros(agent.id)).toBe(20_000_000n);
    expect((await metadataOf(agent.id)).negativeBalanceMicros).toBe('20000000');
  });

  it('a frozen ledger makes credits and reversals answer 503 ledger_frozen so Stripe retries later', async () => {
    const agent = await track('stripe-fz');
    const pi = `pi_fz_${rand()}`;
    const completed = sessionEvent({ agentId: agent.id, paymentIntent: pi });
    await setLedgerFrozen(true);
    try {
      await expect(handleStripeEvent(completed)).rejects.toMatchObject({ code: 'ledger_frozen', status: 503 });
    } finally {
      await setLedgerFrozen(false);
    }
    expect((await handleStripeEvent(completed)).replayed).toBe(false);
    // spend everything so a dispute would post nothing and only record a shortfall
    await hold({ id: `rc_fz_${agent.id}`, clientId: agent.id, providerId: agent.id, priceMicros: 20_000_000n, creditClass: 'cash', feeBps: 50 });
    const dispute = disputeEvent(`dp_${rand()}`, `ch_${rand()}`, pi, 2088);
    await setLedgerFrozen(true);
    try {
      await expect(handleStripeEvent(dispute)).rejects.toMatchObject({ code: 'ledger_frozen' });
      expect(await outstandingShortfallMicros(agent.id)).toBe(0n);
    } finally {
      await setLedgerFrozen(false);
    }
    expect(await handleStripeEvent(dispute)).toMatchObject({ shortfallMicros: '20000000', replayed: false });
  });

  it('a dispute that matches no ANS top-up is acknowledged, ignored and alerted', async () => {
    const result = await handleStripeEvent(disputeEvent(`dp_${rand()}`, `ch_${rand()}`, `pi_unknown_${rand()}`, 5000));
    expect(result).toMatchObject({ handled: false, action: 'ignored' });
    expect(vi.mocked(alert)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(alert).mock.calls[0][0]).toContain('matches no ANS top-up');
  });

  it('leaves the ledger hash chain intact', async () => {
    expect((await verifyChain()).ok).toBe(true);
  });
});
