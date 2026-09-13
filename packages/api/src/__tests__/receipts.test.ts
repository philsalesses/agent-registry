import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Hono } from 'hono';
import { requestId } from 'hono/request-id';
import { eq, inArray, or, sql } from 'drizzle-orm';
import {
  buildAcceptCanonical,
  buildDeliverCanonical,
  buildRatingCanonical,
  buildTermsCanonical,
  buildVerdictCanonical,
  generateApiKey,
  generateNonce,
  sha256hex,
  signMessage,
  signRequest,
  type ReceiptTerms,
} from 'ans-core';
import { db } from '../db';
import { agents, apiKeys, notifications, ratings, receiptEvents, receipts, ledgerTxns, funnelEvents } from '../db/schema';
import { onError } from '../lib/errors';
import { config } from '../config';
import { balances } from '../lib/ledger';
import { runClockTick } from '../lib/clock';
import { floorSec, verifyAgentChain } from '../lib/receipts';
import { receiptsRouter } from '../routes/receipts';
import { agentReceiptsRouter } from '../routes/agent-receipts';
import { createTestAgent, deleteTestAgents, agentAccountIds, fundCash, purgeLedger, deleteRateLimitKeys, type TestAgent, body as parse } from './helpers';

function testApp() {
  const app = new Hono();
  app.use('*', requestId());
  app.onError(onError);
  app.route('/v1/receipts', receiptsRouter);
  app.route('/v1/agents', agentReceiptsRouter);
  return app;
}

const app = testApp();
const created: TestAgent[] = [];

async function agent(prefix: string) {
  const a = await createTestAgent(prefix);
  created.push(a);
  return a;
}

async function signedReq(a: TestAgent, method: string, path: string, body?: unknown, extra: Record<string, string> = {}) {
  const raw = body === undefined ? '' : JSON.stringify(body);
  const headers = await signRequest(a.privateKey, { method, pathname: path.split('?')[0], body: raw, agentId: a.id });
  return app.request(path, {
    method,
    headers: { ...headers, ...(raw ? { 'Content-Type': 'application/json' } : {}), ...extra } as Record<string, string>,
    body: raw || undefined,
  });
}

function deadline(hours = 48): string {
  return floorSec(new Date(Date.now() + hours * 3600_000)).toISOString();
}

interface OpenOpts {
  role: 'client' | 'provider';
  counterpartyId?: string;
  hint?: { name: string; url?: string | null; contact?: string | null };
  task?: string;
  priceMicros?: string;
  /** 'sandbox' only to prove the API refuses it */
  creditClass?: 'sandbox' | 'cash' | 'none';
  reviewWindowSec?: number;
  openNonce?: string;
  deadlineAt?: string;
}

async function openSigned(initiator: TestAgent, o: OpenOpts) {
  const priceMicros = o.priceMicros ?? '0';
  const creditClass = (priceMicros === '0' ? 'none' : (o.creditClass ?? 'cash')) as ReceiptTerms['creditClass'];
  const terms: ReceiptTerms = {
    initiatorId: initiator.id,
    initiatorRole: o.role,
    counterpartyId: o.counterpartyId ?? null,
    counterpartyHint: o.hint ? { name: o.hint.name, url: o.hint.url ?? null, contactHash: o.hint.contact ? sha256hex(o.hint.contact.trim().toLowerCase()) : null } : null,
    task: o.task ?? 'Summarize 40 support tickets into themes',
    offerId: null,
    inputHash: null,
    priceMicros,
    currency: 'USD',
    creditClass,
    feeBps: config.feeBps,
    deadlineAt: o.deadlineAt ?? deadline(),
    reviewWindowSec: o.reviewWindowSec ?? 604800,
    openNonce: o.openNonce ?? generateNonce(),
  };
  const { canonical } = buildTermsCanonical(terms);
  const signature = await signMessage(initiator.privateKey, canonical);
  const body = {
    role: o.role,
    counterparty: o.counterpartyId ? { agentId: o.counterpartyId } : { hint: o.hint },
    task: terms.task,
    priceMicros,
    creditClass,
    deadlineAt: terms.deadlineAt,
    reviewWindowSec: terms.reviewWindowSec,
    feeBps: terms.feeBps,
    openNonce: terms.openNonce,
    signature,
  };
  const res = await signedReq(initiator, 'POST', '/v1/receipts', body);
  return { res, json: await parse(res), body, terms };
}

