import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { feeForPrice } from 'ans-core';
import { ANSClient, AgentIdentity, AnsApiError, hashOutput, type RegisterResult } from '../src';
import { AgentTracker, mountedRoutes, startApi, suffix, type TestApi } from './helpers';

// Decided before the suites are collected: the wallet router may still be a 501 stub
const { wallet } = await mountedRoutes();

let api: TestApi;
let agents: AgentTracker;

let client: ANSClient;
let provider: ANSClient;
let third: ANSClient;
let clientReg: RegisterResult;
let providerReg: RegisterResult;
let thirdReg: RegisterResult;

beforeAll(async () => {
  api = await startApi();
  agents = new AgentTracker(api.baseUrl);
  ({ client, res: clientReg } = await agents.register('sdk-client'));
  ({ client: provider, res: providerReg } = await agents.register('sdk-prov'));
  ({ client: third, res: thirdReg } = await agents.register('sdk-third'));
});

afterAll(async () => {
  await agents?.cleanup();
  await api?.close();
});

describe('register', () => {
  it('returns the agent, a one-time API key and credentials that restore the identity', async () => {
    expect(clientReg.agent.id).toMatch(/^ag_[A-Za-z0-9]{16}$/);
    expect(clientReg.agent.handle).toMatch(/^sdk-client-/);
    expect(clientReg.apiKey.key).toMatch(/^ak_[A-Za-z0-9_-]{32}$/);
    expect(clientReg.apiKey.scopes).toEqual(['read', 'receipts', 'invoke', 'publish']);
    expect(clientReg.sandboxCredit).toBe('25000000');
    expect(clientReg.trust.score).toBe(50);

    const creds = clientReg.credentials;
    expect(creds.agentId).toBe(clientReg.agent.id);
    expect(creds.publicKey).toBe(clientReg.agent.publicKey);
    expect(creds.handle).toBe(clientReg.agent.handle);
    expect(creds.apiKey).toBe(clientReg.apiKey.key);
    expect(client.agentId).toBe(creds.agentId);
    expect(client.identity?.agentId).toBe(creds.agentId);

    const restored = AgentIdentity.fromCredentials({ agentId: creds.agentId, privateKey: creds.privateKey });
    expect(restored.publicKey).toBe(creds.publicKey);
    expect(() => AgentIdentity.fromCredentials({ ...creds, publicKey: providerReg.credentials.publicKey })).toThrow(/does not match/);
    // The private key never leaks through JSON
    expect(JSON.stringify(restored)).not.toContain(creds.privateKey);

    // A restored identity signs for the same agent
    const again = new ANSClient({ baseUrl: api.baseUrl, identity: restored });
    const beat = await again.heartbeat();
    expect(beat.status).toBe('ok');
  });

  it.skipIf(!wallet)('grants $25 of sandbox credit, visible in the wallet and the ledger', async () => {
    const w = await client.wallet();
    expect(w.agentId).toBe(clientReg.agent.id);
    expect(w.sandbox.available).toBe('25000000');
    const page = await client.ledger();
    const grant = page.txns.find((t) => t.type === 'grant');
    expect(grant?.refId).toBe(clientReg.agent.id);
    expect(grant?.entries.find((e) => e.ownerId === clientReg.agent.id)?.amountMicros).toBe('25000000');
  });

  it('refuses to register an identity twice', async () => {
    await expect(client.register({ name: 'again', handle: `sdk-again-${suffix()}`, type: 'assistant' })).rejects.toMatchObject({ code: 'conflict' });
  });
});

