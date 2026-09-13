import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { requestId } from 'hono/request-id';
import { and, eq, inArray, or } from 'drizzle-orm';
import {
  buildInvokeForwardMessage,
  buildOfferPublishCanonical,
  canonicalHash,
  canonicalize,
  feeForPrice,
  generateApiKey,
  generateId,
  sha256hex,
  signMessage,
  signRequest,
  verifyMessage,
  SANDBOX_GRANT_MICROS,
} from 'ans-core';
import { db } from '../db';
import { apiKeys, funnelEvents, ledgerTxns, notifications, offers, receiptEvents, receipts } from '../db/schema';
import { onError } from '../lib/errors';
import { balances, grantSandbox } from '../lib/ledger';
import { SafeFetchError } from '../lib/safeFetch';
import { getRegistryKeys } from '../lib/registry-keys';
import type { ForwardRequest, ForwardResponse } from '../lib/offers';
import { createSessionToken } from '../lib/auth';
import { offersRouter } from '../routes/offers';
import { flushInvokeBackground, invokeRouter, setInvokeForwarder } from '../routes/invoke';
import { agentAccountIds, createTestAgent, deleteRateLimitKeys, deleteTestAgents, purgeLedger, body as parse, type TestAgent } from './helpers';

const app = new Hono();
app.use('*', requestId());
app.onError(onError);
app.route('/v1/offers', offersRouter);
app.route('/v1/invoke', invokeRouter);

const DRAFT = 'https://json-schema.org/draft/2020-12/schema';
const PRICE = 500_000n;
const inputSchema = { $schema: DRAFT, type: 'object', required: ['text'], properties: { text: { type: 'string', minLength: 1, maxLength: 500 } }, additionalProperties: false };
const outputSchema = { type: 'object', required: ['summary'], properties: { summary: { type: 'string' } }, additionalProperties: false };
const EXAMPLE = { input: { text: 'The quick brown fox.' }, output: { summary: 'A fox.' } };

