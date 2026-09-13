import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Hono } from 'hono';
import { requestId } from 'hono/request-id';
import { eq, inArray, or, sql } from 'drizzle-orm';
import { buildOfferPublishCanonical, generateApiKey, sha256hex, verifyMessage } from 'ans-core';
import { db } from '../db';
import { agents, apiKeys, funnelEvents, notifications, offers, rateLimits, receiptEvents, receipts } from '../db/schema';
import { onError } from '../lib/errors';
import { getRegistryKeys } from '../lib/registry-keys';
import { ensureHouseAgent, extractVisibleText, HOUSE_DAILY_CALLS, HOUSE_OFFERS, pageFromBody } from '../lib/house';
import { probeOffer } from '../lib/offers';
import { offersRouter } from '../routes/offers';
import { flushInvokeBackground, invokeRouter } from '../routes/invoke';
import { createTestAgent, deleteRateLimitKeys, deleteTestAgents, body as parse, type TestAgent } from './helpers';

const app = new Hono();
app.use('*', requestId());
app.onError(onError);
app.route('/v1/offers', offersRouter);
app.route('/v1/invoke', invokeRouter);

async function invoke(key: string, payload: unknown): Promise<Response> {
  return app.request('/v1/invoke', { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
}

describe('house offers', () => {
  let caller: TestAgent;
  let apiKey: string;
  let houseId: string;
  let houseExisted = false;

  beforeAll(async () => {
    const [existing] = await db.select({ id: agents.id }).from(agents).where(eq(agents.handle, 'ans'));
    houseExisted = !!existing;
    caller = await createTestAgent('house-c');
    const key = generateApiKey();
    await db.insert(apiKeys).values({ id: key.prefix, keyHash: key.hash, agentId: caller.id, scopes: ['read', 'invoke'] });
    apiKey = key.key;
  });

  afterAll(async () => {
    await flushInvokeBackground();
    const receiptIds = (await db.select({ id: receipts.id }).from(receipts).where(eq(receipts.clientId, caller.id))).map((r) => r.id);
    if (receiptIds.length > 0) {
      await db.delete(receiptEvents).where(inArray(receiptEvents.receiptId, receiptIds));
      await db.delete(receipts).where(inArray(receipts.id, receiptIds));
    }
    if (houseId && !houseExisted) {
      const houseReceipts = (await db.select({ id: receipts.id }).from(receipts).where(or(eq(receipts.providerId, houseId), eq(receipts.clientId, houseId)))).map((r) => r.id);
      if (houseReceipts.length > 0) {
        await db.delete(receiptEvents).where(inArray(receiptEvents.receiptId, houseReceipts));
        await db.delete(receipts).where(inArray(receipts.id, houseReceipts));
      }
      const houseOffers = (await db.select({ id: offers.id }).from(offers).where(eq(offers.agentId, houseId))).map((o) => o.id);
      if (houseOffers.length > 0) {
        await db.delete(funnelEvents).where(inArray(funnelEvents.offerId, houseOffers));
        await db.delete(offers).where(inArray(offers.id, houseOffers));
      }
      await db.delete(notifications).where(eq(notifications.agentId, houseId));
      await deleteTestAgents([houseId]);
    }
    await db.delete(notifications).where(eq(notifications.agentId, caller.id));
    await deleteTestAgents([caller.id]);
    await deleteRateLimitKeys([`house:${caller.id}:`]);
  });

  it('ensureHouseAgent is idempotent and signs every house offer with the registry key', async () => {
    const first = await ensureHouseAgent();
    const second = await ensureHouseAgent();
    houseId = first.agent.id;
    const keys = await getRegistryKeys();

    expect(second.agent.id).toBe(first.agent.id);
    expect(first.agent).toMatchObject({ handle: 'ans', name: 'ANS house', type: 'service', isHouse: true, publicKey: keys.publicKey });
    expect(first.offers.map((o) => o.slug)).toEqual(['fetch-page', 'validate-json', 'hash-text', 'verify-agent']);
    expect(second.offers.map((o) => o.id)).toEqual(first.offers.map((o) => o.id));
    expect(second.offers.map((o) => o.updatedAt.getTime())).toEqual(first.offers.map((o) => o.updatedAt.getTime()));
    const rows = await db.select().from(offers).where(eq(offers.agentId, first.agent.id));
    expect(rows).toHaveLength(HOUSE_OFFERS.length);

    for (const o of first.offers) {
      expect(o).toMatchObject({ priceMicros: 0n, transport: 'ans-house', endpoint: null, status: 'active', version: 1 });
      const canonical = buildOfferPublishCanonical({ agentId: o.agentId, slug: o.slug, version: o.version, inputSchemaHash: o.inputSchemaHash, outputSchemaHash: o.outputSchemaHash, priceMicros: '0', endpoint: null }).canonical;
      expect(await verifyMessage(keys.publicKey, canonical, o.publishSig)).toBe(true);
    }

    const listed = await parse(await app.request('/v1/offers/agent/ans'));
    expect(listed.offers).toHaveLength(HOUSE_OFFERS.length);
    expect(listed.offers.every((o: any) => o.owner.isHouse && o.urls.page.includes('/offers/@ans/'))).toBe(true);
    const skill = await (await app.request('/v1/offers/@ans/hash-text/skill.md')).text();
    expect(skill).toContain('ans__hash-text');
    expect(skill).toContain('free');

    // a house probe runs in-process (no endpoint) and validates the example output shape
    const hashText = first.offers.find((o) => o.slug === 'hash-text')!;
    const probe = await probeOffer({ offer: hashText, owner: first.agent });
    expect(probe.ok).toBe(true);
    expect(probe.resolved.offer.probeOk).toBe(true);
  });

  it('validate-json runs end to end through /v1/invoke and opens a free delivered receipt', async () => {
    const schema = { type: 'object', required: ['name'], properties: { name: { type: 'string' } } };
    const ok = await invoke(apiKey, { offer: '@ans/validate-json', input: { schema, value: { name: 'Ada' } } });
    expect(ok.status).toBe(200);
    const okJson = await parse(ok);
    expect(okJson.output).toEqual({ valid: true, errors: [] });
    expect(okJson.charged).toEqual({ priceMicros: '0', feeMicros: '0', creditClass: 'none' });
    expect(okJson.provider).toMatchObject({ handle: 'ans', isHouse: true });

    const [r] = await db.select().from(receipts).where(eq(receipts.id, okJson.receiptId));
    expect(r).toMatchObject({ state: 'delivered', via: 'proxy', providerId: houseId, clientId: caller.id, creditClass: 'none' });
    expect(r.outputHash).toBe(sha256hex(JSON.stringify({ errors: [], valid: true })));

    const bad = await invoke(apiKey, { offer: '@ans/validate-json', input: { schema, value: { name: 42 } } });
    expect(bad.status).toBe(200);
    expect((await parse(bad)).output).toEqual({ valid: false, errors: [{ path: '/name', message: 'must be string' }] });

    const badSchema = await invoke(apiKey, { offer: '@ans/validate-json', input: { schema: { type: 'object', properties: { a: { $ref: 'https://evil.example/x.json' } } }, value: {} } });
    expect(badSchema.status).toBe(400);
    const bj = await parse(badSchema);
    expect(bj.error).toBe('input_invalid');
    expect(bj.message).toMatch(/not local/);
  });

  it('hash-text returns the sha256 of the text', async () => {
    const text = `deliverable body ${String.fromCharCode(233)}`;
    const res = await invoke(apiKey, { offer: '@ans/hash-text', input: { text } });
    expect(res.status).toBe(200);
    expect((await parse(res)).output).toEqual({ sha256: sha256hex(text) });
  });

  it('verify-agent returns the registered shape and the unregistered shape', async () => {
    const res = await invoke(apiKey, { offer: '@ans/verify-agent', input: { agent: `@${caller.handle}` } });
    expect(res.status).toBe(200);
    const out = (await parse(res)).output;
    expect(out).toEqual({ registered: true, id: caller.id, handle: caller.handle, trust: { score: 50, confidence: 0, rank: 35 }, receipts: { confirmed: 0, negative: 0 } });

    const none = await invoke(apiKey, { offer: '@ans/verify-agent', input: { agent: 'no-such-agent-here' } });
    expect((await parse(none)).output).toEqual({ registered: false, id: null, handle: null, trust: null, receipts: null });
  });

  it('house calls are limited to 50 per caller per UTC day (429) and honor the daily budget flag (503)', async () => {
    const day = new Date().toISOString().slice(0, 10);
    const key = `house:${caller.id}:${day}`;
    await db
      .insert(rateLimits)
      .values({ key, count: HOUSE_DAILY_CALLS, resetAt: new Date(Date.now() + 3600_000) })
      .onConflictDoUpdate({ target: rateLimits.key, set: { count: HOUSE_DAILY_CALLS } });
    const limited = await invoke(apiKey, { offer: '@ans/hash-text', input: { text: 'one too many' } });
    expect(limited.status).toBe(429);
    expect((await parse(limited)).error).toBe('rate_limited');
    expect(limited.headers.get('Retry-After')).toBeTruthy();
    await db.delete(rateLimits).where(eq(rateLimits.key, key));

    // raw SQL on purpose: a drizzle jsonb read-then-write turns the stored string "0" into the number 0
    const rows = (await db.execute(sql`select value::text as v from system_flags where key = 'house_spent_today_micros'`)) as unknown as { v: string }[];
    expect(rows).toHaveLength(1);
    const spentText = rows[0].v;
    try {
      await db.execute(sql`update system_flags set value = (select value from system_flags where key = 'house_daily_budget_micros') where key = 'house_spent_today_micros'`);
      const exhausted = await invoke(apiKey, { offer: '@ans/hash-text', input: { text: 'over budget' } });
      expect(exhausted.status).toBe(503);
      expect((await parse(exhausted)).error).toBe('house_budget_exhausted');
    } finally {
      await db.execute(sql`update system_flags set value = ${spentText}::jsonb where key = 'house_spent_today_micros'`);
    }
    const back = await invoke(apiKey, { offer: '@ans/hash-text', input: { text: 'back again' } });
    expect(back.status).toBe(200);
  });

  it('fetch-page extracts the title and visible text, in linear time on hostile markup', () => {
    const html = '<!doctype html><html><head><title>Hello &amp; welcome</title><style>body{color:red}</style><script>var x = "<p>hidden</p>";</script></head>'
      + '<body><!-- a comment --><h1>Heading</h1>\n\n<p>First&nbsp;para &#233; with &lt;code&gt; and &#x41;.</p><noscript>no js</noscript><svg><text>svg text</text></svg><p>Last</p></body></html>';
    const page = extractVisibleText(html);
    expect(page.title).toBe('Hello & welcome');
    expect(page.text).toBe(`Heading First para ${String.fromCharCode(233)} with <code> and A. Last`);

    const hostile = '<script'.repeat(200_000);
    const t0 = Date.now();
    extractVisibleText(hostile);
    extractVisibleText('<p'.repeat(500_000) + 'x');
    expect(Date.now() - t0).toBeLessThan(2000);

    const long = pageFromBody('https://example.com/', 200, 'text/html; charset=utf-8', new TextEncoder().encode(`<p>${'word '.repeat(10_000)}</p>`));
    expect(long.text.length).toBe(20_000);
    expect(long.bytes).toBeGreaterThan(50_000);
    const binary = pageFromBody('https://example.com/a.png', 200, 'image/png', new Uint8Array([137, 80, 78, 71]));
    expect(binary).toEqual({ url: 'https://example.com/a.png', status: 200, contentType: 'image/png', title: null, text: '', bytes: 4 });
  });
});
