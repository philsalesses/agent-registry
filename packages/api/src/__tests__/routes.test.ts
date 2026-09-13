import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { and, eq, inArray } from 'drizzle-orm';
import {
  generateKeypair, toBase64, signRegistration, signRequest, signMessage, generateId, canonicalHash, SANDBOX_GRANT_MICROS,
} from 'ans-core';
import { createApp } from '../app';
import { db } from '../db';
import { agents, attestations, funnelEvents, ledgerTxns, messages, notifications, offers, webhooks, apiKeys, channels, channelMemberships, posts, votes } from '../db/schema';
import { createSessionToken } from '../lib/auth';
import { balances } from '../lib/ledger';
import { createTestAgent, deleteTestAgents, deleteRateLimitKeys, agentAccountIds, purgeLedger, body as parse, type TestAgent } from './helpers';

/**
 * Route tests against the dev database through app.request(). Every test
 * cleans up what it creates; registration tests also purge the sandbox grant
 * they caused (the ledger is append-only, so the helper lifts the triggers).
 */

const app = createApp();
const JSON_HEADERS = { 'Content-Type': 'application/json' };

async function signed(agent: TestAgent, method: string, pathname: string, body?: string): Promise<Record<string, string>> {
  const headers = await signRequest(agent.privateKey, { method, pathname, body, agentId: agent.id });
  return { ...headers, ...(body ? JSON_HEADERS : {}) } as Record<string, string>;
}

async function registrationBody(handle: string, extra: Record<string, unknown> = {}) {
  const pair = await generateKeypair();
  const privateKey = toBase64(pair.privateKey);
  const publicKey = toBase64(pair.publicKey);
  const unsigned = { name: `Test ${handle}`, handle, publicKey, type: 'assistant', description: 'route test agent', tags: ['testing'], ...extra };
  const signature = await signRegistration(privateKey, unsigned);
  return { body: { ...unsigned, signature }, privateKey, publicKey };
}

async function cleanupRegistered(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const txns = await db.select({ id: ledgerTxns.id }).from(ledgerTxns).where(and(eq(ledgerTxns.refType, 'agent'), inArray(ledgerTxns.refId, ids)));
  await purgeLedger({ txnIds: txns.map((t) => t.id), accountIds: await agentAccountIds(ids) });
  await db.delete(funnelEvents).where(inArray(funnelEvents.agentId, ids));
  await deleteTestAgents(ids);
}

const suffix = () => generateId('x', 6).slice(1).toLowerCase().replace(/[^a-z0-9]/g, 'q');

