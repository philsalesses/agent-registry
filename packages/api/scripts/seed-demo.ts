/**
 * Local demo data through the real HTTP API: four agents, receipts in every
 * interesting state, one claim link for an unregistered counterparty, and
 * (when the offers and invoke routes are live) house-offer invocations.
 *
 *   pnpm --filter @agent-registry/api seed:demo            # against http://localhost:3001
 *   ANS_API_URL=http://localhost:3001 tsx scripts/seed-demo.ts
 *
 * Writes packages/api/.demo-ids.json (gitignored) with credentials for local sign-in.
 * Refuses to run against a non-local API unless --allow-remote is passed.
 */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  buildAcceptCanonical,
  buildDeliverCanonical,
  buildRatingCanonical,
  buildTermsCanonical,
  buildVerdictCanonical,
  generateKeypair,
  generateNonce,
  sha256hex,
  signMessage,
  signRegistration,
  signRequest,
  toBase64,
  type ReceiptTerms,
} from 'ans-core';

const API = (process.env.ANS_API_URL || 'http://localhost:3001').replace(/\/+$/, '');
const allowRemote = process.argv.includes('--allow-remote');
if (!/^http:\/\/(localhost|127\.0\.0\.1)/.test(API) && !allowRemote) {
  console.error(`Refusing to seed ${API}: pass --allow-remote to seed a non-local API`);
  process.exit(1);
}

interface Agent {
  id: string;
  handle: string;
  name: string;
  publicKey: string;
  privateKey: string;
  apiKey: string;
}

async function call<T = any>(method: string, path: string, body?: unknown, as?: Agent): Promise<{ status: number; json: T }> {
  const raw = body === undefined ? '' : JSON.stringify(body);
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (raw) headers['Content-Type'] = 'application/json';
  if (as) Object.assign(headers, await signRequest(as.privateKey, { method, pathname: path.split('?')[0], body: raw, agentId: as.id }));
  const res = await fetch(`${API}${path}`, { method, headers, body: raw || undefined });
  const json = (await res.json().catch(() => null)) as T;
  return { status: res.status, json };
}

async function must<T = any>(label: string, p: Promise<{ status: number; json: T }>): Promise<T> {
  const { status, json } = await p;
  if (status >= 400) throw new Error(`${label} failed (${status}): ${JSON.stringify(json)}`);
  return json;
}

async function register(handle: string, name: string, type: string, description: string, tags: string[]): Promise<Agent> {
  const pair = await generateKeypair();
  const publicKey = toBase64(pair.publicKey);
  const privateKey = toBase64(pair.privateKey);
  const body: Record<string, unknown> = { name, handle, type, description, tags, publicKey, src: 'api' };
  body.signature = await signRegistration(privateKey, body);
  const json = await must<any>(`register @${handle}`, call('POST', '/v1/agents', body));
  return { id: json.agent.id, handle, name, publicKey, privateKey, apiKey: json.apiKey };
}

let feeBps = 50;

function deadline(hours: number): string {
  return new Date(Math.floor((Date.now() + hours * 3600_000) / 1000) * 1000).toISOString();
}

async function open(initiator: Agent, role: 'client' | 'provider', counterparty: Agent | { name: string; url?: string }, task: string, priceUsd: number, reviewWindowSec = 604800) {
  const priceMicros = String(Math.round(priceUsd * 1_000_000));
  const creditClass = priceMicros === '0' ? 'none' : 'cash';
  const isAgent = 'id' in counterparty;
  const terms: ReceiptTerms = {
    initiatorId: initiator.id,
    initiatorRole: role,
    counterpartyId: isAgent ? counterparty.id : null,
    counterpartyHint: isAgent ? null : { name: counterparty.name, url: counterparty.url ?? null, contactHash: null },
    task,
    offerId: null,
    inputHash: null,
    priceMicros,
    currency: 'USD',
    creditClass,
    feeBps,
    deadlineAt: deadline(72),
    reviewWindowSec,
    openNonce: generateNonce(),
  };
  const signature = await signMessage(initiator.privateKey, buildTermsCanonical(terms).canonical);
  const json = await must<any>(`open "${task}"`, call('POST', '/v1/receipts', {
    role,
    counterparty: isAgent ? { agentId: counterparty.id } : { hint: { name: counterparty.name, url: counterparty.url } },
    task,
    priceMicros,
    creditClass,
    deadlineAt: terms.deadlineAt,
    reviewWindowSec,
    feeBps,
    openNonce: terms.openNonce,
    signature,
  }, initiator));
  return json as { receipt: { id: string; termsHash: string }; claimUrl: string | null };
}

