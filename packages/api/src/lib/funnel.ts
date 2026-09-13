import { and, gte, sql } from 'drizzle-orm';
import { generateId, sha256hex } from 'ans-core';
import { db } from '../db';
import { funnelEvents } from '../db/schema';
import { config } from '../config';

/**
 * Funnel instrumentation (docs/DESIGN.md 14.14). IPs are stored only as a
 * salted daily hash so repeat visits can be counted without keeping addresses.
 */

export type FunnelEventName =
  | 'receipt.viewed'
  | 'claim.opened'
  | 'claim.confirmed'
  | 'register.completed'
  | 'find.empty'
  | 'offer.viewed';

export type FunnelSource = 'receipt' | 'offer' | 'npx' | 'web' | 'api' | 'mcp';

export interface FunnelRecord {
  receiptId?: string | null;
  offerId?: string | null;
  agentId?: string | null;
  src?: string | null;
  ip?: string | null;
  /** find.empty only: the query text */
  detail?: string | null;
}

/** Lowercased, whitespace-collapsed, 100 chars: enough to read demand, too short to carry a document */
export function normalizeQuery(q: string): string {
  return q.toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 100);
}

export function ipHash(ip: string | null | undefined, now: Date = new Date()): string | null {
  if (!ip || ip === 'unknown') return null;
  const day = now.toISOString().slice(0, 10);
  return sha256hex(`${day}|${ip}|${config.sessionSecret}`).slice(0, 32);
}

/** Record a funnel event. Never throws. */
export async function recordFunnel(event: FunnelEventName, rec: FunnelRecord = {}): Promise<void> {
  try {
    await db.insert(funnelEvents).values({
      id: generateId('fe_', 16),
      event,
      receiptId: rec.receiptId ?? null,
      offerId: rec.offerId ?? null,
      agentId: rec.agentId ?? null,
      src: rec.src ? String(rec.src).slice(0, 40) : null,
      detail: rec.detail ? normalizeQuery(rec.detail) : null,
      ipHash: ipHash(rec.ip),
      createdAt: new Date(),
    });
  } catch (err) {
    console.error(`[funnel] ${event} not recorded:`, err instanceof Error ? err.message : err);
  }
}

/** Counts by event and UTC day for the last `days` days. */
export async function funnelCounts(days: number = 30, now: Date = new Date()) {
  const since = new Date(now.getTime() - Math.max(1, Math.min(days, 365)) * 86400_000);
  const rows = await db
    .select({
      event: funnelEvents.event,
      day: sql<string>`to_char(${funnelEvents.createdAt}, 'YYYY-MM-DD')`,
      count: sql<number>`count(*)::int`,
      unique: sql<number>`count(distinct ${funnelEvents.ipHash})::int`,
    })
    .from(funnelEvents)
    .where(and(gte(funnelEvents.createdAt, since)))
    .groupBy(funnelEvents.event, sql`to_char(${funnelEvents.createdAt}, 'YYYY-MM-DD')`)
    .orderBy(sql`2 desc`, funnelEvents.event);
  const totals: Record<string, number> = {};
  for (const r of rows) totals[r.event] = (totals[r.event] ?? 0) + Number(r.count);
  const bucket = sql<string>`case when ${funnelEvents.src} like 'rc\\_%' then 'receipt' when ${funnelEvents.src} like 'of\\_%' then 'offer' else coalesce(${funnelEvents.src}, 'unknown') end`;
  const bySrc = await db
    .select({ src: bucket, count: sql<number>`count(*)::int` })
    .from(funnelEvents)
    .where(and(gte(funnelEvents.createdAt, since), sql`${funnelEvents.event} = 'register.completed'`))
    .groupBy(bucket);
  const demand = await db
    .select({ query: funnelEvents.detail, count: sql<number>`count(*)::int`, unique: sql<number>`count(distinct ${funnelEvents.ipHash})::int` })
    .from(funnelEvents)
    .where(and(gte(funnelEvents.createdAt, since), sql`${funnelEvents.event} = 'find.empty'`, sql`${funnelEvents.detail} is not null`))
    .groupBy(funnelEvents.detail)
    .orderBy(sql`2 desc`)
    .limit(25);
  const rate = (num: number, den: number) => (den > 0 ? Math.round((num / den) * 1000) / 1000 : null);
  return {
    since: since.toISOString(),
    totals,
    /** The two loops, as ratios over the window */
    loops: {
      claimConfirmRate: rate(totals['claim.confirmed'] ?? 0, totals['claim.opened'] ?? 0),
      registrationsFromReceipts: Number(bySrc.find((r) => r.src === 'receipt')?.count ?? 0),
      registrationsFromOffers: Number(bySrc.find((r) => r.src === 'offer')?.count ?? 0),
    },
    registrationsBySource: Object.fromEntries(bySrc.map((r) => [r.src ?? 'unknown', Number(r.count)])),
    /** Searches that found nothing: what to recruit providers for */
    unmetDemand: demand.map((d) => ({ query: d.query, count: Number(d.count), unique: Number(d.unique) })),
    days: rows.map((r) => ({ event: r.event, day: r.day, count: Number(r.count), unique: Number(r.unique) })),
  };
}
