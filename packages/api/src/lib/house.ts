import { and, desc, eq, inArray, ne, sql } from 'drizzle-orm';
import { AnsError, canonicalize, generateId, sha256hex, signMessage } from 'ans-core';
import { db } from '../db';
import { agents, offers, systemFlags } from '../db/schema';
import { resolveAgent, type AgentRow } from './auth';
import { consume } from './ratelimit';
import { getRegistryKeys } from './registry-keys';
import { safeFetch, SafeFetchError } from './safeFetch';
import { validateAgainst, validateSchemaDocument, type JsonSchema } from './schemas';
import { buildDraft, classifyOutput, publishCanonicalFor, type OfferExample, type OfferRow, type ProviderOutcome } from './offers';

/**
 * House offers (docs/DESIGN.md sections 2 cold start, 9.9 and 14.15): free,
 * labeled, unranked offers under @ans that run in-process, so the very first
 * search returns something invokable. No network hop to a provider; fetch-page
 * is the only one that leaves the process, through the egress guard.
 */

export const HOUSE_HANDLE = 'ans';
export const HOUSE_NAME = 'ANS house';
export const HOUSE_DAILY_CALLS = 50;
export const FETCH_TIMEOUT_MS = 8000;
export const FETCH_MAX_BYTES = 2 * 1024 * 1024;
export const FETCH_MAX_TEXT = 20_000;
export const HASH_TEXT_MAX_BYTES = 1024 * 1024;

const DRAFT = 'https://json-schema.org/draft/2020-12/schema';

/** A house offer failed at run time (not the caller's fault): the invoke records `failed` with this reason. */
export class HouseOfferError extends Error {
  readonly reason: string;
  constructor(reason: string, message: string) {
    super(message);
    this.name = 'HouseOfferError';
    this.reason = reason;
  }
}

function inputInvalid(message: string, details: Record<string, unknown> = {}): AnsError {
  return new AnsError('input_invalid', message, { details, fix: { docs: 'https://ans-registry.org/skill.md' } });
}

// ---------------------------------------------------------------------------
// fetch-page
// ---------------------------------------------------------------------------

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', copy: '(c)', reg: '(R)', hellip: '...', mdash: '-', ndash: '-', laquo: '"', raquo: '"', lsquo: "'", rsquo: "'", ldquo: '"', rdquo: '"', bull: '*', middot: '*' };

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]{1,6}|#[0-9]{1,7}|[a-z]{2,8});/gi, (whole, body: string) => {
    if (body[0] === '#') {
      const cp = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      if (!Number.isFinite(cp) || cp <= 0 || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) return ' ';
      return String.fromCodePoint(cp);
    }
    return ENTITIES[body.toLowerCase()] ?? whole;
  });
}

const CONTROL = new RegExp('[\\x00-\\x08\\x0b\\x0c\\x0e-\\x1f\\x7f]', 'g');

function collapse(s: string): string {
  return s.replace(CONTROL, ' ').replace(/\s+/g, ' ').trim();
}

/** Cap at `max` UTF-16 units without splitting a surrogate pair. */
function capText(s: string, max: number): string {
  if (s.length <= max) return s;
  let out = s.slice(0, max);
  const last = out.charCodeAt(out.length - 1);
  if (last >= 0xd800 && last <= 0xdbff) out = out.slice(0, -1);
  return out;
}

const INVISIBLE_ELEMENTS = new Set(['script', 'style', 'noscript', 'template', 'svg', 'iframe', 'object', 'canvas', 'title']);

/**
 * Visible text of an HTML document: the <title> separately; scripts, styles and
 * other non-rendered elements removed; tags stripped; entities decoded;
 * whitespace collapsed; capped at `maxChars`. A single forward scan, so hostile
 * markup (thousands of unclosed tags) costs linear time.
 */
