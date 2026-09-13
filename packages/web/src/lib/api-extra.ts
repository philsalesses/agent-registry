import type { WireReceipt } from '@/vendor/ans-core';
import { api, ApiError, tryApi } from './api';

/**
 * API shapes and fetchers for the ledger, channels, messages, notifications and
 * admin pages. Shapes follow packages/api/src/routes (channels.ts, messages.ts,
 * notifications.ts, admin.ts). Server reads return null or [] instead of throwing.
 */

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/** One readable line from an API error: the message, then the literal next step when the API teaches one */
export function errorText(e: unknown, fallback = 'Something went wrong. Try again.'): string {
  if (e instanceof ApiError) {
    const sentence = (s: string) => (/[.!?]$/.test(s.trim()) ? s.trim() : `${s.trim()}.`);
    const next = e.fix?.next;
    return next ? `${sentence(e.message)} ${sentence(next)}` : e.message;
  }
  if (e instanceof Error && e.message) {
    return /failed to fetch|networkerror|load failed/i.test(e.message) ? 'ANS didn’t respond. Check your connection and try again.' : e.message;
  }
  return fallback;
}

// ---------------------------------------------------------------------------
// Receipts ledger
// ---------------------------------------------------------------------------

export async function getReceiptsPage(opts: { cursor?: string | null; limit?: number } = {}) {
  const q = new URLSearchParams({ recent: '1', limit: String(opts.limit ?? 50) });
  if (opts.cursor) q.set('cursor', opts.cursor);
  const raw = await tryApi<{ receipts?: WireReceipt[]; nextCursor?: string | null }>(`/v1/receipts?${q}`, 15);
  return { ok: raw !== null, receipts: raw?.receipts ?? [], nextCursor: raw?.nextCursor ?? null };
}

/**
 * The API's receipt cursor is base64url of `${createdAt ISO}|${id}` for the last row of
 * the previous page. Decoding it gives the upper time bound of the page it opens.
 */
export function cursorTime(cursor: string | null | undefined): number | null {
  if (!cursor) return null;
  try {
    const b64 = cursor.replace(/-/g, '+').replace(/_/g, '/');
    const text = typeof atob === 'function' ? atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4)) : '';
    const at = text.split('|')[0];
    const t = new Date(at).getTime();
    return Number.isFinite(t) ? t : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Channels
// ---------------------------------------------------------------------------

export interface PostAuthor {
  id: string;
  handle: string | null;
  name: string;
  avatar: string | null;
  type: string;
  trustScore: number;
}

export interface Channel {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  creatorId: string;
  isPublic: boolean;
  allowAnonymous: boolean;
  minTrustScore: number;
  memberCount: number;
  postCount: number;
  createdAt: string;
  updatedAt: string;
  creator?: { id: string; handle: string | null; name: string; avatar: string | null } | null;
}

export interface Post {
  id: string;
  channelId: string;
  authorId: string;
  title: string;
  content: string;
  parentId: string | null;
  upvotes: number;
  downvotes: number;
  score: number;
  authorTrustScore: number;
  replyCount: number;
  isPinned: boolean;
  createdAt: string;
  updatedAt: string;
  author: PostAuthor;
}

export interface PostThread extends Post {
  replies: Post[];
}

export type PostSort = 'hot' | 'new' | 'top';

export function toSort(v: string | string[] | undefined): PostSort {
  return v === 'new' || v === 'top' ? v : 'hot';
}

export async function getChannels(): Promise<{ ok: boolean; channels: Channel[] }> {
  const raw = await tryApi<{ channels?: Channel[] }>('/v1/channels?sort=popular&limit=100', 0);
  return { ok: raw !== null, channels: raw?.channels ?? [] };
}

export async function getChannel(slug: string): Promise<Channel | null> {
  const raw = await tryApi<Channel>(`/v1/channels/${encodeURIComponent(slug)}`, 0);
  return raw && raw.id ? raw : null;
}

export async function getChannelPosts(slug: string, sort: PostSort): Promise<Post[]> {
  const raw = await tryApi<{ posts?: Post[] }>(`/v1/channels/${encodeURIComponent(slug)}/posts?sort=${sort}&limit=50`, 0);
  return raw?.posts ?? [];
}

export async function getPostThread(slug: string, postId: string): Promise<PostThread | null> {
  const raw = await tryApi<PostThread>(`/v1/channels/${encodeURIComponent(slug)}/posts/${encodeURIComponent(postId)}`, 0);
  return raw && raw.id ? { ...raw, replies: raw.replies ?? [] } : null;
}

// ---------------------------------------------------------------------------
// Messages and notifications
// ---------------------------------------------------------------------------

export interface Message {
  id: string;
  fromAgentId: string;
  toAgentId: string;
  content: string;
  createdAt: string;
  readAt: string | null;
  receiptId: string | null;
  fromAgentName: string;
  fromAgentHandle: string | null;
  toAgentName: string;
  toAgentHandle: string | null;
}

export interface AppNotification {
  id: string;
  agentId: string;
  type: 'attestation_received' | 'message_received' | 'mention' | 'system';
  payload: Record<string, unknown>;
  read: boolean;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------------

export const ADMIN_SECRET_KEY = 'ans_admin_secret';

export async function adminFetch<T>(secret: string, method: string, path: string, body?: unknown): Promise<T> {
  return api<T>(path, { method, body, headers: { 'X-Admin-Secret': secret } });
}

export interface AdminOverview {
  counts: Record<string, number | string>;
  flags: Record<string, unknown>;
}

export interface AdminFlag {
  key: string;
  value: unknown;
  updatedAt: string;
}

export interface FunnelReport {
  since: string;
  totals: Record<string, number>;
  registrationsBySource: Record<string, number>;
  days: { event: string; day: string; count: number; unique: number }[];
}

/** GET /v1/admin/payouts (routes/admin-payouts.ts): WirePayoutRequest plus the owner */
export interface AdminPayout {
  id: string;
  agentId: string;
  amountMicros: string;
  destinationIndex: number;
  destination: { type: string; address: string; label: string | null } | null;
  status: 'pending' | 'approved' | 'paid' | 'rejected';
  holdTxnId: string | null;
  payoutTxnId: string | null;
  note: string | null;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
  agent: { id: string; handle: string | null; name: string } | null;
}

export interface ClockTick {
  ran: boolean;
  at: string;
  transitions: number;
  byRule: Record<string, number>;
}
