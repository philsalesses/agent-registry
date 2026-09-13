import { Hono } from 'hono';
import { z } from 'zod';
import { inArray } from 'drizzle-orm';
import { db } from '../db';
import { agents } from '../db/schema';
import { requireAdmin } from '../lib/auth';
import { jsonAns } from '../lib/errors';
import { approvePayout, listPayouts, markPayoutPaid, rejectPayout, serializePayout, type PayoutRow, type PayoutStatus } from '../lib/payouts';

/**
 * Manual payout approval (docs/DESIGN.md 14.12). Mounted at /v1/admin/payouts; every route needs X-Admin-Secret.
 *   GET  /?status=pending|approved|paid|rejected
 *   POST /:id/approve
 *   POST /:id/paid    {note?}
 *   POST /:id/reject  {note?}
 */
export const adminPayoutsRouter = new Hono();

adminPayoutsRouter.use('*', requireAdmin);

async function withDestinations(rows: PayoutRow[]) {
  const ids = Array.from(new Set(rows.map((r) => r.agentId)));
  const owners = ids.length
    ? await db.select({ id: agents.id, handle: agents.handle, name: agents.name, paymentMethods: agents.paymentMethods }).from(agents).where(inArray(agents.id, ids))
    : [];
  const byId = new Map(owners.map((o) => [o.id, o]));
  return rows.map((row) => {
    const owner = byId.get(row.agentId);
    return { ...serializePayout(row, owner?.paymentMethods ?? null), agent: owner ? { id: owner.id, handle: owner.handle, name: owner.name } : null };
  });
}

adminPayoutsRouter.get('/', async (c) => {
  const status = c.req.query('status') as PayoutStatus | undefined;
  const limit = parseInt(c.req.query('limit') ?? '200', 10) || 200;
  const rows = await listPayouts(status || undefined, { limit });
  return jsonAns(c, { payouts: await withDestinations(rows) });
});

const noteSchema = z.object({ note: z.string().max(1000).optional().nullable() });

adminPayoutsRouter.post('/:id/approve', async (c) => {
  const row = await approvePayout(c.req.param('id'));
  return jsonAns(c, { payout: (await withDestinations([row]))[0] });
});

adminPayoutsRouter.post('/:id/paid', async (c) => {
  const body = noteSchema.parse(await c.req.json().catch(() => ({})));
  const row = await markPayoutPaid(c.req.param('id'), body.note ?? null);
  return jsonAns(c, { payout: (await withDestinations([row]))[0] });
});

adminPayoutsRouter.post('/:id/reject', async (c) => {
  const body = noteSchema.parse(await c.req.json().catch(() => ({})));
  const row = await rejectPayout(c.req.param('id'), body.note ?? null);
  return jsonAns(c, { payout: (await withDestinations([row]))[0] });
});

export default adminPayoutsRouter;