describe('verify and trust', () => {
  it('verifies a registered agent by handle and by id', async () => {
    const byHandle = await client.verify(providerReg.agent.handle!);
    expect(byHandle.registered).toBe(true);
    expect(byHandle.id).toBe(providerReg.agent.id);
    expect(byHandle.trust?.score).toBe(50);
    expect(byHandle.fix).toBeNull();
    const byAt = await client.verify(`@${providerReg.agent.handle}`);
    expect(byAt.id).toBe(providerReg.agent.id);
  });

  it('reports an unregistered agent with the register fix', async () => {
    const v = await client.verify(`nobody-${suffix()}`);
    expect(v.registered).toBe(false);
    expect(v.id).toBeNull();
    expect(v.fix?.url).toMatch(/register/);
    expect(v.fix?.command).toMatch(/ans-mcp register/);
  });

  it('verifies many in order', async () => {
    const missing = `ghost-${suffix()}`;
    const results = await client.verifyMany([providerReg.agent.id, thirdReg.agent.handle!, missing]);
    expect(results.map((r) => r.query)).toEqual([providerReg.agent.id, thirdReg.agent.handle, missing]);
    expect(results.map((r) => r.registered)).toEqual([true, true, false]);
  });

  it('serves the trust formula and a breakdown', async () => {
    const formula = await client.trustFormula();
    expect(formula.version).toBe('trust-v1');
    expect(formula.formula.k).toBe(2);
    const breakdown = await client.trust(providerReg.agent.handle!);
    expect(breakdown.agentId).toBe(providerReg.agent.id);
    expect(breakdown.score).toBe(50);
  });
});

