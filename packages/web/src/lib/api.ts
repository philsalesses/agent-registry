import type {
  WireAgentRef,
  WireOffer,
  WireOfferSummary,
  WireReceipt,
  WireReceiptCounts,
  WireRegistryTotals,
  WireVerify,
  WireWallet,
  TeachingFix,
} from '@/vendor/ans-core';
import { API_URL } from './config';

/** Untyped JSON from older or newer API builds, normalized by the functions below */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type RawJson = Record<string, any>;

export type { WireAgentRef, WireOffer, WireOfferSummary, WireReceipt, WireRegistryTotals, WireVerify, WireWallet };

/** An API error carrying the teaching envelope */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fix?: TeachingFix;
  readonly details?: unknown;
  readonly requestId?: string;

  constructor(status: number, body: { error?: string; message?: string; fix?: TeachingFix; details?: unknown; requestId?: string } | null) {
    super(body?.message || `Request failed (${status})`);
    this.name = 'ApiError';
    this.status = status;
    this.code = body?.error || 'unknown';
    this.fix = body?.fix;
    this.details = body?.details;
    this.requestId = body?.requestId;
  }
}

type FetchOpts = {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
  /** seconds; server components only */
  revalidate?: number | false;
  /** cache tags; server components only */
  tags?: string[];
  token?: string | null;
  signal?: AbortSignal;
};

export async function api<T>(path: string, opts: FetchOpts = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json', ...(opts.headers ?? {}) };
  let body: string | undefined;
  if (opts.body !== undefined) {
    body = typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body);
    headers['Content-Type'] = 'application/json';
  }
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  const init: RequestInit & { next?: { revalidate?: number | false; tags?: string[] } } = { method: opts.method ?? 'GET', headers, body, signal: opts.signal };
  if (opts.revalidate !== undefined || opts.tags) init.next = { revalidate: opts.revalidate, tags: opts.tags };
  const res = await fetch(`${API_URL}${path}`, init);
  const text = await res.text();
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = null;
  }
  if (!res.ok) throw new ApiError(res.status, parsed as ConstructorParameters<typeof ApiError>[1]);
  return parsed as T;
}