async function accept(a: TestAgent, receiptId: string, termsHash: string) {
  const signature = await signMessage(a.privateKey, buildAcceptCanonical({ receiptId, termsHash, acceptorId: a.id }).canonical);
  return signedReq(a, 'POST', `/v1/receipts/${receiptId}/accept`, { signature });
}

async function deliver(a: TestAgent, receiptId: string, output = 'the delivered work') {
  const outputHash = sha256hex(output);
  const signature = await signMessage(a.privateKey, buildDeliverCanonical({ receiptId, outputHash }).canonical);
  return { res: await signedReq(a, 'POST', `/v1/receipts/${receiptId}/deliver`, { outputHash, signature }), outputHash };
}

async function verdict(a: TestAgent, receiptId: string, outputHash: string, v: 'accept' | 'reject', extra: Record<string, unknown> = {}) {
  const signature = await signMessage(a.privateKey, buildVerdictCanonical({ receiptId, outputHash, verdict: v }).canonical);
  return signedReq(a, 'POST', `/v1/receipts/${receiptId}/verdict`, { verdict: v, signature, ...extra });
}

async function ratingBody(a: TestAgent, receiptId: string, subjectId: string, score: number, tags: string[] = []) {
  const signature = await signMessage(a.privateKey, buildRatingCanonical({ receiptId, subjectId, score, tags }).canonical);
  return { score, tags, signature };
}

afterAll(async () => {
  const ids = created.map((a) => a.id);
  if (ids.length === 0) return;
  const rows = await db.select({ id: receipts.id }).from(receipts).where(or(inArray(receipts.clientId, ids), inArray(receipts.providerId, ids), inArray(receipts.initiatorId, ids)));
  const rids = rows.map((r) => r.id);
  const txns = rids.length ? await db.select({ id: ledgerTxns.id }).from(ledgerTxns).where(inArray(ledgerTxns.refId, [...rids, ...ids])) : [];
  const grantTxns = await db.select({ id: ledgerTxns.id }).from(ledgerTxns).where(inArray(ledgerTxns.refId, ids));
  await purgeLedger({ txnIds: [...txns.map((t) => t.id), ...grantTxns.map((t) => t.id)], accountIds: await agentAccountIds(ids) });
  if (rids.length) {
    await db.delete(ratings).where(inArray(ratings.receiptId, rids));
    await db.delete(receiptEvents).where(inArray(receiptEvents.receiptId, rids));
    await db.delete(funnelEvents).where(inArray(funnelEvents.receiptId, rids));
    await db.delete(receipts).where(inArray(receipts.id, rids));
  }
  await db.delete(notifications).where(inArray(notifications.agentId, ids));
  await deleteRateLimitKeys(['receipt:', 'hint:']);
  await deleteTestAgents(ids);
});

