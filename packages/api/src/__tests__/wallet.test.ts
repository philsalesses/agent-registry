import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Hono } from 'hono';
import { requestId } from 'hono/request-id';
import { desc, inArray, sql } from 'drizzle-orm';
import { CASH_BALANCE_CAP_MICROS, PAYOUT_HOLD_DAYS, SANDBOX_GRANT_MICROS, generateApiKey, signRequest } from 'ans-core';
import { db } from '../db';
import { apiKeys, ledgerEntries, ledgerTxns, notifications, offers, payoutRequests } from '../db/schema';
import { onError } from '../lib/errors';
import { createSessionToken } from '../lib/auth';
import { SYSTEM_ACCOUNTS, getOrCreateAccount, grantSandbox, postTxn, setLedgerFrozen } from '../lib/ledger';
import { SHORTFALL_FLAG_PREFIX, createStripeRail, type CheckoutSessionCreator } from '../lib/rails-stripe';
import type { Rail } from '../lib/rails';
import { createWalletRouter, walletRouter, type WalletRouterDeps } from '../routes/wallet';
import { CHECKPOINTS_NOTE, createLedgerRouter } from '../routes/ledger';
import { agentAccountIds, createTestAgent, deleteTestAgents, purgeLedger, body as parse, type TestAgent } from './helpers';

function testApp(wallet: Hono = walletRouter, ledger: Hono = createLedgerRouter({ cacheMs: 0 })) {
  const app = new Hono();
  app.use('*', requestId());
  app.route('/v1/wallet', wallet);
  app.route('/v1/ledger', ledger);
  app.onError(onError);
  return app;
}

async function sessionHeaders(agent: TestAgent, extra: Record<string, string> = {}) {
  return { Authorization: `Bearer ${await createSessionToken(agent.id)}`, ...extra };
}

async function signedHeaders(agent: TestAgent, method: string, pathname: string, body?: string) {
  const h = await signRequest(agent.privateKey, { method, pathname, body, agentId: agent.id });
  return { ...h, ...(body ? { 'Content-Type': 'application/json' } : {}) } as Record<string, string>;
}

/** Remove everything the given agents own, ledger rows included. */
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

function fakeStripeRail(created: unknown[], opts: { fail?: boolean } = {}): Rail {
  const client: CheckoutSessionCreator = {
    checkout: {
      sessions: {
        async create(params) {
          if (opts.fail) throw new Error('stripe down');
          created.push(params);
          return { id: `cs_test_${created.length}`, url: `https://checkout.stripe.test/c/pay/cs_test_${created.length}` };
        },
      },
    },
  };
  return createStripeRail({ enabled: () => true, client: () => client, webUrl: () => 'https://web.test' });
}

