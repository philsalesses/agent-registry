import { describe, it, expect } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { generateKeypair, toBase64 } from 'ans-core';
import { AnsHttp } from '../shared/client';
import { memorySpendLedger, registerAnsTools, type AnsToolsContext } from '../shared/tools';

/**
 * The shared tools against a scripted registry (no network, no database):
 * local cash cap with reservations, requireRegistered, and signed-mode gating.
 */

type Route = (req: { method: string; path: string; body: any; headers: Record<string, string> }) => { status: number; body: unknown };

function fakeRegistry(route: Route) {
  const calls: { method: string; path: string; body: any; headers: Record<string, string> }[] = [];
  const fetchImpl = async (input: string, init: RequestInit) => {
    const url = new URL(input);
    const headers = (init.headers ?? {}) as Record<string, string>;
    const req = { method: String(init.method ?? 'GET'), path: url.pathname, body: init.body ? JSON.parse(String(init.body)) : undefined, headers };
    calls.push(req);
    const res = route(req);
    return new Response(JSON.stringify(res.body), { status: res.status, headers: { 'Content-Type': 'application/json' } });
  };
  return { fetchImpl, calls };
}

async function connect(ctx: AnsToolsContext) {
  const server = new McpServer({ name: 'ans-test', version: '0.0.0' });
  const handle = registerAnsTools(server, ctx);
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test', version: '0.0.0' });
  await Promise.all([server.connect(a), client.connect(b)]);
  const call = async (name: string, args: Record<string, unknown>) => {
    const res = (await client.callTool({ name, arguments: args })) as { content: { text: string }[]; isError?: boolean };
    return { isError: res.isError === true, text: res.content[0].text, json: JSON.parse(res.content[0].text.split('\n')[0]) };
  };
  return { client, call, handle };
}

const SELLER = { id: 'ag_SellerSeller1234', handle: 'seller' };
const OFFER = { id: 'of_OfferOffer123456', name: '@seller/thing@1', slug: 'thing', priceMicros: '600000', acceptsSandbox: false, owner: { ...SELLER, trust: { score: 70, confidence: 0.5, rank: 60 } } };