async function signedPost(agent: TestAgent, path: string, payload: unknown, extra: Record<string, string> = {}): Promise<Response> {
  const body = JSON.stringify(payload);
  const headers = await signRequest(agent.privateKey, { method: 'POST', pathname: path, body, agentId: agent.id });
  return app.request(path, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json', ...extra } as Record<string, string>, body });
}

async function keyPost(key: string, path: string, payload: unknown, extra: Record<string, string> = {}): Promise<Response> {
  return app.request(path, { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', ...extra }, body: JSON.stringify(payload) });
}

describe('POST /v1/invoke', () => {
  let provider: TestAgent;
  let caller: TestAgent;
  let apiKey: string;
  const grantTxnIds: string[] = [];
  let reply: (req: ForwardRequest) => Promise<ForwardResponse>;
  const forwarded: ForwardRequest[] = [];
  let offerName: string;
  let offerId: string;

  beforeAll(async () => {
    provider = await createTestAgent('inv-p');
    caller = await createTestAgent('inv-c');
    grantTxnIds.push((await grantSandbox(caller.id)).txn.id);
    const key = generateApiKey();
    await db.insert(apiKeys).values({ id: key.prefix, keyHash: key.hash, agentId: caller.id, scopes: ['read', 'receipts', 'invoke', 'publish'], spendCapMicrosPerDay: 0n });
    apiKey = key.key;
    setInvokeForwarder(async (req) => {
      forwarded.push(req);
      return reply(req);
    });

    const draft = {
      slug: 'summarize',
      title: 'Summarize',
      description: 'Summarizes a short text.',
      inputSchema,
      outputSchema,
      examples: [EXAMPLE],
      priceMicros: PRICE.toString(),
      endpoint: 'http://127.0.0.1:9/ans/summarize',
      timeoutMs: 5000,
    };
    const canonical = buildOfferPublishCanonical({ agentId: provider.id, slug: draft.slug, version: 1, inputSchemaHash: canonicalHash(inputSchema), outputSchemaHash: canonicalHash(outputSchema), priceMicros: draft.priceMicros, endpoint: draft.endpoint }).canonical;
    const res = await signedPost(provider, '/v1/offers', { ...draft, publishSig: await signMessage(provider.privateKey, canonical) });
    expect(res.status).toBe(201);
    const json = await parse(res);
    offerName = json.offer.name;
    offerId = json.offer.id;
  });

  beforeEach(() => {
    reply = async () => ({ status: 200, text: JSON.stringify({ summary: 'A fox.' }) });
  });

  afterAll(async () => {
    setInvokeForwarder(null);
    await flushInvokeBackground();
    const ids = [provider.id, caller.id];
    const receiptIds = (await db.select({ id: receipts.id }).from(receipts).where(or(inArray(receipts.clientId, ids), inArray(receipts.providerId, ids)))).map((r) => r.id);
    const txnIds = receiptIds.length > 0 ? (await db.select({ id: ledgerTxns.id }).from(ledgerTxns).where(and(eq(ledgerTxns.refType, 'receipt'), inArray(ledgerTxns.refId, receiptIds)))).map((t) => t.id) : [];
    await purgeLedger({ txnIds: [...txnIds, ...grantTxnIds], accountIds: await agentAccountIds(ids) });
    if (receiptIds.length > 0) {
      await db.delete(receiptEvents).where(inArray(receiptEvents.receiptId, receiptIds));
      await db.delete(receipts).where(inArray(receipts.id, receiptIds));
    }
    await db.delete(funnelEvents).where(eq(funnelEvents.offerId, offerId));
    await db.delete(offers).where(inArray(offers.agentId, ids));
    await db.delete(notifications).where(inArray(notifications.agentId, ids));
    await deleteTestAgents(ids);
    await deleteRateLimitKeys(['invoke:inflight:']);
  });

  async function receiptCount(): Promise<number> {
    return (await db.select({ id: receipts.id }).from(receipts).where(eq(receipts.clientId, caller.id))).length;
  }

  async function statsOf(): Promise<Record<string, any>> {
    const [row] = await db.select({ stats: offers.stats }).from(offers).where(eq(offers.id, offerId));
    return row.stats as Record<string, any>;
  }

  it('happy path: 200, receipt delivered, sandbox escrow held, stats updated, forward signed by the registry', async () => {
    const before = await balances(caller.id);
    expect(before.sandbox.available).toBe(SANDBOX_GRANT_MICROS);
    const input = { text: 'The quick brown fox jumps over the lazy dog.' };
    const res = await keyPost(apiKey, '/v1/invoke', { offer: `@${provider.handle}/summarize`, input }, { 'Idempotency-Key': `happy-${generateId('k', 8)}` });
    expect(res.status).toBe(200);
    const json = await parse(res);
    expect(json.receiptId).toMatch(/^rc_/);
    expect(json.offer).toBe(offerName);
    expect(json.output).toEqual({ summary: 'A fox.' });
    expect(json.charged).toEqual({ priceMicros: '500000', feeMicros: feeForPrice(PRICE, 50).toString(), creditClass: 'sandbox' });
    expect(json.charged.feeMicros).toBe('2500');
    expect(json.provider.id).toBe(provider.id);
    expect(json.provider.handle).toBe(provider.handle);
    expect(typeof json.latencyMs).toBe('number');
    expect(json.receiptUrl).toContain(`/r/${json.receiptId}`);
    expect(json.verdict).toBe(`POST /v1/receipts/${json.receiptId}/verdict`);
    expect(json._ans).toBeTruthy();

    const [r] = await db.select().from(receipts).where(eq(receipts.id, json.receiptId));
    expect(r.state).toBe('delivered');
    expect(r.via).toBe('proxy');
    expect(r.clientId).toBe(caller.id);
    expect(r.providerId).toBe(provider.id);
    expect(r.offerId).toBe(offerId);
    expect(r.creditClass).toBe('sandbox');
    expect(r.priceMicros).toBe(PRICE);
    expect(r.inputHash).toBe(sha256hex(canonicalize(input)));
    expect(r.outputHash).toBe(sha256hex(canonicalize({ summary: 'A fox.' })));
    expect(r.deliverSig).toMatch(/^attested:registry:/);
    expect(r.sigMaterial?.keyId).toBeTruthy();

    const after = await balances(caller.id);
    expect(after.sandbox.available).toBe(SANDBOX_GRANT_MICROS - PRICE);
    expect(after.sandbox.held).toBe(PRICE);

    const stats = await statsOf();
    expect(stats.calls).toBe(1);
    expect(stats.ok).toBe(1);
    expect(typeof stats.p50Ms).toBe('number');
    expect(typeof stats.p95Ms).toBe('number');
    expect(stats.lastCalledAt).toBeTruthy();
    expect(stats.recentMs).toHaveLength(1);

    const req = forwarded[forwarded.length - 1];
    expect(req.url).toBe('http://127.0.0.1:9/ans/summarize');
    expect(req.timeoutMs).toBe(5000);
    expect(req.maxBytes).toBe(1024 * 1024);
    expect(req.headers['X-ANS-Receipt']).toBe(json.receiptId);
    expect(req.headers['X-ANS-Caller']).toBe(caller.id);
    const keys = await getRegistryKeys();
    expect(req.headers['X-ANS-Registry-Key-Id']).toBe(keys.kid);
    const message = buildInvokeForwardMessage({ receiptId: json.receiptId, timestamp: req.headers['X-ANS-Timestamp'], body: req.body });
    expect(await verifyMessage(keys.publicKey, message, req.headers['X-ANS-Signature'])).toBe(true);
    const envelope = JSON.parse(req.body);
    expect(envelope).toMatchObject({ receiptId: json.receiptId, offer: offerName, input, caller: { id: caller.id, handle: caller.handle, trust: 50 } });
    expect(new Date(envelope.deadlineAt).getTime()).toBeGreaterThan(Date.now());
  });

  it('replays an Idempotency-Key with the same receiptId and no second hold', async () => {
    const key = `replay-${generateId('k', 8)}`;
    const payload = { offer: offerName, input: { text: 'once only' } };
    const first = await keyPost(apiKey, '/v1/invoke', payload, { 'Idempotency-Key': key });
    expect(first.status).toBe(200);
    const firstJson = await parse(first);
    const count = await receiptCount();
    const held = (await balances(caller.id)).sandbox.held;

    const second = await keyPost(apiKey, '/v1/invoke', payload, { 'Idempotency-Key': key });
    expect(second.status).toBe(200);
    expect(second.headers.get('Idempotent-Replayed')).toBe('true');
    expect((await parse(second)).receiptId).toBe(firstJson.receiptId);
    expect(await receiptCount()).toBe(count);
    expect((await balances(caller.id)).sandbox.held).toBe(held);

    const different = await keyPost(apiKey, '/v1/invoke', { ...payload, input: { text: 'something else' } }, { 'Idempotency-Key': key });
    expect(different.status).toBe(409);
    expect((await parse(different)).error).toBe('idempotency_mismatch');
  });

  it('a concurrent duplicate with the same Idempotency-Key gets 409 instead of a second hold, then replays the result', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let entered!: () => void;
    const inForward = new Promise<void>((resolve) => { entered = resolve; });
    reply = async () => {
      entered();
      await gate;
      return { status: 200, text: JSON.stringify({ summary: 'slow' }) };
    };
    const key = `concurrent-${generateId('k', 8)}`;
    const payload = { offer: offerName, input: { text: 'slow call' } };
    const count = await receiptCount();
    const first = keyPost(apiKey, '/v1/invoke', payload, { 'Idempotency-Key': key });
    await inForward;
    const dup = await keyPost(apiKey, '/v1/invoke', payload, { 'Idempotency-Key': key });
    expect(dup.status).toBe(409);
    expect((await parse(dup)).error).toBe('conflict');
    release();
    const firstRes = await first;
    expect(firstRes.status).toBe(200);
    const firstJson = await parse(firstRes);
    expect(await receiptCount()).toBe(count + 1);
    const replay = await keyPost(apiKey, '/v1/invoke', payload, { 'Idempotency-Key': key });
    expect(replay.status).toBe(200);
    expect((await parse(replay)).receiptId).toBe(firstJson.receiptId);
    expect(await receiptCount()).toBe(count + 1);
  });

  it('answers 400 input_invalid with ajv errors, the schema, the example and the next request; no receipt opens', async () => {
    const count = await receiptCount();
    const res = await keyPost(apiKey, '/v1/invoke', { offer: offerName, input: { text: '', extra: 1 } });
    expect(res.status).toBe(400);
    const json = await parse(res);
    expect(json.error).toBe('input_invalid');
    expect(json.details.errors.length).toBeGreaterThanOrEqual(2);
    expect(json.details.errors.map((e: any) => e.keyword).sort()).toEqual(['additionalProperties', 'minLength']);
    expect(json.details.inputSchema).toEqual(inputSchema);
    expect(json.details.example).toEqual(EXAMPLE.input);
    expect(json.fix.next).toBe(`POST /v1/invoke ${JSON.stringify({ offer: offerName, input: EXAMPLE.input })}`);
    expect(await receiptCount()).toBe(count);
    expect((await statsOf()).inputInvalid).toBe(1);
  });

  it('provider garbage: 502 output_invalid, receipt output_invalid, hold refunded', async () => {
    reply = async () => ({ status: 200, text: JSON.stringify({ nope: true }) });
    const before = await balances(caller.id);
    const res = await keyPost(apiKey, '/v1/invoke', { offer: offerName, input: { text: 'garbage please' } });
    expect(res.status).toBe(502);
    const json = await parse(res);
    expect(json.error).toBe('output_invalid');
    expect(json.details.state).toBe('output_invalid');
    expect(json.details.refunded).toBe(true);
    expect(json.details.errors.length).toBeGreaterThan(0);
    const [r] = await db.select().from(receipts).where(eq(receipts.id, json.details.receiptId));
    expect(r.state).toBe('output_invalid');
    expect(r.sealedAt).toBeTruthy();
    const after = await balances(caller.id);
    expect(after.sandbox.available).toBe(before.sandbox.available);
    expect(after.sandbox.held).toBe(before.sandbox.held);
    const txns = await db.select({ type: ledgerTxns.type }).from(ledgerTxns).where(and(eq(ledgerTxns.refType, 'receipt'), eq(ledgerTxns.refId, r.id)));
    expect(txns.map((t) => t.type).sort()).toEqual(['hold', 'refund']);
    expect((await statsOf()).outputInvalid).toBe(1);
  });

  it('provider throws, non-2xx, non-JSON and timeout: 502, receipt failed, hold refunded', async () => {
    const cases: [() => Promise<ForwardResponse>, string, string][] = [
      [async () => { throw new Error('connection reset'); }, 'network', 'failed'],
      [async () => ({ status: 500, text: 'oops' }), 'http_500', 'failed'],
      [async () => ({ status: 200, text: '<html>not json</html>' }), 'non_json', 'failed'],
      [async () => { throw new SafeFetchError('timeout', 'Timed out after 5000 ms'); }, 'timeout', 'timeout'],
    ];
    const stats0 = await statsOf();
    for (const [fn, reason] of cases) {
      reply = fn;
      const before = await balances(caller.id);
      const res = await keyPost(apiKey, '/v1/invoke', { offer: offerName, input: { text: `failure ${reason}` } });
      expect(res.status).toBe(502);
      const json = await parse(res);
      expect(json.error).toBe('internal');
      expect(json.message).toBe('The provider did not return a result');
      expect(json.details.reason).toBe(reason);
      expect(json.details.state).toBe('failed');
      const [r] = await db.select().from(receipts).where(eq(receipts.id, json.details.receiptId));
      expect(r.state).toBe('failed');
      const after = await balances(caller.id);
      expect(after.sandbox.available).toBe(before.sandbox.available);
      expect(after.sandbox.held).toBe(before.sandbox.held);
    }
    const stats = await statsOf();
    expect(stats.failed - (stats0.failed ?? 0)).toBe(3);
    expect(stats.timeout - (stats0.timeout ?? 0)).toBe(1);
  });

  it('402 insufficient_credit for an unfunded cash call (signed) and 402 spend_cap_exceeded for an api key capped at 0', async () => {
    const count = await receiptCount();
    const unfunded = await signedPost(caller, '/v1/invoke', { offer: offerName, input: { text: 'pay cash' }, creditClass: 'cash' });
    expect(unfunded.status).toBe(402);
    const uj = await parse(unfunded);
    expect(uj.error).toBe('insufficient_credit');
    expect(uj.details).toMatchObject({ have: '0', need: '500000', creditClass: 'cash', sandboxAccepted: true });
    expect(uj.fix.url).toContain('/wallet');

    const capped = await keyPost(apiKey, '/v1/invoke', { offer: offerName, input: { text: 'pay cash' }, creditClass: 'cash' });
    expect(capped.status).toBe(402);
    const cj = await parse(capped);
    expect(cj.error).toBe('spend_cap_exceeded');
    expect(cj.details).toMatchObject({ capMicros: '0', spentTodayMicros: '0', priceMicros: '500000' });
    expect(await receiptCount()).toBe(count);
  });

  it('refuses sessions, self-invocation, unknown offers (with closest names) and prices above maxPriceMicros', async () => {
    const session = await createSessionToken(caller.id);
    const s = await app.request('/v1/invoke', { method: 'POST', headers: { Authorization: `Bearer ${session}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ offer: offerName, input: { text: 'x' } }) });
    expect(s.status).toBe(403);
    expect((await parse(s)).message).toMatch(/session/);

    const self = await signedPost(provider, '/v1/invoke', { offer: offerName, input: { text: 'x' } });
    expect(self.status).toBe(400);

    const missing = await keyPost(apiKey, '/v1/invoke', { offer: `@${provider.handle}/summarise`, input: { text: 'x' } });
    expect(missing.status).toBe(404);
    const mj = await parse(missing);
    expect(mj.error).toBe('no_offer');
    expect(mj.details.closest).toContain(`@${provider.handle}/summarize`);

    const pricey = await keyPost(apiKey, '/v1/invoke', { offer: offerName, input: { text: 'x' }, maxPriceMicros: '1000' });
    expect(pricey.status).toBe(409);
    expect((await parse(pricey)).details).toMatchObject({ priceMicros: '500000', maxPriceMicros: '1000' });

    const malformed = await keyPost(apiKey, '/v1/invoke', { offer: offerName });
    expect(malformed.status).toBe(400);
    expect((await parse(malformed)).error).toBe('validation_error');
  });

  it('409 sandbox_not_accepted when the provider refuses sandbox, and paused offers refuse calls', async () => {
    await db.update(offers).set({ acceptsSandbox: false }).where(eq(offers.id, offerId));
    const res = await keyPost(apiKey, '/v1/invoke', { offer: offerName, input: { text: 'x' }, creditClass: 'sandbox' });
    expect(res.status).toBe(409);
    expect((await parse(res)).error).toBe('sandbox_not_accepted');
    await db.update(offers).set({ acceptsSandbox: true, status: 'paused' }).where(eq(offers.id, offerId));
    const paused = await keyPost(apiKey, '/v1/invoke', { offer: `@${provider.handle}/summarize`, input: { text: 'x' } });
    expect(paused.status).toBe(409);
    expect((await parse(paused)).error).toBe('invalid_state');
    await db.update(offers).set({ status: 'active' }).where(eq(offers.id, offerId));
  });
});
