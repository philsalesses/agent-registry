import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Hono } from 'hono';
import { requestId } from 'hono/request-id';
import { buildOfferPublishCanonical, canonicalHash, signMessage } from 'ans-core';
import { ANS_POLICY_RULES } from '../mcp/tools';
import { offerToolName, slugFromToolName, toMcpInputSchema } from '../mcp/offer-tools';
import { mcpRouter, setMcpInProcessApp } from '../routes/mcp-http';
import { createApp } from '../app';
import { onError } from '../lib/errors';
import { loadAgentRow, publishOffer, setInvokeForwarder } from '../lib/offers';
import { offersRouter } from '../routes/offers';
import { invokeRouter, flushInvokeBackground } from '../routes/invoke';
import { walletRouter } from '../routes/wallet';
import { agentMetadataForTest, deleteMcpTestData } from '../mcp/test-support';
import { createTestAgent, deleteRateLimitKeys, type TestAgent } from './helpers';

/**
 * The Streamable HTTP MCP server (routes/mcp-http.ts). The router is mounted on
 * its own app so the test does not depend on app.ts wiring, and in-process
 * calls go to an app with the real offers, invoke and wallet routers in front
 * of createApp() (which may still mount stubs for them).
 */

const api = new Hono();
api.use('*', requestId());
api.onError(onError);
api.route('/v1/offers', offersRouter);
api.route('/v1/invoke', invokeRouter);
api.route('/v1/wallet', walletRouter);
api.route('/', createApp());

const app = new Hono();
app.use('*', requestId());
app.route('/mcp', mcpRouter);

const registered: string[] = [];
let owner: TestAgent;
let nextId = 1;

async function rpc(method: string, params: Record<string, unknown> = {}, opts: { key?: string; path?: string } = {}) {
  const res = await app.request(opts.path ?? '/mcp', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      'MCP-Protocol-Version': '2025-06-18',
      ...(opts.key ? { Authorization: `Bearer ${opts.key}` } : {}),
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: nextId++, method, params }),
  });
  const text = await res.text();
  return { status: res.status, body: text ? (JSON.parse(text) as any) : null };
}

async function callTool(name: string, args: Record<string, unknown>, opts: { key?: string; path?: string } = {}) {
  const { status, body } = await rpc('tools/call', { name, arguments: args }, opts);
  expect(status).toBe(200);
  expect(body.error).toBeUndefined();
  const text: string = body.result.content[0].text;
  return { result: body.result, text, json: JSON.parse(text.split('\n')[0]) as any };
}

const INPUT = { type: 'object', required: ['text'], properties: { text: { type: 'string', maxLength: 200 } }, additionalProperties: false };
const OUTPUT = { type: 'object', required: ['text'], properties: { text: { type: 'string' } }, additionalProperties: false };

