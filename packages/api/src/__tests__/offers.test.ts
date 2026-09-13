import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Hono } from 'hono';
import { requestId } from 'hono/request-id';
import { and, eq, gte, inArray, or } from 'drizzle-orm';
import { buildOfferPublishCanonical, canonicalHash, generateApiKey, generateId, sha256hex, signMessage, signRequest } from 'ans-core';
import { db } from '../db';
import { agents, apiKeys, funnelEvents, notifications, offers, receiptEvents, receipts } from '../db/schema';
import { config } from '../config';
import { onError } from '../lib/errors';
import { decodeOffsetCursor, encodeOffsetCursor, parseOfferName, type ForwardRequest } from '../lib/offers';
import { topFields, validateAgainst, validateSchemaDocument } from '../lib/schemas';
import { RECEIPT_LINE } from '../lib/skillgen';
import { offersRouter } from '../routes/offers';
import { flushInvokeBackground, setInvokeForwarder } from '../routes/invoke';
import { createTestAgent, deleteTestAgents, deleteRateLimitKeys, body as parse, type TestAgent } from './helpers';

const app = new Hono();
app.use('*', requestId());
app.onError(onError);
app.route('/v1/offers', offersRouter);

const DRAFT = 'https://json-schema.org/draft/2020-12/schema';
const API = config.publicApiUrl;
const WEB = config.publicWebUrl;
const suffix = () => generateId('x', 8).slice(1).toLowerCase().replace(/[^a-z0-9]/g, 'q');
const TOKEN = `zq${suffix()}`;

const textIn = { $schema: DRAFT, type: 'object', required: ['text'], properties: { text: { type: 'string', maxLength: 1000 } }, additionalProperties: false };
const summaryOut = { type: 'object', required: ['summary'], properties: { summary: { type: 'string' }, words: { type: 'integer' } }, additionalProperties: false };
const countOut = { type: 'object', required: ['count'], properties: { count: { type: 'integer', minimum: 0 } }, additionalProperties: false };

interface Draft {
  slug: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  examples?: { input: unknown; output: unknown }[];
  tags?: string[];
  priceMicros?: string;
  endpoint?: string | null;
  feeds?: string[];
  requires?: Record<string, unknown>;
  [key: string]: unknown;
}

function draft(overrides: Partial<Draft> = {}): Draft {
  return {
    slug: 'summarize',
    title: `Summarize text ${TOKEN}`,
    description: 'Summarizes a <b>short</b> text into one sentence.',
    inputSchema: textIn,
    outputSchema: summaryOut,
    examples: [{ input: { text: 'The quick brown fox jumps over the lazy dog.' }, output: { summary: 'A fox jumps a dog.', words: 5 } }],
    tags: ['text', 'summary'],
    priceMicros: '0',
    endpoint: 'http://127.0.0.1:9/ans/summarize',
    ...overrides,
  };
}

function canonicalFor(agent: TestAgent, d: Draft, version: number): string {
  return buildOfferPublishCanonical({
    agentId: agent.id,
    slug: d.slug,
    version,
    inputSchemaHash: canonicalHash(d.inputSchema),
    outputSchemaHash: canonicalHash(d.outputSchema),
    priceMicros: BigInt(d.priceMicros ?? '0').toString(),
    endpoint: d.endpoint ?? null,
  }).canonical;
}

async function signedBody(agent: TestAgent, d: Draft, version = 1): Promise<Record<string, unknown>> {
  const publishSig = await signMessage(agent.privateKey, canonicalFor(agent, d, version));
  return { ...d, ...(version !== 1 ? { version } : {}), publishSig };
}

async function signedRequest(agent: TestAgent, method: string, path: string, payload?: unknown): Promise<Response> {
  const body = payload === undefined ? undefined : JSON.stringify(payload);
  const headers = await signRequest(agent.privateKey, { method, pathname: path, body, agentId: agent.id });
  return app.request(path, { method, headers: { ...headers, ...(body ? { 'Content-Type': 'application/json' } : {}) } as Record<string, string>, body });
}

async function publish(agent: TestAgent, d: Draft, version = 1): Promise<Response> {
  return signedRequest(agent, 'POST', '/v1/offers', await signedBody(agent, d, version));
}