describe('receipts: direct flow', () => {
  let client: TestAgent;
  let provider: TestAgent;

  beforeAll(async () => {
    client = await agent('rc-client');
    provider = await agent('rc-prov');
    await fundCash(client.id);
  });

  it('opens, accepts with escrow, delivers, accepts with ratings, releases with the 0.5% fee and seals both chains', async () => {
    const opened = await openSigned(client, { role: 'client', counterpartyId: provider.id, priceMicros: '2000000', creditClass: 'cash' });
    expect(opened.res.status).toBe(201);
    const id = opened.json.receipt.id as string;
    expect(opened.json.receipt.state).toBe('proposed');
    expect(opened.json.receipt.confirmed).toBe(false);
    expect(opened.json.terms.hash).toBe(opened.json.receipt.termsHash);

    // anonymous cannot see an unconfirmed receipt
    expect((await app.request(`/v1/receipts/${id}`)).status).toBe(404);

    const acc = await accept(provider, id, opened.json.receipt.termsHash);
    expect(acc.status).toBe(200);
    const accJson = await parse(acc);
    expect(accJson.receipt.state).toBe('open');
    expect(accJson.receipt.confirmed).toBe(true);
    let b = await balances(client.id);
    expect(b.cash.held).toBe(2_000_000n);
    expect(b.cash.available).toBe(23_000_000n);

    const { res: delRes, outputHash } = await deliver(provider, id);
    expect(delRes.status).toBe(200);
    expect((await parse(delRes)).receipt.state).toBe('delivered');

    const v = await verdict(client, id, outputHash, 'accept', { rating: await ratingBody(client, id, provider.id, 92, ['on_time']) });
    expect(v.status).toBe(200);
    const vJson = await parse(v);
    expect(vJson.receipt.state).toBe('accepted');
    expect(vJson.receipt.ratings.revealed).toBe(false); // sealed until the provider rates too
    expect(vJson.receipt.hash).toMatch(/^[0-9a-f]{64}$/);

    const pb = await balances(provider.id);
    expect(pb.cash.available).toBe(2_000_000n - 10_000n); // ceil(2_000_000 * 50 / 10000) = 10_000
    b = await balances(client.id);
    expect(b.cash.held).toBe(0n);

    const rate = await signedReq(provider, 'POST', `/v1/receipts/${id}/rate`, await ratingBody(provider, id, client.id, 88));
    expect(rate.status).toBe(200);
    const rateJson = await parse(rate);
    expect(rateJson.revealed).toBe(true);
    expect(rateJson.receipt.ratings.provider.score).toBe(92);
    expect(rateJson.receipt.ratings.client.score).toBe(88);

    const [p] = await db.select().from(agents).where(eq(agents.id, provider.id));
    expect(p.receiptCounts).toMatchObject({ confirmed: 1 });
    expect(p.trustScore).toBeGreaterThan(50);

    const pub = await app.request(`/v1/receipts/${id}`);
    expect(pub.status).toBe(200);
    const pubJson = await parse(pub);
    expect(pubJson.receipt.events.map((e: { toState: string }) => e.toState)).toEqual(['proposed', 'open', 'delivered', 'accepted']);
    expect(pubJson._ans).toBeTruthy();

    const chain = await parse(await app.request(`/v1/agents/${provider.id}/receipts/verify`));
    expect(chain.ok).toBe(true);
    expect(chain.checked).toBe(1);
    expect(chain.signatures.failed).toBe(0);
    expect(chain.signatures.verified).toBeGreaterThanOrEqual(4);

    const list = await parse(await app.request(`/v1/agents/${provider.handle}/receipts`));
    expect(list.receipts.map((r: { id: string }) => r.id)).toContain(id);

    const recent = await parse(await app.request('/v1/receipts?recent=1&limit=50'));
    expect(recent.receipts.map((r: { id: string }) => r.id)).toContain(id);
  });

  it('chains the second receipt to the first and detects tampering', async () => {
    const opened = await openSigned(provider, { role: 'provider', counterpartyId: client.id, task: 'Proofread the changelog' });
    const id = opened.json.receipt.id as string;
    expect((await accept(client, id, opened.json.receipt.termsHash)).status).toBe(200);
    const { outputHash } = await deliver(provider, id, 'proofread text');
    expect((await verdict(client, id, outputHash, 'accept')).status).toBe(200);

    const report = await verifyAgentChain(provider.id);
    expect(report.ok).toBe(true);
    expect(report.checked).toBe(2);
    const [second] = await db.select().from(receipts).where(eq(receipts.id, id));
    expect(second.prevHashProvider).not.toBeNull();

    await db.update(receipts).set({ task: 'tampered task' }).where(eq(receipts.id, id));
    const broken = await verifyAgentChain(provider.id);
    expect(broken.ok).toBe(false);
    expect(broken.breakAt?.receiptId).toBe(id);
    await db.update(receipts).set({ task: 'Proofread the changelog' }).where(eq(receipts.id, id));
    expect((await verifyAgentChain(provider.id)).ok).toBe(true);
  });

  it('replays the same signed terms idempotently and refuses a reused nonce with different terms', async () => {
    const nonce = generateNonce();
    const first = await openSigned(client, { role: 'client', counterpartyId: provider.id, openNonce: nonce, task: 'Same terms twice' });
    expect(first.res.status).toBe(201);
    const again = await signedReq(client, 'POST', '/v1/receipts', first.body);
    expect(again.status).toBe(200);
    expect((await parse(again)).receipt.id).toBe(first.json.receipt.id);
    const different = await openSigned(client, { role: 'client', counterpartyId: provider.id, openNonce: nonce, task: 'Different terms' });
    expect(different.res.status).toBe(409);
  });

  it('refuses a bad terms signature and shows the canonical string', async () => {
    const opened = await openSigned(client, { role: 'client', counterpartyId: provider.id });
    const body = { ...opened.body, openNonce: generateNonce(), task: 'changed after signing' };
    const res = await signedReq(client, 'POST', '/v1/receipts', body);
    expect(res.status).toBe(401);
    const json = await parse(res);
    expect(json.error).toBe('invalid_signature');
    expect(json.details.signed).toContain('ans-receipt-terms-v1');
  });
});

