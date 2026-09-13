import { Hono } from 'hono';
import { z } from 'zod';
import { and, count, desc, eq, isNull, ne, or, sql, type SQL, type SQLWrapper } from 'drizzle-orm';
import {
  ANS_BLOCK,
  ANS_LINKS,
  HANDLE_REGEX,
  RESERVED_HANDLES,
  AgentPolicySchema,
  fromBase64,
  generateApiKey,
  generateId,
  sha256hex,
  verifyRegistration,
  type AgentPolicy,
  type ReceiptCounts,
} from 'ans-core';
import { db } from '../db';
import { ipHash } from '../lib/funnel';
import { activeOffersOf, toWireOfferSummary } from '../lib/offers';
import { agents, apiKeys, attestations, funnelEvents, offers, receipts, systemFlags, API_KEY_SCOPES, DEFAULT_AGENT_POLICY, type ApiKeyScope, type OfferStats } from '../db/schema';
import { config } from '../config';
import { requireAgent, requireOwner, resolveAgent, type AgentRow } from '../lib/auth';
import { jsonAns, teach } from '../lib/errors';
import { clientIp, registerIpLimit } from '../lib/ratelimit';
import { validatePaymentMethods, sanitizeString } from '../utils/validation';

/**
 * Identity routes (docs/DESIGN.md section 4 "Identity and auth", 14.6, 14.7,
 * 14.14). One auth scheme: signed, session or api key via lib/auth. There is
 * no private-key header and no placeholder-key bypass anywhere in this file.
 */

const agentsRouter = new Hono();

// ---------------------------------------------------------------------------
// Public views shared with discovery, reputation, analytics and a2a
// ---------------------------------------------------------------------------

export interface TrustView {
  score: number;
  confidence: number;
  rank: number;
  computedAt: string | null;
}

export function trustOf(a: Pick<AgentRow, 'trustScore' | 'trustConfidence' | 'trustRank' | 'trustComputedAt'>): TrustView {
  return {
    score: a.trustScore,
    confidence: a.trustConfidence,
    rank: a.trustRank,
    computedAt: a.trustComputedAt ? a.trustComputedAt.toISOString() : null,
  };
}

export function receiptCountsOf(a: Pick<AgentRow, 'receiptCounts'>): ReceiptCounts {
  return { confirmed: 0, unconfirmed: 0, unreviewed: 0, negative: 0, noReview: 0, ...(a.receiptCounts ?? {}) };
}

export function policyOf(a: Pick<AgentRow, 'policy'>): AgentPolicy {
  const p = { ...DEFAULT_AGENT_POLICY, ...(a.policy ?? {}) };
  return { requireRegistered: !!p.requireRegistered, minTrust: Number(p.minTrust) || 0 };
}

/** The agent as every public surface shows it. Never includes private data (there is none on the row). */
export function publicAgentView(a: AgentRow) {
  return {
    id: a.id,
    handle: a.handle,
    name: a.name,
    type: a.type,
    description: a.description,
    avatar: a.avatar,
    homepage: a.homepage,
    endpoint: a.endpoint,
    protocols: a.protocols ?? [],
    tags: a.tags ?? [],
    linkedProfiles: a.linkedProfiles ?? {},
    verificationTier: a.verificationTier ?? 0,
    operatorId: a.operatorId,
    operatorName: a.operatorName,
    paymentMethods: a.paymentMethods ?? [],
    status: a.status,
    lastSeen: a.lastSeen,
    publicKey: a.publicKey,
    metadata: a.metadata ?? null,
    isHouse: a.isHouse,
    referredBy: a.referredBy,
    trust: trustOf(a),
    receiptCounts: receiptCountsOf(a),
    policy: policyOf(a),
    createdAt: a.createdAt,
    updatedAt: a.updatedAt,
  };
}

export type PublicAgentView = ReturnType<typeof publicAgentView>;

/** `@handle/slug@version`, the full offer name */
export function offerName(handle: string | null, slug: string, version: number): string {
  return `@${handle ?? 'unknown'}/${slug}@${version}`;
}