describe('wallet routes', () => {
  let fresh: TestAgent;
  let rich: TestAgent;
  const agentIds: string[] = [];

  beforeAll(async () => {
    await setLedgerFrozen(false);
    fresh = await createTestAgent('wallet-f');
    rich = await createTestAgent('wallet-r');
    agentIds.push(fresh.id, rich.id);
    await grantSandbox(fresh.id);
  });

  afterAll(async () => {
    await setLedgerFrozen(false);
    await cleanupAgents(agentIds);
  });

  it('GET /v1/wallet shows a fresh agent its $25 sandbox grant in the WireWallet shape', async () => {
    const app = testApp();
    const res = await app.request('/v1/wallet', { headers: await sessionHeaders(fresh) });
    expect(res.status).toBe(200);
    const json = await parse(res);
    expect(json).toMatchObject({
      agentId: fresh.id,
      sandbox: { available: SANDBOX_GRANT_MICROS.toString(), held: '0' },
      cash: { available: '0', held: '0' },
      payoutEligibleMicros: '0',
      caps: { cashBalanceMicros: CASH_BALANCE_CAP_MICROS.toString(), payoutHoldDays: PAYOUT_HOLD_DAYS },
      topup: {
        enabled: false,
        packsMicros: ['20000000', '50000000', '100000000'],
        reason: 'Card top-ups are not enabled yet. Sandbox credit works everywhere sandbox is accepted.',
      },
      manualPayouts: true,
      ledgerUrl: '/v1/wallet/ledger',
    });
    expect(json.sandbox.available).toBe('25000000');
    expect(json._ans.docs).toBeTruthy();
    expect(Object.keys(json).sort()).toEqual(['_ans', 'agentId', 'caps', 'cash', 'ledgerUrl', 'manualPayouts', 'payoutEligibleMicros', 'sandbox', 'topup'].sort());
  });

  it('GET /v1/wallet accepts signed requests and api keys with scope read; refuses other keys and anonymous calls', async () => {
    const app = testApp();
    const signed = await app.request('/v1/wallet', { headers: await signedHeaders(fresh, 'GET', '/v1/wallet') });
    expect(signed.status).toBe(200);
    expect((await parse(signed)).agentId).toBe(fresh.id);

    const readKey = generateApiKey();
    const invokeKey = generateApiKey();
    await db.insert(apiKeys).values([
      { id: readKey.prefix, keyHash: readKey.hash, agentId: fresh.id, scopes: ['read'] },
      { id: invokeKey.prefix, keyHash: invokeKey.hash, agentId: fresh.id, scopes: ['invoke'] },
    ]);
    const withRead = await app.request('/v1/wallet', { headers: { Authorization: `Bearer ${readKey.key}` } });
    expect(withRead.status).toBe(200);
    const withoutRead = await app.request('/v1/wallet', { headers: { Authorization: `Bearer ${invokeKey.key}` } });
    expect(withoutRead.status).toBe(403);
    expect((await parse(withoutRead)).error).toBe('forbidden');

    // a read-only key cannot request a payout
    const payout = await app.request('/v1/wallet/payout-request', {
      method: 'POST',
      headers: { Authorization: `Bearer ${readKey.key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ amountMicros: '1000000', destinationIndex: 0 }),
    });
    expect(payout.status).toBe(403);

    const anonymous = await app.request('/v1/wallet');
    expect(anonymous.status).toBe(401);
    expect((await parse(anonymous)).error).toBe('unauthorized');
  });

  it('GET /v1/wallet/ledger pages the caller\'s txns and validates cursor and limit', async () => {
    const app = testApp();
    const res = await app.request('/v1/wallet/ledger', { headers: await sessionHeaders(fresh) });
    expect(res.status).toBe(200);
    const json = await parse(res);
    expect(json.nextCursor).toBeNull();
    expect(json.txns).toHaveLength(1);
    expect(json.txns[0]).toMatchObject({ type: 'grant', refType: 'agent', refId: fresh.id });
    expect(json.txns[0].entries.find((e: { ownerId: string }) => e.ownerId === fresh.id).amountMicros).toBe('25000000');

    const other = await app.request('/v1/wallet/ledger', { headers: await sessionHeaders(rich) });
    expect((await parse(other)).txns).toHaveLength(0);

    const badCursor = await app.request('/v1/wallet/ledger?cursor=abc', { headers: await sessionHeaders(fresh) });
    expect(badCursor.status).toBe(400);
    expect((await parse(badCursor)).error).toBe('validation_error');
    const badLimit = await app.request('/v1/wallet/ledger?limit=0', { headers: await sessionHeaders(fresh) });
    expect(badLimit.status).toBe(400);
    const page = await app.request('/v1/wallet/ledger?limit=1', { headers: await sessionHeaders(fresh) });
    expect((await parse(page)).txns).toHaveLength(1);
  });

  it('POST /v1/wallet/topup answers 503 not_implemented while Stripe is disabled', async () => {
    const app = testApp();
    const res = await app.request('/v1/wallet/topup', {
      method: 'POST',
      headers: await sessionHeaders(fresh, { 'Content-Type': 'application/json' }),
      body: JSON.stringify({ amountMicros: '20000000', rail: 'stripe' }),
    });
    expect(res.status).toBe(503);
    const json = await parse(res);
    expect(json.error).toBe('not_implemented');
    expect(json.message).toBe('Card top-ups are not enabled yet. Sandbox credit works everywhere sandbox is accepted.');
    expect(json.fix.docs).toBeTruthy();
    expect(res.headers.get('Link')).toContain('rel="help"');

    const signedBody = JSON.stringify({ amountMicros: 20000000, rail: 'stripe' });
    const signed = await app.request('/v1/wallet/topup', { method: 'POST', headers: await signedHeaders(fresh, 'POST', '/v1/wallet/topup', signedBody), body: signedBody });
    expect(signed.status).toBe(503);

    const lightning = await app.request('/v1/wallet/topup', {
      method: 'POST',
      headers: await sessionHeaders(fresh, { 'Content-Type': 'application/json' }),
      body: JSON.stringify({ amountMicros: '20000000', rail: 'lightning' }),
    });
    expect(lightning.status).toBe(501);
    expect((await parse(lightning)).error).toBe('not_implemented');
  });

  it('POST /v1/wallet/topup with the rail enabled: 400 for a non-pack, the cap pre-check, {url, quote} for a pack', async () => {
    const created: unknown[] = [];
    const stripe = fakeStripeRail(created);
    const deps: WalletRouterDeps = { getRail: (id) => (id === 'stripe' ? stripe : undefined) };
    const app = testApp(createWalletRouter(deps));
    const post = async (agent: TestAgent, body: unknown, extra: Record<string, string> = {}) =>
      app.request('/v1/wallet/topup', { method: 'POST', headers: await sessionHeaders(agent, { 'Content-Type': 'application/json', ...extra }), body: JSON.stringify(body) });

    const wallet = await app.request('/v1/wallet', { headers: await sessionHeaders(fresh) });
    expect((await parse(wallet)).topup).toMatchObject({ enabled: true, reason: null });

    const notPack = await post(fresh, { amountMicros: '25000000', rail: 'stripe' });
    expect(notPack.status).toBe(400);
    const notPackJson = await parse(notPack);
    expect(notPackJson.error).toBe('validation_error');
    expect(notPackJson.details.packsMicros).toEqual(['20000000', '50000000', '100000000']);

    const malformed = await post(fresh, { amountMicros: '20.5' });
    expect(malformed.status).toBe(400);
    expect((await parse(malformed)).error).toBe('validation_error');

    const ok = await post(fresh, { amountMicros: '20000000', rail: 'stripe' }, { 'Idempotency-Key': 'topup-1' });
    expect(ok.status).toBe(200);
    const okJson = await parse(ok);
    expect(okJson.url).toBe('https://checkout.stripe.test/c/pay/cs_test_1');
    expect(okJson.quote).toEqual({ credit: '20000000', surcharge: '880000', total: '20880000' });
    expect(okJson.rail).toBe('stripe');
    expect(created).toHaveLength(1);
    const params = created[0] as { line_items: { price_data: { unit_amount: number } }[]; metadata: Record<string, string>; success_url: string; cancel_url: string };
    expect(params.line_items.map((l) => l.price_data.unit_amount)).toEqual([2000, 88]);
    expect(params.metadata).toMatchObject({ agentId: fresh.id, amountMicros: '20000000' });
    expect(params.success_url.startsWith('https://web.test/wallet')).toBe(true);
    expect(params.cancel_url.startsWith('https://web.test/wallet')).toBe(true);

    // Idempotency-Key replays the stored response without a second Checkout Session
    const replay = await post(fresh, { amountMicros: '20000000', rail: 'stripe' }, { 'Idempotency-Key': 'topup-1' });
    expect(replay.status).toBe(200);
    expect(replay.headers.get('Idempotent-Replayed')).toBe('true');
    expect((await parse(replay)).url).toBe(okJson.url);
    expect(created).toHaveLength(1);

    // cap pre-check: $450 of cash leaves room for no pack above $50
    const available = await getOrCreateAccount('agent', rich.id, 'available', 'cash');
    await postTxn(db, {
      type: 'topup',
      refType: 'test',
      refId: rich.id,
      idempotencyKey: `test:wallet:topup:${rich.id}`,
      entries: [
        { accountId: SYSTEM_ACCOUNTS.stripe_clearing.id, amountMicros: -450_000_000n },
        { accountId: available.id, amountMicros: 450_000_000n },
      ],
    });
    const overCap = await post(rich, { amountMicros: '100000000', rail: 'stripe' });
    expect(overCap.status).toBe(400);
    const overCapJson = await parse(overCap);
    expect(overCapJson.error).toBe('bad_request');
    expect(overCapJson.details).toMatchObject({ capMicros: '500000000', cashBalanceMicros: '450000000', packsThatFitMicros: ['20000000', '50000000'] });
    const fits = await post(rich, { amountMicros: '50000000', rail: 'stripe' });
    expect(fits.status).toBe(200);
    expect(created).toHaveLength(2);

    // a frozen ledger refuses new top-ups
    await setLedgerFrozen(true);
    try {
      const frozen = await post(fresh, { amountMicros: '20000000', rail: 'stripe' });
      expect(frozen.status).toBe(503);
      expect((await parse(frozen)).error).toBe('ledger_frozen');
    } finally {
      await setLedgerFrozen(false);
    }

    // Stripe API failure surfaces as a 502 teaching error, not a 500
    const failing = testApp(createWalletRouter({ getRail: () => fakeStripeRail([], { fail: true }) }));
    const down = await failing.request('/v1/wallet/topup', {
      method: 'POST',
      headers: await sessionHeaders(fresh, { 'Content-Type': 'application/json' }),
      body: JSON.stringify({ amountMicros: '20000000' }),
    });
    expect(down.status).toBe(502);
    expect((await parse(down)).error).toBe('internal');
  });

  it('POST bodies must be JSON', async () => {
    const app = testApp();
    const res = await app.request('/v1/wallet/payout-request', { method: 'POST', headers: await sessionHeaders(fresh, { 'Content-Type': 'application/json' }), body: '{not json' });
    expect(res.status).toBe(400);
    expect((await parse(res)).error).toBe('bad_request');
  });

  it('GET /v1/ledger/checkpoints is public, cached, lists daily checkpoints and verifies the chain', async () => {
    const router = createLedgerRouter({ cacheMs: 60_000 });
    const app = testApp(walletRouter, router);
    const res = await app.request('/v1/ledger/checkpoints');
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toContain('max-age=300');
    const json = await parse(res);
    expect(json.chain.ok).toBe(true);
    expect(json.chain.checked).toBeGreaterThanOrEqual(1);
    expect(json.note).toBe(CHECKPOINTS_NOTE);
    expect(json.note).toContain('not third-party proof');
    expect(json._ans).toBeTruthy();
    expect(json.checkpoints.length).toBeGreaterThanOrEqual(1);
    expect(json.checkpoints.length).toBeLessThanOrEqual(30);

    const [head] = await db.select().from(ledgerTxns).orderBy(desc(ledgerTxns.seq)).limit(1);
    const today = json.checkpoints[0];
    expect(today.date).toBe(head.createdAt.toISOString().slice(0, 10));
    expect(today).toMatchObject({ lastTxnId: head.id, lastSeq: head.seq.toString(), hash: head.hash });
    expect(today.txnCount).toBeGreaterThanOrEqual(1);
    const [{ count }] = (await db.execute(sql`select count(*)::int as count from ledger_txns where created_at::date = ${today.date}::date`)) as unknown as { count: number }[];
    expect(today.txnCount).toBe(Number(count));

    // with the head unchanged the snapshot is reused
    const cachedJson = await parse(await app.request('/v1/ledger/checkpoints'));
    expect(cachedJson.generatedAt).toBe(json.generatedAt);

    // a new txn moves the chain head, so the snapshot is recomputed
    const next = await grantSandbox(rich.id);
    const again = await parse(await app.request('/v1/ledger/checkpoints'));
    expect(again.chain.checked).toBe(json.chain.checked + 1);
    expect(again.checkpoints[0].lastTxnId).toBe(next.txn.id);
  });
});