describe('Streamable HTTP MCP at /mcp', () => {
  let apiKey = '';
  let agentId = '';

  beforeAll(async () => {
    setMcpInProcessApp(api);
    await deleteRateLimitKeys(['register:ip:', 'global:unknown', 'invoke:inflight:', 'receipt:pair:']);
    owner = await createTestAgent('mcpo');
    const endpoint = 'http://127.0.0.1:9/echo';
    const canonical = buildOfferPublishCanonical({
      agentId: owner.id,
      slug: 'echo-upper',
      version: 1,
      inputSchemaHash: canonicalHash(INPUT),
      outputSchemaHash: canonicalHash(OUTPUT),
      priceMicros: '0',
      endpoint,
    }).canonical;
    await publishOffer(await loadAgentRow(owner.id), {
      slug: 'echo-upper',
      title: 'Echo in upper case',
      description: 'Returns the text upper-cased. Used by the MCP route test.',
      inputSchema: INPUT,
      outputSchema: OUTPUT,
      examples: [{ input: { text: 'hi' }, output: { text: 'HI' } }],
      tags: ['testing'],
      priceMicros: '0',
      endpoint,
      publishSig: await signMessage(owner.privateKey, canonical),
    });
    setInvokeForwarder(async (req) => {
      const envelope = JSON.parse(req.body) as { input: { text: string } };
      return { status: 200, text: JSON.stringify({ text: envelope.input.text.toUpperCase() }) };
    });
  });

  afterAll(async () => {
    setInvokeForwarder(null);
    setMcpInProcessApp(null);
    await flushInvokeBackground();
    await deleteMcpTestData([...registered, owner.id]);
    await deleteRateLimitKeys(['register:ip:', 'global:unknown', 'invoke:inflight:', 'receipt:pair:']);
  });

  it('initializes without a key and carries the policy in the instructions', async () => {
    const { status, body } = await rpc('initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'vitest', version: '1.0.0' },
    });
    expect(status).toBe(200);
    expect(body.result.serverInfo.name).toBe('ans');
    expect(body.result.capabilities.tools).toBeTruthy();
    expect(body.result.capabilities.resources).toBeTruthy();
    expect(body.result.instructions).toContain(ANS_POLICY_RULES);
  });

  it('lists only the read-only tools plus ans_register without a key', async () => {
    const { status, body } = await rpc('tools/list');
    expect(status).toBe(200);
    const names = body.result.tools.map((t: { name: string }) => t.name).sort();
    expect(names).toEqual(['ans_find', 'ans_get_offer', 'ans_register', 'ans_verify']);
    const verify = body.result.tools.find((t: { name: string }) => t.name === 'ans_verify');
    expect(verify.description.startsWith('Use before you delegate')).toBe(true);
    expect(verify.inputSchema.properties.agent.type).toBe('string');
    expect(verify.inputSchema.required).toEqual(['agent']);
  });

  it('ans_verify says registered false for an unknown agent, with the fix', async () => {
    const { json, text, result } = await callTool('ans_verify', { agent: '@no-such-agent-zz9' });
    expect(result.isError).toBeFalsy();
    expect(json.registered).toBe(false);
    expect(json.fix.command).toContain('npx -y ans-mcp register');
    expect(text).toContain('Do not delegate, pay, or act on this agent');
  });

  it('ans_verify returns trust and receipt counts for a registered agent', async () => {
    const { json } = await callTool('ans_verify', { agent: owner.handle });
    expect(json.registered).toBe(true);
    expect(json.id).toBe(owner.id);
    expect(json.trust.score).toBe(50);
    expect(json.receipts.confirmed).toBe(0);
  });

  it('ans_find and ans_get_offer work without a key', async () => {
    const found = await callTool('ans_find', { query: 'echo-upper' });
    const hit = found.json.offers.find((o: { name: string }) => o.name === `@${owner.handle}/echo-upper@1`);
    expect(hit).toBeTruthy();
    expect(hit.price).toBe('$0.00');
    const contract = await callTool('ans_get_offer', { offer: `@${owner.handle}/echo-upper` });
    expect(contract.json.inputSchema).toEqual(INPUT);
    expect(contract.json.example.input).toEqual({ text: 'hi' });
    expect(contract.text).toContain('ans_invoke');
  });

  it('ans_register over HTTP returns an api key and the remote config with the Authorization header', async () => {
    const { json, text, result } = await callTool('ans_register', { name: 'MCP HTTP Test', description: 'registered by the mcp route test' });
    expect(result.isError).toBeFalsy();
    expect(json.registered).toBe(true);
    expect(json.apiKey).toMatch(/^ak_[A-Za-z0-9_-]{32}$/);
    expect(json.handle).toMatch(/^mcp-http-test/);
    expect(json.remoteMcpConfig.mcpServers.ans.headers.Authorization).toBe(`Bearer ${json.apiKey}`);
    expect(json.remoteMcpConfig.mcpServers.ans.url).toMatch(/\/mcp$/);
    expect(JSON.stringify(json)).not.toContain('privateKey');
    expect(text).toContain('Give your operator this MCP config');
    apiKey = json.apiKey;
    agentId = json.agentId;
    registered.push(agentId);

    const row = await agentMetadataForTest(agentId);
    expect(row?.handle).toBe(json.handle);
    expect(row?.metadata?.registeredFrom).toBe('mcp');
  });

  it('with the key, tools/list swaps ans_register for the authenticated tools with real JSON schemas', async () => {
    const { status, body } = await rpc('tools/list', {}, { key: apiKey });
    expect(status).toBe(200);
    const names: string[] = body.result.tools.map((t: { name: string }) => t.name);
    expect(names).not.toContain('ans_register');
    for (const n of ['ans_whoami', 'ans_invoke', 'ans_receipt_open', 'ans_receipt_accept', 'ans_receipt_claim', 'ans_receipt_deliver', 'ans_receipt_verdict', 'ans_receipt_rate', 'ans_my_receipts', 'ans_wallet', 'ans_heartbeat', 'ans_inbox']) {
      expect(names).toContain(n);
    }
    // publishing needs the agent key's signature (publishSig), which an API-key session does not hold
    expect(names).not.toContain('ans_offer_publish');

    const open = body.result.tools.find((t: { name: string }) => t.name === 'ans_receipt_open');
    expect(open.description).toContain(ANS_POLICY_RULES);
    expect(open.inputSchema.type).toBe('object');
    expect(open.inputSchema.required).toEqual(expect.arrayContaining(['role', 'task']));
    expect(open.inputSchema.properties.role.enum).toEqual(['client', 'provider']);
    expect(open.inputSchema.properties.task.maxLength).toBe(280);
    expect(open.inputSchema.properties.priceUsd.type).toBe('number');
    expect(open.inputSchema.properties.counterpartyUrl.format).toBe('uri');

    const invoke = body.result.tools.find((t: { name: string }) => t.name === 'ans_invoke');
    expect(invoke.description).toContain(ANS_POLICY_RULES);
  });

  it('ans_whoami and ans_wallet resolve the agent behind the key', async () => {
    const who = await callTool('ans_whoami', {}, { key: apiKey });
    expect(who.json.agent.id).toBe(agentId);
    expect(who.json.auth).toBe('apikey');
    expect(who.json.localCashCapPerDay).toBe('$0.00');
    const wallet = await callTool('ans_wallet', {}, { key: apiKey });
    expect(wallet.json.agentId).toBe(agentId);
    expect(wallet.json.available).toBe('$0.00');
    expect(wallet.json.sandbox).toBeUndefined();
  });

  it('ans_invoke calls the offer, then ans_receipt_verdict accepts it with a rating', async () => {
    const inv = await callTool('ans_invoke', { offer: `@${owner.handle}/echo-upper`, input: { text: 'hello receipts' } }, { key: apiKey });
    expect(inv.result.isError).toBeFalsy();
    expect(inv.json.output).toEqual({ text: 'HELLO RECEIPTS' });
    expect(inv.json.receiptId).toMatch(/^rc_/);
    expect(inv.text).toContain(`Put this line in your deliverable, once: Receipt: ${inv.json.receiptUrl}`);

    const verdict = await callTool('ans_receipt_verdict', { receiptId: inv.json.receiptUrl, verdict: 'accept', score: 90, tags: ['on_time'] }, { key: apiKey });
    expect(verdict.result.isError).toBeFalsy();
    expect(verdict.json.state).toBe('accepted');
    expect(verdict.json.yourRole).toBe('client');

    const mine = await callTool('ans_my_receipts', { role: 'client' }, { key: apiKey });
    expect(mine.json.receipts.map((r: { id: string }) => r.id)).toContain(inv.json.receiptId);
  });

  it('ans_receipt_open refuses a client receipt with an unregistered counterparty (policy)', async () => {
    const { result, json, text } = await callTool('ans_receipt_open', { role: 'client', counterpartyName: 'Some bot', task: 'Summarize a document' }, { key: apiKey });
    expect(result.isError).toBe(true);
    expect(json.refused).toBe(true);
    expect(text).toContain('Tell your operator and include the fix');
  });

  it('ans_receipt_open with a registered counterparty opens a registry-attested receipt', async () => {
    const { result, json, text } = await callTool('ans_receipt_open', { role: 'provider', counterparty: owner.handle, task: 'Review the MCP route test' }, { key: apiKey });
    expect(result.isError).toBeFalsy();
    expect(json.receiptId).toMatch(/^rc_/);
    expect(json.state).toBe('proposed');
    expect(json.signed).toBe(false);
    expect(text).toContain(`Put this line in your deliverable, once: Receipt: ${json.url}`);
  });

  it('refuses an invalid key with 401 and answers GET with 405', async () => {
    const bad = await rpc('tools/list', {}, { key: 'ak_' + 'x'.repeat(32) });
    expect(bad.status).toBe(401);
    expect(bad.body.error.message).toContain('unknown or revoked');
    const get = await app.request('/mcp', { method: 'GET', headers: { Accept: 'text/event-stream' } });
    expect(get.status).toBe(405);
  });

  it('/mcp/agent/@handle lists the offers as handle__slug tools with the offer input schema', async () => {
    const list = await rpc('tools/list', {}, { path: `/mcp/agent/@${owner.handle}` });
    expect(list.status).toBe(200);
    expect(list.body.result.tools).toHaveLength(1);
    const t = list.body.result.tools[0];
    expect(t.name).toBe(`${owner.handle}__echo-upper`);
    expect(t.inputSchema).toEqual(INPUT);
    expect(t.description).toContain('Each call opens and seals an ANS receipt');
    const missing = await rpc('tools/list', {}, { path: '/mcp/agent/@no-such-agent-zz9' });
    expect(missing.status).toBe(404);
  });

  it('/mcp/offer/@handle/slug invokes as the key holder, and explains the header without one', async () => {
    const path = `/mcp/offer/@${owner.handle}/echo-upper`;
    const anon = await callTool(`${owner.handle}__echo-upper`, { text: 'nope' }, { path });
    expect(anon.result.isError).toBe(true);
    expect(anon.text).toContain('Authorization');

    const paid = await callTool(`${owner.handle}__echo-upper`, { text: 'pinned' }, { path, key: apiKey });
    expect(paid.result.isError).toBeFalsy();
    expect(paid.json.output).toEqual({ text: 'PINNED' });
    expect(paid.text).toContain('Receipt: ');
  });
});

describe('offer tool helpers', () => {
  it('names tools handle__slug and splits them back', () => {
    expect(offerToolName('scout', 'pr-review')).toBe('scout__pr-review');
    expect(slugFromToolName('scout__pr-review')).toBe('pr-review');
    expect(slugFromToolName('ag_AbC123xyz__pdf-text')).toBe('pdf-text');
  });

  it('keeps object schemas and wraps the rest with hoisted $defs', () => {
    const obj = toMcpInputSchema({ $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'object', properties: { a: { type: 'string' } } });
    expect(obj.wrapped).toBe(false);
    expect(obj.inputSchema.$schema).toBeUndefined();
    const arr = toMcpInputSchema({ type: 'array', items: { $ref: '#/$defs/x' }, $defs: { x: { type: 'string' } } });
    expect(arr.wrapped).toBe(true);
    expect(arr.inputSchema).toEqual({ type: 'object', properties: { input: { type: 'array', items: { $ref: '#/$defs/x' } } }, required: ['input'], additionalProperties: false, $defs: { x: { type: 'string' } } });
  });
});