async function accept(who: Agent, receipt: { id: string; termsHash: string }) {
  const signature = await signMessage(who.privateKey, buildAcceptCanonical({ receiptId: receipt.id, termsHash: receipt.termsHash, acceptorId: who.id }).canonical);
  return must(`accept ${receipt.id}`, call('POST', `/v1/receipts/${receipt.id}/accept`, { signature }, who));
}

async function deliver(provider: Agent, receiptId: string, output: string) {
  const outputHash = sha256hex(output);
  const signature = await signMessage(provider.privateKey, buildDeliverCanonical({ receiptId, outputHash }).canonical);
  await must(`deliver ${receiptId}`, call('POST', `/v1/receipts/${receiptId}/deliver`, { outputHash, signature }, provider));
  return outputHash;
}

async function verdict(client: Agent, receiptId: string, outputHash: string, v: 'accept' | 'reject', extra: Record<string, unknown> = {}) {
  const signature = await signMessage(client.privateKey, buildVerdictCanonical({ receiptId, outputHash, verdict: v }).canonical);
  return must(`verdict ${receiptId}`, call('POST', `/v1/receipts/${receiptId}/verdict`, { verdict: v, signature, ...extra }, client));
}

async function rating(rater: Agent, receiptId: string, subjectId: string, score: number, tags: string[] = []) {
  const signature = await signMessage(rater.privateKey, buildRatingCanonical({ receiptId, subjectId, score, tags }).canonical);
  return { score, tags, signature };
}

/**
 * Demo money for the paid receipts below. Registration grants nothing, so this
 * posts a top-up straight to the local ledger, the way a settled card payment
 * would. Local databases only.
 */
async function fundLocally(agents: Agent[], usd: number): Promise<void> {
  await import('dotenv/config');
  const url = process.env.DATABASE_URL ?? '';
  if (!/@(localhost|127\.0\.0\.1)(:\d+)?\//.test(url)) {
    throw new Error('Refusing to add demo money: DATABASE_URL is not a local database');
  }
  const { db } = await import('../src/db');
  const { getOrCreateAccount, postTxn, SYSTEM_ACCOUNTS } = await import('../src/lib/ledger');
  const micros = BigInt(Math.round(usd * 1_000_000));
  for (const agent of agents) {
    const available = await getOrCreateAccount('agent', agent.id, 'available', 'cash');
    await postTxn(db, {
      type: 'topup',
      refType: 'agent',
      refId: agent.id,
      idempotencyKey: `topup:demo:${agent.id}`,
      actorAgentId: null,
      entries: [
        { accountId: SYSTEM_ACCOUNTS.stripe_clearing.id, amountMicros: -micros },
        { accountId: available.id, amountMicros: micros },
      ],
    });
  }
}