export function extractVisibleText(html: string, maxChars: number = FETCH_MAX_TEXT): { title: string | null; text: string } {
  const lower = html.toLowerCase();
  let title: string | null = null;
  const titleOpen = lower.indexOf('<title');
  if (titleOpen >= 0) {
    const gt = lower.indexOf('>', titleOpen);
    const close = gt >= 0 ? lower.indexOf('</title', gt) : -1;
    if (close > gt) title = capText(collapse(decodeEntities(html.slice(gt + 1, close))), 500) || null;
  }

  const parts: string[] = [];
  const n = html.length;
  let i = 0;
  while (i < n) {
    const lt = html.indexOf('<', i);
    if (lt === -1) {
      parts.push(html.slice(i));
      break;
    }
    if (lt > i) parts.push(html.slice(i, lt));
    if (lower.startsWith('<!--', lt)) {
      const end = lower.indexOf('-->', lt + 4);
      if (end === -1) break;
      i = end + 3;
      parts.push(' ');
      continue;
    }
    const gt = html.indexOf('>', lt + 1);
    if (gt === -1) break;
    const m = /^<([a-z][a-z0-9-]*)/.exec(lower.slice(lt, Math.min(gt + 1, lt + 40)));
    const name = m ? m[1] : '';
    if (name && INVISIBLE_ELEMENTS.has(name) && html[gt - 1] !== '/') {
      const close = lower.indexOf(`</${name}`, gt + 1);
      if (close === -1) break;
      const closeGt = html.indexOf('>', close);
      i = closeGt === -1 ? n : closeGt + 1;
    } else {
      i = gt + 1;
    }
    parts.push(' ');
  }
  return { title, text: capText(collapse(decodeEntities(parts.join(''))), maxChars) };
}

function decodeBody(body: Uint8Array, contentType: string): string {
  const charset = /charset\s*=\s*"?([A-Za-z0-9._:-]+)/i.exec(contentType)?.[1];
  if (charset) {
    try {
      return new TextDecoder(charset).decode(body);
    } catch {
      // unknown label: fall through to UTF-8
    }
  }
  return new TextDecoder('utf-8').decode(body);
}

/** The fetch-page output for a fetched body (exported for tests). */
export function pageFromBody(url: string, status: number, contentType: string, body: Uint8Array) {
  const ct = contentType.toLowerCase();
  let title: string | null = null;
  let text = '';
  const sniffHtml = ct === '' && /^\s*</.test(new TextDecoder('utf-8').decode(body.subarray(0, 256)));
  if (ct.includes('html') || sniffHtml) {
    ({ title, text } = extractVisibleText(decodeBody(body, contentType)));
  } else if (ct.startsWith('text/') || /json|xml|javascript|yaml|csv/.test(ct)) {
    text = capText(collapse(decodeBody(body, contentType)), FETCH_MAX_TEXT);
  }
  return { url, status, contentType, title, text, bytes: body.byteLength };
}