describe('receipts: hints, policy and the clock', () => {
  let a: TestAgent;
  let b: TestAgent;

  beforeAll(async () => {
    a = await agent('rc-a');
    b = await agent('rc-b');
    await fundCash(a.id);
  });

  it('names an unregistered counterparty with a hint and lets a new agent claim it', async () => {
    const opened = await openSigned(a, { role: 'provider', hint: { name: 'Nimbus research desk', url: 'https://nimbus.example', contact: 'ops@nimbus.example' }, task: 'Market map for https://spam.example please' });
    expect(opened.res.status).toBe(201);
    const id = opened.json.receipt.id as string;
    expect(opened.json.claimToken).toMatch(/^ct_/);
    expect(opened.json.claimUrl).toContain(`/r/${id}?claim=`);

    // the claim link shows the receipt, with URLs stripped while unconfirmed
    const viaLink = await parse(await app.request(`/v1/receipts/${id}?claim=${opened.json.claimToken}`));
    expect(viaLink.claimable).toBe(true);
    expect(viaLink.receipt.task).toContain('[link removed]');
    expect(viaLink.receipt.counterpartyHint).toEqual({ name: 'Nimbus research desk', url: 'https://nimbus.example' });

    const claimant = await agent('rc-claim');
    const bad = await signedReq(claimant, 'POST', `/v1/receipts/${id}/claim`, { claimToken: 'ct_wrongwrongwrong' });
    expect(bad.status).toBe(403);
    const signature = await signMessage(claimant.privateKey, buildAcceptCanonical({ receiptId: id, termsHash: opened.json.receipt.termsHash, acceptorId: claimant.id }).canonical);
    const ok = await signedReq(claimant, 'POST', `/v1/receipts/${id}/claim`, { claimToken: opened.json.claimToken, signature });
    expect(ok.status).toBe(200);
    const json = await parse(ok);
    expect(json.receipt.state).toBe('open');
    expect(json.receipt.client.id).toBe(claimant.id);
    expect(json.receipt.counterpartyHint).toBeNull();

    // single use
    const replay = await signedReq(claimant, 'POST', `/v1/receipts/${id}/claim`, { claimToken: opened.json.claimToken, signature });
    expect(replay.status).toBe(409);
  });

  it('serves the receipt strip badge for public receipts and a not-public strip otherwise', async () => {
    const opened = await openSigned(a, { role: 'client', counterpartyId: b.id, task: 'Badge check' });
    const id = opened.json.receipt.id as string;
    const hidden = await app.request(`/v1/receipts/${id}/badge.svg`);
    expect(hidden.status).toBe(404);
    expect(hidden.headers.get('content-type')).toContain('image/svg+xml');
    expect(await hidden.text()).toContain('is not public');

    expect((await accept(b, id, opened.json.receipt.termsHash)).status).toBe(200);
    const shown = await app.request(`/v1/receipts/${id}/badge.svg`);
    expect(shown.status).toBe(200);
    const svg = await shown.text();
    expect(svg).toContain(id);
    expect(svg).toContain(`@${b.handle} for @${a.handle}`);
    expect(svg).toContain('open');
    expect(svg).not.toContain('<script');
  });

  it('declined receipts stay invisible to the public', async () => {
    const opened = await openSigned(a, { role: 'client', counterpartyId: b.id, task: 'A job b will not take' });
    const id = opened.json.receipt.id as string;
    const res = await signedReq(b, 'POST', `/v1/receipts/${id}/decline`, {});
    expect(res.status).toBe(200);
    expect((await app.request(`/v1/receipts/${id}`)).status).toBe(404);
    const list = await parse(await app.request(`/v1/agents/${a.id}/receipts`));
    expect(list.receipts.map((r: { id: string }) => r.id)).not.toContain(id);
  });

  it('428 for an unregistered counterparty id, 403 below minTrust, 400 for sandbox credit', async () => {
    const unknown = await openSigned(a, { role: 'client', counterpartyId: 'ag_doesnotexist0000' });
    expect(unknown.res.status).toBe(428);
    expect(unknown.json.error).toBe('registration_required');
    expect(unknown.json.fix.command).toContain('ans-mcp register');

    await db.update(agents).set({ policy: { requireRegistered: true, minTrust: 90 } }).where(eq(agents.id, b.id));
    const low = await openSigned(a, { role: 'client', counterpartyId: b.id });
    expect(low.res.status).toBe(403);
    expect(low.json.error).toBe('trust_below_minimum');
    expect(low.json.details.required).toBe(90);

    await db.update(agents).set({ policy: { requireRegistered: false, minTrust: 0 } }).where(eq(agents.id, b.id));
    const sandbox = await openSigned(a, { role: 'client', counterpartyId: b.id, priceMicros: '1000000', creditClass: 'sandbox' });
    expect(sandbox.res.status).toBe(400);
    expect(sandbox.json.error).toBe('validation_error');
  });

  it('402 when the client cannot fund the price', async () => {
    const opened = await openSigned(a, { role: 'client', counterpartyId: b.id, priceMicros: '999000000', creditClass: 'cash' });
    expect(opened.res.status).toBe(402);
    expect(opened.json.error).toBe('insufficient_credit');
  });

  it('rejected and undisputed for 72 hours resolves for the client with a refund', async () => {
    const opened = await openSigned(a, { role: 'client', counterpartyId: b.id, priceMicros: '1000000', creditClass: 'cash', task: 'Translate onboarding emails' });
    const id = opened.json.receipt.id as string;
    await accept(b, id, opened.json.receipt.termsHash);
    const before = await balances(a.id);
    const { outputHash } = await deliver(b, id, 'bad translation');
    const rej = await verdict(a, id, outputHash, 'reject', { reason: 'The output is in Spanish, not Portuguese, and skips two of the five emails.' });
    expect(rej.status).toBe(200);
    expect((await parse(rej)).receipt.state).toBe('rejected');

    const tick = await runClockTick(new Date(Date.now() + 73 * 3600_000));
    expect(tick.ran).toBe(true);
    const [row] = await db.select().from(receipts).where(eq(receipts.id, id));
    expect(row.state).toBe('resolved_client');
    expect(row.hash).not.toBeNull();
    const after = await balances(a.id);
    expect(after.cash.available).toBe(before.cash.available + 1_000_000n);
    expect(after.cash.held).toBe(before.cash.held - 1_000_000n);
  });

  it('a delivery nobody reviews becomes unreviewed, releases, and seals only after the dispute window', async () => {
    const opened = await openSigned(a, { role: 'client', counterpartyId: b.id, priceMicros: '500000', creditClass: 'cash', reviewWindowSec: 3600, task: 'Quick page summary' });
    const id = opened.json.receipt.id as string;
    await accept(b, id, opened.json.receipt.termsHash);
    await deliver(b, id, 'summary');
    await runClockTick(new Date(Date.now() + 2 * 3600_000));
    let [row] = await db.select().from(receipts).where(eq(receipts.id, id));
    expect(row.state).toBe('unreviewed');
    expect(row.hash).toBeNull();
    const bb = await balances(b.id);
    expect(bb.cash.available).toBeGreaterThanOrEqual(500_000n - 2_500n);

    await runClockTick(new Date(Date.now() + 8 * 86400_000));
    [row] = await db.select().from(receipts).where(eq(receipts.id, id));
    expect(row.hash).not.toBeNull();
    expect((await verifyAgentChain(b.id)).ok).toBe(true);
  });

  it('proposed receipts expire after 7 days', async () => {
    const opened = await openSigned(a, { role: 'client', counterpartyId: b.id, task: 'Never answered' });
    const id = opened.json.receipt.id as string;
    await runClockTick(new Date(Date.now() + 8 * 86400_000));
    const [row] = await db.select().from(receipts).where(eq(receipts.id, id));
    expect(row.state).toBe('expired');
    const acc = await accept(b, id, opened.json.receipt.termsHash);
    expect(acc.status).toBe(409);
  });

  it('an API-key caller can open without signing and the registry marks the signature attested', async () => {
    const key = generateApiKey();
    await db.insert(apiKeys).values({ id: key.prefix, keyHash: key.hash, agentId: a.id, scopes: ['read', 'receipts', 'invoke', 'publish'] });
    const res = await app.request('/v1/receipts', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key.key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'client', counterparty: { agentId: b.handle }, task: 'Opened from a remote MCP client', deadlineAt: deadline(), openNonce: generateNonce() }),
    });
    expect(res.status).toBe(201);
    const json = await parse(res);
    expect(json.receipt.signatures.attested).toEqual(['initiator']);
    expect(json.receipt.signatures.callerSig).toBe('attested');
  });

  it('rejects a deadline that is not a whole-second ISO string', async () => {
    const res = await signedReq(a, 'POST', '/v1/receipts', {
      role: 'client',
      counterparty: { agentId: b.id },
      task: 'bad deadline',
      deadlineAt: new Date(Date.now() + 86400_000).toISOString().replace('.000Z', '.123Z'),
      openNonce: generateNonce(),
      signature: 'x',
    });
    expect(res.status).toBe(400);
    expect((await parse(res)).details.example).toMatch(/\.000Z$/);
  });
});