export function profileUrl(a: Pick<AgentRow, 'id'>): string {
  return `${config.publicWebUrl}/agent/${a.id}`;
}

/**
 * A jsonb column as a real jsonb value in SQL. drizzle 0.29 stringifies jsonb
 * params and postgres.js 3.4 serializes them again, so rows written through
 * drizzle hold a JSON-encoded string scalar ("[\"a\"]") rather than an array;
 * drizzle reads both back correctly, but SQL operators (?|, ->>, jsonb_array_elements)
 * need the unwrapped form. Rows written by SQL (migrations) are already plain.
 */
export function jsonbValue(column: SQLWrapper): SQL {
  return sql`(case when jsonb_typeof(${column}) = 'string' and left(${column} #>> '{}', 1) in ('[', '{') then (${column} #>> '{}')::jsonb else ${column} end)`;
}

/** The jsonb column as an array (empty when null or not an array). */
export function jsonbArray(column: SQLWrapper): SQL {
  const v = jsonbValue(column);
  return sql`(case when jsonb_typeof(${v}) = 'array' then ${v} else '[]'::jsonb end)`;
}

/** `(receipt_counts ->> 'confirmed')::int` regardless of encoding, for ordering. */
export const confirmedReceiptsSql = sql`coalesce((${jsonbValue(agents.receiptCounts)} ->> 'confirmed')::int, 0)`;

// ---------------------------------------------------------------------------
// Shared schemas
// ---------------------------------------------------------------------------

const agentTypeSchema = z.enum(['assistant', 'autonomous', 'tool', 'service']);
const protocolSchema = z.enum(['a2a', 'mcp', 'http', 'websocket', 'grpc']);
const statusSchema = z.enum(['online', 'offline', 'maintenance', 'unknown']);
const paymentMethodSchema = z.object({
  type: z.enum(['bitcoin', 'lightning', 'ethereum', 'usdc', 'other']),
  address: z.string().min(1).max(200),
  label: z.string().max(64).optional(),
});
const tagsSchema = z.array(z.string().min(1).max(48)).max(32);
const linkedProfilesSchema = z.object({
  moltbook: z.string().max(100).optional(),
  github: z.string().max(100).optional(),
  twitter: z.string().max(100).optional(),
  discord: z.string().max(100).optional(),
  website: z.string().url().optional(),
});

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isEd25519PublicKey(b64: string): boolean {
  try {
    return fromBase64(b64).length === 32;
  } catch {
    return false;
  }
}

const RESERVED = new Set<string>([...RESERVED_HANDLES, 'ans']);

async function registrationsPaused(): Promise<boolean> {
  const [row] = await db.select({ value: systemFlags.value }).from(systemFlags).where(eq(systemFlags.key, 'registrations_paused'));
  return row?.value === true || row?.value === 'true';
}

// ---------------------------------------------------------------------------
// POST /v1/agents: registration v2 (proof of possession, handle, api key)
// ---------------------------------------------------------------------------

const registerSchema = z.object({
  name: z.string().min(1).max(64),
  handle: z.string().min(3).max(33),
  publicKey: z.string().min(40).max(64),
  type: agentTypeSchema,
  description: z.string().max(500).optional(),
  referredBy: z.string().max(64).optional(),
  tags: tagsSchema.optional(),
  endpoint: z.string().url().max(2048).optional(),
  protocols: z.array(protocolSchema).optional(),
  homepage: z.string().url().max(2048).optional(),
  avatar: z.string().url().max(2048).optional(),
  operatorId: z.string().max(100).optional(),
  operatorName: z.string().max(100).optional(),
  paymentMethods: z.array(paymentMethodSchema).max(10).optional(),
  metadata: z.record(z.unknown()).optional(),
  /** funnel attribution: rc_x | of_x | npx | web | api (14.14) */
  src: z.string().max(64).optional(),
  /** base64 Ed25519 over buildRegistrationMessage(body without signature) */
  signature: z.string().min(1),
});

/** Metadata keys only the registry writes */
const RESERVED_METADATA = /^(capExceeded|negativeBalance.*|registeredFrom)$/;

export const REGISTRATION_KEY_SCOPES: ApiKeyScope[] = ['read', 'receipts', 'invoke', 'publish'];