describe('POST /v1/agents (registration v2)', () => {
  const created: string[] = [];

  beforeEach(async () => {
    await deleteRateLimitKeys(['register:ip:', 'global:unknown']);
  });
  afterAll(async () => {
    await cleanupRegistered(created);
    await deleteRateLimitKeys(['register:ip:', 'global:unknown']);
  });

  it('registers with proof of possession, mints an api key and grants $25 sandbox', async () => {
    const handle = `reg-${suffix()}`;
    const { body: reg, publicKey } = await registrationBody(handle, { src: 'api' });
    const res = await app.request('/v1/agents', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(reg) });
    expect(res.status).toBe(201);
    const json = await parse(res);
    created.push(json.agent.id);

    expect(json.agent.handle).toBe(handle);
    expect(json.agent.publicKey).toBe(publicKey);
    expect(json.agent.trust).toEqual({ score: 50, confidence: 0, rank: 35, computedAt: null });
    expect(json.trust.score).toBe(50);
    expect(json.apiKey.key).toMatch(/^ak_[A-Za-z0-9_-]{32}$/);
    expect(json.apiKey.scopes).toEqual(['read', 'receipts', 'invoke', 'publish']);
    expect(json.apiKey.spendCapMicrosPerDay).toBe('0');
    expect(json.sandboxCredit).toBe(SANDBOX_GRANT_MICROS.toString());
    expect(json.next.mcpConfig).toEqual({ mcpServers: { ans: { command: 'npx', args: ['-y', 'ans-mcp'] } } });
    expect(json.next.remoteMcp.headers.Authorization).toBe(`Bearer ${json.apiKey.key}`);
    expect(json.next.remoteMcp.url).toMatch(/\/mcp$/);
    expect(json.next.skillUrl).toContain('skill.md');
    expect(json._ans.docs).toBeTruthy();

    const bal = await balances(json.agent.id);
    expect(bal.sandbox.available).toBe(25_000_000n);
    expect(bal.cash.available).toBe(0n);

    const keys = await db.select().from(apiKeys).where(eq(apiKeys.agentId, json.agent.id));
    expect(keys).toHaveLength(1);
    expect(keys[0].id).toBe(json.apiKey.key.slice(0, 11));

    const [funnel] = await db.select().from(funnelEvents).where(eq(funnelEvents.agentId, json.agent.id));
    expect(funnel?.event).toBe('register.completed');
    expect(funnel?.src).toBe('api');

    // the api key authenticates
    const me = await app.request(`/v1/agents/${json.agent.id}/heartbeat`, { method: 'POST', headers: { Authorization: `Bearer ${json.apiKey.key}` } });
    expect(me.status).toBe(200);
    expect((await parse(me)).pendingReceipts).toBe(0);
  });

  it('answers 409 conflict on a duplicate handle', async () => {
    const handle = `dup-${suffix()}`;
    const first = await registrationBody(handle);
    const r1 = await app.request('/v1/agents', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(first.body) });
    expect(r1.status).toBe(201);
    created.push((await parse(r1)).agent.id);

    const second = await registrationBody(handle);
    const r2 = await app.request('/v1/agents', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(second.body) });
    expect(r2.status).toBe(409);
    const json = await parse(r2);
    expect(json.error).toBe('conflict');
    expect(json.requestId).toBeTruthy();
    expect(r2.headers.get('Link')).toContain('rel="help"');
  });

  it('answers 400 on a reserved handle', async () => {
    const { body: reg } = await registrationBody('openai');
    const res = await app.request('/v1/agents', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(reg) });
    expect(res.status).toBe(400);
    const json = await parse(res);
    expect(json.error).toBe('validation_error');
    expect(json.details.reserved).toBe(true);

    const ans = await registrationBody('ans');
    const res2 = await app.request('/v1/agents', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(ans.body) });
    expect(res2.status).toBe(400);
  });

  it('answers 401 invalid_signature on a bad proof of possession', async () => {
    const { body: reg } = await registrationBody(`bad-${suffix()}`);
    const tampered = { ...reg, name: 'Someone else' };
    const res = await app.request('/v1/agents', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(tampered) });
    expect(res.status).toBe(401);
    const json = await parse(res);
    expect(json.error).toBe('invalid_signature');
    expect(json.fix.docs).toBeTruthy();

    const other = await generateKeypair();
    const wrongKey = { ...reg, publicKey: toBase64(other.publicKey) };
    const res2 = await app.request('/v1/agents', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(wrongKey) });
    expect(res2.status).toBe(401);
  });

  it('answers 400 when referredBy does not exist', async () => {
    const { body: reg } = await registrationBody(`ref-${suffix()}`, { referredBy: 'ag_doesnotexist0000' });
    const res = await app.request('/v1/agents', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(reg) });
    expect(res.status).toBe(400);
    expect((await parse(res)).error).toBe('validation_error');
  });

  it('refuses the private-key header with 400 private_key_in_header', async () => {
    const { body: reg } = await registrationBody(`pk-${suffix()}`);
    const res = await app.request('/v1/agents', { method: 'POST', headers: { ...JSON_HEADERS, ['X-Agent-Private-' + 'Key']: 'nope' }, body: JSON.stringify(reg) });
    expect(res.status).toBe(400);
    expect((await parse(res)).error).toBe('private_key_in_header');
  });
});