async function cleanupAgents(ids: string[]): Promise<void> {
  const offerIds = (await db.select({ id: offers.id }).from(offers).where(inArray(offers.agentId, ids))).map((o) => o.id);
  const receiptIds = (
    await db
      .select({ id: receipts.id })
      .from(receipts)
      .where(or(inArray(receipts.clientId, ids), inArray(receipts.providerId, ids)))
  ).map((r) => r.id);
  if (receiptIds.length > 0) {
    await db.delete(receiptEvents).where(inArray(receiptEvents.receiptId, receiptIds));
    await db.delete(receipts).where(inArray(receipts.id, receiptIds));
  }
  if (offerIds.length > 0) {
    await db.delete(funnelEvents).where(inArray(funnelEvents.offerId, offerIds));
    await db.delete(offers).where(inArray(offers.id, offerIds));
  }
  await db.delete(notifications).where(inArray(notifications.agentId, ids));
  await deleteTestAgents(ids);
}

const WIRE_SUMMARY_KEYS = ['description', 'id', 'inputFields', 'name', 'outputFields', 'owner', 'priceMicros', 'slug', 'stats', 'status', 'tags', 'title', 'urls', 'version'];
const WIRE_OFFER_KEYS = [...WIRE_SUMMARY_KEYS, 'createdAt', 'endpointHost', 'examples', 'feeds', 'inputSchema', 'inputSchemaHash', 'mode', 'outputSchema', 'outputSchemaHash', 'probeOk', 'probedAt', 'requires', 'timeoutMs'];

describe('lib/schemas', () => {
  it('accepts a strict draft 2020-12 schema and reports top fields, required first', () => {
    expect(() => validateSchemaDocument(textIn, 'inputSchema')).not.toThrow();
    expect(topFields({ type: 'object', required: ['b'], properties: { a: { type: 'string' }, b: { type: 'string' } } })).toEqual(['b', 'a']);
    const r = validateAgainst(textIn, { text: 5 });
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toMatchObject({ path: '/text', keyword: 'type' });
  });

  it('refuses remote refs, remote ids, unknown keywords, deep nesting and nested quantifiers', () => {
    const cases: [unknown, RegExp][] = [
      [{ type: 'object', properties: { a: { $ref: 'https://evil.example/s.json' } } }, /not local/],
      [{ $id: 'https://evil.example/root.json', type: 'string' }, /points outside/],
      [{ type: 'string', frobnicate: true }, /unknown keyword/],
      [{ properties: { a: { type: 'string' } } }, /missing type "object"/],
      [{ type: 'string', pattern: '^(a+)+$' }, /nested quantifiers/],
      [{ $schema: 'http://json-schema.org/draft-07/schema#', type: 'string' }, /2020-12/],
      [JSON.parse('{"type":"object","properties":' + '{"a":{"type":"object","properties":'.repeat(6) + '{}' + '}}'.repeat(6) + '}'), /levels deep/],
      [[{ type: 'string' }], /JSON Schema object/],
    ];
    for (const [schema, message] of cases) {
      let err: any;
      try {
        validateSchemaDocument(schema, 'inputSchema');
      } catch (e) {
        err = e;
      }
      expect(err?.code, JSON.stringify(schema).slice(0, 80)).toBe('validation_error');
      expect(err.message).toMatch(message);
    }
  });

  it('parses offer names and offset cursors', () => {
    expect(parseOfferName('@Scout/PR-Review@3')).toEqual({ owner: 'scout', slug: 'pr-review', version: 3 });
    expect(parseOfferName('scout/pr-review')).toEqual({ owner: 'scout', slug: 'pr-review', version: null });
    expect(parseOfferName('@scout')).toBeNull();
    expect(decodeOffsetCursor(encodeOffsetCursor(40))).toBe(40);
    expect(() => decodeOffsetCursor('garbage')).toThrow(/cursor/);
  });
});

