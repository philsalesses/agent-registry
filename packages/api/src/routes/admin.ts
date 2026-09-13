import { Hono } from 'hono';
import { z } from 'zod';
import { desc, eq, sql } from 'drizzle-orm';
import { AnsError } from 'ans-core';
import { db } from '../db';
import { receipts, systemFlags } from '../db/schema';
import { requireAdmin } from '../lib/auth';
import { jsonAns } from '../lib/errors';
import { runClockTick } from '../lib/clock';
import { recomputeAll } from '../lib/trust';
import { reconcile, setLedgerFrozen } from '../lib/ledger';
import { funnelCounts } from '../lib/funnel';
import { alert } from '../lib/alerts';
import { ruleReceipt, runEffects, toWire } from '../lib/receipts';

/**
 * Admin surface (docs/DESIGN.md 14.16). Every route needs X-Admin-Secret.
 * Payout approval routes live in routes/admin-payouts.ts next to the wallet module.
 */
export const adminRouter = new Hono();

adminRouter.use('*', requireAdmin);

const FLAG_KEYS = ['ledger_frozen', 'registrations_paused', 'house_daily_budget_micros', 'house_spent_today_micros'] as const;

adminRouter.get('/overview', async (c) => {
  const [row] = (await db.execute(sql`
    select
      (select count(*) from agents where is_seed = false)::int as agents,
      (select count(*) from agents where created_at > now() - interval '24 hours')::int as agents_24h,
      (select count(*) from receipts)::int as receipts,
      (select count(*) from receipts where state = 'disputed')::int as disputed,
      (select count(*) from receipts where state in ('open','delivered','rejected'))::int as in_progress,
      (select count(*) from receipts where hash is not null)::int as sealed,
      (select count(*) from offers where status = 'active')::int as offers,
      (select count(*) from payout_requests where status in ('pending','approved'))::int as payouts_open,
      (select coalesce(sum(balance_micros), 0) from ledger_accounts where id = 'acc_sys_fee_revenue')::text as fee_revenue
  `)) as unknown as Record<string, number | string>[];
  const flags = await db.select().from(systemFlags);
  return jsonAns(c, { counts: row, flags: Object.fromEntries(flags.filter((f) => (FLAG_KEYS as readonly string[]).includes(f.key)).map((f) => [f.key, f.value])) });
});

adminRouter.get('/receipts', async (c) => {
  const state = c.req.query('state') ?? 'disputed';
  const rows = await db.select().from(receipts).where(eq(receipts.state, state as never)).orderBy(desc(receipts.createdAt)).limit(100);
  return jsonAns(c, { receipts: await toWire(rows, { events: true }) });
});

adminRouter.post('/receipts/:id/rule', async (c) => {
  const body = z.object({ ruling: z.enum(['client', 'provider', 'split']), note: z.string().max(1000).optional().nullable() }).parse(await c.req.json());
  const { receipt, effects } = await ruleReceipt({ receiptId: c.req.param('id'), ruling: body.ruling, note: body.note });
  await runEffects(effects);
  const [wire] = await toWire([receipt], { events: true });
  return jsonAns(c, { receipt: wire });
});

adminRouter.get('/flags', async (c) => {
  const flags = await db.select().from(systemFlags);
  return jsonAns(c, { flags: flags.filter((f) => (FLAG_KEYS as readonly string[]).includes(f.key)) });
});

adminRouter.patch('/flags', async (c) => {
  const body = z.object({ key: z.enum(FLAG_KEYS), value: z.union([z.boolean(), z.number(), z.string()]) }).parse(await c.req.json());
  if (body.key === 'ledger_frozen') {
    if (typeof body.value !== 'boolean') throw new AnsError('validation_error', 'ledger_frozen must be a boolean');
    await setLedgerFrozen(body.value);
  } else {
    await db
      .insert(systemFlags)
      .values({ key: body.key, value: body.value, updatedAt: new Date() })
      .onConflictDoUpdate({ target: systemFlags.key, set: { value: body.value, updatedAt: new Date() } });
  }
  await alert(`Admin flag ${body.key} set to ${JSON.stringify(body.value)}`);
  return jsonAns(c, { key: body.key, value: body.value });
});

adminRouter.post('/clock/tick', async (c) => {
  const body = z.object({ now: z.string().datetime().optional() }).parse(await c.req.json().catch(() => ({})));
  const result = await runClockTick(body.now ? new Date(body.now) : new Date());
  return jsonAns(c, result);
});

adminRouter.post('/trust/recompute', async (c) => jsonAns(c, await recomputeAll()));

adminRouter.get('/funnel', async (c) => {
  const days = Math.min(Math.max(parseInt(c.req.query('days') ?? '30', 10) || 30, 1), 365);
  return jsonAns(c, await funnelCounts(days));
});

adminRouter.get('/reconcile', async (c) => jsonAns(c, await reconcile()));
