import { and, asc, desc, eq, gte, ilike, ne, or, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import {
  AnsError,
  buildInvokeForwardMessage,
  buildOfferPublishCanonical,
  generateId,
  verifyMessage,
  type TeachingFix,
  type WireOffer,
  type WireOfferStats,
  type WireOfferSummary,
  type WireOfferUrls,
} from 'ans-core';
import { db } from '../db';
import { agents, offers, type OfferRequires, type OfferStats } from '../db/schema';
import { config } from '../config';
import { resolveAgent, type AgentRow } from './auth';
import { agentRef } from './receipts';
import { getRegistryKeys, signRegistry } from './registry-keys';
import { isBlockedHostname, safeFetch, SafeFetchError } from './safeFetch';
import {
  containsNul,
  jsonDepth,
  schemaHash,
  topFields,
  validateAgainst,
  validateSchemaDocument,
  type JsonSchema,
  type SchemaError,
} from './schemas';

/**
 * Offers: typed capabilities agents publish (docs/DESIGN.md sections 2 Loop B,
 * 3 Offer, 4 "Offers, discovery and invocation", 7 and 14.11).
 */

export type OfferRow = typeof offers.$inferSelect;
export interface ResolvedOffer {
  offer: OfferRow;
  owner: AgentRow;
}

export type OfferExample = { input: unknown; output: unknown };

const DOCS = 'https://ans-registry.org/skill.md';
export const SLUG_REGEX = /^[a-z0-9-]{2,48}$/;
export const TAG_REGEX = /^[a-z0-9-]{2,32}$/;
export const MAX_TITLE = 80;
export const MAX_DESCRIPTION = 500;
export const MAX_NOTES = 300;
export const MAX_EXAMPLES = 3;
export const MAX_TAGS = 8;
export const MAX_FEEDS = 10;
export const MIN_TIMEOUT_MS = 1000;
export const MAX_TIMEOUT_MS = 120_000;
export const DEFAULT_TIMEOUT_MS = 30_000;
/** Deepest JSON accepted in examples, invoke input and provider output (canonical hashing recurses) */
export const MAX_VALUE_DEPTH = 64;
/** Provider responses are capped at 1 MB */
export const MAX_PROVIDER_BYTES = 1024 * 1024;

/** NODE_ENV=test (or running under vitest): lets tests publish http://127.0.0.1 endpoints and swap the forwarder. */
export function isTestEnv(): boolean {
  return config.nodeEnv === 'test' || process.env.NODE_ENV === 'test' || process.env.VITEST === 'true';
}

// ---------------------------------------------------------------------------
// Names and URLs
// ---------------------------------------------------------------------------

/** The owner segment of an offer name: the handle, or the agent id for legacy agents without one. */
export function ownerSegment(owner: Pick<AgentRow, 'id' | 'handle'>): string {
  return owner.handle ?? owner.id;
}

/** `@handle/slug@version`, or `@handle/slug` when versioned is false. */
export function offerName(offer: Pick<OfferRow, 'slug' | 'version'>, owner: Pick<AgentRow, 'id' | 'handle'>, versioned: boolean = true): string {
  const base = `@${ownerSegment(owner)}/${offer.slug}`;
  return versioned ? `${base}@${offer.version}` : base;
}

export function offerUrls(offer: Pick<OfferRow, 'slug' | 'version'>, owner: Pick<AgentRow, 'id' | 'handle'>): WireOfferUrls {
  const h = ownerSegment(owner);
  const api = config.publicApiUrl;
  return {
    page: `${config.publicWebUrl}/offers/@${h}/${offer.slug}`,
    mcp: `${api}/mcp/offer/@${h}/${offer.slug}`,
    skill: `${api}/v1/offers/@${h}/${offer.slug}/skill.md`,
    inputSchema: `${api}/v1/offers/@${h}/${offer.slug}@${offer.version}/input.json`,
    outputSchema: `${api}/v1/offers/@${h}/${offer.slug}@${offer.version}/output.json`,
    badge: `${api}/v1/agents/${owner.id}/card?style=badge`,
  };
}

export interface ParsedOfferName {
  owner: string;
  slug: string;
  version: number | null;
}

const NAME_REGEX = /^@?([A-Za-z0-9_-]{3,64})\/([A-Za-z0-9-]{2,48})(?:@(\d{1,9}))?$/;

/** Parse `@handle/slug`, `@handle/slug@3` (the leading @ is optional). */
export function parseOfferName(raw: string): ParsedOfferName | null {
  const m = NAME_REGEX.exec(raw.trim());
  if (!m) return null;
  const owner = m[1].startsWith('ag_') ? m[1] : m[1].toLowerCase();
  const version = m[3] === undefined ? null : Number(m[3]);
  if (version !== null && version < 1) return null;
  return { owner, slug: m[2].toLowerCase(), version };
}

// ---------------------------------------------------------------------------
// Resolve
// ---------------------------------------------------------------------------

/** Excludes rows that have a higher active version of the same (agent, slug). */
const latestActiveOnly: SQL = sql`not exists (select 1 from offers o2 where o2.agent_id = ${offers.agentId} and o2.slug = ${offers.slug} and o2.status = 'active' and o2.version > ${offers.version})`;

/**
 * Resolve `of_...`, `@handle/slug` (highest active version, or the highest
 * version when none is active, so a paused offer reads as paused rather than
 * missing) or `@handle/slug@3` (that exact version). Callers that need an
 * active offer check `offer.status`.
 */
export async function resolveOffer(nameOrId: string): Promise<ResolvedOffer | null> {
  const raw = (nameOrId ?? '').trim();
  if (!raw || raw.length > 200) return null;
  if (raw.startsWith('of_')) {
    if (!/^of_[A-Za-z0-9]{8,64}$/.test(raw)) return null;
    const rows = await db.select({ offer: offers, owner: agents }).from(offers).innerJoin(agents, eq(offers.agentId, agents.id)).where(eq(offers.id, raw)).limit(1);
    return rows[0] ?? null;
  }
  const parsed = parseOfferName(raw);
  if (!parsed) return null;
  const owner = await resolveAgent(parsed.owner);
  if (!owner) return null;
  const conds: SQL[] = [eq(offers.agentId, owner.id), eq(offers.slug, parsed.slug)];
  if (parsed.version !== null) conds.push(eq(offers.version, parsed.version));
  const rows = await db
    .select()
    .from(offers)
    .where(and(...conds))
    .orderBy(sql`(${offers.status} = 'active') desc`, desc(offers.version))
    .limit(1);
  return rows[0] ? { offer: rows[0], owner } : null;
}

function likePattern(s: string): string {
  return `%${s.replace(/[%_\\]/g, (m) => `\\${m}`)}%`;
}

/** Up to 5 active offer names that look like what was asked for (for 404 no_offer). */
export async function closestOfferNames(raw: string, limit: number = 5): Promise<string[]> {
  const text = (raw ?? '').trim().replace(/^@/, '').slice(0, 200);
  if (!text) return [];
  const [ownerPart, rest] = text.includes('/') ? [text.split('/')[0], text.split('/').slice(1).join('/')] : [null, text];
  const slugPart = (rest ?? '').replace(/@\d*$/, '').toLowerCase();
  const tokens = Array.from(new Set([slugPart, ...slugPart.split(/[^a-z0-9]+/)])).filter((t) => t.length >= 2).slice(0, 6);
  const matches: SQL[] = tokens.flatMap((t) => [ilike(offers.slug, likePattern(t)), ilike(offers.title, likePattern(t))]);
  if (ownerPart && ownerPart.length >= 3) matches.push(ilike(agents.handle, likePattern(ownerPart.toLowerCase())));
  if (matches.length === 0) return [];
  const rows = await db
    .select({ slug: offers.slug, version: offers.version, ownerId: agents.id, handle: agents.handle })
    .from(offers)
    .innerJoin(agents, eq(offers.agentId, agents.id))
    .where(and(eq(offers.status, 'active'), eq(agents.isSeed, false), latestActiveOnly, or(...matches)))
    .orderBy(asc(agents.isHouse), desc(agents.trustRank), desc(offers.createdAt))
    .limit(limit);
  return rows.map((r) => `@${r.handle ?? r.ownerId}/${r.slug}`);
}

// ---------------------------------------------------------------------------
// Sanitizing and field validation
// ---------------------------------------------------------------------------

const CONTROL_CHARS = new RegExp('[\\x00-\\x1f\\x7f-\\x9f]', 'g');
const INVISIBLE_CHARS = new RegExp('[\\u200b-\\u200f\\u202a-\\u202e\\u2060-\\u2064\\u2066-\\u2069\\ufeff]', 'g');

/** Strip HTML tags, control and invisible formatting characters; collapse whitespace to single spaces. */
export function cleanText(input: string): string {
  return input
    .replace(/<[^>]*>/g, ' ')
    .replace(CONTROL_CHARS, ' ')
    .replace(INVISIBLE_CHARS, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function fieldError(field: string, message: string, details: Record<string, unknown> = {}, next?: string): AnsError {
  const fix: TeachingFix = { docs: DOCS };
  if (next) fix.next = next;
  return new AnsError('validation_error', `${field}: ${message}`, { details: { field, ...details }, fix });
}

function zodError(err: z.ZodError): AnsError {
  const issues = err.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
  const first = issues[0];
  return new AnsError('validation_error', first ? `${first.path || 'body'}: ${first.message}` : 'Request failed validation', {
    details: { errors: issues },
    fix: { docs: DOCS },
  });
}

function cleanBounded(field: string, value: string, max: number, required: boolean): string {
  const s = cleanText(value);
  if (required && s.length === 0) throw fieldError(field, 'is required (plain text)');
  if (s.length > max) throw fieldError(field, `must be at most ${max} characters (got ${s.length} after removing markup)`);
  return s;
}

const priceInput = z.union([z.string().regex(/^\d{1,15}$/, 'must be a decimal string of USD micros ($1 = "1000000")'), z.number().int().min(0).max(Number.MAX_SAFE_INTEGER)]);

function toPrice(value: string | number): bigint {
  return BigInt(typeof value === 'number' ? value : value.trim());
}

const requiresInput = z
  .object({
    secrets: z.array(z.string().regex(/^[A-Za-z0-9_.-]{1,64}$/, 'secret names are 1 to 64 letters, digits, _ . or -')).max(10).optional(),
    callbackUrl: z.boolean().optional(),
    notes: z.string().max(2000).optional(),
  })
  .strict();

function normalizeRequires(input: z.infer<typeof requiresInput> | null | undefined): OfferRequires | null {
  if (!input) return null;
  const out: OfferRequires = {};
  if (input.secrets && input.secrets.length > 0) out.secrets = Array.from(new Set(input.secrets));
  if (input.callbackUrl !== undefined) out.callbackUrl = input.callbackUrl;
  if (input.notes !== undefined) {
    const notes = cleanBounded('requires.notes', input.notes, MAX_NOTES, false);
    if (notes) out.notes = notes;
  }
  return Object.keys(out).length > 0 ? out : null;
}

export function normalizeTags(tags: string[] | null | undefined): string[] {
  const out: string[] = [];
  for (const [i, t] of (tags ?? []).entries()) {
    const tag = String(t).trim().toLowerCase();
    if (!TAG_REGEX.test(tag)) throw fieldError(`tags[${i}]`, `"${tag.slice(0, 40)}" must be lowercase letters, digits or hyphens, 2 to 32 characters`);
    if (!out.includes(tag)) out.push(tag);
  }
  if (out.length > MAX_TAGS) throw fieldError('tags', `at most ${MAX_TAGS} tags`);
  return out;
}

/** https URL (http://127.0.0.1 and http://localhost too under NODE_ENV=test); null only for house offers. Returned exactly as sent (it is signed). */
export function normalizeEndpoint(owner: Pick<AgentRow, 'isHouse'>, endpoint: string | null | undefined): string | null {
  if (endpoint === null || endpoint === undefined || endpoint === '') {
    if (owner.isHouse) return null;
    throw fieldError('endpoint', 'is required: the https URL the registry forwards each call to', {}, 'Add "endpoint": "https://your-host.example/ans/<slug>"');
  }
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    throw fieldError('endpoint', 'is not a valid URL');
  }
  const localTest = isTestEnv() && url.protocol === 'http:' && (url.hostname === '127.0.0.1' || url.hostname === 'localhost');
  if (!localTest) {
    if (url.protocol !== 'https:') throw fieldError('endpoint', 'must be an https URL');
    if (url.username || url.password) throw fieldError('endpoint', 'must not contain credentials');
    const blocked = isBlockedHostname(url.hostname);
    if (blocked) throw fieldError('endpoint', `must be a public host (${blocked})`);
  }
  if (url.hash) throw fieldError('endpoint', 'must not contain a #fragment');
  return endpoint;
}

/** True when the value is nested deeper than `limit` (canonical hashing and validation recurse). */
export function jsonDepthExceeded(value: unknown, limit: number = MAX_VALUE_DEPTH): boolean {
  return jsonDepth(value, limit) > limit;
}

function assertValue(field: string, value: unknown): void {
  if (jsonDepth(value, MAX_VALUE_DEPTH) > MAX_VALUE_DEPTH) throw fieldError(field, `is nested more than ${MAX_VALUE_DEPTH} levels deep`);
  if (containsNul(value)) throw fieldError(field, 'must not contain the U+0000 character');
}

/** Examples must carry both input and output, and each must validate against its schema. */
export function validateExamples(examples: unknown[], inputSchema: JsonSchema, outputSchema: JsonSchema): OfferExample[] {
  if (examples.length > MAX_EXAMPLES) throw fieldError('examples', `at most ${MAX_EXAMPLES} examples`);
  return examples.map((raw, i) => {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw) || !('input' in raw) || !('output' in raw)) {
      throw fieldError(`examples[${i}]`, 'must be an object with both "input" and "output"');
    }
    const ex = raw as OfferExample;
    for (const side of ['input', 'output'] as const) {
      const field = `examples[${i}].${side}`;
      assertValue(field, ex[side]);
      const check = validateAgainst(side === 'input' ? inputSchema : outputSchema, ex[side]);
      if (!check.ok) {
        throw new AnsError('validation_error', `${field} does not match ${side}Schema`, {
          details: { field, errors: check.errors },
          fix: { docs: DOCS, next: `Fix ${field} so it validates against ${side}Schema, or fix the schema` },
        });
      }
    }
    return { input: ex.input, output: ex.output };
  });
}

