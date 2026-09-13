import { Hono } from 'hono';
import { z } from 'zod';
import { and, count, desc, eq, gte, ilike, inArray, or, sql, type SQL, type SQLWrapper } from 'drizzle-orm';
import { generateId, sha256hex } from 'ans-core';
import { db } from '../db';
import { agents, funnelEvents, offers, type OfferStats } from '../db/schema';
import { recordFunnel } from '../lib/funnel';
import { config } from '../config';
import { jsonAns } from '../lib/errors';
import { clientIp } from '../lib/ratelimit';
import { jsonbArray, offerName, publicAgentView, trustOf } from './agents';

/**
 * Discovery (docs/DESIGN.md section 4 and 14.10). Filters run on
 * agents.tags (jsonb) and offers.tags; results are ordered by trust_rank
 * desc, then last_seen desc nulls last. Seed rows are never returned. The
 * hardcoded keyword map is gone: /find searches offers first, agents second.
 */

const discoveryRouter = new Hono();

const agentTypeSchema = z.enum(['assistant', 'autonomous', 'tool', 'service']);
const protocolSchema = z.enum(['a2a', 'mcp', 'http', 'websocket', 'grpc']);
const statusSchema = z.enum(['online', 'offline', 'maintenance', 'unknown']);

const discoverSchema = z.object({
  capabilities: z.array(z.string().min(1).max(64)).max(32).optional(),
  tags: z.array(z.string().min(1).max(64)).max(32).optional(),
  types: z.array(agentTypeSchema).optional(),
  protocols: z.array(protocolSchema).optional(),
  status: z.array(statusSchema).optional(),
  minTrust: z.number().int().min(0).max(100).optional(),
  /** legacy alias of minTrust */
  minTrustScore: z.number().int().min(0).max(100).optional(),
  query: z.string().max(200).optional(),
  limit: z.number().int().min(1).max(100).default(20),
  offset: z.number().int().min(0).max(100_000).default(0),
});

/** `column ?| array[...]`: the jsonb string array contains any of the values (either jsonb encoding). */
function jsonbHasAny(column: SQLWrapper, values: string[]): SQL {
  const list = sql.join(values.map((v) => sql`${v}`), sql`, `);
  return sql`${jsonbArray(column)} ?| array[${list}]::text[]`;
}

const rankOrder = [desc(agents.trustRank), sql`${agents.lastSeen} desc nulls last`, desc(agents.createdAt)];

function textMatch(q: string): SQL {
  const pattern = `%${q.replace(/[%_\\]/g, (m) => `\\${m}`)}%`;
  return or(ilike(agents.name, pattern), ilike(agents.description, pattern), ilike(agents.handle, pattern))!;
}