describe('agent profile, policy, heartbeat, transfer, keys', () => {
  let agent: TestAgent;
  let other: TestAgent;

  beforeAll(async () => {
    agent = await createTestAgent('own');
    other = await createTestAgent('oth');
  });
  afterAll(async () => {
    await deleteTestAgents([agent.id, other.id]);
    await deleteRateLimitKeys(['global:unknown']);
  });

  it('GET /v1/agents/:idOrHandle is public and resolves handles', async () => {
    const res = await app.request(`/v1/agents/@${agent.handle}`);
    expect(res.status).toBe(200);
    const json = await parse(res);
    expect(json.agent.id).toBe(agent.id);
    expect(json.trust.score).toBe(50);
    expect(json.receiptCounts).toEqual({ confirmed: 0, unconfirmed: 0, unreviewed: 0, negative: 0, noReview: 0 });
    expect(json.offers).toEqual([]);
    expect(json.vouches).toBe(0);
    expect(json.policy).toEqual({ requireRegistered: false, minTrust: 0, acceptSandbox: true });
    expect(json._ans.register).toBeTruthy();

    const list = await app.request('/v1/agents?sort=rank&limit=5');
    expect(list.status).toBe(200);
    expect(Array.isArray((await parse(list)).agents)).toBe(true);

    const missing = await app.request('/v1/agents/@no-such-handle-xyz');
    expect(missing.status).toBe(404);
    expect((await parse(missing)).error).toBe('not_found');
  });

  it('PATCH policy as owner (signed), refused unauthenticated and for another agent', async () => {
    const path = `/v1/agents/${agent.id}`;
    const body = JSON.stringify({ policy: { minTrust: 40, requireRegistered: true }, description: 'updated' });
    const res = await app.request(path, { method: 'PATCH', headers: await signed(agent, 'PATCH', path, body), body });
    expect(res.status).toBe(200);
    const json = await parse(res);
    expect(json.policy).toEqual({ requireRegistered: true, minTrust: 40, acceptSandbox: true });
    expect(json.agent.description).toBe('updated');

    const anon = await app.request(path, { method: 'PATCH', headers: JSON_HEADERS, body });
    expect(anon.status).toBe(401);

    const asOther = await app.request(path, { method: 'PATCH', headers: await signed(other, 'PATCH', path, body), body });
    expect(asOther.status).toBe(403);

    // session works too
    const token = await createSessionToken(agent.id);
    const viaSession = await app.request(path, { method: 'PATCH', headers: { ...JSON_HEADERS, Authorization: `Bearer ${token}` }, body: JSON.stringify({ policy: { minTrust: 0 } }) });
    expect(viaSession.status).toBe(200);
    expect((await parse(viaSession)).policy.minTrust).toBe(0);
  });

  it('heartbeat needs auth: 401 unauthenticated, 200 signed with pendingReceipts', async () => {
    const path = `/v1/agents/${agent.id}/heartbeat`;
    const anon = await app.request(path, { method: 'POST' });
    expect(anon.status).toBe(401);
    expect((await parse(anon)).error).toBe('unauthorized');

    const res = await app.request(path, { method: 'POST', headers: await signed(agent, 'POST', path) });
    expect(res.status).toBe(200);
    const json = await parse(res);
    expect(json.status).toBe('ok');
    expect(json.pendingReceipts).toBe(0);

    const [row] = await db.select({ status: agents.status }).from(agents).where(eq(agents.id, agent.id));
    expect(row.status).toBe('online');
  });

  it('transfer is key-only: 401 without auth, 403 with a session, 200 signed', async () => {
    const path = `/v1/agents/${agent.id}/transfer`;
    const pair = await generateKeypair();
    const body = JSON.stringify({ newPublicKey: toBase64(pair.publicKey) });

    const anon = await app.request(path, { method: 'POST', headers: JSON_HEADERS, body });
    expect(anon.status).toBe(401);

    const token = await createSessionToken(agent.id);
    const viaSession = await app.request(path, { method: 'POST', headers: { ...JSON_HEADERS, Authorization: `Bearer ${token}` }, body });
    expect(viaSession.status).toBe(403);

    const ok = await app.request(path, { method: 'POST', headers: await signed(agent, 'POST', path, body), body });
    expect(ok.status).toBe(200);
    expect((await parse(ok)).agent.publicKey).toBe(toBase64(pair.publicKey));

    // the old key no longer verifies
    const stale = await app.request(`/v1/agents/${agent.id}/heartbeat`, { method: 'POST', headers: await signed(agent, 'POST', `/v1/agents/${agent.id}/heartbeat`) });
    expect(stale.status).toBe(401);
    agent = { ...agent, privateKey: toBase64(pair.privateKey), publicKey: toBase64(pair.publicKey) };
  });

  it('api keys: POST key-only, GET prefixes only, DELETE revokes', async () => {
    const path = `/v1/agents/${agent.id}/keys`;
    const body = JSON.stringify({ scopes: ['read', 'invoke'], spendCapMicrosPerDay: '5000000', label: 'ci' });
    const minted = await app.request(path, { method: 'POST', headers: await signed(agent, 'POST', path, body), body });
    expect(minted.status).toBe(201);
    const key = await parse(minted);
    expect(key.key).toMatch(/^ak_/);
    expect(key.scopes).toEqual(['read', 'invoke']);
    expect(key.spendCapMicrosPerDay).toBe('5000000');

    const token = await createSessionToken(agent.id);
    const bySession = await app.request(path, { method: 'POST', headers: { ...JSON_HEADERS, Authorization: `Bearer ${token}` }, body });
    expect(bySession.status).toBe(403);

    const list = await app.request(path, { headers: { Authorization: `Bearer ${token}` } });
    expect(list.status).toBe(200);
    const keys = (await parse(list)).keys;
    expect(keys.some((k: { id: string; key?: string }) => k.id === key.id && k.key === undefined)).toBe(true);

    // scope enforcement: the key lacks 'receipts'
    const send = await app.request('/v1/messages', { method: 'POST', headers: { ...JSON_HEADERS, Authorization: `Bearer ${key.key}` }, body: JSON.stringify({ toAgentId: other.id, content: 'hi' }) });
    expect(send.status).toBe(403);

    const del = await app.request(`${path}/${key.id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
    expect(del.status).toBe(200);
    const revoked = await app.request('/v1/notifications/count', { headers: { Authorization: `Bearer ${key.key}` } });
    expect(revoked.status).toBe(401);
  });
});

describe('auth challenge flow', () => {
  let agent: TestAgent;
  beforeAll(async () => { agent = await createTestAgent('chal'); });
  afterAll(async () => { await deleteTestAgents([agent.id]); await deleteRateLimitKeys(['global:unknown']); });

  it('challenge -> signed nonce -> session token -> GET /v1/auth/session', async () => {
    const ch = await app.request('/v1/auth/challenge', { method: 'POST' });
    expect(ch.status).toBe(200);
    const { id, nonce } = await parse(ch);
    const signature = await signMessage(agent.privateKey, nonce);
    const verify = await app.request('/v1/auth/verify', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ challengeId: id, agentId: `@${agent.handle}`, signature }) });
    expect(verify.status).toBe(200);
    const { token, agent: who } = await parse(verify);
    expect(who.id).toBe(agent.id);

    const session = await app.request('/v1/auth/session', { headers: { Authorization: `Bearer ${token}` } });
    expect(session.status).toBe(200);
    expect((await parse(session)).valid).toBe(true);

    const replay = await app.request('/v1/auth/verify', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ challengeId: id, agentId: agent.id, signature }) });
    expect(replay.status).toBe(400);

    const gone = await app.request('/v1/auth/session', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ agentId: agent.id, privateKey: agent.privateKey }) });
    expect(gone.status).toBe(404);
  });
});

describe('vouches, messages, notifications', () => {
  let attester: TestAgent;
  let subject: TestAgent;
  beforeAll(async () => {
    attester = await createTestAgent('att');
    subject = await createTestAgent('sub');
  });
  afterAll(async () => {
    await db.delete(attestations).where(inArray(attestations.attesterId, [attester.id, subject.id]));
    await db.delete(messages).where(inArray(messages.fromAgentId, [attester.id, subject.id]));
    await db.delete(notifications).where(inArray(notifications.agentId, [attester.id, subject.id]));
    await deleteTestAgents([attester.id, subject.id]);
    await deleteRateLimitKeys(['global:unknown']);
  });

  it('POST /v1/attestations stores a vouch and warns that it has zero weight', async () => {
    const claim = { type: 'behavior', value: 90 };
    const message = JSON.stringify({ attesterId: attester.id, subjectId: subject.id, claim });
    const body = JSON.stringify({ attesterId: attester.id, subjectId: subject.id, claim, signature: await signMessage(attester.privateKey, message) });
    const res = await app.request('/v1/attestations', { method: 'POST', headers: await signed(attester, 'POST', '/v1/attestations', body), body });
    expect(res.status).toBe(201);
    const json = await parse(res);
    expect(json.warning).toBe('Vouches carry zero weight in trust; open a receipt for work you did together');
    expect(json.docs).toContain('/docs/receipts');
    expect(json.subjectId).toBe(subject.id);

    const asSomeoneElse = await app.request('/v1/attestations', { method: 'POST', headers: await signed(subject, 'POST', '/v1/attestations', body), body });
    expect(asSomeoneElse.status).toBe(403);

    const anon = await app.request('/v1/attestations', { method: 'POST', headers: JSON_HEADERS, body });
    expect(anon.status).toBe(401);

    const profile = await parse(await app.request(`/v1/agents/${subject.id}`));
    expect(profile.vouches).toBe(1);
    expect(profile.trust.score).toBe(50);
  });

  it('messages honour the recipient policy (403 trust_below_minimum) and accept signed senders', async () => {
    await db.update(agents).set({ policy: { requireRegistered: true, minTrust: 60, acceptSandbox: true } }).where(eq(agents.id, subject.id));
    const body = JSON.stringify({ toAgentId: `@${subject.handle}`, content: 'hello' });
    const blocked = await app.request('/v1/messages', { method: 'POST', headers: await signed(attester, 'POST', '/v1/messages', body), body });
    expect(blocked.status).toBe(403);
    const json = await parse(blocked);
    expect(json.error).toBe('trust_below_minimum');
    expect(json.details).toMatchObject({ required: 60, actual: 50 });

    await db.update(agents).set({ policy: { requireRegistered: false, minTrust: 0, acceptSandbox: true } }).where(eq(agents.id, subject.id));
    const sent = await app.request('/v1/messages', { method: 'POST', headers: await signed(attester, 'POST', '/v1/messages', body), body });
    expect(sent.status).toBe(201);

    const inbox = await app.request('/v1/messages', { headers: await signed(subject, 'GET', '/v1/messages') });
    expect(inbox.status).toBe(200);
    expect((await parse(inbox)).messages[0].fromAgentId).toBe(attester.id);

    const token = await createSessionToken(subject.id);
    const notif = await app.request('/v1/notifications?unread=true', { headers: { Authorization: `Bearer ${token}` } });
    expect(notif.status).toBe(200);
    expect((await parse(notif)).unreadCount).toBeGreaterThanOrEqual(1);
  });
});

describe('capabilities and discovery', () => {
  let high: TestAgent;
  let low: TestAgent;
  const tag = `tag-${suffix()}`;
  beforeAll(async () => {
    high = await createTestAgent('hi');
    low = await createTestAgent('lo');
    await db.update(agents).set({ trustRank: 88, trustScore: 90, tags: [tag, 'testing'], description: 'summarizes documents' }).where(eq(agents.id, high.id));
    await db.update(agents).set({ trustRank: 12, trustScore: 30, tags: [tag], description: 'summarizes documents' }).where(eq(agents.id, low.id));
  });
  afterAll(async () => { await deleteTestAgents([high.id, low.id]); await deleteRateLimitKeys(['global:unknown']); });

  it('GET /v1/capabilities and /common both answer', async () => {
    const common = await app.request('/v1/capabilities/common');
    expect(common.status).toBe(200);
    const json = await parse(common);
    expect(json.capabilities.length).toBeGreaterThan(5);
    expect(json.capabilities[0].id).toBe('text-generation');

    const all = await app.request('/v1/capabilities');
    expect(all.status).toBe(200);
    expect(Array.isArray((await parse(all)).capabilities)).toBe(true);

    const post = await app.request('/v1/capabilities', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ id: 'squat', description: 'x' }) });
    expect(post.status).toBe(404);
  });

  it('POST /v1/discover filters on tags and orders by trust_rank', async () => {
    const res = await app.request('/v1/discover', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ tags: [tag] }) });
    expect(res.status).toBe(200);
    const json = await parse(res);
    expect(json.agents.map((a: { id: string }) => a.id)).toEqual([high.id, low.id]);
    expect(json.total).toBe(2);

    const filtered = await app.request('/v1/discover', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ capabilities: [tag], minTrust: 50 }) });
    expect((await parse(filtered)).agents.map((a: { id: string }) => a.id)).toEqual([high.id]);

    const search = await app.request(`/v1/discover/search?q=${encodeURIComponent(high.handle)}`);
    expect((await parse(search)).agents[0].id).toBe(high.id);

    const find = await app.request('/v1/discover/find?q=summarizes');
    expect(find.status).toBe(200);
    const found = await parse(find);
    expect(found.offers).toEqual([]);
    const ids = found.agents.map((a: { id: string }) => a.id);
    expect(ids.indexOf(high.id)).toBeLessThan(ids.indexOf(low.id));

    const gone = await app.request('/v1/discover/capability/web-search');
    expect(gone.status).toBe(404);
  });
});

describe('a2a agent card from offers', () => {
  let owner: TestAgent;
  let offerId: string;
  beforeAll(async () => {
    owner = await createTestAgent('a2a');
    offerId = generateId('of_', 16);
    const inputSchema = { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] };
    const outputSchema = { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] };
    await db.insert(offers).values({
      id: offerId,
      agentId: owner.id,
      slug: 'fetch-page',
      version: 1,
      title: 'Fetch a page',
      description: 'Fetches a URL and returns readable text',
      inputSchema,
      outputSchema,
      inputSchemaHash: canonicalHash(inputSchema),
      outputSchemaHash: canonicalHash(outputSchema),
      examples: [{ input: { url: 'https://example.com' }, output: { text: 'Example Domain' } }],
      tags: ['web-browsing'],
      priceMicros: 250_000n,
      publishSig: 'test-publish-sig',
    });
  });
  afterAll(async () => {
    await db.delete(offers).where(eq(offers.id, offerId));
    await deleteTestAgents([owner.id]);
    await deleteRateLimitKeys(['global:unknown']);
  });

  it('builds skills from active offers and 301s the old path', async () => {
    const res = await app.request(`/v1/a2a/agent/${owner.id}/agent-card.json`);
    expect(res.status).toBe(200);
    const card = await parse(res);
    expect(card.authentication.schemes).toEqual(['ans-signed']);
    expect(card.skills).toHaveLength(1);
    const skill = card.skills[0];
    expect(skill.id).toBe(offerId);
    expect(skill.name).toBe('Fetch a page');
    expect(skill.inputModes).toEqual(['application/json']);
    expect(skill.outputModes).toEqual(['application/json']);
    expect(skill['x-ans'].offerId).toBe(offerId);
    expect(skill['x-ans'].priceMicros).toBe('250000');
    expect(skill['x-ans'].inputSchemaUrl).toContain(`/v1/offers/${offerId}/input.json`);
    expect(skill['x-ans'].trust.score).toBe(50);

    const old = await app.request(`/v1/a2a/agent/${owner.id}/agent.json`, { redirect: 'manual' });
    expect(old.status).toBe(301);
    expect(old.headers.get('location')).toBe(`/v1/a2a/agent/${owner.id}/agent-card.json`);

    const profile = await parse(await app.request(`/v1/agents/${owner.id}`));
    expect(profile.offers[0].id).toBe(offerId);
    expect(profile.offers[0].name).toBe(`@${owner.handle}/fetch-page@1`);

    const find = await parse(await app.request('/v1/discover/find?q=readable'));
    expect(find.offers[0].id).toBe(offerId);

    const rpc = await app.request(`/v1/a2a/agent/${owner.id}/rpc`, { method: 'POST', headers: JSON_HEADERS, body: '{}' });
    expect(rpc.status).toBe(404);
  });
});

describe('webhooks', () => {
  let agent: TestAgent;
  let token: string;
  beforeAll(async () => {
    agent = await createTestAgent('wh');
    token = await createSessionToken(agent.id);
  });
  afterAll(async () => {
    await db.delete(webhooks).where(eq(webhooks.agentId, agent.id));
    await deleteTestAgents([agent.id]);
    await deleteRateLimitKeys(['global:unknown']);
  });

  async function create(url: string, events: string[] = ['receipt.proposed']) {
    return app.request('/v1/webhooks', { method: 'POST', headers: { ...JSON_HEADERS, Authorization: `Bearer ${token}` }, body: JSON.stringify({ url, events }) });
  }

  it('rejects http and private URLs, accepts a public https URL, lists new receipt events', async () => {
    for (const bad of ['http://example.com/hook', 'https://127.0.0.1/hook', 'https://localhost/hook', 'https://10.1.2.3/hook', 'https://192.168.1.10/hook', 'https://169.254.169.254/latest', 'https://[::1]/hook', 'https://user:pw@example.com/hook']) {
      const res = await create(bad);
      expect(res.status, bad).toBe(400);
      expect((await parse(res)).error).toBe('validation_error');
    }

    const ok = await create('https://example.com/ans-hook', ['receipt.proposed', 'wallet.credited']);
    expect(ok.status).toBe(201);
    const json = await parse(ok);
    expect(json.secret.length).toBeGreaterThan(20);
    expect(json.events).toEqual(['receipt.proposed', 'wallet.credited']);

    const unknownEvent = await create('https://example.com/other', ['nope.event']);
    expect(unknownEvent.status).toBe(400);

    const list = await app.request('/v1/webhooks', { headers: { Authorization: `Bearer ${token}` } });
    expect((await parse(list)).webhooks[0].secret).toMatch(/^\*\*\*\*/);

    const events = await parse(await app.request('/v1/webhooks/events'));
    const names = events.events.map((e: { name: string }) => e.name);
    for (const e of ['receipt.proposed', 'receipt.opened', 'receipt.delivered', 'receipt.sealed', 'receipt.disputed', 'invoke.received', 'wallet.credited']) {
      expect(names).toContain(e);
    }

    const anon = await app.request('/v1/webhooks');
    expect(anon.status).toBe(401);
  });
});

describe('legacy surfaces', () => {
  afterAll(async () => { await deleteRateLimitKeys(['global:unknown']); });

  it('/v1/mcp/* answers 410 with a pointer at /mcp', async () => {
    const res = await app.request('/v1/mcp/rpc', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ jsonrpc: '2.0', method: 'initialize', id: 1 }) });
    expect(res.status).toBe(410);
    const json = await parse(res);
    expect(json.fix.url).toMatch(/\/mcp$/);
    expect(json.fix.mcp).toBe('npx -y ans-mcp');
    expect(res.headers.get('Deprecation')).toBe('true');
  });

  it('/v1/claim is gone and the OpenAPI spec never mentions the private-key header', async () => {
    const claim = await app.request('/v1/claim', { method: 'POST', headers: JSON_HEADERS, body: '{}' });
    expect(claim.status).toBe(404);
    const spec = await app.request('/docs/openapi.json');
    expect(spec.status).toBe(200);
    const text = await spec.text();
    expect(text).not.toContain('X-Agent-Private-' + 'Key');
    expect(text).toContain('X-Agent-Signature');
    expect(JSON.parse(text).paths['/v1/agents'].post).toBeTruthy();
  });
});

describe('reputation, analytics, cards', () => {
  let agent: TestAgent;
  beforeAll(async () => {
    agent = await createTestAgent('rep');
    await db.update(agents).set({ trustScore: 72, trustConfidence: 0.4, trustRank: 63, tags: ['web-search', 'reasoning'], receiptCounts: { confirmed: 3, unconfirmed: 1, unreviewed: 0, negative: 0, noReview: 0 } }).where(eq(agents.id, agent.id));
  });
  afterAll(async () => { await deleteTestAgents([agent.id]); await deleteRateLimitKeys(['global:unknown']); });

  it('reads the materialized trust columns everywhere', async () => {
    const rep = await parse(await app.request(`/v1/reputation/@${agent.handle}`));
    expect(rep.trust).toMatchObject({ score: 72, confidence: 0.4, rank: 63 });
    expect(rep.receiptCounts.confirmed).toBe(3);
    expect(rep.vouches.weight).toBe(0);

    const board = await parse(await app.request('/v1/reputation/leaderboard?limit=100'));
    const ranks = board.leaderboard.map((a: { trust: { rank: number } }) => a.trust.rank);
    expect(ranks).toEqual([...ranks].sort((a, b) => b - a));
    expect(board.leaderboard.some((a: { id: string }) => a.id === agent.id)).toBe(true);

    const stats = await parse(await app.request('/v1/analytics/stats'));
    expect(stats.totals.agents).toBeGreaterThanOrEqual(1);
    expect(typeof stats.receiptsByState).toBe('object');

    const caps = await parse(await app.request('/v1/analytics/capabilities'));
    expect(caps.capabilities.some((c: { id: string }) => c.id === 'web-search')).toBe(true);

    const per = await parse(await app.request(`/v1/analytics/agent/${agent.id}`));
    expect(per.trust.score).toBe(72);
    expect(per.tags).toEqual(['web-search', 'reasoning']);

    const lb = await parse(await app.request('/v1/analytics/leaderboard?limit=100'));
    expect(lb.agents.some((a: { id: string }) => a.id === agent.id)).toBe(true);

    const card = await app.request(`/v1/agents/@${agent.handle}/card?style=badge`);
    expect(card.status).toBe(200);
    expect(card.headers.get('content-type')).toContain('image/svg+xml');
    const svg = await card.text();
    expect(svg).toContain('72');
    expect(svg).toContain('confidence 0.40');
    const flat = await (await app.request(`/v1/agents/${agent.id}/card`)).text();
    expect(flat).toContain(`@${agent.handle}`);
    const embed = await parse(await app.request(`/v1/agents/${agent.id}/card/embed`));
    expect(embed.markdown).toContain(agent.id);
  });
});

describe('channels', () => {
  let creator: TestAgent;
  let member: TestAgent;
  let slug: string;
  beforeAll(async () => {
    creator = await createTestAgent('chc');
    member = await createTestAgent('chm');
    await db.update(agents).set({ trustScore: 30 }).where(eq(agents.id, member.id));
  });
  afterAll(async () => {
    const chs = await db.select({ id: channels.id }).from(channels).where(eq(channels.creatorId, creator.id));
    const ids = chs.map((c) => c.id);
    if (ids.length) {
      const ps = await db.select({ id: posts.id }).from(posts).where(inArray(posts.channelId, ids));
      if (ps.length) await db.delete(votes).where(inArray(votes.postId, ps.map((p) => p.id)));
      await db.delete(posts).where(inArray(posts.channelId, ids));
      await db.delete(channelMemberships).where(inArray(channelMemberships.channelId, ids));
      await db.delete(channels).where(inArray(channels.id, ids));
    }
    await db.delete(notifications).where(inArray(notifications.agentId, [creator.id, member.id]));
    await deleteTestAgents([creator.id, member.id]);
    await deleteRateLimitKeys(['global:unknown']);
  });

  it('gates joining on agents.trust_score and stamps the author score on posts', async () => {
    const name = `Room ${suffix()}`;
    const created = await app.request('/v1/channels', { method: 'POST', headers: await signed(creator, 'POST', '/v1/channels', JSON.stringify({ name, minTrustScore: 40 })), body: JSON.stringify({ name, minTrustScore: 40 }) });
    expect(created.status).toBe(201);
    slug = (await parse(created)).slug;

    const token = await createSessionToken(member.id);
    const blocked = await app.request(`/v1/channels/${slug}/join`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
    expect(blocked.status).toBe(403);
    expect((await parse(blocked)).error).toBe('trust_below_minimum');

    await db.update(agents).set({ trustScore: 65 }).where(eq(agents.id, member.id));
    const joined = await app.request(`/v1/channels/${slug}/join`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
    expect(joined.status).toBe(200);

    const post = await app.request(`/v1/channels/${slug}/posts`, { method: 'POST', headers: { ...JSON_HEADERS, Authorization: `Bearer ${token}` }, body: JSON.stringify({ title: 'hello', content: 'first post' }) });
    expect(post.status).toBe(201);
    const p = await parse(post);
    expect(p.authorTrustScore).toBe(65);
    expect(p.author.id).toBe(member.id);

    const vote = await app.request(`/v1/channels/${slug}/posts/${p.id}/vote`, { method: 'POST', headers: await signed(creator, 'POST', `/v1/channels/${slug}/posts/${p.id}/vote`, JSON.stringify({ value: 1 })), body: JSON.stringify({ value: 1 }) });
    expect(vote.status).toBe(200);
    expect((await parse(vote)).score).toBe(1);

    const anon = await app.request(`/v1/channels/${slug}/posts`, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ title: 'x', content: 'y' }) });
    expect(anon.status).toBe(401);
  });
});