describe('a paid receipt from open to sealed', () => {
  const output = { themes: ['billing confusion', 'slow onboarding', 'missing export'], tickets: 40 };
  let receiptId = '';

  it('opens a sandbox-priced receipt signed by the client', async () => {
    const opened = await client.openReceipt({
      role: 'client',
      counterparty: providerReg.agent.handle!,
      task: '  Summarize 40 support tickets into themes  ',
      priceUsd: 2.5,
      creditClass: 'sandbox',
    });
    receiptId = opened.receipt.id;
    expect(receiptId).toMatch(/^rc_/);
    expect(opened.replayed).toBe(false);
    expect(opened.claimUrl).toBeNull();
    const r = opened.receipt;
    expect(r.state).toBe('proposed');
    expect(r.task).toBe('Summarize 40 support tickets into themes');
    expect(r.client?.id).toBe(clientReg.agent.id);
    expect(r.provider?.id).toBe(providerReg.agent.id);
    expect(r.priceMicros).toBe('2500000');
    expect(r.creditClass).toBe('sandbox');
    expect(r.feeBps).toBe(50);
    expect(r.feeMicros).toBe(feeForPrice(2_500_000n, 50).toString());
    expect(r.termsHash).toBe(opened.terms.hash);
    expect(r.signatures).toMatchObject({ initiator: true, counterparty: false, callerSig: 'signed', attested: [] });
    expect(Date.parse(r.deadlineAt) - Date.now()).toBeGreaterThan(47 * 3600_000);
    expect(r.deadlineAt).toMatch(/:\d\d\.000Z$/);
  });

  it('is accepted (countersigned) by the provider', async () => {
    const { receipt } = await provider.acceptReceipt(receiptId);
    expect(receipt.state).toBe('open');
    expect(receipt.signatures.counterparty).toBe(true);
    expect(receipt.signatures.attested).toEqual([]);
  });

  it.skipIf(!wallet)('holds the price in escrow', async () => {
    const w = await client.wallet();
    expect(w.sandbox.available).toBe('22500000');
    expect(w.sandbox.held).toBe('2500000');
  });

  it('is delivered with the canonical output hash', async () => {
    const { receipt } = await provider.deliverReceipt(receiptId, output);
    expect(receipt.state).toBe('delivered');
    expect(receipt.outputHash).toBe(hashOutput(output));
    expect(receipt.signatures.deliver).toBe(true);
  });

  it('is accepted by the client with a rating, which seals it', async () => {
    const { receipt } = await client.verdict(receiptId, 'accept', { score: 92, tags: ['on_time', 'as_specified', 'on_time'] });
    expect(receipt.state).toBe('accepted');
    expect(receipt.signatures.verdict).toBe(true);
    expect(receipt.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(receipt.ratings.revealed).toBe(false);
  });

  it('is rated back by the provider, which reveals both ratings', async () => {
    const rated = await provider.rate(receiptId, { score: 88, tags: ['on_time'], note: 'Clear brief, quick verdict' });
    expect(rated.revealed).toBe(true);
    const { receipt } = await client.getReceipt(receiptId);
    expect(receipt.ratings.revealed).toBe(true);
    expect(receipt.ratings.provider).toMatchObject({ raterId: clientReg.agent.id, subjectId: providerReg.agent.id, score: 92 });
    expect([...(receipt.ratings.provider?.tags ?? [])].sort()).toEqual(['as_specified', 'on_time']);
    expect(receipt.ratings.client).toMatchObject({ raterId: providerReg.agent.id, subjectId: clientReg.agent.id, score: 88 });
  });

  it.skipIf(!wallet)('released escrow to the provider minus the fee', async () => {
    const w = await provider.wallet();
    const fee = feeForPrice(2_500_000n, 50);
    expect(BigInt(w.sandbox.available)).toBe(25_000_000n + 2_500_000n - fee);
  });

  it('verifies both agents\' receipt chains, signatures included', async () => {
    for (const who of [client, provider]) {
      const report = await who.verifyChain();
      expect(report.ok).toBe(true);
      expect(report.checked).toBe(1);
      expect(report.breakAt).toBeNull();
      expect(report.signatures.failed).toBe(0);
      expect(report.signatures.verified).toBe(4);
      expect(report.signatures.attested).toBe(0);
    }
    const mine = await client.myReceipts({ role: 'client' });
    expect(mine.receipts.map((r) => r.id)).toContain(receiptId);
  });
});

describe('a rejected delivery disputed by the provider', () => {
  it('rejects with a reason, then the provider disputes', async () => {
    const opened = await client.openReceipt({ role: 'client', counterparty: providerReg.agent.id, task: 'Write migration notes for v2', deadlineHours: 24, reviewWindowSec: 3600 });
    expect(opened.receipt.reviewWindowSec).toBe(3600);
    await provider.acceptReceipt(opened.receipt.id);
    await provider.deliverReceipt(opened.receipt.id, 'Migration notes: rename config keys, rerun the backfill.', 'https://example.com/notes/v2');
    const rejected = await client.verdict(opened.receipt.id, 'reject', { reason: 'The notes skip the database changes, which are the riskiest part of v2.' });
    expect(rejected.receipt.state).toBe('rejected');
    expect(rejected.receipt.signatures.verdict).toBe(true);
    const disputed = await provider.dispute(opened.receipt.id, 'Database changes were out of scope in the task text.', [{ url: 'https://example.com/scope' }]);
    expect(disputed.receipt.state).toBe('disputed');
  });
});

describe('a hint receipt claimed by a third agent', () => {
  it('opens with a claim link and is claimed by a newly met agent', async () => {
    const opened = await client.openReceipt({
      role: 'client',
      counterparty: { name: 'Riverside Research', url: 'https://riverside.example', contact: '  OPS@riverside.example ' },
      task: 'Draft a literature review on agent receipts',
    });
    expect(opened.receipt.state).toBe('proposed');
    expect(opened.receipt.provider).toBeNull();
    expect(opened.receipt.counterpartyHint).toEqual({ name: 'Riverside Research', url: 'https://riverside.example' });
    expect(opened.claimToken).toBeTruthy();
    expect(opened.claimUrl).toContain(`/r/${opened.receipt.id}?claim=`);

    const { receipt } = await third.claimReceipt(opened.claimUrl!);
    expect(receipt.state).toBe('open');
    expect(receipt.provider?.id).toBe(thirdReg.agent.id);
    expect(receipt.signatures.counterparty).toBe(true);
    expect(receipt.signatures.attested).toEqual([]);
  });

  it('lets the named counterparty decline a proposal', async () => {
    const opened = await client.openReceipt({ role: 'client', counterparty: providerReg.agent.id, task: 'Translate the README into Spanish' });
    const declined = await provider.declineReceipt(opened.receipt.id);
    expect(declined.receipt.state).toBe('declined');
  });
});

describe('API key only', () => {
  it('omits signatures and the registry attests', async () => {
    const keyed = new ANSClient({ baseUrl: api.baseUrl, apiKey: clientReg.apiKey.key, agentId: clientReg.agent.id });
    expect(keyed.signs).toBe(false);
    const beat = await keyed.heartbeat();
    expect(beat.status).toBe('ok');

    const opened = await keyed.openReceipt({ role: 'client', counterparty: providerReg.agent.handle!, task: 'Review the pricing page copy' });
    expect(opened.receipt.signatures.callerSig).toBe('attested');
    expect(opened.receipt.signatures.attested).toEqual(['initiator']);

    const accepted = await provider.acceptReceipt(opened.receipt.id);
    expect(accepted.receipt.state).toBe('open');
    const cancelled = await keyed.cancel(opened.receipt.id, 'Changed plans before any work started');
    expect(cancelled.receipt.state).toBe('cancelled_client');

    // PATCH /v1/agents/:id takes signed requests or sessions, never API keys
    await expect(keyed.updateAgent({ description: 'nope' })).rejects.toMatchObject({ status: 403, code: 'forbidden' });
  });
});

describe('agent management, messages and errors', () => {
  it('updates the profile and policy', async () => {
    const res = await third.updateAgent({
      description: 'Research agent',
      paymentMethods: [{ type: 'lightning', address: 'third@example.com' }],
      policy: { minTrust: 10, acceptSandbox: false },
    });
    expect(res.agent.description).toBe('Research agent');
    expect(res.policy).toEqual({ requireRegistered: false, minTrust: 10, acceptSandbox: false });
    const profile = await client.getAgent(thirdReg.agent.handle!);
    expect(profile.policy.minTrust).toBe(10);
    expect(profile.agent.id).toBe(thirdReg.agent.id);
  });

  it.skipIf(!wallet)('requests a payout (sandbox credit is never payout-eligible)', async () => {
    await expect(third.requestPayout(1, 0, 'first payout')).rejects.toMatchObject({ status: 402, code: 'insufficient_credit' });
    await expect(third.requestPayout('1.00', 3)).rejects.toMatchObject({ status: 400, code: 'validation_error' });
  });

  it('creates, lists and revokes API keys', async () => {
    const created = await third.createKey({ scopes: ['read'], label: 'sdk test', spendCapMicrosPerDay: 0 });
    expect(created.key).toMatch(/^ak_/);
    expect(created.scopes).toEqual(['read']);
    const keys = await third.listKeys();
    expect(keys.map((k) => k.id)).toContain(created.id);
    const revoked = await third.revokeKey(created.id);
    expect(revoked.revoked).toBe(true);
    expect(revoked.key.revokedAt).not.toBeNull();
  });

  it('sends a message attached to a receipt and shows it in the inbox and notifications', async () => {
    const { receipts } = await client.myReceipts({ role: 'client' });
    const shared = receipts.find((r) => r.provider?.id === providerReg.agent.id)!;
    const sent = await client.sendMessage(providerReg.agent.handle!, 'Thanks for the summary', shared.id);
    expect(sent.message.receiptId).toBe(shared.id);
    const inbox = await provider.inbox();
    expect(inbox.messages.map((m) => m.id)).toContain(sent.message.id);
    const notes = await provider.notifications(true);
    expect(notes.unreadCount).toBeGreaterThan(0);
  });

  it('throws AnsApiError parsed from the teaching envelope', async () => {
    const err = await client.getReceipt('rc_doesnotexist0000').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AnsApiError);
    const e = err as AnsApiError;
    expect(e.status).toBe(404);
    expect(e.code).toBe('not_found');
    expect(e.requestId).toBeTruthy();
    expect(e.message).toMatch(/not found/);

    const bad = await client.verdict('rc_doesnotexist0000', 'reject', { reason: 'too short' }).catch((x: unknown) => x);
    expect(bad).toBeInstanceOf(AnsApiError);

    const unregistered = await client.openReceipt({ role: 'client', counterparty: `ghost-${suffix()}`, task: 'Anything' }).catch((x: unknown) => x);
    expect(unregistered).toMatchObject({ status: 428, code: 'registration_required' });
    expect((unregistered as AnsApiError).fix?.url).toMatch(/register/);

    const unreachable = await new ANSClient({ baseUrl: 'http://127.0.0.1:1' }).verify('anyone').catch((x: unknown) => x);
    expect(unreachable).toMatchObject({ status: 0, code: 'network_error' });
  });
});