agentsRouter.post('/', registerIpLimit(), async (c) => {
  if (await registrationsPaused()) {
    return teach(c, 503, 'internal', 'Registrations are paused. Try again later.', { fix: { docs: ANS_BLOCK.docs, url: config.publicWebUrl } });
  }

  const raw: unknown = await c.req.json();
  if (!isPlainObject(raw)) return teach(c, 400, 'bad_request', 'Request body must be a JSON object');

  // Proof of possession first: the signature covers the body exactly as sent.
  if (typeof raw.publicKey !== 'string' || !isEd25519PublicKey(raw.publicKey)) {
    return teach(c, 400, 'validation_error', 'publicKey must be a base64 Ed25519 public key (32 bytes)', { fix: { docs: ANS_BLOCK.docs } });
  }
  if (typeof raw.signature !== 'string' || !(await verifyRegistration(raw))) {
    return teach(c, 401, 'invalid_signature', 'The registration signature does not verify against publicKey', {
      details: { signed: "'register:' + sha256hex(canonicalize(body without signature))", publicKey: raw.publicKey },
      fix: { docs: ANS_BLOCK.docs, next: 'Sign with ans-core signRegistration(privateKey, body) and place the result in body.signature (ans-sdk and ans-mcp do this for you)' },
    });
  }

  const body = registerSchema.parse(raw);
  const handle = body.handle.trim().replace(/^@/, '').toLowerCase();
  if (!HANDLE_REGEX.test(handle)) {
    return teach(c, 400, 'validation_error', 'handle must be 3 to 32 lowercase letters, digits or hyphens', { details: { handle: body.handle } });
  }
  if (RESERVED.has(handle)) {
    return teach(c, 400, 'validation_error', `Handle @${handle} is reserved`, { details: { handle, reserved: true } });
  }
  const houseTaken = await db.select({ id: agents.id }).from(agents).where(and(eq(agents.handle, handle), eq(agents.isHouse, true))).limit(1);
  if (houseTaken.length > 0) {
    return teach(c, 400, 'validation_error', `Handle @${handle} is reserved for a house agent`, { details: { handle, reserved: true } });
  }
  const taken = await db.select({ id: agents.id }).from(agents).where(eq(agents.handle, handle)).limit(1);
  if (taken.length > 0) {
    return teach(c, 409, 'conflict', `Handle @${handle} is already registered`, { details: { handle }, fix: { docs: ANS_BLOCK.docs, next: 'Pick another handle and sign the body again' } });
  }

  let referredBy: string | null = null;
  if (body.referredBy) {
    const referrer = await resolveAgent(body.referredBy);
    if (!referrer) return teach(c, 400, 'validation_error', `referredBy agent ${body.referredBy} does not exist`, { details: { referredBy: body.referredBy } });
    referredBy = referrer.id;
  }
  if (body.paymentMethods) {
    const v = validatePaymentMethods(body.paymentMethods);
    if (!v.valid) return teach(c, 400, 'validation_error', v.error ?? 'Invalid payment methods');
  }

  const id = generateId('ag_', 16);
  const now = new Date();
  const src = body.src ? sanitizeString(body.src, 64) ?? null : (c.req.query('src') ? sanitizeString(c.req.query('src'), 64) ?? null : null);
  const metadata: Record<string, unknown> = Object.fromEntries(Object.entries(body.metadata ?? {}).filter(([k]) => !RESERVED_METADATA.test(k)));
  if (src) metadata.registeredFrom = src;
  const minted = generateApiKey();

  const agent = await db.transaction(async (tx) => {
    const [row] = await tx.insert(agents).values({
      id,
      name: sanitizeString(body.name, 64) ?? body.name,
      handle,
      publicKey: body.publicKey,
      type: body.type,
      description: sanitizeString(body.description, 500),
      endpoint: body.endpoint,
      protocols: body.protocols ?? [],
      tags: body.tags ?? [],
      avatar: body.avatar,
      homepage: body.homepage,
      operatorId: body.operatorId,
      operatorName: sanitizeString(body.operatorName, 100),
      paymentMethods: body.paymentMethods ?? [],
      metadata,
      referredBy,
      status: 'unknown',
      policy: DEFAULT_AGENT_POLICY,
      receiptCounts: { confirmed: 0, unconfirmed: 0, unreviewed: 0, negative: 0, noReview: 0 },
      createdAt: now,
      updatedAt: now,
    }).returning();

    await tx.insert(apiKeys).values({
      id: minted.prefix,
      keyHash: minted.hash,
      agentId: id,
      label: 'default',
      scopes: REGISTRATION_KEY_SCOPES,
      spendCapMicrosPerDay: 0n,
      createdAt: now,
    });

    await tx.insert(funnelEvents).values({
      id: generateId('fe_', 16),
      event: 'register.completed',
      agentId: id,
      src,
      receiptId: src && src.startsWith('rc_') ? src : null,
      offerId: src && src.startsWith('of_') ? src : null,
      ipHash: ipHash(clientIp(c), now),
      createdAt: now,
    });

    return row;
  });

  return jsonAns(c, {
    agent: publicAgentView(agent),
    apiKey: {
      id: minted.prefix,
      key: minted.key,
      prefix: minted.prefix,
      scopes: REGISTRATION_KEY_SCOPES,
      spendCapMicrosPerDay: '0',
      note: 'Shown once. Store it with your credentials; the registry keeps only its hash.',
    },
    trust: trustOf(agent),
    next: {
      mcpConfig: { mcpServers: { ans: { command: 'npx', args: ['-y', 'ans-mcp'] } } },
      remoteMcp: { url: `${config.publicApiUrl}/mcp`, headers: { Authorization: `Bearer ${minted.key}` } },
      skillUrl: ANS_LINKS.skill,
      profileUrl: profileUrl(agent),
    },
  }, 201);
});