async function fetchPage(input: { url: string }) {
  let res;
  try {
    res = await safeFetch(
      input.url,
      { method: 'GET', headers: { Accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5', 'User-Agent': 'ANS-house-fetch-page (+https://ans-registry.org/skill.md)' } },
      { timeoutMs: FETCH_TIMEOUT_MS, maxBytes: FETCH_MAX_BYTES },
    );
  } catch (err) {
    if (err instanceof SafeFetchError) throw new HouseOfferError(err.code, err.message);
    throw new HouseOfferError('network', err instanceof Error ? err.message : String(err));
  }
  return pageFromBody(input.url, res.status, res.headers.get('content-type') ?? '', res.body);
}

// ---------------------------------------------------------------------------
// Definitions
// ---------------------------------------------------------------------------

export interface HouseOfferDef {
  slug: string;
  title: string;
  description: string;
  tags: string[];
  timeoutMs: number;
  inputSchema: JsonSchema;
  outputSchema: JsonSchema;
  examples: OfferExample[];
  /** Caller mistakes the schema cannot express: throw input_invalid before a receipt opens */
  prevalidate?: (input: any) => void;
  run: (input: any) => Promise<unknown>;
}

const HOUSE_DESCRIPTION = 'Free services run by ANS itself. Not ranked. Each agent can use them 50 times a day.';

const EXAMPLE_TEXT = 'Example Domain This domain is for use in documentation examples without needing permission. Avoid use in operations. Learn more';

export const HOUSE_OFFERS: readonly HouseOfferDef[] = [
  {
    slug: 'fetch-page',
    title: 'Fetch a web page as text',
    description: 'Fetches a public https web page and returns its title and readable text, without scripts or styles, up to 20,000 characters. Free, run by ANS.',
    tags: ['house', 'web', 'fetch', 'text'],
    timeoutMs: 15_000,
    inputSchema: {
      $schema: DRAFT,
      type: 'object',
      required: ['url'],
      properties: { url: { type: 'string', format: 'uri', pattern: '^https://', maxLength: 2048, description: 'A public https URL. Redirects are not followed.' } },
      additionalProperties: false,
    },
    outputSchema: {
      $schema: DRAFT,
      type: 'object',
      required: ['url', 'status', 'contentType', 'title', 'text', 'bytes'],
      properties: {
        url: { type: 'string', description: 'The URL that was fetched' },
        status: { type: 'integer', minimum: 100, maximum: 599, description: 'HTTP status of the response' },
        contentType: { type: 'string', description: 'The Content-Type header, empty when absent' },
        title: { type: ['string', 'null'], maxLength: 500, description: 'The HTML <title>, or null' },
        text: { type: 'string', maxLength: FETCH_MAX_TEXT, description: 'Visible text; empty for binary content' },
        bytes: { type: 'integer', minimum: 0, description: 'Size of the response body in bytes' },
      },
      additionalProperties: false,
    },
    examples: [
      {
        input: { url: 'https://example.com/' },
        output: { url: 'https://example.com/', status: 200, contentType: 'text/html', title: 'Example Domain', text: EXAMPLE_TEXT, bytes: 559 },
      },
    ],
    run: fetchPage,
  },
  {
    slug: 'validate-json',
    title: 'Validate JSON against a JSON Schema',
    description: 'Checks a JSON value against a JSON Schema (draft 2020-12, local $ref only, up to 32 KB) and lists every error and where it is. Free, run by ANS.',
    tags: ['house', 'json', 'json-schema', 'validation'],
    timeoutMs: 5000,
    inputSchema: {
      $schema: DRAFT,
      type: 'object',
      required: ['schema', 'value'],
      properties: {
        schema: { type: 'object', description: 'A draft 2020-12 JSON Schema object' },
        value: { description: 'Any JSON value to validate' },
      },
      additionalProperties: false,
    },
    outputSchema: {
      $schema: DRAFT,
      type: 'object',
      required: ['valid', 'errors'],
      properties: {
        valid: { type: 'boolean' },
        errors: {
          type: 'array',
          maxItems: 50,
          items: {
            type: 'object',
            required: ['path', 'message'],
            properties: { path: { type: 'string', description: 'JSON pointer into the value; empty for the root' }, message: { type: 'string' } },
            additionalProperties: false,
          },
        },
      },
      additionalProperties: false,
    },
    examples: [
      {
        input: { schema: { type: 'object', required: ['name'], properties: { name: { type: 'string' } } }, value: { name: 42 } },
        output: { valid: false, errors: [{ path: '/name', message: 'must be string' }] },
      },
    ],
    prevalidate: (input: { schema: unknown }) => {
      try {
        validateSchemaDocument(input.schema, 'input.schema');
      } catch (err) {
        if (err instanceof AnsError) throw inputInvalid(`input.schema is not an acceptable JSON Schema (${err.message})`, (err.details ?? {}) as Record<string, unknown>);
        throw err;
      }
    },
    run: async (input: { schema: JsonSchema; value: unknown }) => {
      const result = validateAgainst(input.schema, input.value);
      return { valid: result.ok, errors: result.errors.map((e) => ({ path: e.path, message: e.message })) };
    },
  },
  {
    slug: 'hash-text',
    title: 'SHA-256 of a text',
    description: 'Returns the SHA-256 fingerprint (lowercase hex) of a UTF-8 text up to 1 MB. Agents use it to fingerprint the work they deliver. Free, run by ANS.',
    tags: ['house', 'hash', 'sha256', 'receipts'],
    timeoutMs: 5000,
    inputSchema: {
      $schema: DRAFT,
      type: 'object',
      required: ['text'],
      properties: { text: { type: 'string', maxLength: HASH_TEXT_MAX_BYTES, description: 'UTF-8 text, at most 1 MB' } },
      additionalProperties: false,
    },
    outputSchema: {
      $schema: DRAFT,
      type: 'object',
      required: ['sha256'],
      properties: { sha256: { type: 'string', pattern: '^[0-9a-f]{64}$' } },
      additionalProperties: false,
    },
    examples: [{ input: { text: 'hello' }, output: { sha256: sha256hex('hello') } }],
    prevalidate: (input: { text: string }) => {
      const bytes = Buffer.byteLength(input.text, 'utf8');
      if (bytes > HASH_TEXT_MAX_BYTES) throw inputInvalid(`input.text is ${bytes} bytes; the limit is ${HASH_TEXT_MAX_BYTES}`, { bytes, limit: HASH_TEXT_MAX_BYTES });
    },
    run: async (input: { text: string }) => ({ sha256: sha256hex(input.text) }),
  },
  {
    slug: 'verify-agent',
    title: 'Verify an agent is registered',
    description: 'Looks up an agent by ID or handle and returns whether it is registered, its trust score, confidence and rank, and how many of its jobs went well or badly. Free, run by ANS.',
    tags: ['house', 'verify', 'trust', 'registry'],
    timeoutMs: 5000,
    inputSchema: {
      $schema: DRAFT,
      type: 'object',
      required: ['agent'],
      properties: { agent: { type: 'string', minLength: 3, maxLength: 64, description: 'An agent id (ag_...) or handle (with or without @)' } },
      additionalProperties: false,
    },
    outputSchema: {
      $schema: DRAFT,
      type: 'object',
      required: ['registered', 'id', 'handle', 'trust', 'receipts'],
      properties: {
        registered: { type: 'boolean' },
        id: { type: ['string', 'null'] },
        handle: { type: ['string', 'null'] },
        trust: {
          type: ['object', 'null'],
          required: ['score', 'confidence', 'rank'],
          properties: { score: { type: 'integer', minimum: 0, maximum: 100 }, confidence: { type: 'number', minimum: 0, maximum: 1 }, rank: { type: 'number' } },
          additionalProperties: false,
        },
        receipts: {
          type: ['object', 'null'],
          required: ['confirmed', 'negative'],
          properties: { confirmed: { type: 'integer', minimum: 0 }, negative: { type: 'integer', minimum: 0 } },
          additionalProperties: false,
        },
      },
      additionalProperties: false,
    },
    examples: [
      {
        input: { agent: '@not-registered-yet' },
        output: { registered: false, id: null, handle: null, trust: null, receipts: null },
      },
    ],
    run: async (input: { agent: string }) => {
      const agent = await resolveAgent(input.agent);
      if (!agent) return { registered: false, id: null, handle: null, trust: null, receipts: null };
      const counts = (agent.receiptCounts ?? {}) as { confirmed?: number; negative?: number };
      return {
        registered: true,
        id: agent.id,
        handle: agent.handle ?? null,
        trust: { score: agent.trustScore, confidence: Math.round(agent.trustConfidence * 1000) / 1000, rank: Math.round(agent.trustRank * 10) / 10 },
        receipts: { confirmed: counts.confirmed ?? 0, negative: counts.negative ?? 0 },
      };
    },
  },
];

export function houseOfferDef(slug: string): HouseOfferDef | null {
  return HOUSE_OFFERS.find((d) => d.slug === slug) ?? null;
}

// ---------------------------------------------------------------------------
// Running
// ---------------------------------------------------------------------------

/** Throws input_invalid for caller mistakes the schema cannot catch (call after schema validation, before opening a receipt). */
export function prevalidateHouseInput(slug: string, input: unknown): void {
  houseOfferDef(slug)?.prevalidate?.(input);
}

/** Run a house offer in-process. Throws HouseOfferError on run-time failure, AnsError for an unknown slug. */
export async function runHouseOffer(slug: string, input: unknown): Promise<unknown> {
  const def = houseOfferDef(slug);
  if (!def) throw new AnsError('no_offer', `No house offer named @${HOUSE_HANDLE}/${slug}`);
  return def.run(input);
}

/** Run a house offer and classify it like a provider response (output validated against the stored schema). */
export async function callHouseOffer(offer: OfferRow, input: unknown): Promise<ProviderOutcome> {
  const started = Date.now();
  try {
    const output = await runHouseOffer(offer.slug, input);
    return classifyOutput(offer, output, Date.now() - started);
  } catch (err) {
    const latencyMs = Date.now() - started;
    if (err instanceof HouseOfferError) return { kind: err.reason === 'timeout' ? 'timeout' : 'failed', reason: err.reason, latencyMs, status: null };
    console.error(`[house] ${offer.slug} crashed:`, err instanceof Error ? err.message : err);
    return { kind: 'failed', reason: 'house_error', latencyMs, status: null };
  }
}

function utcDay(now: Date): string {
  return now.toISOString().slice(0, 10);
}

function flagMicros(value: unknown): bigint | null {
  if (typeof value === 'number' && Number.isSafeInteger(value)) return BigInt(value);
  if (typeof value === 'string' && /^-?\d{1,18}$/.test(value.trim())) return BigInt(value.trim());
  return null;
}

/**
 * 503 house_budget_exhausted when system_flags.house_spent_today_micros has
 * reached house_daily_budget_micros (only when both flags exist), then 429 when
 * the caller has used its 50 house calls this UTC day.
 */
export async function assertHouseAllowance(callerId: string, now: Date = new Date()): Promise<void> {
  const nextMidnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  const resetsAt = new Date(nextMidnight).toISOString();
  const flags = await db.select().from(systemFlags).where(inArray(systemFlags.key, ['house_daily_budget_micros', 'house_spent_today_micros']));
  const budget = flagMicros(flags.find((f) => f.key === 'house_daily_budget_micros')?.value);
  const spent = flagMicros(flags.find((f) => f.key === 'house_spent_today_micros')?.value);
  if (budget !== null && spent !== null && spent >= budget) {
    throw new AnsError('house_budget_exhausted', 'House offers have used today\'s budget; they come back at 00:00 UTC', {
      details: { budgetMicros: budget.toString(), spentMicros: spent.toString(), resetsAt },
      fix: { docs: 'https://ans-registry.org/skill.md', next: 'Search for a non-house offer: GET /v1/offers?q=<what you need done>' },
    });
  }
  const windowSec = Math.max(1, Math.ceil((nextMidnight - now.getTime()) / 1000));
  const hit = await consume(`house:${callerId}:${utcDay(now)}`, HOUSE_DAILY_CALLS, windowSec, now);
  if (!hit.allowed) {
    throw new AnsError('rate_limited', `House offers allow ${HOUSE_DAILY_CALLS} calls per agent per UTC day`, {
      details: { retryAfter: hit.retryAfterSec, limit: HOUSE_DAILY_CALLS, resetAt: resetsAt },
      fix: { docs: 'https://ans-registry.org/skill.md', next: 'Try again after 00:00 UTC, or use a non-house offer' },
    });
  }
}

// ---------------------------------------------------------------------------
// ensureHouseAgent
// ---------------------------------------------------------------------------

type HouseFields = Pick<OfferRow, 'title' | 'description' | 'examples' | 'tags' | 'timeoutMs' | 'acceptsSandbox' | 'status' | 'publishSig' | 'transport' | 'endpoint' | 'priceMicros'>;

function projection(o: HouseFields): string {
  return canonicalize({
    title: o.title,
    description: o.description,
    examples: o.examples,
    tags: o.tags,
    timeoutMs: o.timeoutMs,
    acceptsSandbox: o.acceptsSandbox,
    status: o.status,
    publishSig: o.publishSig,
    transport: o.transport,
    endpoint: o.endpoint,
    priceMicros: o.priceMicros.toString(),
  });
}

/**
 * Create the @ans house agent once (its key is the registry key) and upsert the
 * house offers, signed with the registry private key over the publish canonical
 * with endpoint null. Idempotent and safe to call on every boot: unchanged
 * offers are left alone, changed metadata is updated in place, changed schemas
 * become the next version and older versions are retired (house code only runs
 * the current definition).
 */
export async function ensureHouseAgent(now: Date = new Date()): Promise<{ agent: AgentRow; offers: OfferRow[] }> {
  const keys = await getRegistryKeys();
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('ans-house-offers'))`);
    let [agent] = await tx.select().from(agents).where(eq(agents.handle, HOUSE_HANDLE));
    if (agent && !agent.isHouse) {
      throw new Error(`@${HOUSE_HANDLE} belongs to a non-house agent (${agent.id}); refusing to take it over`);
    }
    if (!agent) {
      [agent] = await tx
        .insert(agents)
        .values({
          id: generateId('ag_', 16),
          name: HOUSE_NAME,
          handle: HOUSE_HANDLE,
          type: 'service',
          isHouse: true,
          publicKey: keys.publicKey,
          description: HOUSE_DESCRIPTION,
          homepage: 'https://ans-registry.org',
          tags: ['house'],
          createdAt: now,
          updatedAt: now,
        })
        .returning();
    } else if (agent.publicKey !== keys.publicKey || agent.description !== HOUSE_DESCRIPTION) {
      [agent] = await tx.update(agents).set({ publicKey: keys.publicKey, description: HOUSE_DESCRIPTION, updatedAt: now }).where(eq(agents.id, agent.id)).returning();
    }

    const out: OfferRow[] = [];
    for (const def of HOUSE_OFFERS) {
      const draft = await buildDraft(agent, {
        slug: def.slug,
        title: def.title,
        description: def.description,
        inputSchema: def.inputSchema,
        outputSchema: def.outputSchema,
        examples: def.examples,
        tags: def.tags,
        priceMicros: '0',
        acceptsSandbox: true,
        endpoint: null,
        timeoutMs: def.timeoutMs,
      });
      const [latest] = await tx.select().from(offers).where(and(eq(offers.agentId, agent.id), eq(offers.slug, def.slug))).orderBy(desc(offers.version)).limit(1);
      const sameSchemas = !!latest && latest.inputSchemaHash === draft.inputSchemaHash && latest.outputSchemaHash === draft.outputSchemaHash;
      const version = !latest ? 1 : sameSchemas ? latest.version : latest.version + 1;
      const publishSig = await signMessage(keys.privateKey, publishCanonicalFor(agent.id, { ...draft, version }));
      const fields = {
        title: draft.title,
        description: draft.description,
        examples: draft.examples,
        tags: draft.tags,
        timeoutMs: draft.timeoutMs,
        acceptsSandbox: true,
        status: 'active' as const,
        publishSig,
        transport: 'ans-house',
        endpoint: null,
        priceMicros: 0n,
      };
      let row: OfferRow;
      if (latest && sameSchemas) {
        row = latest;
        if (projection(latest) !== projection(fields)) {
          [row] = await tx.update(offers).set({ ...fields, requires: null, feeds: [], updatedAt: now }).where(eq(offers.id, latest.id)).returning();
        }
      } else {
        [row] = await tx
          .insert(offers)
          .values({
            id: generateId('of_', 16),
            agentId: agent.id,
            slug: def.slug,
            version,
            inputSchema: draft.inputSchema,
            outputSchema: draft.outputSchema,
            inputSchemaHash: draft.inputSchemaHash,
            outputSchemaHash: draft.outputSchemaHash,
            priceUnit: 'call',
            mode: 'sync',
            stats: {},
            requires: null,
            feeds: [],
            createdAt: now,
            updatedAt: now,
            ...fields,
          })
          .returning();
      }
      await tx
        .update(offers)
        .set({ status: 'retired', updatedAt: now })
        .where(and(eq(offers.agentId, agent.id), eq(offers.slug, def.slug), ne(offers.id, row.id), ne(offers.status, 'retired')));
      out.push(row);
    }
    return { agent, offers: out };
  });
}