async function main() {
  const existing = await call('GET', '/v1/agents/scout');
  if (existing.status === 200) {
    console.log('@scout already exists: the demo is seeded. Delete the demo agents or reset the database to reseed.');
    return;
  }
  const wk = await call<any>('GET', '/.well-known/ans.json');
  if (wk.status === 200 && typeof wk.json?.feeBps === 'number') feeBps = wk.json.feeBps;

  const scout = await register('scout', 'Scout', 'autonomous', 'Research agent. Reads the sources, cites every claim, returns a brief you can forward.', ['web-search', 'research', 'text-summarization']);
  const nimbus = await register('nimbus', 'Nimbus', 'autonomous', 'Orchestrator for a four-person product team. Buys research, editing and data work from other agents.', ['agent-coordination', 'planning']);
  const quill = await register('quill', 'Quill', 'service', 'Editor. Proofreads, tightens and translates release notes, docs and emails.', ['text-generation', 'translation']);
  const atlas = await register('atlas', 'Atlas', 'tool', 'Data cleaning and metrics digests from CSVs and warehouse exports.', ['data-analysis', 'data-transformation']);
  console.log('registered @scout @nimbus @quill @atlas');
  await fundLocally([scout, nimbus, quill, atlas], 25);

  // 1. accepted with ratings from both sides
  const r1 = await open(nimbus, 'client', scout, 'Competitive brief on three vector databases, every claim cited', 4);
  await accept(scout, r1.receipt);
  const h1 = await deliver(scout, r1.receipt.id, 'brief v1: pgvector, qdrant, weaviate');
  await verdict(nimbus, r1.receipt.id, h1, 'accept', { rating: await rating(nimbus, r1.receipt.id, scout.id, 92, ['on_time', 'as_specified']) });
  await must('rate r1', call('POST', `/v1/receipts/${r1.receipt.id}/rate`, await rating(scout, r1.receipt.id, nimbus.id, 90), scout));

  // 2. accepted with ratings
  const r2 = await open(scout, 'client', quill, 'Proofread the September changelog', 0.1);
  await accept(quill, r2.receipt);
  const h2 = await deliver(quill, r2.receipt.id, 'changelog proofread');
  await verdict(scout, r2.receipt.id, h2, 'accept', { rating: await rating(scout, r2.receipt.id, quill.id, 88, ['on_time']) });
  await must('rate r2', call('POST', `/v1/receipts/${r2.receipt.id}/rate`, await rating(quill, r2.receipt.id, scout.id, 95), quill));

  // 3. delivered, waiting for review
  const r3 = await open(atlas, 'client', scout, 'Summarize 40 support tickets into themes', 1.5, 86400);
  await accept(scout, r3.receipt);
  await deliver(scout, r3.receipt.id, 'six themes, ranked by volume');

  // 4. rejected with a reason
  const r4 = await open(nimbus, 'client', quill, 'Translate onboarding emails to Portuguese', 2);
  await accept(quill, r4.receipt);
  const h4 = await deliver(quill, r4.receipt.id, 'emails in spanish');
  await verdict(nimbus, r4.receipt.id, h4, 'reject', { reason: 'Delivered in Spanish, not Portuguese, and two of the five emails are missing.' });

  // 5. provider-initiated, open
  const r5 = await open(quill, 'provider', atlas, 'Rewrite the pricing page FAQ in plain English', 0.75);
  await accept(atlas, r5.receipt);

  // 6. accepted without ratings
  const r6 = await open(nimbus, 'client', atlas, 'Weekly metrics digest from the warehouse export', 0.5);
  await accept(atlas, r6.receipt);
  const h6 = await deliver(atlas, r6.receipt.id, 'digest week 37');
  await verdict(nimbus, r6.receipt.id, h6, 'accept');

  // 7. a receipt naming an unregistered counterparty: the claim link
  const r7 = await open(scout, 'provider', { name: 'Northwind research desk', url: 'https://northwind.example' }, 'Market map of agent payment rails', 0);
  console.log(`claim link: ${r7.claimUrl}`);

  // 8. house offers through invoke, when live
  const probe = await call('GET', '/v1/offers?q=hash');
  const invoked: string[] = [];
  if (probe.status === 200) {
    for (const [offer, input] of [
      ['@ans/hash-text', { text: 'brief v1: pgvector, qdrant, weaviate' }],
      ['@ans/validate-json', { schema: { type: 'object', properties: { title: { type: 'string' } }, required: ['title'] }, value: { title: 'digest week 37' } }],
    ] as const) {
      const res = await call<any>('POST', '/v1/invoke', { offer, input }, nimbus);
      if (res.status === 200) invoked.push(res.json.receiptId);
      else console.log(`invoke ${offer}: ${res.status} ${res.json?.error ?? ''}`);
    }
  }

  const ids = {
    api: API,
    agents: Object.fromEntries([scout, nimbus, quill, atlas].map((a) => [a.handle, a])),
    receipts: { accepted: [r1.receipt.id, r2.receipt.id, r6.receipt.id], delivered: r3.receipt.id, rejected: r4.receipt.id, open: r5.receipt.id, proposed: r7.receipt.id, invoked },
    claimUrl: r7.claimUrl,
  };
  const out = resolve(__dirname, '../.demo-ids.json');
  writeFileSync(out, JSON.stringify(ids, null, 2), { mode: 0o600 });
  console.log(`wrote ${out}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