describe('ans_invoke local cash cap', () => {
  it('reserves cash per call, refuses above the cap, and gives the reservation back when the call fails', async () => {
    let failNext = false;
    const registry = fakeRegistry((req) => {
      if (req.path === '/v1/offers/@seller/thing') return { status: 200, body: { offer: OFFER } };
      if (req.path === `/v1/verify/${SELLER.id}`) return { status: 200, body: { registered: true, id: SELLER.id, handle: SELLER.handle } };
      if (req.path === '/v1/invoke') {
        if (failNext) return { status: 502, body: { error: 'internal', message: 'The provider did not return a result', details: { receiptId: 'rc_Failed123456789' } } };
        return { status: 200, body: { receiptId: 'rc_Receipt123456789', output: { ok: true }, charged: { priceMicros: '600000', feeMicros: '3000', creditClass: 'cash' }, provider: SELLER, latencyMs: 5, receiptUrl: 'https://ans-registry.org/r/rc_Receipt123456789' } };
      }
      return { status: 404, body: { error: 'not_found', message: req.path } };
    });
    const spend = memorySpendLedger();
    const pair = await generateKeypair();
    const { call } = await connect({
      http: new AnsHttp({ baseUrl: 'https://api.test', fetch: registry.fetchImpl }),
      identity: { agentId: 'ag_BuyerBuyer123456', privateKey: toBase64(pair.privateKey) },
      localSpendCapMicros: 1_000_000n,
      spend,
      transport: 'stdio',
    });

    const noClass = await call('ans_invoke', { offer: '@seller/thing', input: { q: 1 } });
    expect(noClass.isError).toBe(true);
    expect(noClass.text).toContain('does not accept SANDBOX credit');

    const first = await call('ans_invoke', { offer: '@seller/thing', input: { q: 1 }, creditClass: 'cash' });
    expect(first.isError).toBe(false);
    expect(first.json.charged).toEqual({ price: '$0.60', fee: '$0.003', creditClass: 'cash' });
    expect(first.text).toContain('Receipt: https://ans-registry.org/r/rc_Receipt123456789');
    expect(await spend.spentToday(new Date())).toBe(600_000n);

    const second = await call('ans_invoke', { offer: '@seller/thing', input: { q: 2 }, creditClass: 'cash' });
    expect(second.isError).toBe(true);
    expect(second.text).toContain('over the local cap of $1.00 per day');
    expect(registry.calls.filter((c) => c.path === '/v1/invoke')).toHaveLength(1);

    // raise the headroom by failing a call: the reservation must come back
    const roomy = memorySpendLedger();
    const again = await connect({
      http: new AnsHttp({ baseUrl: 'https://api.test', fetch: registry.fetchImpl }),
      identity: { agentId: 'ag_BuyerBuyer123456', privateKey: toBase64(pair.privateKey) },
      localSpendCapMicros: 1_000_000n,
      spend: roomy,
      transport: 'stdio',
    });
    failNext = true;
    const failed = await again.call('ans_invoke', { offer: '@seller/thing', input: { q: 3 }, creditClass: 'cash' });
    expect(failed.isError).toBe(true);
    expect(failed.json.error).toBe('internal');
    expect(await roomy.spentToday(new Date())).toBe(0n);
  });

  it('refuses to invoke when the owner is not a registered agent (requireRegistered)', async () => {
    const registry = fakeRegistry((req) => {
      if (req.path === '/v1/offers/@seller/thing') return { status: 200, body: { offer: { ...OFFER, priceMicros: '0' } } };
      if (req.path.startsWith('/v1/verify/')) return { status: 200, body: { registered: false, fix: { command: 'npx -y ans-mcp register --name "<name>"', url: 'https://ans-registry.org/register', docs: 'https://ans-registry.org/skill.md' } } };
      return { status: 500, body: { error: 'internal', message: 'unexpected' } };
    });
    const { call } = await connect({ http: new AnsHttp({ baseUrl: 'https://api.test', fetch: registry.fetchImpl, apiKey: 'ak_' + 'k'.repeat(32) }), self: { agentId: 'ag_BuyerBuyer123456' }, transport: 'http' });
    const res = await call('ans_invoke', { offer: '@seller/thing', input: {} });
    expect(res.isError).toBe(true);
    expect(res.json.fix.command).toContain('npx -y ans-mcp register');
    expect(res.text).toContain('Tell your operator and include the fix');
    expect(registry.calls.some((c) => c.path === '/v1/invoke')).toBe(false);
  });
});

describe('tool gating', () => {
  it('exposes publish only to a signed session and hides tools whose API key scope is missing', async () => {
    const registry = fakeRegistry(() => ({ status: 404, body: { error: 'not_found', message: 'x' } }));
    const pair = await generateKeypair();
    const signed = await connect({ http: new AnsHttp({ baseUrl: 'https://api.test', fetch: registry.fetchImpl }), identity: { agentId: 'ag_SignedSigned1234', privateKey: toBase64(pair.privateKey) }, transport: 'stdio' });
    const signedNames = (await signed.client.listTools()).tools.map((t) => t.name);
    expect(signedNames).toContain('ans_offer_publish');
    expect(signedNames).not.toContain('ans_register');
    expect(signedNames).toHaveLength(16);

    const readOnlyKey = await connect({ http: new AnsHttp({ baseUrl: 'https://api.test', fetch: registry.fetchImpl, apiKey: 'ak_' + 'r'.repeat(32) }), self: { agentId: 'ag_KeyKeyKey1234567' }, scopes: ['read'], transport: 'http' });
    const keyNames = (await readOnlyKey.client.listTools()).tools.map((t) => t.name).sort();
    expect(keyNames).toEqual(['ans_find', 'ans_get_offer', 'ans_heartbeat', 'ans_inbox', 'ans_my_receipts', 'ans_verify', 'ans_wallet', 'ans_whoami']);
  });
});
