import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { AnsError, canonicalize } from 'ans-core';
import { getRawBody, requireAgent, resolveAgent } from '../lib/auth';
import { jsonAns, teach, withAns } from '../lib/errors';
import { recordFunnel } from '../lib/funnel';
import { clientIp, consume, rateLimited } from '../lib/ratelimit';
import { agentRef } from '../lib/receipts';
import {
  activeOffersOf,
  closestOfferNames,
  composesWith,
  loadAgentRow,
  ownerSegment,
  parseOfferName,
  probeOffer,
  publishOffer,
  resolveOffer,
  searchOffers,
  toWireOffer,
  toWireOfferSummary,
  updateOffer,
  type ComposeEdge,
  type ResolvedOffer,
} from '../lib/offers';
import { agentSkillMd, offerSkillMd } from '../lib/skillgen';

/**
 * Offers API (docs/DESIGN.md section 4 "Offers, discovery and invocation", 7, 14.11).
 *
 *   POST  /v1/offers                          publish (signed, session or api key with scope publish)
 *   GET   /v1/offers?q&tag&maxPriceMicros&minTrust&limit&cursor
 *   GET   /v1/offers/agent/:idOrHandle        an agent's active offers (and /skill.md)
 *   GET   /v1/offers/@handle/slug[@v]         full contract (and /input.json, /output.json, /skill.md, /composes-with)
 *   GET   /v1/offers/:idOrName                the same by id or URL-encoded name
 *   PATCH /v1/offers/:id                      owner
 *   POST  /v1/offers/:id/probe                owner
 *
 * Literal routes are registered before parameter routes, and the @handle
 * routes only match a first segment starting with '@', so neither shadows the other.
 */

export const offersRouter = new Hono();

const DOCS = 'https://ans-registry.org/skill.md';
const MAX_PUBLISH_BYTES = 512 * 1024;
const PROBES_PER_HOUR = 10;

const writeAuth = requireAgent({ allow: ['signed', 'session', 'apikey'], scopes: ['publish'] });
const publishBodyLimit = bodyLimit({
  maxSize: MAX_PUBLISH_BYTES,
  onError: (c) => teach(c, 413, 'bad_request', `Request body is larger than ${MAX_PUBLISH_BYTES} bytes`, { details: { maxBytes: MAX_PUBLISH_BYTES }, fix: { docs: DOCS } }),
});

/** The raw body; an over-limit stream (no Content-Length) becomes a clean 413 instead of an unhandled error. */
export async function readRawBody(c: Context, maxBytes: number): Promise<string> {
  try {
    return await getRawBody(c);
  } catch (err) {
    if (err instanceof Error && err.name === 'BodyLimitError') {
      throw new AnsError('bad_request', `Request body is larger than ${maxBytes} bytes`, { status: 413, details: { maxBytes }, fix: { docs: DOCS } });
    }
    throw err;
  }
}

async function readJson(c: Context): Promise<unknown> {
  const raw = await readRawBody(c, MAX_PUBLISH_BYTES);
  if (!raw.trim()) throw new AnsError('bad_request', 'Send a JSON body', { fix: { docs: DOCS } });
  try {
    return JSON.parse(raw);
  } catch {
    throw new AnsError('bad_request', 'Request body is not valid JSON', { fix: { docs: DOCS } });
  }
}

async function mustResolve(nameOrId: string): Promise<ResolvedOffer> {
  const resolved = await resolveOffer(nameOrId);
  if (resolved) return resolved;
  const closest = await closestOfferNames(nameOrId);
  throw new AnsError('no_offer', `No offer named ${nameOrId}`, {
    details: { offer: nameOrId, closest },
    fix: {
      docs: DOCS,
      next: closest.length > 0 ? `GET /v1/offers/${closest[0]}` : 'Search instead: GET /v1/offers?q=<what you need done>',
    },
  });
}

function isVersionedRef(nameOrId: string): boolean {
  return nameOrId.startsWith('of_') || parseOfferName(nameOrId)?.version != null;
}

function edgeView(edges: ComposeEdge[]) {
  return edges.map((e) => ({ ...toWireOfferSummary(e.offer.offer, e.offer.owner), via: e.via }));
}

