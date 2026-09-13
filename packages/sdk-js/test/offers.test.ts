import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { canonicalHash } from 'ans-core';
import { flushInvokeBackground, setInvokeForwarder } from '../../api/src/routes/invoke';
import { ANSClient, AnsApiError, serve, type RegisterResult } from '../src';
import { AgentTracker, listen, mountedRoutes, startApi, type TestApi } from './helpers';

/**
 * publishOffer, find, getOffer, invoke and hire against the real offers and
 * invoke routers. Skipped while app.ts still mounts their 501 stubs.
 */
const mounted = await mountedRoutes();
const live = mounted.offers && mounted.invoke;

const inputSchema = {
  type: 'object',
  required: ['text'],
  properties: { text: { type: 'string', maxLength: 10000 } },
  additionalProperties: false,
};
const outputSchema = {
  type: 'object',
  required: ['words'],
  properties: { words: { type: 'integer', minimum: 0 } },
};

describe.skipIf(!live)('offers and invoke', () => {
  let api: TestApi;
  let endpoint: TestApi;
  let agents: AgentTracker;
  let provider: ANSClient;
  let caller: ANSClient;
  let providerReg: RegisterResult;
  let offerName = '';
  let lying = false;

  beforeAll(async () => {
    api = await startApi();
    agents = new AgentTracker(api.baseUrl);
    ({ client: provider, res: providerReg } = await agents.register('sdk-offer'));
    ({ client: caller } = await agents.register('sdk-hirer'));

    // The provider's endpoint: serve() verifies the registry signature with the keys the API publishes
    const handle = serve<{ text: string }>(({ input }) => (lying ? { words: 'many' } : { words: input.text.split(/\s+/).filter(Boolean).length }), {
      registryKeysUrl: `${api.baseUrl}/.well-known/ans.json`,
    });
    endpoint = await listen(handle);
    // The production forwarder refuses private addresses; under test the registry may POST to 127.0.0.1
    setInvokeForwarder(async (req) => {
      const res = await fetch(req.url, { method: 'POST', headers: req.headers, body: req.body });
      return { status: res.status, text: await res.text() };
    });
  });

  afterAll(async () => {
    if (live) setInvokeForwarder(null);
    await flushInvokeBackground();
    await agents?.cleanup();
    await endpoint?.close();
    await api?.close();
  });

  it('publishes a signed offer with schema hashes', async () => {
    const res = await provider.publishOffer({
      slug: 'word-count',
      title: 'Count words',
      description: 'Counts the words in a text',
      inputSchema,
      outputSchema,
      examples: [{ input: { text: 'hello brave new world' }, output: { words: 4 } }],
      tags: ['text', 'counting'],
      priceUsd: 0.25,
      endpoint: `${endpoint.baseUrl}/ans/word-count`,
      timeoutMs: 5000,
    });
    offerName = res.name;
    expect(offerName).toBe(`@${providerReg.agent.handle}/word-count@1`);
    expect(res.offer.version).toBe(1);
    expect(res.offer.priceMicros).toBe('250000');
    expect(res.offer.inputSchemaHash).toBe(canonicalHash(inputSchema));
    expect(res.offer.outputSchemaHash).toBe(canonicalHash(outputSchema));
    expect(res.urls.mcp).toContain('/mcp/offer/');
  });

  it('is found by search, by name and on the agent', async () => {
    const found = await caller.find('count words', { maxPriceUsd: 1 });
    expect(found.offers.map((o) => o.name)).toContain(offerName);
    const offer = await caller.getOffer(`@${providerReg.agent.handle}/word-count`);
    expect(offer.name).toBe(offerName);
    expect(offer.outputSchema).toEqual(outputSchema);
    const listed = await caller.listAgentOffers(providerReg.agent.handle!);
    expect(listed.map((o) => o.name)).toEqual([offerName]);
  });

  it('invokes the offer through the registry and gets a delivered receipt', async () => {
    const result = await caller.invoke<{ words: number }>(offerName, { text: 'one two three' }, { maxPriceUsd: 0.25, creditClass: 'sandbox' });
    expect(result.output).toEqual({ words: 3 });
    expect(result.offer).toBe(offerName);
    expect(result.charged).toEqual({ priceMicros: '250000', feeMicros: '1250', creditClass: 'sandbox' });
    expect(result.provider.id).toBe(providerReg.agent.id);
    const { receipt } = await caller.getReceipt(result.receiptId);
    expect(receipt.state).toBe('delivered');
    expect(receipt.via).toBe('proxy');
  });

  it('replays an invoke sent again with the same idempotency key', async () => {
    const key = `sdk-${Date.now()}`;
    const first = await caller.invoke<{ words: number }>(offerName, { text: 'same call twice' }, { idempotencyKey: key });
    const again = await caller.invoke<{ words: number }>(offerName, { text: 'same call twice' }, { idempotencyKey: key });
    expect(again.receiptId).toBe(first.receiptId);
    expect(again.output).toEqual({ words: 3 });
  });

  it('hires with autoAccept: validates the output locally and accepts with a rating', async () => {
    const hired = await caller.hire<{ words: number }>(offerName, { text: 'a b' }, { autoAccept: true, score: 95 });
    expect(hired.output).toEqual({ words: 2 });
    expect(hired.validation).toEqual({ ok: true, errors: [] });
    expect(hired.acceptance?.receipt.state).toBe('accepted');
  });

  it('turns output that breaks the schema into an output_invalid AnsApiError', async () => {
    lying = true;
    try {
      const err = await caller.invoke(offerName, { text: 'x' }).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(AnsApiError);
      expect(err).toMatchObject({ status: 502, code: 'output_invalid' });
      expect((err as AnsApiError).details).toMatchObject({ state: 'output_invalid', refunded: true });
    } finally {
      lying = false;
    }
  });

  it('refuses a price above maxPriceMicros', async () => {
    await expect(caller.invoke(offerName, { text: 'x' }, { maxPriceMicros: 1000 })).rejects.toMatchObject({ status: 409, code: 'conflict' });
  });
});
