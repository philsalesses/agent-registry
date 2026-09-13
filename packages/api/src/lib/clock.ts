import { sql } from 'drizzle-orm';
import { db } from '../db';
import { config } from '../config';
import type { Tx } from './ledger';

/**
 * The in-process clock (docs/DESIGN.md section 5, rule 2). Runs every 5
 * minutes under advisory lock 42 so only one instance ticks at a time.
 *
 * Rules are registered by lib/receipts.ts (proposed -> expired,
 * open -> timed_out, delivered -> unreviewed, rejected -> resolved_client,
 * disputed -> split, rating reveal, sealing). Side effects that must see
 * committed data (trust recompute, notifications) go through ctx.afterCommit.
 */

export const CLOCK_LOCK_KEY = 42;
export const CLOCK_INTERVAL_MS = 5 * 60 * 1000;

export interface ClockContext {
  /** Run after the tick's transaction commits (errors are logged, never thrown) */
  afterCommit: (fn: () => Promise<void>) => void;
}

export interface ClockRule {
  name: string;
  /** Returns the number of receipts transitioned */
  run: (tx: Tx, now: Date, ctx: ClockContext) => Promise<number>;
}

export interface ClockTickResult {
  ran: boolean; // false when another instance held the lock
  at: string;
  transitions: number;
  byRule: Record<string, number>;
}

const rules: ClockRule[] = [];

export function registerClockRule(rule: ClockRule): void {
  rules.push(rule);
}

export function listClockRules(): readonly string[] {
  return rules.map((r) => r.name);
}

/**
 * Run the clock once. Also used by POST /v1/admin/clock/tick (external cron fallback).
 * The advisory lock is transaction-scoped so it is always released, even on error.
 */
export async function runClockTick(now: Date = new Date()): Promise<ClockTickResult> {
  const after: (() => Promise<void>)[] = [];
  const ctx: ClockContext = { afterCommit: (fn) => { after.push(fn); } };
  const result = await db.transaction(async (tx) => {
    const rows = await tx.execute(sql`select pg_try_advisory_xact_lock(${CLOCK_LOCK_KEY}) as locked`);
    const locked = rows[0]?.locked === true;
    if (!locked) return { ran: false, at: now.toISOString(), transitions: 0, byRule: {} } as ClockTickResult;
    const byRule: Record<string, number> = {};
    let transitions = 0;
    for (const rule of rules) {
      const n = await rule.run(tx, now, ctx);
      byRule[rule.name] = n;
      transitions += n;
    }
    return { ran: true, at: now.toISOString(), transitions, byRule } as ClockTickResult;
  });
  for (const fn of after) {
    try {
      await fn();
    } catch (err) {
      console.error('[clock] after-commit step failed:', err instanceof Error ? err.message : err);
    }
  }
  return result;
}

let timer: NodeJS.Timeout | null = null;

export function startClock(): void {
  if (config.disableJobs || timer) return;
  const tick = async () => {
    try {
      const result = await runClockTick();
      if (result.ran && process.env.ANS_QUIET !== '1') {
        console.log(`[clock] tick at ${result.at}: ${result.transitions} transitions (${rules.length} rules)`);
      }
    } catch (err) {
      console.error('[clock] tick failed:', err);
    }
  };
  timer = setInterval(tick, CLOCK_INTERVAL_MS);
  timer.unref();
  void tick();
}

export function stopClock(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