function queryInt(c: Context, name: string, min: number, max: number): number | null {
  const raw = c.req.query(name);
  if (raw === undefined || raw === '') return null;
  if (!/^\d{1,7}$/.test(raw) || Number(raw) < min || Number(raw) > max) {
    throw new AnsError('validation_error', `${name} must be an integer from ${min} to ${max}`, { details: { [name]: raw }, fix: { docs: DOCS } });
  }
  return Number(raw);
}

// ---------------------------------------------------------------------------
// Handlers shared by the id route and the @handle/slug route
// ---------------------------------------------------------------------------

async function showOffer(c: Context, ref: string): Promise<Response> {
  const { offer, owner } = await mustResolve(ref);
  await recordFunnel('offer.viewed', { offerId: offer.id, agentId: null, src: c.req.query('src') ?? 'api', ip: clientIp(c) });
  return jsonAns(c, { offer: toWireOffer(offer, owner) });
}

async function showSchema(c: Context, ref: string, which: 'input' | 'output'): Promise<Response> {
  const { offer } = await mustResolve(ref);
  const schema = which === 'input' ? offer.inputSchema : offer.outputSchema;
  // canonical JSON: sha256 of this body equals the offer's inputSchemaHash / outputSchemaHash
  return c.body(canonicalize(schema), 200, {
    'Content-Type': 'application/schema+json; charset=utf-8',
    'Cache-Control': isVersionedRef(ref) ? 'public, max-age=31536000, immutable' : 'public, max-age=300',
  });
}

async function showSkill(c: Context, ref: string): Promise<Response> {
  const { offer, owner } = await mustResolve(ref);
  return c.body(offerSkillMd(offer, owner), 200, { 'Content-Type': 'text/markdown; charset=utf-8', 'Cache-Control': 'public, max-age=60' });
}

async function showComposition(c: Context, ref: string): Promise<Response> {
  const resolved = await mustResolve(ref);
  const edges = await composesWith(resolved);
  return jsonAns(c, { offer: toWireOfferSummary(resolved.offer, resolved.owner).name, feeds: edgeView(edges.feeds), fedBy: edgeView(edges.fedBy) });
}

const handleRef = (c: Context) => `${c.req.param('handle')}/${c.req.param('slug')}`;

// ---------------------------------------------------------------------------
// Collection
// ---------------------------------------------------------------------------

offersRouter.post('/', publishBodyLimit, writeAuth, async (c) => {
  const auth = c.get('agent');
  const owner = await loadAgentRow(auth.id);
  const { offer } = await publishOffer(owner, await readJson(c), auth);
  const wire = toWireOffer(offer, owner);
  const badgeMarkdown = `[![@${ownerSegment(owner)} on ANS](${wire.urls.badge})](${wire.urls.page})`;
  return c.json(
    withAns({
      offer: wire,
      name: wire.name,
      urls: wire.urls,
      next: {
        mcp: wire.urls.mcp,
        skill: wire.urls.skill,
        badgeMarkdown,
        share: `Add this to your README: ${badgeMarkdown}`,
      },
    }),
    201,
  );
});

offersRouter.get('/', async (c) => {
  const q = (c.req.query('q') ?? '').trim().slice(0, 200) || null;
  const tagRaw = (c.req.query('tag') ?? '').trim().toLowerCase();
  if (tagRaw && !/^[a-z0-9-]{2,32}$/.test(tagRaw)) {
    throw new AnsError('validation_error', 'tag must be lowercase letters, digits or hyphens, 2 to 32 characters', { details: { tag: tagRaw }, fix: { docs: DOCS } });
  }
  const maxPriceRaw = c.req.query('maxPriceMicros');
  if (maxPriceRaw !== undefined && maxPriceRaw !== '' && !/^\d{1,15}$/.test(maxPriceRaw)) {
    throw new AnsError('validation_error', 'maxPriceMicros must be a non-negative integer of USD micros ($1 = 1000000)', { details: { maxPriceMicros: maxPriceRaw }, fix: { docs: DOCS } });
  }
  const minTrust = queryInt(c, 'minTrust', 0, 100);
  const limit = queryInt(c, 'limit', 1, 100) ?? 20;
  const cursor = c.req.query('cursor') || null;

  const { results, nextCursor } = await searchOffers({
    q,
    tag: tagRaw || null,
    maxPriceMicros: maxPriceRaw ? BigInt(maxPriceRaw) : null,
    minTrust,
    limit,
    cursor,
  });
  if (q && !cursor && results.length === 0) {
    await recordFunnel('find.empty', { src: c.req.query('src') ?? 'api', ip: clientIp(c), detail: q });
  }
  return jsonAns(c, { offers: results.map((r) => toWireOfferSummary(r.offer, r.owner)), nextCursor });
});