describe('offers API', () => {
  let owner: TestAgent;
  let other: TestAgent;
  let house: TestAgent;
  const started = new Date(Date.now() - 1000);
  const forwarded: ForwardRequest[] = [];

  beforeAll(async () => {
    owner = await createTestAgent('offer-o');
    other = await createTestAgent('offer-x');
    house = await createTestAgent('offer-h');
    await db.update(agents).set({ isHouse: true, trustRank: 99 }).where(eq(agents.id, house.id));
    await db.update(agents).set({ trustRank: 80, trustScore: 90 }).where(eq(agents.id, owner.id));
    await db.update(agents).set({ trustRank: 40, trustScore: 60 }).where(eq(agents.id, other.id));
    setInvokeForwarder(async (req) => {
      forwarded.push(req);
      return { status: 200, text: JSON.stringify({ summary: 'A fox jumps a dog.' }) };
    });
  });

  afterAll(async () => {
    setInvokeForwarder(null);
    await flushInvokeBackground();
    await db.delete(funnelEvents).where(and(eq(funnelEvents.event, 'find.empty'), gte(funnelEvents.createdAt, started)));
    await cleanupAgents([owner.id, other.id, house.id]);
    await deleteRateLimitKeys(['probe:']);
  });

  it('publishes a signed offer: 201 with the WireOffer shape, name, urls and next', async () => {
    const res = await publish(owner, draft({ requires: { secrets: ['OPENAI_API_KEY'], callbackUrl: false, notes: 'Plain <i>text</i> only.' } }));
    expect(res.status).toBe(201);
    const json = await parse(res);
    const o = json.offer;
    expect(Object.keys(o).sort()).toEqual([...WIRE_OFFER_KEYS].sort());
    expect(o.name).toBe(`@${owner.handle}/summarize@1`);
    expect(json.name).toBe(o.name);
    expect(o.id).toMatch(/^of_[A-Za-z0-9]{16}$/);
    expect(o.description).toBe('Summarizes a short text into one sentence.');
    expect(o.version).toBe(1);
    expect(o.priceMicros).toBe('0');
    expect(o.status).toBe('active');
    expect(o.mode).toBe('sync');
    expect(o.timeoutMs).toBe(30000);
    expect(o.inputFields).toEqual(['text']);
    expect(o.outputFields).toEqual(['summary', 'words']);
    expect(o.inputSchemaHash).toBe(canonicalHash(textIn));
    expect(o.endpointHost).toBe('127.0.0.1');
    expect(JSON.stringify(o)).not.toContain('/ans/summarize');
    expect(o.requires).toEqual({ secrets: ['OPENAI_API_KEY'], callbackUrl: false, notes: 'Plain text only.' });
    expect(o.feeds).toEqual([]);
    expect(o.probeOk).toBeNull();
    expect(o.stats).toEqual({ calls: 0, ok: 0, failed: 0, timeout: 0, inputInvalid: 0, outputInvalid: 0, p50Ms: null, p95Ms: null, lastCalledAt: null });
    expect(Object.keys(o.owner).sort()).toEqual(['avatar', 'handle', 'id', 'isHouse', 'name', 'trust']);
    expect(o.owner.id).toBe(owner.id);
    expect(o.urls).toEqual({
      page: `${WEB}/offers/@${owner.handle}/summarize`,
      mcp: `${API}/mcp/offer/@${owner.handle}/summarize`,
      skill: `${API}/v1/offers/@${owner.handle}/summarize/skill.md`,
      inputSchema: `${API}/v1/offers/@${owner.handle}/summarize@1/input.json`,
      outputSchema: `${API}/v1/offers/@${owner.handle}/summarize@1/output.json`,
      badge: `${API}/v1/agents/${owner.id}/card?style=badge`,
    });
    expect(json.urls).toEqual(o.urls);
    expect(json.next.mcp).toBe(o.urls.mcp);
    expect(json.next.skill).toBe(o.urls.skill);
    expect(json.next.badgeMarkdown).toBe(`[![@${owner.handle} on ANS](${o.urls.badge})](${o.urls.page})`);
    expect(json.next.share).toContain(json.next.badgeMarkdown);
    expect(json._ans.docs).toBeTruthy();
  });

  it('answers 401 invalid_signature with the canonical when publishSig is wrong', async () => {
    const d = draft({ slug: 'bad-sig' });
    const body = { ...d, publishSig: await signMessage(other.privateKey, canonicalFor(owner, d, 1)) };
    const res = await signedRequest(owner, 'POST', '/v1/offers', body);
    expect(res.status).toBe(401);
    const json = await parse(res);
    expect(json.error).toBe('invalid_signature');
    expect(json.details.canonical).toBe(canonicalFor(owner, d, 1));
    expect(json.fix.next).toContain('standingAccept');
  });

  it('refuses an api-key publish without publishSig with 400 explaining the signature, and bodies over 512 KB with 413', async () => {
    const key = generateApiKey();
    await db.insert(apiKeys).values({ id: key.prefix, keyHash: key.hash, agentId: owner.id, scopes: ['read', 'publish'] });
    const huge = await app.request('/v1/offers', { method: 'POST', headers: { Authorization: `Bearer ${key.key}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ ...draft({ slug: 'huge' }), description: 'x'.repeat(600 * 1024) }) });
    expect(huge.status).toBe(413);
    expect((await parse(huge)).details.maxBytes).toBe(512 * 1024);
    const res = await app.request('/v1/offers', { method: 'POST', headers: { Authorization: `Bearer ${key.key}`, 'Content-Type': 'application/json' }, body: JSON.stringify(draft({ slug: 'no-sig' })) });
    expect(res.status).toBe(400);
    const json = await parse(res);
    expect(json.error).toBe('bad_request');
    expect(json.message).toMatch(/publishSig/);
    expect(json.details.canonical).toContain('"standingAccept":true');
  });

  it('answers 400 for an oversized schema, a remote $ref, an example that does not match, and bad feeds', async () => {
    const big = { ...textIn, description: 'x'.repeat(40 * 1024) };
    const r1 = await publish(owner, draft({ slug: 'too-big', inputSchema: big }));
    expect(r1.status).toBe(400);
    const j1 = await parse(r1);
    expect(j1.error).toBe('validation_error');
    expect(j1.message).toMatch(/inputSchema: is \d+ bytes/);

    const remote = { type: 'object', properties: { text: { $ref: 'https://evil.example/text.json' } } };
    const r2 = await publish(owner, draft({ slug: 'remote-ref', inputSchema: remote, examples: [] }));
    expect(r2.status).toBe(400);
    const j2 = await parse(r2);
    expect(j2.details.field).toBe('inputSchema');
    expect(j2.details.errors[0].path).toBe('#/properties/text/$ref');

    const r3 = await publish(owner, draft({ slug: 'bad-example', examples: [{ input: { text: 42 }, output: { summary: 'x' } }] }));
    expect(r3.status).toBe(400);
    const j3 = await parse(r3);
    expect(j3.details.field).toBe('examples[0].input');
    expect(j3.details.errors[0]).toMatchObject({ path: '/text', keyword: 'type' });

    const r4 = await publish(owner, draft({ slug: 'bad-feed', feeds: ['@nobody-registered/nothing'] }));
    expect(r4.status).toBe(400);
    expect((await parse(r4)).details.field).toBe('feeds[0]');

    // a real target whose input schema rejects examples[0].output
    const target = await publish(other, draft({ slug: 'count-words', title: `Count words ${TOKEN}`, inputSchema: textIn, outputSchema: countOut, examples: [{ input: { text: 'a b' }, output: { count: 2 } }] }));
    expect(target.status).toBe(201);
    const r5 = await publish(owner, draft({ slug: 'bad-feed-2', feeds: [`@${other.handle}/count-words`] }));
    expect(r5.status).toBe(400);
    const j5 = await parse(r5);
    expect(j5.details.target).toBe(`@${other.handle}/count-words`);
    expect(j5.details.errors.length).toBeGreaterThan(0);
  });

  it('versions: schema change needs version + 1 (409 with nextVersion), identical schemas answer 409 use PATCH', async () => {
    const changed = draft({ outputSchema: { ...summaryOut, properties: { ...summaryOut.properties, lang: { type: 'string' } } } });
    const r1 = await publish(owner, changed, 1);
    expect(r1.status).toBe(409);
    const j1 = await parse(r1);
    expect(j1.error).toBe('conflict');
    expect(j1.details.nextVersion).toBe(2);

    const r2 = await publish(owner, changed, 2);
    expect(r2.status).toBe(201);
    expect((await parse(r2)).offer.name).toBe(`@${owner.handle}/summarize@2`);

    const r3 = await publish(owner, changed, 3);
    expect(r3.status).toBe(409);
    const j3 = await parse(r3);
    expect(j3.details.patch).toMatch(/^PATCH \/v1\/offers\/of_/);

    const latest = await parse(await app.request(`/v1/offers/@${owner.handle}/summarize`));
    expect(latest.offer.version).toBe(2);
    const pinned = await parse(await app.request(`/v1/offers/@${owner.handle}/summarize@1`));
    expect(pinned.offer.version).toBe(1);
    const byEncoded = await app.request(`/v1/offers/${encodeURIComponent(`@${owner.handle}/summarize@1`)}`);
    expect((await parse(byEncoded)).offer.id).toBe(pinned.offer.id);
    const byId = await parse(await app.request(`/v1/offers/${pinned.offer.id}`));
    expect(byId.offer.name).toBe(`@${owner.handle}/summarize@1`);

    const views = await db.select().from(funnelEvents).where(and(eq(funnelEvents.event, 'offer.viewed'), eq(funnelEvents.offerId, pinned.offer.id)));
    expect(views.length).toBeGreaterThanOrEqual(2);

    const missing = await app.request(`/v1/offers/@${owner.handle}/summarise`);
    expect(missing.status).toBe(404);
    const mj = await parse(missing);
    expect(mj.error).toBe('no_offer');
    expect(mj.details.closest).toContain(`@${owner.handle}/summarize`);
  });

  it('serves schemas as application/schema+json whose sha256 is the schema hash, and a skill.md with three call methods', async () => {
    const res = await app.request(`/v1/offers/@${owner.handle}/summarize@1/input.json`);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('application/schema+json');
    const text = await res.text();
    expect(sha256hex(text)).toBe(canonicalHash(textIn));
    const out = await app.request(`/v1/offers/@${owner.handle}/summarize@1/output.json`);
    expect(JSON.parse(await out.text())).toEqual(summaryOut);

    const md = await app.request(`/v1/offers/@${owner.handle}/summarize/skill.md`);
    expect(md.status).toBe(200);
    expect(md.headers.get('Content-Type')).toContain('text/markdown');
    const skill = await md.text();
    expect(skill).toContain(`@${owner.handle}/summarize@2`);
    expect(skill).toContain('npx -y ans-mcp');
    expect(skill).toContain(`${owner.handle}__summarize`);
    expect(skill).toContain(`${API}/mcp/offer/@${owner.handle}/summarize`);
    expect(skill).toContain('Authorization: Bearer ak_...');
    expect(skill).toContain(`curl -X POST ${API}/v1/invoke`);
    expect(skill).toContain('0.5%');
    expect(skill).toContain('## Send');
    expect(skill).toContain('## Get back');
    const pinnedSkill = await (await app.request(`/v1/offers/@${owner.handle}/summarize@1/skill.md`)).text();
    expect(pinnedSkill).toContain('## Requires');
    expect(pinnedSkill).toContain('`OPENAI_API_KEY`');
    expect(skill).toContain(RECEIPT_LINE);
    expect(skill).not.toMatch(new RegExp('[\\u2013\\u2014]'));

    const agentMd = await (await app.request(`/v1/offers/agent/@${owner.handle}/skill.md`)).text();
    expect(agentMd).toContain('## Summarize text');
    expect(agentMd).toContain(RECEIPT_LINE);
  });

  it('lists an agent\'s active offers (latest version per slug) and PATCHes metadata, price only with a new publishSig', async () => {
    const list = await parse(await app.request(`/v1/offers/agent/@${owner.handle}`));
    expect(list.agent.id).toBe(owner.id);
    expect(list.offers.map((o: any) => o.name)).toEqual([`@${owner.handle}/summarize@2`]);
    expect(Object.keys(list.offers[0]).sort()).toEqual([...WIRE_SUMMARY_KEYS].sort());
    const id = list.offers[0].id;

    const r1 = await signedRequest(owner, 'PATCH', `/v1/offers/${id}`, { description: 'Summarizes text in one sentence.', tags: ['Text', 'nlp'] });
    expect(r1.status).toBe(200);
    const j1 = await parse(r1);
    expect(j1.offer.description).toBe('Summarizes text in one sentence.');
    expect(j1.offer.tags).toEqual(['text', 'nlp']);

    const noSig = await signedRequest(owner, 'PATCH', `/v1/offers/${id}`, { priceMicros: '250000' });
    expect(noSig.status).toBe(400);
    const nj = await parse(noSig);
    expect(nj.details.canonical).toContain('"priceMicros":"250000"');

    const [row] = await db.select().from(offers).where(eq(offers.id, id));
    const canonical = buildOfferPublishCanonical({ agentId: owner.id, slug: row.slug, version: row.version, inputSchemaHash: row.inputSchemaHash, outputSchemaHash: row.outputSchemaHash, priceMicros: '250000', endpoint: row.endpoint }).canonical;
    const withSig = await signedRequest(owner, 'PATCH', `/v1/offers/${id}`, { priceMicros: '250000', publishSig: await signMessage(owner.privateKey, canonical) });
    expect(withSig.status).toBe(200);
    expect((await parse(withSig)).offer.priceMicros).toBe('250000');

    // a paused offer still resolves by its unversioned name and reads as paused
    const paused = await signedRequest(owner, 'PATCH', `/v1/offers/${encodeURIComponent(`@${owner.handle}/summarize@1`)}`, { status: 'paused' });
    expect(paused.status).toBe(200);
    const pinnedV1 = await parse(await app.request(`/v1/offers/@${owner.handle}/summarize@1`));
    expect(pinnedV1.offer.status).toBe('paused');
    expect((await parse(await app.request(`/v1/offers/@${owner.handle}/summarize`))).offer.version).toBe(2);

    const notMine = await signedRequest(other, 'PATCH', `/v1/offers/${id}`, { description: 'hijacked description here' });
    expect(notMine.status).toBe(403);
    const unknownField = await signedRequest(owner, 'PATCH', `/v1/offers/${id}`, { inputSchema: {} });
    expect(unknownField.status).toBe(400);
  });

  it('search ranks by owner trust rank, lists house offers last, filters, pages, and records find.empty', async () => {
    const h = await publish(house, draft({ slug: 'house-thing', title: `House thing ${TOKEN}` }));
    expect(h.status).toBe(201);
    const res = await app.request(`/v1/offers?q=${TOKEN}`);
    expect(res.status).toBe(200);
    const json = await parse(res);
    const names = json.offers.map((o: any) => o.name);
    expect(names).toEqual([`@${owner.handle}/summarize@2`, `@${other.handle}/count-words@1`, `@${house.handle}/house-thing@1`]);
    expect(json.offers[2].owner.isHouse).toBe(true);
    expect(Object.keys(json.offers[0]).sort()).toEqual([...WIRE_SUMMARY_KEYS].sort());
    expect(json.nextCursor).toBeNull();

    const paged = await parse(await app.request(`/v1/offers?q=${TOKEN}&limit=2`));
    expect(paged.offers).toHaveLength(2);
    expect(paged.nextCursor).toBeTruthy();
    const page2 = await parse(await app.request(`/v1/offers?q=${TOKEN}&limit=2&cursor=${paged.nextCursor}`));
    expect(page2.offers.map((o: any) => o.name)).toEqual([`@${house.handle}/house-thing@1`]);

    const cheap = await parse(await app.request(`/v1/offers?q=${TOKEN}&maxPriceMicros=100000`));
    expect(cheap.offers.map((o: any) => o.slug)).not.toContain('summarize');
    const trusted = await parse(await app.request(`/v1/offers?q=${TOKEN}&minTrust=85`));
    expect(trusted.offers.map((o: any) => o.slug)).toEqual(['summarize']);
    const tagged = await parse(await app.request(`/v1/offers?q=${TOKEN}&tag=nlp`));
    expect(tagged.offers.map((o: any) => o.slug)).toEqual(['summarize']);
    const byHandle = await parse(await app.request(`/v1/offers?q=${other.handle}`));
    expect(byHandle.offers.map((o: any) => o.slug)).toContain('count-words');

    const bad = await app.request('/v1/offers?minTrust=500');
    expect(bad.status).toBe(400);

    const nothing = `nothing-${suffix()}`;
    const empty = await parse(await app.request(`/v1/offers?q=${nothing}`));
    expect(empty.offers).toEqual([]);
    const rows = await db.select().from(funnelEvents).where(and(eq(funnelEvents.event, 'find.empty'), gte(funnelEvents.createdAt, started)));
    expect(rows.length).toBeGreaterThanOrEqual(1);
  });

  it('composes-with returns declared feeds and exact schema-hash edges in both directions', async () => {
    // @owner/extract: text -> {text} (its output schema equals count-words' input schema)
    const extract = await publish(owner, draft({ slug: 'extract', title: `Extract ${TOKEN}`, outputSchema: textIn, examples: [{ input: { text: 'x' }, output: { text: 'x' } }] }));
    expect(extract.status).toBe(201);
    // @owner/declares: declares it feeds @other/count-words (examples[0].output is valid count-words input)
    const declares = await publish(owner, draft({ slug: 'declares', title: `Declares ${TOKEN}`, outputSchema: { type: 'object', required: ['text'], properties: { text: { type: 'string' }, extra: { type: 'boolean' } } }, examples: [{ input: { text: 'x' }, output: { text: 'hello world' } }], feeds: [`@${other.handle}/count-words`] }));
    expect(declares.status).toBe(201);
    expect((await parse(declares)).offer.feeds).toEqual([`@${other.handle}/count-words`]);

    const fromExtract = await parse(await app.request(`/v1/offers/@${owner.handle}/extract/composes-with`));
    expect(fromExtract.offer).toBe(`@${owner.handle}/extract@1`);
    const feedTargets = fromExtract.feeds.map((e: any) => [e.name, e.via]);
    expect(feedTargets).toContainEqual([`@${other.handle}/count-words@1`, ['schema']]);

    const intoCount = await parse(await app.request(`/v1/offers/@${other.handle}/count-words/composes-with`));
    const fedBy = Object.fromEntries(intoCount.fedBy.map((e: any) => [e.name, e.via]));
    expect(fedBy[`@${owner.handle}/extract@1`]).toEqual(['schema']);
    expect(fedBy[`@${owner.handle}/declares@1`]).toEqual(['declared']);

    const fromDeclares = await parse(await app.request(`/v1/offers/@${owner.handle}/declares/composes-with`));
    expect(fromDeclares.feeds.map((e: any) => [e.name, e.via])).toContainEqual([`@${other.handle}/count-words@1`, ['declared']]);
  });

  it('probe: owner-only, posts examples[0].input through the forwarder with registry headers, stores probeOk', async () => {
    const list = await parse(await app.request(`/v1/offers/agent/@${owner.handle}`));
    const summarize = list.offers.find((o: any) => o.slug === 'summarize');
    const forbidden = await signedRequest(other, 'POST', `/v1/offers/${summarize.id}/probe`);
    expect(forbidden.status).toBe(403);

    const res = await signedRequest(owner, 'POST', `/v1/offers/${summarize.id}/probe`);
    expect(res.status).toBe(200);
    const json = await parse(res);
    expect(json.probe.ok).toBe(true);
    expect(json.probe.label).toMatch(/^probe passed on \d{4}-\d{2}-\d{2}$/);
    expect(json.offer.probeOk).toBe(true);
    expect(json.offer.probedAt).toBeTruthy();
    const req = forwarded[forwarded.length - 1];
    expect(req.url).toBe('http://127.0.0.1:9/ans/summarize');
    expect(req.headers['X-ANS-Probe']).toBe('1');
    expect(req.headers['X-ANS-Signature']).toBeTruthy();
    expect(JSON.parse(req.body).input).toEqual({ text: 'The quick brown fox jumps over the lazy dog.' });
  });
});