function intQuery(value: string | undefined, fallback: number, min: number, max: number): number {
  const n = parseInt(value ?? '', 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

// POST /v1/discover
discoveryRouter.post('/', async (c) => {
  const body = discoverSchema.parse(await c.req.json());
  const conditions: SQL[] = [eq(agents.isSeed, false)];

  const tagFilter = Array.from(new Set([...(body.capabilities ?? []), ...(body.tags ?? [])].map((t) => t.trim().toLowerCase()).filter(Boolean)));
  if (tagFilter.length > 0) conditions.push(jsonbHasAny(agents.tags, tagFilter));
  if (body.protocols && body.protocols.length > 0) conditions.push(jsonbHasAny(agents.protocols, body.protocols));
  if (body.types && body.types.length > 0) conditions.push(inArray(agents.type, body.types));
  if (body.status && body.status.length > 0) conditions.push(inArray(agents.status, body.status));
  const minTrust = body.minTrust ?? body.minTrustScore;
  if (minTrust !== undefined && minTrust > 0) conditions.push(gte(agents.trustScore, minTrust));
  if (body.query && body.query.trim()) conditions.push(textMatch(body.query.trim()));

  const where = and(...conditions);
  const [rows, [{ total }]] = await Promise.all([
    db.select().from(agents).where(where).orderBy(...rankOrder).limit(body.limit).offset(body.offset),
    db.select({ total: count() }).from(agents).where(where),
  ]);

  return jsonAns(c, {
    agents: rows.map(publicAgentView),
    total: Number(total),
    hasMore: body.offset + rows.length < Number(total),
    limit: body.limit,
    offset: body.offset,
    ordering: 'trust_rank desc, last_seen desc',
  });
});

// GET /v1/discover/search?q=&limit=&offset=
discoveryRouter.get('/search', async (c) => {
  const q = (c.req.query('q') ?? '').trim();
  const limit = intQuery(c.req.query('limit'), 20, 1, 100);
  const offset = intQuery(c.req.query('offset'), 0, 0, 100_000);
  if (!q) return jsonAns(c, { agents: [], total: 0, limit, offset });

  const where = and(eq(agents.isSeed, false), textMatch(q));
  const [rows, [{ total }]] = await Promise.all([
    db.select().from(agents).where(where).orderBy(...rankOrder).limit(limit).offset(offset),
    db.select({ total: count() }).from(agents).where(where),
  ]);
  return jsonAns(c, { agents: rows.map(publicAgentView), total: Number(total), limit, offset });
});

export interface OfferSearchResult {
  id: string;
  name: string;
  slug: string;
  version: number;
  title: string;
  description: string | null;
  tags: string[];
  priceMicros: string;
  stats: OfferStats;
  owner: { id: string; handle: string | null; name: string; trust: ReturnType<typeof trustOf> };
  urls: { page: string; offer: string; mcp: string; skill: string; invoke: string };
}

/** Search active offers by title, description, slug and tags; owner rank first, then successful calls. */
export async function searchOffers(q: string, limit: number): Promise<OfferSearchResult[]> {
  const pattern = `%${q.replace(/[%_\\]/g, (m) => `\\${m}`)}%`;
  const rows = await db
    .select({ offer: offers, owner: agents })
    .from(offers)
    .innerJoin(agents, eq(offers.agentId, agents.id))
    .where(and(
      eq(offers.status, 'active'),
      eq(agents.isSeed, false),
      or(
        ilike(offers.title, pattern),
        ilike(offers.description, pattern),
        ilike(offers.slug, pattern),
        sql`${offers.tags}::text ilike ${pattern}`,
      ),
    ))
    .orderBy(desc(agents.trustRank), sql`coalesce((${offers.stats}->>'ok')::int, 0) desc`, desc(offers.createdAt))
    .limit(limit);

  return rows.map(({ offer, owner }) => {
    const handle = owner.handle ?? owner.id;
    return {
      id: offer.id,
      name: offerName(owner.handle, offer.slug, offer.version),
      slug: offer.slug,
      version: offer.version,
      title: offer.title,
      description: offer.description,
      tags: offer.tags ?? [],
      priceMicros: offer.priceMicros.toString(),
      stats: offer.stats ?? {},
      owner: { id: owner.id, handle: owner.handle, name: owner.name, trust: trustOf(owner) },
      urls: {
        page: `${config.publicWebUrl}/offers/@${handle}/${offer.slug}`,
        offer: `${config.publicApiUrl}/v1/offers/${offer.id}`,
        mcp: `${config.publicApiUrl}/mcp/offer/@${handle}/${offer.slug}`,
        skill: `${config.publicApiUrl}/v1/offers/${offer.id}/skill.md`,
        invoke: `${config.publicApiUrl}/v1/invoke`,
      },
    };
  });
}

// GET /v1/discover/find?q=&limit=  (offers first, then agents)
discoveryRouter.get('/find', async (c) => {
  const q = (c.req.query('q') ?? '').trim();
  const limit = intQuery(c.req.query('limit'), 20, 1, 100);
  if (!q) return jsonAns(c, { query: q, offers: [], agents: [], hint: 'Pass ?q=<what you need done>' });

  const [offerResults, agentRows] = await Promise.all([
    searchOffers(q, limit),
    db.select().from(agents).where(and(eq(agents.isSeed, false), textMatch(q))).orderBy(...rankOrder).limit(limit),
  ]);

  if (offerResults.length === 0 && agentRows.length === 0) {
    void recordFunnel('find.empty', { src: 'api', ip: clientIp(c), detail: q });
  }

  return jsonAns(c, {
    query: q,
    offers: offerResults,
    agents: agentRows.map(publicAgentView),
    next: offerResults.length > 0
      ? 'POST /v1/invoke {offer: <name>, input} calls an offer and opens a receipt automatically'
      : 'No offer matched. Publish one: POST /v1/offers, or ask an agent directly and open a receipt: POST /v1/receipts',
  });
});

export { discoveryRouter };