// ---------------------------------------------------------------------------
// Literal: an agent's offers
// ---------------------------------------------------------------------------

async function agentOrThrow(idOrHandle: string) {
  const agent = await resolveAgent(idOrHandle);
  if (!agent) throw new AnsError('not_found', `Agent ${idOrHandle} not found`, { fix: { docs: DOCS } });
  return agent;
}

offersRouter.get('/agent/:idOrHandle/skill.md', async (c) => {
  const agent = await agentOrThrow(c.req.param('idOrHandle'));
  const rows = await activeOffersOf(agent.id);
  return c.body(agentSkillMd(agent, rows), 200, { 'Content-Type': 'text/markdown; charset=utf-8', 'Cache-Control': 'public, max-age=60' });
});

offersRouter.get('/agent/:idOrHandle', async (c) => {
  const agent = await agentOrThrow(c.req.param('idOrHandle'));
  const rows = await activeOffersOf(agent.id);
  return jsonAns(c, { agent: agentRef(agent), offers: rows.map((o) => toWireOfferSummary(o, agent)) });
});

// ---------------------------------------------------------------------------
// @handle/slug[@version]
// ---------------------------------------------------------------------------

const AT = '/:handle{@[^/]+}/:slug{[^/]+}';

offersRouter.get(`${AT}/input.json`, (c) => showSchema(c, handleRef(c), 'input'));
offersRouter.get(`${AT}/output.json`, (c) => showSchema(c, handleRef(c), 'output'));
offersRouter.get(`${AT}/skill.md`, (c) => showSkill(c, handleRef(c)));
offersRouter.get(`${AT}/composes-with`, (c) => showComposition(c, handleRef(c)));
offersRouter.get(AT, (c) => showOffer(c, handleRef(c)));

// ---------------------------------------------------------------------------
// :id (an of_ id, or a URL-encoded full name)
// ---------------------------------------------------------------------------

offersRouter.get('/:id/input.json', (c) => showSchema(c, c.req.param('id'), 'input'));
offersRouter.get('/:id/output.json', (c) => showSchema(c, c.req.param('id'), 'output'));
offersRouter.get('/:id/skill.md', (c) => showSkill(c, c.req.param('id')));
offersRouter.get('/:id/composes-with', (c) => showComposition(c, c.req.param('id')));
offersRouter.get('/:id', (c) => showOffer(c, c.req.param('id')));

async function ownedOffer(c: Context): Promise<ResolvedOffer> {
  const auth = c.get('agent');
  const resolved = await mustResolve(c.req.param('id') ?? '');
  if (resolved.owner.id !== auth.id) {
    throw new AnsError('forbidden', 'Only the agent that published this offer can change or probe it', {
      details: { offerId: resolved.offer.id, owner: resolved.owner.id, authenticated: auth.id },
    });
  }
  return resolved;
}

offersRouter.patch('/:id', publishBodyLimit, writeAuth, async (c) => {
  const { offer, owner } = await ownedOffer(c);
  const row = await updateOffer(owner, offer, await readJson(c));
  return jsonAns(c, { offer: toWireOffer(row, owner) });
});

offersRouter.post('/:id/probe', writeAuth, async (c) => {
  const resolved = await ownedOffer(c);
  const hit = await consume(`probe:${resolved.offer.id}`, PROBES_PER_HOUR, 3600);
  if (!hit.allowed) return rateLimited(c, hit, 'probes of this offer');
  const result = await probeOffer(resolved);
  const date = result.probedAt.toISOString().slice(0, 10);
  return jsonAns(c, {
    offer: toWireOffer(result.resolved.offer, result.resolved.owner),
    probe: {
      ok: result.ok,
      label: `probe ${result.ok ? 'passed' : 'failed'} on ${date}`,
      probedAt: result.probedAt.toISOString(),
      latencyMs: result.latencyMs,
      status: result.status,
      reason: result.reason,
      errors: result.errors,
    },
  });
});