/** Server-side read that returns null instead of throwing (404, network down) */
export async function tryApi<T>(path: string, revalidate: number | false = 30, tags?: string[]): Promise<T | null> {
  try {
    return await api<T>(path, { revalidate, tags });
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Agents
// ---------------------------------------------------------------------------

export interface ViewAgent {
  id: string;
  handle: string | null;
  name: string;
  type: string;
  description: string | null;
  avatar: string | null;
  homepage: string | null;
  endpoint: string | null;
  protocols: string[];
  tags: string[];
  operatorName: string | null;
  status: string;
  lastSeen: string | null;
  publicKey: string;
  paymentMethods: { type: string; address: string; label?: string }[];
  linkedProfiles: Record<string, string>;
  trust: { score: number; confidence: number; rank: number; computedAt: string | null };
  receiptCounts: WireReceiptCounts;
  policy: { requireRegistered: boolean; minTrust: number };
  isHouse: boolean;
  isSeed: boolean;
  offers: WireOfferSummary[];
  vouches: number;
  createdAt: string;
}

function num(v: unknown, fallback = 0): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : fallback;
}

/** Normalize an agent from GET /v1/agents/:id (tolerates older response shapes) */
export function toViewAgent(raw: RawJson): ViewAgent {
  const trust = raw.trust ?? {};
  const counts = raw.receiptCounts ?? {};
  const policy = raw.policy ?? {};
  return {
    id: String(raw.id),
    handle: raw.handle ?? null,
    name: String(raw.name ?? raw.handle ?? raw.id),
    type: String(raw.type ?? 'assistant'),
    description: raw.description ?? null,
    avatar: raw.avatar ?? null,
    homepage: raw.homepage ?? null,
    endpoint: raw.endpoint ?? null,
    protocols: Array.isArray(raw.protocols) ? raw.protocols : [],
    tags: Array.isArray(raw.tags) ? raw.tags : [],
    operatorName: raw.operatorName ?? null,
    status: String(raw.status ?? 'unknown'),
    lastSeen: raw.lastSeen ?? null,
    publicKey: String(raw.publicKey ?? ''),
    paymentMethods: Array.isArray(raw.paymentMethods) ? raw.paymentMethods : [],
    linkedProfiles: raw.linkedProfiles && typeof raw.linkedProfiles === 'object' ? raw.linkedProfiles : {},
    trust: {
      score: num(trust.score ?? raw.trustScore, 50),
      confidence: num(trust.confidence ?? raw.trustConfidence, 0),
      rank: num(trust.rank ?? raw.trustRank, 35),
      computedAt: trust.computedAt ?? raw.trustComputedAt ?? null,
    },
    receiptCounts: {
      confirmed: num(counts.confirmed),
      unconfirmed: num(counts.unconfirmed),
      unreviewed: num(counts.unreviewed),
      negative: num(counts.negative),
      noReview: num(counts.noReview),
    },
    policy: {
      requireRegistered: !!policy.requireRegistered,
      minTrust: num(policy.minTrust),
    },
    isHouse: !!raw.isHouse,
    isSeed: !!raw.isSeed,
    offers: Array.isArray(raw.offers) ? raw.offers : [],
    vouches: num(raw.vouches ?? raw.vouchCount),
    createdAt: String(raw.createdAt ?? new Date(0).toISOString()),
  };
}

/** GET /v1/agents/:id answers {agent, trust, receiptCounts, offers, vouches, policy, urls}; older builds spread the row */
export function unwrapAgentResponse(raw: RawJson | null): ViewAgent | null {
  if (!raw) return null;
  const row = raw.agent && typeof raw.agent === 'object' ? { ...raw.agent, trust: raw.trust ?? raw.agent.trust, receiptCounts: raw.receiptCounts ?? raw.agent.receiptCounts, offers: raw.offers ?? raw.agent.offers, vouches: raw.vouches ?? raw.agent.vouches, policy: raw.policy ?? raw.agent.policy } : raw;
  if (!row.id) return null;
  return toViewAgent(row);
}

export async function getAgent(idOrHandle: string): Promise<ViewAgent | null> {
  const raw = await tryApi<RawJson>(`/v1/agents/${encodeURIComponent(idOrHandle)}`, 30);
  return unwrapAgentResponse(raw);
}

export async function listAgents(opts: { sort?: 'rank' | 'new'; limit?: number; offset?: number } = {}): Promise<ViewAgent[]> {
  const q = new URLSearchParams({ sort: opts.sort ?? 'rank', limit: String(opts.limit ?? 20), offset: String(opts.offset ?? 0) });
  const raw = await tryApi<{ agents?: RawJson[] }>(`/v1/agents?${q}`, 30);
  return (raw?.agents ?? []).map(toViewAgent);
}

// ---------------------------------------------------------------------------
// Receipts
// ---------------------------------------------------------------------------

export async function getRecentReceipts(limit = 20): Promise<WireReceipt[]> {
  const raw = await tryApi<{ receipts?: WireReceipt[] }>(`/v1/receipts?recent=1&limit=${limit}`, 15);
  return raw?.receipts ?? [];
}

/** Cache tag for one receipt's reads; server actions expire it after a party acts */
export function receiptTag(id: string): string {
  return `receipt:${id}`;
}

export async function getReceipt(id: string, claim?: string | null): Promise<WireReceipt | null> {
  const q = claim ? `?claim=${encodeURIComponent(claim)}` : '';
  const raw = await tryApi<{ receipt?: WireReceipt }>(`/v1/receipts/${encodeURIComponent(id)}${q}`, claim ? 0 : 15, [receiptTag(id)]);
  return raw?.receipt ?? null;
}

export async function getAgentReceipts(idOrHandle: string, opts: { role?: string; cursor?: string; limit?: number } = {}) {
  const q = new URLSearchParams();
  if (opts.role) q.set('role', opts.role);
  if (opts.cursor) q.set('cursor', opts.cursor);
  q.set('limit', String(opts.limit ?? 20));
  const raw = await tryApi<{ receipts?: WireReceipt[]; nextCursor?: string | null }>(`/v1/agents/${encodeURIComponent(idOrHandle)}/receipts?${q}`, 15);
  return { receipts: raw?.receipts ?? [], nextCursor: raw?.nextCursor ?? null };
}

// ---------------------------------------------------------------------------
// Offers
// ---------------------------------------------------------------------------

export async function listOffers(opts: { q?: string; tag?: string; maxPriceMicros?: string; minTrust?: number; limit?: number; cursor?: string } = {}) {
  const q = new URLSearchParams();
  if (opts.q) q.set('q', opts.q);
  if (opts.tag) q.set('tag', opts.tag);
  if (opts.maxPriceMicros) q.set('maxPriceMicros', opts.maxPriceMicros);
  if (opts.minTrust) q.set('minTrust', String(opts.minTrust));
  q.set('limit', String(opts.limit ?? 20));
  if (opts.cursor) q.set('cursor', opts.cursor);
  const raw = await tryApi<{ offers?: WireOfferSummary[]; nextCursor?: string | null }>(`/v1/offers?${q}`, 30);
  return { ok: raw !== null, offers: raw?.offers ?? [], nextCursor: raw?.nextCursor ?? null };
}

export async function getOffer(handle: string, slug: string): Promise<WireOffer | null> {
  const h = handle.startsWith('@') ? handle.slice(1) : handle;
  const raw = await tryApi<{ offer?: WireOffer }>(`/v1/offers/@${encodeURIComponent(h)}/${encodeURIComponent(slug)}`, 30);
  return raw?.offer ?? null;
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export const EMPTY_TOTALS: WireRegistryTotals = { agents: 0, receiptsSealed: 0, receiptsOpen: 0, offersActive: 0, volumeMicros: '0', feeBps: 50 };

export async function getTotals(): Promise<WireRegistryTotals> {
  const raw = await tryApi<WireRegistryTotals>('/v1/registry/totals', 60);
  return raw && typeof raw.agents === 'number' ? raw : EMPTY_TOTALS;
}

export interface LeaderboardRow {
  agent: WireAgentRef;
  confirmed: number;
  volumeMicros: string;
}

export async function getLeaderboard(limit = 50): Promise<LeaderboardRow[]> {
  const raw = await tryApi<{ agents?: RawJson[] }>(`/v1/analytics/leaderboard?limit=${limit}`, 60);
  return (raw?.agents ?? []).map((a) => {
    const v = toViewAgent(a);
    return {
      agent: { id: v.id, handle: v.handle, name: v.name, avatar: v.avatar, trust: { score: v.trust.score, confidence: v.trust.confidence, rank: v.trust.rank }, isHouse: v.isHouse },
      confirmed: v.receiptCounts.confirmed,
      volumeMicros: String(a.volumeMicros ?? '0'),
    };
  });
}

export async function verifyAgent(idOrHandle: string): Promise<WireVerify | null> {
  return tryApi<WireVerify>(`/v1/verify/${encodeURIComponent(idOrHandle)}`, 60);
}