/**
 * Each declared feed must name an active offer, and examples[0].output must be
 * valid input for it. Returns normalized names (`@handle/slug`, or
 * `@handle/slug@v` when a version or an id was given).
 */
export async function normalizeFeeds(feeds: string[], examples: OfferExample[]): Promise<string[]> {
  if (feeds.length > MAX_FEEDS) throw fieldError('feeds', `at most ${MAX_FEEDS} names`);
  if (feeds.length === 0) return [];
  if (examples.length === 0) {
    throw fieldError('feeds', 'needs examples[0].output: each declared feed is checked by validating it against the target offer\'s input schema', {}, 'Add an example whose output is valid input for every offer named in feeds');
  }
  const out: string[] = [];
  for (const [i, name] of feeds.entries()) {
    const field = `feeds[${i}]`;
    const target = await resolveOffer(name);
    if (!target || target.offer.status !== 'active') {
      throw fieldError(field, `${JSON.stringify(name)} is not an active offer`, { name }, 'Use a full name such as "@handle/slug" from GET /v1/offers');
    }
    const pinned = name.trim().startsWith('of_') || parseOfferName(name)?.version != null;
    const normalized = offerName(target.offer, target.owner, pinned);
    const check = validateAgainst(target.offer.inputSchema as JsonSchema, examples[0].output);
    if (!check.ok) {
      throw new AnsError('validation_error', `${field}: examples[0].output is not valid input for ${normalized}`, {
        details: { field, target: normalized, errors: check.errors, targetInputSchema: target.offer.inputSchema },
        fix: { docs: DOCS, next: `Remove ${normalized} from feeds, or change examples[0].output so it validates against ${offerUrls(target.offer, target.owner).inputSchema}` },
      });
    }
    if (!out.includes(normalized)) out.push(normalized);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Publish
// ---------------------------------------------------------------------------

const publishInput = z
  .object({
    slug: z.string().max(200),
    title: z.string().max(1000),
    description: z.string().max(2000),
    inputSchema: z.record(z.unknown()),
    outputSchema: z.record(z.unknown()),
    examples: z.array(z.unknown()).optional(),
    tags: z.array(z.string().max(100)).max(50).optional(),
    priceMicros: priceInput.optional(),
    acceptsSandbox: z.boolean().optional(),
    endpoint: z.string().max(2048).nullable().optional(),
    timeoutMs: z.number().int().min(MIN_TIMEOUT_MS).max(MAX_TIMEOUT_MS).optional(),
    requires: requiresInput.nullable().optional(),
    feeds: z.array(z.string().max(200)).max(50).optional(),
    version: z.number().int().min(1).optional(),
    publishSig: z.string().max(200).optional(),
  })
  .strict();

export interface OfferDraft {
  slug: string;
  title: string;
  description: string;
  inputSchema: JsonSchema;
  outputSchema: JsonSchema;
  inputSchemaHash: string;
  outputSchemaHash: string;
  examples: OfferExample[];
  tags: string[];
  priceMicros: bigint;
  acceptsSandbox: boolean;
  endpoint: string | null;
  timeoutMs: number;
  requires: OfferRequires | null;
  feeds: string[];
  version?: number;
  publishSig?: string;
}

/** Validate a publish body into a draft (every 400 lives here). */
export async function buildDraft(owner: Pick<AgentRow, 'isHouse'>, body: unknown): Promise<OfferDraft> {
  const parsed = publishInput.safeParse(body);
  if (!parsed.success) throw zodError(parsed.error);
  const b = parsed.data;

  const slug = b.slug.trim();
  if (!SLUG_REGEX.test(slug)) throw fieldError('slug', 'must be 2 to 48 lowercase letters, digits or hyphens');
  const title = cleanBounded('title', b.title, MAX_TITLE, true);
  const description = cleanBounded('description', b.description, MAX_DESCRIPTION, true);

  validateSchemaDocument(b.inputSchema, 'inputSchema');
  validateSchemaDocument(b.outputSchema, 'outputSchema');
  const inputSchema = b.inputSchema as JsonSchema;
  const outputSchema = b.outputSchema as JsonSchema;

  const examples = validateExamples(b.examples ?? [], inputSchema, outputSchema);
  const tags = normalizeTags(b.tags);
  const endpoint = normalizeEndpoint(owner, b.endpoint);
  const requires = normalizeRequires(b.requires);
  const feeds = await normalizeFeeds(b.feeds ?? [], examples);

  return {
    slug,
    title,
    description,
    inputSchema,
    outputSchema,
    inputSchemaHash: schemaHash(inputSchema),
    outputSchemaHash: schemaHash(outputSchema),
    examples,
    tags,
    priceMicros: toPrice(b.priceMicros ?? '0'),
    acceptsSandbox: b.acceptsSandbox ?? true,
    endpoint,
    timeoutMs: b.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    requires,
    feeds,
    version: b.version,
    publishSig: b.publishSig,
  };
}

export function publishCanonicalFor(
  agentId: string,
  o: { slug: string; version: number; inputSchemaHash: string; outputSchemaHash: string; priceMicros: bigint; endpoint: string | null },
): string {
  return buildOfferPublishCanonical({
    agentId,
    slug: o.slug,
    version: o.version,
    inputSchemaHash: o.inputSchemaHash,
    outputSchemaHash: o.outputSchemaHash,
    priceMicros: o.priceMicros.toString(),
    endpoint: o.endpoint,
  }).canonical;
}

/** publishSig is the provider's standing acceptance of every invocation: always a real signature by the agent key. */
export async function assertPublishSig(owner: Pick<AgentRow, 'publicKey'>, sig: string | null | undefined, canonical: string): Promise<string> {
  const next = `Sign this exact string with the agent's Ed25519 key and send the base64 signature as publishSig: ${canonical}`;
  if (!sig) {
    throw new AnsError('bad_request', 'Publishing requires publishSig, the agent key\'s signature over the offer canonical. It is your standing acceptance of every invocation, so an API key or session alone cannot publish or reprice an offer.', {
      details: { field: 'publishSig', canonical },
      fix: { docs: DOCS, next, mcp: 'npx -y ans-mcp (ans_offer_publish signs for you)' },
    });
  }
  if (!(await verifyMessage(owner.publicKey, canonical, sig))) {
    throw new AnsError('invalid_signature', 'publishSig does not verify against your public key over the offer canonical', {
      details: { field: 'publishSig', canonical },
      fix: { docs: DOCS, next },
    });
  }
  return sig;
}

/**
 * POST /v1/offers. Version rules: a new slug is version 1; identical schemas
 * to the latest version are a 409 (use PATCH); changed schemas must be sent
 * as latest + 1.
 */
export async function publishOffer(owner: AgentRow, body: unknown, actor?: { id: string; method: string } | null): Promise<ResolvedOffer> {
  if (actor && actor.id !== owner.id) throw new AnsError('forbidden', 'You can only publish offers for your own agent');
  const draft = await buildDraft(owner, body);

  const [latest] = await db.select().from(offers).where(and(eq(offers.agentId, owner.id), eq(offers.slug, draft.slug))).orderBy(desc(offers.version)).limit(1);
  let version = 1;
  if (!latest) {
    if (draft.version !== undefined && draft.version !== 1) {
      throw new AnsError('conflict', `${draft.slug} is a new slug: publish it as version 1`, {
        details: { slug: draft.slug, nextVersion: 1 },
        fix: { docs: DOCS, next: 'Resend with "version": 1 (or omit version) and a publishSig over the canonical with version 1' },
      });
    }
  } else if (latest.inputSchemaHash === draft.inputSchemaHash && latest.outputSchemaHash === draft.outputSchemaHash) {
    const name = offerName(latest, owner);
    throw new AnsError('conflict', `${name} already has these exact schemas; change its metadata with PATCH instead of publishing again`, {
      details: { offerId: latest.id, name, latestVersion: latest.version, patch: `PATCH /v1/offers/${latest.id}` },
      fix: { docs: DOCS, next: `PATCH /v1/offers/${latest.id} with the fields to change (title, description, examples, tags, status, timeoutMs, requires, feeds; priceMicros or endpoint with a new publishSig)` },
    });
  } else {
    version = latest.version + 1;
    if (draft.version !== version) {
      throw new AnsError('conflict', `The schemas changed, so this is a new version: send "version": ${version}`, {
        details: { slug: draft.slug, latestVersion: latest.version, nextVersion: version },
        fix: { docs: DOCS, next: `Resend with "version": ${version} and a publishSig over the canonical with version ${version}` },
      });
    }
  }

  const canonical = publishCanonicalFor(owner.id, { ...draft, version });
  const publishSig = await assertPublishSig(owner, draft.publishSig, canonical);
  const now = new Date();
  const [row] = await db
    .insert(offers)
    .values({
      id: generateId('of_', 16),
      agentId: owner.id,
      slug: draft.slug,
      version,
      title: draft.title,
      description: draft.description,
      inputSchema: draft.inputSchema,
      outputSchema: draft.outputSchema,
      inputSchemaHash: draft.inputSchemaHash,
      outputSchemaHash: draft.outputSchemaHash,
      examples: draft.examples,
      tags: draft.tags,
      priceMicros: draft.priceMicros,
      priceUnit: 'call',
      acceptsSandbox: draft.acceptsSandbox,
      endpoint: draft.endpoint,
      transport: draft.endpoint === null ? 'ans-house' : 'ans-http',
      mode: 'sync',
      timeoutMs: draft.timeoutMs,
      status: 'active',
      stats: {},
      publishSig,
      requires: draft.requires,
      feeds: draft.feeds,
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  return { offer: row, owner };
}

// ---------------------------------------------------------------------------
// Update (PATCH)
// ---------------------------------------------------------------------------

const patchInput = z
  .object({
    title: z.string().max(1000).optional(),
    description: z.string().max(2000).optional(),
    examples: z.array(z.unknown()).optional(),
    tags: z.array(z.string().max(100)).max(50).optional(),
    acceptsSandbox: z.boolean().optional(),
    status: z.enum(['active', 'paused', 'retired']).optional(),
    timeoutMs: z.number().int().min(MIN_TIMEOUT_MS).max(MAX_TIMEOUT_MS).optional(),
    requires: requiresInput.nullable().optional(),
    feeds: z.array(z.string().max(200)).max(50).optional(),
    priceMicros: priceInput.optional(),
    endpoint: z.string().max(2048).nullable().optional(),
    publishSig: z.string().max(200).optional(),
  })
  .strict();

/** PATCH /v1/offers/:id. Schemas are immutable per version; price and endpoint changes need a new publishSig. */
export async function updateOffer(owner: AgentRow, offer: OfferRow, body: unknown): Promise<OfferRow> {
  if (offer.agentId !== owner.id) throw new AnsError('forbidden', 'Only the owner can change this offer');
  const parsed = patchInput.safeParse(body);
  if (!parsed.success) throw zodError(parsed.error);
  const p = parsed.data;
  if (Object.keys(p).length === 0) {
    throw new AnsError('validation_error', 'Send at least one field to change', {
      details: { fields: Object.keys(patchInput.shape) },
      fix: { docs: DOCS },
    });
  }

  const patch: Partial<typeof offers.$inferInsert> = {};
  if (p.title !== undefined) patch.title = cleanBounded('title', p.title, MAX_TITLE, true);
  if (p.description !== undefined) patch.description = cleanBounded('description', p.description, MAX_DESCRIPTION, true);
  let examples = (offer.examples ?? []) as OfferExample[];
  if (p.examples !== undefined) {
    examples = validateExamples(p.examples, offer.inputSchema as JsonSchema, offer.outputSchema as JsonSchema);
    patch.examples = examples;
  }
  if (p.tags !== undefined) patch.tags = normalizeTags(p.tags);
  if (p.acceptsSandbox !== undefined) patch.acceptsSandbox = p.acceptsSandbox;
  if (p.status !== undefined) patch.status = p.status;
  if (p.timeoutMs !== undefined) patch.timeoutMs = p.timeoutMs;
  if (p.requires !== undefined) patch.requires = normalizeRequires(p.requires);
  if (p.feeds !== undefined || (p.examples !== undefined && (offer.feeds ?? []).length > 0)) {
    patch.feeds = await normalizeFeeds(p.feeds ?? offer.feeds ?? [], examples);
  }

  const price = p.priceMicros !== undefined ? toPrice(p.priceMicros) : offer.priceMicros;
  const endpoint = p.endpoint !== undefined ? normalizeEndpoint(owner, p.endpoint) : offer.endpoint;
  const priceChanged = price !== offer.priceMicros;
  const endpointChanged = endpoint !== offer.endpoint;
  if (priceChanged || endpointChanged || p.publishSig !== undefined) {
    const canonical = publishCanonicalFor(owner.id, { ...offer, priceMicros: price, endpoint });
    patch.publishSig = await assertPublishSig(owner, p.publishSig, canonical);
    patch.priceMicros = price;
    patch.endpoint = endpoint;
    if (endpointChanged) {
      patch.transport = endpoint === null ? 'ans-house' : 'ans-http';
      patch.probeOk = null;
      patch.probedAt = null;
    }
  }
  patch.updatedAt = new Date();
  const [row] = await db.update(offers).set(patch).where(eq(offers.id, offer.id)).returning();
  return row;
}

// ---------------------------------------------------------------------------
// Search and listings
// ---------------------------------------------------------------------------

export interface OfferSearch {
  q?: string | null;
  tag?: string | null;
  maxPriceMicros?: bigint | null;
  minTrust?: number | null;
  limit?: number | null;
  cursor?: string | null;
}

const MAX_OFFSET = 10_000;

export function encodeOffsetCursor(offset: number): string {
  return Buffer.from(`o:${offset}`, 'utf8').toString('base64url');
}

export function decodeOffsetCursor(cursor: string | null | undefined): number {
  if (!cursor) return 0;
  const m = /^o:(\d{1,6})$/.exec(Buffer.from(cursor, 'base64url').toString('utf8'));
  if (!m || Number(m[1]) > MAX_OFFSET) {
    throw new AnsError('validation_error', 'cursor is not a value this API returned; start again without it', { details: { cursor }, fix: { docs: DOCS } });
  }
  return Number(m[1]);
}

/**
 * Active offers (highest active version per slug), ranked by owner trust_rank,
 * then successful calls, then newest. House offers come after ranked offers.
 */
export async function searchOffers(search: OfferSearch): Promise<{ results: ResolvedOffer[]; nextCursor: string | null }> {
  const limit = Math.min(Math.max(Math.trunc(search.limit ?? 20), 1), 100);
  const offset = decodeOffsetCursor(search.cursor);
  const conds: SQL[] = [eq(offers.status, 'active'), eq(agents.isSeed, false), latestActiveOnly];
  const q = search.q?.trim();
  if (q) {
    const pattern = likePattern(q.slice(0, 200));
    conds.push(or(ilike(offers.title, pattern), ilike(offers.description, pattern), ilike(offers.slug, pattern), sql`${offers.tags}::text ilike ${pattern}`, ilike(agents.handle, pattern))!);
  }
  if (search.tag) conds.push(sql`${offers.tags} @> ${JSON.stringify([search.tag])}::jsonb`);
  if (search.maxPriceMicros !== null && search.maxPriceMicros !== undefined) conds.push(sql`${offers.priceMicros} <= ${search.maxPriceMicros.toString()}::bigint`);
  if (search.minTrust !== null && search.minTrust !== undefined) conds.push(gte(agents.trustScore, search.minTrust));

  const rows = await db
    .select({ offer: offers, owner: agents })
    .from(offers)
    .innerJoin(agents, eq(offers.agentId, agents.id))
    .where(and(...conds))
    .orderBy(asc(agents.isHouse), desc(agents.trustRank), sql`coalesce((${offers.stats}->>'ok')::bigint, 0) desc`, desc(offers.createdAt), asc(offers.id))
    .limit(limit + 1)
    .offset(offset);
  const results = rows.slice(0, limit);
  const nextOffset = offset + limit;
  return { results, nextCursor: rows.length > limit && nextOffset <= MAX_OFFSET ? encodeOffsetCursor(nextOffset) : null };
}

/** An agent's active offers, highest active version per slug, newest first. */
export async function activeOffersOf(agentId: string): Promise<OfferRow[]> {
  return db
    .select()
    .from(offers)
    .where(and(eq(offers.agentId, agentId), eq(offers.status, 'active'), latestActiveOnly))
    .orderBy(desc(offers.createdAt), asc(offers.slug));
}

export type ComposeVia = 'declared' | 'schema';
export interface ComposeEdge {
  offer: ResolvedOffer;
  via: ComposeVia[];
}

function addEdge(map: Map<string, ComposeEdge>, r: ResolvedOffer, via: ComposeVia): void {
  const hit = map.get(r.offer.id);
  if (hit) {
    if (!hit.via.includes(via)) hit.via.push(via);
  } else {
    map.set(r.offer.id, { offer: r, via: [via] });
  }
}

const EDGE_LIMIT = 50;

/**
 * feeds: offers named in this offer's feeds plus active offers whose input
 * schema hash equals this output schema hash. fedBy: active offers that declare
 * this offer in their feeds plus those whose output schema hash equals this
 * input schema hash. Exact hash equality only (section 7).
 */
export async function composesWith(resolved: ResolvedOffer): Promise<{ feeds: ComposeEdge[]; fedBy: ComposeEdge[] }> {
  const { offer, owner } = resolved;
  const feeds = new Map<string, ComposeEdge>();
  const fedBy = new Map<string, ComposeEdge>();

  for (const name of offer.feeds ?? []) {
    const target = await resolveOffer(name);
    if (target && target.offer.status === 'active') addEdge(feeds, target, 'declared');
  }
  const base = [eq(offers.status, 'active'), eq(agents.isSeed, false), ne(offers.id, offer.id)];
  const byInputHash = await db
    .select({ offer: offers, owner: agents })
    .from(offers)
    .innerJoin(agents, eq(offers.agentId, agents.id))
    .where(and(...base, latestActiveOnly, eq(offers.inputSchemaHash, offer.outputSchemaHash)))
    .orderBy(asc(agents.isHouse), desc(agents.trustRank), desc(offers.createdAt))
    .limit(EDGE_LIMIT);
  for (const r of byInputHash) addEdge(feeds, r, 'schema');

  const names = [offerName(offer, owner, false), offerName(offer, owner, true)];
  const declaring = await db
    .select({ offer: offers, owner: agents })
    .from(offers)
    .innerJoin(agents, eq(offers.agentId, agents.id))
    .where(and(...base, or(...names.map((n) => sql`${offers.feeds} @> ${JSON.stringify([n])}::jsonb`))))
    .orderBy(asc(agents.isHouse), desc(agents.trustRank), desc(offers.createdAt))
    .limit(EDGE_LIMIT);
  for (const r of declaring) addEdge(fedBy, r, 'declared');
  const byOutputHash = await db
    .select({ offer: offers, owner: agents })
    .from(offers)
    .innerJoin(agents, eq(offers.agentId, agents.id))
    .where(and(...base, latestActiveOnly, eq(offers.outputSchemaHash, offer.inputSchemaHash)))
    .orderBy(asc(agents.isHouse), desc(agents.trustRank), desc(offers.createdAt))
    .limit(EDGE_LIMIT);
  for (const r of byOutputHash) addEdge(fedBy, r, 'schema');

  return { feeds: Array.from(feeds.values()), fedBy: Array.from(fedBy.values()) };
}

// ---------------------------------------------------------------------------
// Calling a provider (shared by invoke and probe)
// ---------------------------------------------------------------------------

export interface ForwardRequest {
  url: string;
  headers: Record<string, string>;
  /** the exact JSON string whose sha256 the registry signed */
  body: string;
  timeoutMs: number;
  maxBytes: number;
}

export interface ForwardResponse {
  status: number;
  text: string;
}

/** How the registry POSTs to a provider. Production uses safeFetch; tests swap it with setInvokeForwarder. */
export type InvokeForwarder = (req: ForwardRequest) => Promise<ForwardResponse>;

const safeForwarder: InvokeForwarder = async (req) => {
  const res = await safeFetch(req.url, { method: 'POST', headers: req.headers, body: req.body }, { timeoutMs: req.timeoutMs, maxBytes: req.maxBytes });
  return { status: res.status, text: res.text() };
};

let forwarder: InvokeForwarder = safeForwarder;

/** Tests only: replace the forwarder (null restores safeFetch). Throws outside NODE_ENV=test. */
export function setInvokeForwarder(fn: InvokeForwarder | null): void {
  if (!isTestEnv()) throw new Error('setInvokeForwarder is only available under NODE_ENV=test');
  forwarder = fn ?? safeForwarder;
}

export type ProviderOutcome =
  | { kind: 'ok'; output: unknown; latencyMs: number; status: number | null }
  | { kind: 'failed' | 'timeout'; reason: string; latencyMs: number; status: number | null }
  | { kind: 'output_invalid'; errors: SchemaError[]; latencyMs: number; status: number | null };

/** Validate a provider's (or a house offer's) output against the offer's output schema. */
export function classifyOutput(offer: Pick<OfferRow, 'outputSchema'>, output: unknown, latencyMs: number, status: number | null = null): ProviderOutcome {
  if (jsonDepth(output, MAX_VALUE_DEPTH) > MAX_VALUE_DEPTH) {
    return { kind: 'output_invalid', errors: [{ path: '', message: `output is nested more than ${MAX_VALUE_DEPTH} levels deep`, keyword: 'depth', params: { limit: MAX_VALUE_DEPTH } }], latencyMs, status };
  }
  const check = validateAgainst(offer.outputSchema as JsonSchema, output);
  if (!check.ok) return { kind: 'output_invalid', errors: check.errors, latencyMs, status };
  return { kind: 'ok', output, latencyMs, status };
}

export interface ProviderCall {
  offer: OfferRow;
  /** full name `@handle/slug@version` */
  name: string;
  receiptId: string;
  caller: { id: string; handle: string | null; trust: number | null };
  input: unknown;
  timeoutMs: number;
  probe?: boolean;
}

/**
 * POST the invoke envelope to the offer endpoint with the registry's signature
 * headers, then classify: network error, non-2xx and non-JSON are `failed`,
 * the timeout is `timeout`, a schema mismatch is `output_invalid`.
 * Reasons are short codes (they appear on the public receipt).
 */
export async function callProvider(call: ProviderCall): Promise<ProviderOutcome> {
  const endpoint = call.offer.endpoint;
  if (!endpoint) return { kind: 'failed', reason: 'no_endpoint', latencyMs: 0, status: null };
  const envelope: Record<string, unknown> = {
    receiptId: call.receiptId,
    offer: call.name,
    input: call.input,
    caller: call.caller,
    deadlineAt: new Date(Date.now() + call.timeoutMs).toISOString(),
  };
  if (call.probe) envelope.probe = true;
  const body = JSON.stringify(envelope);
  const timestamp = String(Date.now());
  const [signature, keys] = await Promise.all([signRegistry(buildInvokeForwardMessage({ receiptId: call.receiptId, timestamp, body })), getRegistryKeys()]);
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    'User-Agent': 'ANS-registry (+https://ans-registry.org/skill.md)',
    'X-ANS-Receipt': call.receiptId,
    'X-ANS-Caller': call.caller.id,
    'X-ANS-Timestamp': timestamp,
    'X-ANS-Signature': signature,
    'X-ANS-Registry-Key-Id': keys.kid,
  };
  if (call.probe) headers['X-ANS-Probe'] = '1';

  const started = Date.now();
  let res: ForwardResponse;
  try {
    res = await forwarder({ url: endpoint, headers, body, timeoutMs: call.timeoutMs, maxBytes: MAX_PROVIDER_BYTES });
  } catch (err) {
    const latencyMs = Date.now() - started;
    if (err instanceof SafeFetchError) return { kind: err.code === 'timeout' ? 'timeout' : 'failed', reason: err.code, latencyMs, status: null };
    return { kind: 'failed', reason: 'network', latencyMs, status: null };
  }
  const latencyMs = Date.now() - started;
  if (res.status < 200 || res.status > 299) return { kind: 'failed', reason: `http_${res.status}`, latencyMs, status: res.status };
  let output: unknown;
  try {
    output = JSON.parse(res.text);
  } catch {
    return { kind: 'failed', reason: 'non_json', latencyMs, status: res.status };
  }
  return classifyOutput(call.offer, output, latencyMs, res.status);
}

export interface ProbeResult {
  resolved: ResolvedOffer;
  ok: boolean;
  probedAt: Date;
  latencyMs: number;
  reason: string | null;
  status: number | null;
  errors: SchemaError[];
}

/** POST /v1/offers/:id/probe: send examples[0].input through the real path, validate the reply, store probe_ok and probed_at. */
export async function probeOffer(resolved: ResolvedOffer): Promise<ProbeResult> {
  const { offer, owner } = resolved;
  const example = ((offer.examples ?? []) as OfferExample[])[0];
  if (!example) {
    throw new AnsError('validation_error', 'A probe sends examples[0].input: add an example first', {
      details: { field: 'examples' },
      fix: { docs: DOCS, next: `PATCH /v1/offers/${offer.id} {"examples": [{"input": ..., "output": ...}]}` },
    });
  }
  let outcome: ProviderOutcome;
  if (owner.isHouse && offer.transport === 'ans-house') {
    const { callHouseOffer } = await import('./house');
    outcome = await callHouseOffer(offer, example.input);
  } else {
    outcome = await callProvider({
      offer,
      name: offerName(offer, owner),
      receiptId: generateId('probe_', 16),
      caller: { id: 'ans-probe', handle: null, trust: null },
      input: example.input,
      timeoutMs: offer.timeoutMs,
      probe: true,
    });
  }
  const probedAt = new Date();
  const ok = outcome.kind === 'ok';
  const [row] = await db.update(offers).set({ probeOk: ok, probedAt }).where(eq(offers.id, offer.id)).returning();
  return {
    resolved: { offer: row ?? offer, owner },
    ok,
    probedAt,
    latencyMs: outcome.latencyMs,
    reason: outcome.kind === 'failed' || outcome.kind === 'timeout' ? outcome.reason : outcome.kind === 'output_invalid' ? 'output_invalid' : null,
    status: outcome.status,
    errors: outcome.kind === 'output_invalid' ? outcome.errors : [],
  };
}

// ---------------------------------------------------------------------------
// Stats
// ---------------------------------------------------------------------------

export type CallOutcome = 'ok' | 'failed' | 'timeout' | 'input_invalid' | 'output_invalid';

type StoredStats = OfferStats & { recentMs?: number[] };

const OUTCOME_FIELD: Record<CallOutcome, 'ok' | 'failed' | 'timeout' | 'inputInvalid' | 'outputInvalid'> = {
  ok: 'ok',
  failed: 'failed',
  timeout: 'timeout',
  input_invalid: 'inputInvalid',
  output_invalid: 'outputInvalid',
};

export const LATENCY_RESERVOIR = 50;

function percentile(sorted: number[], p: number): number {
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

/**
 * Count one call against the offer's stats: calls and the outcome counter,
 * lastCalledAt, and p50/p95 over the last 50 latencies (stats.recentMs).
 * Never throws: stats must not fail an invoke that already settled.
 */
export async function recordCall(offerId: string, outcome: CallOutcome, latencyMs: number | null, now: Date = new Date()): Promise<void> {
  try {
    await db.transaction(async (tx) => {
      const [row] = await tx.select({ stats: offers.stats }).from(offers).where(eq(offers.id, offerId)).for('update');
      if (!row) return;
      const s: StoredStats = { ...((row.stats ?? {}) as StoredStats) };
      s.calls = (s.calls ?? 0) + 1;
      const field = OUTCOME_FIELD[outcome];
      s[field] = (s[field] ?? 0) + 1;
      if (latencyMs !== null && Number.isFinite(latencyMs)) {
        const recent = [...(Array.isArray(s.recentMs) ? s.recentMs : []), Math.max(0, Math.round(latencyMs))].slice(-LATENCY_RESERVOIR);
        const sorted = [...recent].sort((a, b) => a - b);
        s.recentMs = recent;
        s.p50Ms = percentile(sorted, 50);
        s.p95Ms = percentile(sorted, 95);
      }
      s.lastCalledAt = now.toISOString();
      await tx.update(offers).set({ stats: s }).where(eq(offers.id, offerId));
    });
  } catch (err) {
    console.error(`[offers] stats not recorded for ${offerId}:`, err instanceof Error ? err.message : err);
  }
}

// ---------------------------------------------------------------------------
// Wire shapes
// ---------------------------------------------------------------------------

export function toWireStats(stats: OfferStats | null | undefined): WireOfferStats {
  const s = (stats ?? {}) as StoredStats;
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  return {
    calls: n(s.calls),
    ok: n(s.ok),
    failed: n(s.failed),
    timeout: n(s.timeout),
    inputInvalid: n(s.inputInvalid),
    outputInvalid: n(s.outputInvalid),
    p50Ms: typeof s.p50Ms === 'number' ? s.p50Ms : null,
    p95Ms: typeof s.p95Ms === 'number' ? s.p95Ms : null,
    lastCalledAt: typeof s.lastCalledAt === 'string' ? s.lastCalledAt : null,
  };
}

export function toWireOfferSummary(row: OfferRow, owner: AgentRow): WireOfferSummary {
  return {
    id: row.id,
    name: offerName(row, owner),
    slug: row.slug,
    version: row.version,
    title: row.title,
    description: row.description ?? '',
    tags: row.tags ?? [],
    priceMicros: row.priceMicros.toString(),
    acceptsSandbox: row.acceptsSandbox,
    status: row.status,
    inputFields: topFields(row.inputSchema),
    outputFields: topFields(row.outputSchema),
    stats: toWireStats(row.stats),
    owner: agentRef(owner),
    urls: offerUrls(row, owner),
  };
}

function hostOf(endpoint: string | null): string | null {
  if (!endpoint) return null;
  try {
    return new URL(endpoint).hostname;
  } catch {
    return null;
  }
}

export function toWireOffer(row: OfferRow, owner: AgentRow): WireOffer {
  return {
    ...toWireOfferSummary(row, owner),
    inputSchema: row.inputSchema as Record<string, unknown>,
    outputSchema: row.outputSchema as Record<string, unknown>,
    inputSchemaHash: row.inputSchemaHash,
    outputSchemaHash: row.outputSchemaHash,
    examples: ((row.examples ?? []) as OfferExample[]).map((e) => ({ input: e.input, output: e.output })),
    endpointHost: hostOf(row.endpoint),
    timeoutMs: row.timeoutMs,
    mode: 'sync',
    requires: row.requires ?? null,
    feeds: row.feeds ?? [],
    probeOk: row.probeOk ?? null,
    probedAt: row.probedAt ? row.probedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Load an agent row by id (throws 404). */
export async function loadAgentRow(id: string): Promise<AgentRow> {
  const [row] = await db.select().from(agents).where(eq(agents.id, id));
  if (!row) throw new AnsError('not_found', `Agent ${id} not found`);
  return row;
}