describe('receipts: disputes and cancels', () => {
  it('provider disputes a rejection, then cancel rules apply', async () => {
    const c = await agent('rc-dc');
    const p = await agent('rc-dp');
    await fundCash(c.id);
    const opened = await openSigned(c, { role: 'client', counterpartyId: p.id, priceMicros: '1000000', creditClass: 'cash' });
    const id = opened.json.receipt.id as string;
    await accept(p, id, opened.json.receipt.termsHash);
    const { outputHash } = await deliver(p, id);
    await verdict(c, id, outputHash, 'reject', { reason: 'Missing the three sources the task asked for, and the summary is too short.' });
    const clientDispute = await signedReq(c, 'POST', `/v1/receipts/${id}/dispute`, { reason: 'the client cannot dispute a rejection' });
    expect(clientDispute.status).toBe(403);
    const d = await signedReq(p, 'POST', `/v1/receipts/${id}/dispute`, { reason: 'All three sources are cited in section two of the delivery.' });
    expect(d.status).toBe(200);
    expect((await parse(d)).receipt.state).toBe('disputed');

    const opened2 = await openSigned(c, { role: 'client', counterpartyId: p.id, priceMicros: '1000000', creditClass: 'cash', task: 'cancel me' });
    const id2 = opened2.json.receipt.id as string;
    await accept(p, id2, opened2.json.receipt.termsHash);
    const before = await balances(c.id);
    const cancel = await signedReq(c, 'POST', `/v1/receipts/${id2}/cancel`, { reason: 'no longer needed' });
    expect(cancel.status).toBe(200);
    expect((await parse(cancel)).receipt.state).toBe('cancelled_client');
    const after = await balances(c.id);
    expect(after.cash.available).toBe(before.cash.available + 1_000_000n);

    const noAuth = await app.request(`/v1/receipts/${id2}/cancel`, { method: 'POST' });
    expect(noAuth.status).toBe(401);
    await db.execute(sql`select 1`);
  });
});