// ---------------------------------------------------------------------------
// GET /v1/agents: list (sort=rank|new)
// ---------------------------------------------------------------------------

function intQuery(value: string | undefined, fallback: number, min: number, max: number): number {
  const n = parseInt(value ?? '', 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

const lastSeenDescNullsLast = sql`${agents.lastSeen} desc nulls last`;

agentsRouter.get('/', async (c) => {
  const limit = intQuery(c.req.query('limit'), 20, 1, 100);
  const offset = intQuery(c.req.query('offset'), 0, 0, 1_000_000);
  const sort = c.req.query('sort') === 'new' ? 'new' : 'rank';

  const where = sort === 'rank'
    ? and(eq(agents.isSeed, false), eq(agents.isHouse, false))
    : eq(agents.isSeed, false);
  const order = sort === 'rank'
    ? [desc(agents.trustRank), lastSeenDescNullsLast, desc(agents.createdAt)]
    : [desc(agents.createdAt)];

  const [rows, [{ total }]] = await Promise.all([
    db.select().from(agents).where(where).orderBy(...order).limit(limit).offset(offset),
    db.select({ total: count() }).from(agents).where(where),
  ]);

  return jsonAns(c, { agents: rows.map(publicAgentView), total: Number(total), limit, offset, sort });
});

// ---------------------------------------------------------------------------
// GET /v1/agents/:idOrHandle
// ---------------------------------------------------------------------------

export interface OfferSummary {
  id: string;
  name: string;
  slug: string;
  version: number;
  title: string;
  description: string | null;
  tags: string[];
  priceMicros: string;
  status: string;
  stats: OfferStats;
  probeOk: boolean | null;
  urls: { page: string; mcp: string; skill: string; inputSchema: string; outputSchema: string };
}

/** Active offers of an agent, highest version per slug. */
export async function activeOfferSummaries(agent: Pick<AgentRow, 'id' | 'handle'>): Promise<OfferSummary[]> {
  const rows = await db
    .select()
    .from(offers)
    .where(and(eq(offers.agentId, agent.id), eq(offers.status, 'active')))
    .orderBy(desc(offers.version), desc(offers.createdAt));
  const bySlug = new Map<string, typeof rows[number]>();
  for (const r of rows) if (!bySlug.has(r.slug)) bySlug.set(r.slug, r);
  const handle = agent.handle ?? agent.id;
  return Array.from(bySlug.values()).map((o) => ({
    id: o.id,
    name: offerName(agent.handle, o.slug, o.version),
    slug: o.slug,
    version: o.version,
    title: o.title,
    description: o.description,
    tags: o.tags ?? [],
    priceMicros: o.priceMicros.toString(),
    status: o.status,
    stats: o.stats ?? {},
    probeOk: o.probeOk,
    urls: {
      page: `${config.publicWebUrl}/offers/@${handle}/${o.slug}`,
      mcp: `${config.publicApiUrl}/mcp/offer/@${handle}/${o.slug}`,
      skill: `${config.publicApiUrl}/v1/offers/${o.id}/skill.md`,
      inputSchema: `${config.publicApiUrl}/v1/offers/${o.id}/input.json`,
      outputSchema: `${config.publicApiUrl}/v1/offers/${o.id}/output.json`,
    },
  }));
}

export async function vouchCount(agentId: string): Promise<number> {
  const [row] = await db.select({ n: count() }).from(attestations).where(eq(attestations.subjectId, agentId));
  return Number(row?.n ?? 0);
}

agentsRouter.get('/:id', async (c) => {
  const agent = await resolveAgent(c.req.param('id'));
  if (!agent) return teach(c, 404, 'not_found', `Agent ${c.req.param('id')} not found`);
  const [offerRows, vouches] = await Promise.all([activeOffersOf(agent.id), vouchCount(agent.id)]);
  const offerList = offerRows.map((o) => toWireOfferSummary(o, agent));
  return jsonAns(c, {
    agent: publicAgentView(agent),
    trust: trustOf(agent),
    receiptCounts: receiptCountsOf(agent),
    offers: offerList,
    vouches,
    policy: policyOf(agent),
    urls: {
      profile: profileUrl(agent),
      receipts: `${config.publicApiUrl}/v1/agents/${agent.id}/receipts`,
      trust: `${config.publicApiUrl}/v1/agents/${agent.id}/trust`,
      verify: `${config.publicApiUrl}/v1/verify/${agent.handle ?? agent.id}`,
      card: `${config.publicApiUrl}/v1/agents/${agent.id}/card`,
    },
  });
});

// ---------------------------------------------------------------------------
// PATCH /v1/agents/:id (owner): profile, policy, status
// ---------------------------------------------------------------------------

const updateSchema = z.object({
  name: z.string().min(1).max(64).optional(),
  endpoint: z.string().url().max(2048).nullable().optional(),
  protocols: z.array(protocolSchema).optional(),
  description: z.string().max(500).nullable().optional(),
  avatar: z.string().url().max(2048).nullable().optional(),
  homepage: z.string().url().max(2048).nullable().optional(),
  tags: tagsSchema.optional(),
  operatorName: z.string().max(100).nullable().optional(),
  linkedProfiles: linkedProfilesSchema.optional(),
  paymentMethods: z.array(paymentMethodSchema).max(10).optional(),
  status: statusSchema.optional(),
  metadata: z.record(z.unknown()).optional(),
  policy: AgentPolicySchema.partial().optional(),
});

const ownerAuth = requireAgent({ allow: ['signed', 'session'] });

agentsRouter.patch('/:id', ownerAuth, requireOwner('id'), async (c) => {
  const current = c.get('resolvedAgent');
  const body = updateSchema.parse(await c.req.json());

  if (body.paymentMethods) {
    const v = validatePaymentMethods(body.paymentMethods);
    if (!v.valid) return teach(c, 400, 'validation_error', v.error ?? 'Invalid payment methods');
  }

  const set: Partial<typeof agents.$inferInsert> = { updatedAt: new Date() };
  if (body.name !== undefined) set.name = sanitizeString(body.name, 64) ?? current.name;
  if (body.endpoint !== undefined) set.endpoint = body.endpoint;
  if (body.protocols !== undefined) set.protocols = body.protocols;
  if (body.description !== undefined) set.description = body.description === null ? null : sanitizeString(body.description, 500) ?? null;
  if (body.avatar !== undefined) set.avatar = body.avatar;
  if (body.homepage !== undefined) set.homepage = body.homepage;
  if (body.tags !== undefined) set.tags = body.tags;
  if (body.operatorName !== undefined) set.operatorName = body.operatorName === null ? null : sanitizeString(body.operatorName, 100) ?? null;
  if (body.linkedProfiles !== undefined) set.linkedProfiles = { ...(current.linkedProfiles ?? {}), ...body.linkedProfiles };
  if (body.paymentMethods !== undefined) set.paymentMethods = body.paymentMethods;
  if (body.status !== undefined) set.status = body.status;
  if (body.metadata !== undefined) {
    // Registry-owned keys (payment shortfall markers, funnel source) cannot be written by the owner
    const owned = Object.fromEntries(Object.entries(body.metadata).filter(([k]) => !RESERVED_METADATA.test(k)));
    set.metadata = { ...((current.metadata as Record<string, unknown> | null) ?? {}), ...owned };
  }
  if (body.policy !== undefined) set.policy = AgentPolicySchema.parse({ ...policyOf(current), ...body.policy });

  const [updated] = await db.update(agents).set(set).where(eq(agents.id, current.id)).returning();
  return jsonAns(c, { agent: publicAgentView(updated), policy: policyOf(updated) });
});

// ---------------------------------------------------------------------------
// POST /v1/agents/:id/heartbeat (owner)
// ---------------------------------------------------------------------------

/** Receipts proposed to this agent that it has not yet accepted or declined. */
export async function pendingReceiptCount(agentId: string): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(receipts)
    .where(and(
      eq(receipts.state, 'proposed'),
      ne(receipts.initiatorId, agentId),
      or(eq(receipts.clientId, agentId), eq(receipts.providerId, agentId)),
    ));
  return Number(row?.n ?? 0);
}

agentsRouter.post('/:id/heartbeat', requireAgent({ allow: ['signed', 'session', 'apikey'], scopes: ['read'] }), requireOwner('id'), async (c) => {
  const agent = c.get('resolvedAgent');
  const now = new Date();
  const [updated] = await db.update(agents).set({ status: 'online', lastSeen: now, updatedAt: now }).where(eq(agents.id, agent.id)).returning({ lastSeen: agents.lastSeen });
  const pendingReceipts = await pendingReceiptCount(agent.id);
  return jsonAns(c, {
    status: 'ok',
    lastSeen: updated?.lastSeen ?? now,
    pendingReceipts,
    inbox: `${config.publicApiUrl}/v1/notifications`,
  });
});

// ---------------------------------------------------------------------------
// POST /v1/agents/:id/status (owner)
// ---------------------------------------------------------------------------

agentsRouter.post('/:id/status', ownerAuth, requireOwner('id'), async (c) => {
  const agent = c.get('resolvedAgent');
  const { status } = z.object({ status: statusSchema }).parse(await c.req.json());
  const now = new Date();
  const [updated] = await db.update(agents).set({ status, lastSeen: now, updatedAt: now }).where(eq(agents.id, agent.id)).returning({ status: agents.status, lastSeen: agents.lastSeen });
  return jsonAns(c, { status: updated.status, lastSeen: updated.lastSeen });
});

// ---------------------------------------------------------------------------
// POST /v1/agents/:id/transfer (keyonly): rotate the agent's key
// ---------------------------------------------------------------------------

const transferSchema = z.object({ newPublicKey: z.string().min(40).max(64) });

agentsRouter.post('/:id/transfer', requireAgent({ allow: ['signed'], keyOnly: true }), requireOwner('id'), async (c) => {
  const agent = c.get('resolvedAgent');
  const { newPublicKey } = transferSchema.parse(await c.req.json());
  if (!isEd25519PublicKey(newPublicKey)) {
    return teach(c, 400, 'validation_error', 'newPublicKey must be a base64 Ed25519 public key (32 bytes)');
  }
  if (newPublicKey === agent.publicKey) {
    return teach(c, 400, 'bad_request', 'newPublicKey is the current key');
  }
  const [updated] = await db.update(agents).set({ publicKey: newPublicKey, updatedAt: new Date() }).where(eq(agents.id, agent.id)).returning();
  return jsonAns(c, {
    agent: publicAgentView(updated),
    message: 'Key rotated. Sign every request from now on with the new private key; the old key no longer verifies. API keys are unchanged.',
  });
});

// ---------------------------------------------------------------------------
// API keys (14.6): POST keyonly, GET and DELETE owner
// ---------------------------------------------------------------------------

const microsSchema = z.union([z.string().regex(/^\d{1,20}$/), z.number().int().nonnegative()]).transform((v) => BigInt(v));

const createKeySchema = z.object({
  scopes: z.array(z.enum(API_KEY_SCOPES as [ApiKeyScope, ...ApiKeyScope[]])).min(1).max(4).optional(),
  spendCapMicrosPerDay: microsSchema.optional(),
  label: z.string().max(64).optional(),
});

const MAX_ACTIVE_KEYS = 20;

function keyView(k: typeof apiKeys.$inferSelect) {
  return {
    id: k.id,
    prefix: k.id,
    label: k.label,
    scopes: k.scopes ?? [],
    spendCapMicrosPerDay: k.spendCapMicrosPerDay.toString(),
    lastUsedAt: k.lastUsedAt,
    createdAt: k.createdAt,
    revokedAt: k.revokedAt,
  };
}

agentsRouter.post('/:id/keys', requireAgent({ allow: ['signed'], keyOnly: true }), requireOwner('id'), async (c) => {
  const agent = c.get('resolvedAgent');
  const body = createKeySchema.parse(await c.req.json());
  const [{ active }] = await db.select({ active: count() }).from(apiKeys).where(and(eq(apiKeys.agentId, agent.id), isNull(apiKeys.revokedAt)));
  if (Number(active) >= MAX_ACTIVE_KEYS) {
    return teach(c, 400, 'bad_request', `At most ${MAX_ACTIVE_KEYS} active API keys per agent; revoke one first`);
  }
  const minted = generateApiKey();
  const scopes = Array.from(new Set(body.scopes ?? REGISTRATION_KEY_SCOPES)) as ApiKeyScope[];
  const [row] = await db.insert(apiKeys).values({
    id: minted.prefix,
    keyHash: minted.hash,
    agentId: agent.id,
    label: body.label ? sanitizeString(body.label, 64) ?? null : null,
    scopes,
    spendCapMicrosPerDay: body.spendCapMicrosPerDay ?? 0n,
  }).returning();
  return jsonAns(c, {
    ...keyView(row),
    key: minted.key,
    note: 'Shown once. The registry stores only the hash.',
    remoteMcp: { url: `${config.publicApiUrl}/mcp`, headers: { Authorization: `Bearer ${minted.key}` } },
  }, 201);
});

agentsRouter.get('/:id/keys', ownerAuth, requireOwner('id'), async (c) => {
  const agent = c.get('resolvedAgent');
  const rows = await db.select().from(apiKeys).where(eq(apiKeys.agentId, agent.id)).orderBy(desc(apiKeys.createdAt));
  return jsonAns(c, { keys: rows.map(keyView) });
});

agentsRouter.delete('/:id/keys/:keyId', requireAgent({ allow: ['signed', 'session', 'apikey'] }), requireOwner('id'), async (c) => {
  const agent = c.get('resolvedAgent');
  const keyId = c.req.param('keyId');
  const auth = c.get('agent');
  // An API key may revoke itself (a leaked key can always be killed by whoever holds it), never another key
  if (auth.method === 'apikey' && auth.keyId !== keyId) {
    return teach(c, 403, 'forbidden', 'An API key can only revoke itself; revoke other keys with a signed request or a browser session');
  }
  const [row] = await db
    .update(apiKeys)
    .set({ revokedAt: new Date() })
    .where(and(eq(apiKeys.agentId, agent.id), eq(apiKeys.id, keyId), isNull(apiKeys.revokedAt)))
    .returning();
  if (!row) return teach(c, 404, 'not_found', `No active key ${keyId} on this agent`);
  return jsonAns(c, { revoked: true, key: keyView(row) });
});

export { agentsRouter };
