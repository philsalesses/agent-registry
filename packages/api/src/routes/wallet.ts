import { rateLimit } from '../lib/ratelimit';
import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import {
  ANS_BLOCK,
  AnsError,
  CASH_BALANCE_CAP_MICROS,
  PAYOUT_HOLD_DAYS,
  TOPUP_PACKS_MICROS,
  formatUsd,
  isTopupPack,
  topupQuote,
  type WireWallet,
} from 'ans-core';
import { db } from '../db';
import { agents } from '../db/schema';
import { config } from '../config';
import { getRawBody, requireAgent } from '../lib/auth';
import { withAns } from '../lib/errors';
import { idempotencyKeyFrom, withIdempotency } from '../lib/idempotency';
import { assertLedgerOpen, balances, ledgerFor, serializeBalances } from '../lib/ledger';
import { PAYOUT_STATUSES, listPayouts, payoutEligibility, requestPayout, serializePayout, type PayoutStatus } from '../lib/payouts';
import { getRail, type Rail } from '../lib/rails';
import { CARD_TOPUPS_DISABLED_REASON, cardTopupsDisabledError, topupPackError } from '../lib/rails-stripe';

/**
 * Wallet (docs/DESIGN.md section 4 "Money", section 6, 14.12). Mounted at /v1/wallet.
 * Every route acts on the authenticated agent's own wallet.
 *
 *   GET  /                  balances, payout eligibility, caps, top-up availability (WireWallet)
 *   GET  /ledger            txns touching the caller's accounts, newest first
 *   POST /topup             {amountMicros, rail: 'stripe'} -> {url, quote}
 *   POST /payout-request    {amountMicros, destinationIndex, note?} -> the payout request (201)
 *   GET  /payout-requests   the caller's payout requests, newest first
 *
 * API keys need scope read for the GETs, invoke for a top-up, and every scope
 * (read, receipts, invoke, publish) to request a payout.
 */

const readAuth = requireAgent({ allow: ['signed', 'session', 'apikey'], scopes: ['read'] });
const topupAuth = requireAgent({ allow: ['signed', 'session', 'apikey'], scopes: ['invoke'] });
const payoutAuth = requireAgent({ allow: ['signed', 'session', 'apikey'], scopes: ['read', 'receipts', 'invoke', 'publish'] });

const microsInput = z
  .union([
    z.string().trim().regex(/^\d{1,18}$/, 'must be a decimal integer string of USD micros'),
    z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  ])
  .transform((v) => BigInt(v));

const topupBody = z.object({
  amountMicros: microsInput,
  rail: z.enum(['stripe', 'lightning', 'usdc']).default('stripe'),
});

const payoutBody = z
  .object({
    amountMicros: microsInput,
    destinationIndex: z.number().int().nonnegative().optional(),
    /** alias used by docs/DESIGN.md 14.12 */
    destination: z.number().int().nonnegative().optional(),
    note: z.string().max(500).nullable().optional(),
  })
  .refine((b) => b.destinationIndex !== undefined || b.destination !== undefined, {
    message: 'destinationIndex is required: the index of one of your agent paymentMethods',
    path: ['destinationIndex'],
  });

function moneyFix(next?: string) {
  return { docs: ANS_BLOCK.docs, url: `${config.publicWebUrl}/docs/money`, ...(next ? { next } : {}) };
}

/** Parse the JSON body from the raw text (the stream may already have been read for signature checks). */
async function readJsonBody(c: Context): Promise<unknown> {
  const text = await getRawBody(c);
  if (!text.trim()) throw new AnsError('bad_request', 'Request body must be a JSON object', { fix: { docs: ANS_BLOCK.docs } });
  try {
    return JSON.parse(text);
  } catch {
    throw new AnsError('bad_request', 'Request body is not valid JSON', { fix: { docs: ANS_BLOCK.docs } });
  }
}

async function paymentMethodsOf(agentId: string) {
  const row = await db.query.agents.findFirst({ where: eq(agents.id, agentId), columns: { paymentMethods: true } });
  return row?.paymentMethods ?? [];
}

export interface WalletRouterDeps {
  /** Rail lookup; tests inject a fake Stripe rail */
  getRail?: (id: string) => Rail | undefined;
  /** Clock for the payout hold window; tests move it forward */
  now?: () => Date;
}

export function createWalletRouter(deps: WalletRouterDeps = {}): Hono {
  const railFor = deps.getRail ?? getRail;
  const now = deps.now ?? (() => new Date());
  const router = new Hono();

  router.get('/', readAuth, async (c) => {
    const { id } = c.get('agent');
    const [b, eligibility] = await Promise.all([balances(id), payoutEligibility(id, { now: now() })]);
    const stripe = railFor('stripe');
    const enabled = !!stripe && stripe.enabled();
    const wallet: WireWallet = {
      agentId: id,
      ...serializeBalances(b),
      payoutEligibleMicros: eligibility.eligibleMicros.toString(),
      caps: { cashBalanceMicros: CASH_BALANCE_CAP_MICROS.toString(), payoutHoldDays: PAYOUT_HOLD_DAYS },
      topup: { enabled, packsMicros: TOPUP_PACKS_MICROS.map(String), reason: enabled ? null : CARD_TOPUPS_DISABLED_REASON },
      manualPayouts: true,
      ledgerUrl: '/v1/wallet/ledger',
    };
    return c.json(withAns(wallet));
  });

  router.get('/ledger', readAuth, async (c) => {
    const { id } = c.get('agent');
    const cursor = c.req.query('cursor') || null;
    if (cursor !== null && !/^\d{1,19}$/.test(cursor)) {
      throw new AnsError('validation_error', 'cursor must be the nextCursor value from a previous page', { details: { cursor } });
    }
    const limitRaw = c.req.query('limit');
    let limit = 50;
    if (limitRaw !== undefined && limitRaw !== '') {
      const n = /^\d{1,3}$/.test(limitRaw) ? Number(limitRaw) : NaN;
      if (!(n >= 1 && n <= 200)) throw new AnsError('validation_error', 'limit must be an integer from 1 to 200', { details: { limit: limitRaw } });
      limit = n;
    }
    return c.json(withAns(await ledgerFor(id, cursor, limit)));
  });

  router.post('/topup', topupAuth, async (c) => {
    const { id } = c.get('agent');
    return withIdempotency(c, id, idempotencyKeyFrom(c), async () => {
      const body = topupBody.parse(await readJsonBody(c));
      const rail = railFor(body.rail);
      if (!rail) {
        throw new AnsError('not_implemented', `The ${body.rail} rail is not available yet; use rail "stripe"`, { status: 501, fix: moneyFix() });
      }
      if (!rail.enabled()) {
        throw rail.id === 'stripe'
          ? cardTopupsDisabledError()
          : new AnsError('not_implemented', `The ${rail.id} rail is switched off`, { status: 503, fix: moneyFix() });
      }
      await assertLedgerOpen();
      if (!isTopupPack(body.amountMicros)) throw topupPackError(body.amountMicros);

      const b = await balances(id);
      const cashBalance = b.cash.available + b.cash.held;
      if (cashBalance + body.amountMicros > CASH_BALANCE_CAP_MICROS) {
        const room = CASH_BALANCE_CAP_MICROS > cashBalance ? CASH_BALANCE_CAP_MICROS - cashBalance : 0n;
        throw new AnsError('bad_request', `This top-up would take your cash balance to ${formatUsd(cashBalance + body.amountMicros)}, over the ${formatUsd(CASH_BALANCE_CAP_MICROS)} cap`, {
          details: {
            capMicros: CASH_BALANCE_CAP_MICROS.toString(),
            cashBalanceMicros: cashBalance.toString(),
            amountMicros: body.amountMicros.toString(),
            packsThatFitMicros: TOPUP_PACKS_MICROS.filter((p) => p <= room).map(String),
          },
          fix: moneyFix('Pick a smaller pack, or spend or pay out cash first'),
        });
      }

      const quote = topupQuote(body.amountMicros);
      const started = await rail.topup(id, body.amountMicros);
      return c.json(withAns({
        rail: rail.id,
        url: started.url ?? null,
        ...(started.instructions ? { instructions: started.instructions } : {}),
        quote: { credit: quote.credit.toString(), surcharge: quote.surcharge.toString(), total: quote.total.toString() },
      }));
    });
  });

  // 20 requests a day per agent: each one alerts the founder, so a runaway loop cannot flood the channel
  router.post('/payout-request', payoutAuth, rateLimit((c) => `payout:${(c.get('agent') as { id: string }).id}`, 20, 86400, 'payout requests'), async (c) => {
    const { id } = c.get('agent');
    return withIdempotency(c, id, idempotencyKeyFrom(c), async () => {
      const body = payoutBody.parse(await readJsonBody(c));
      const { payout } = await requestPayout(id, {
        amountMicros: body.amountMicros,
        destinationIndex: (body.destinationIndex ?? body.destination) as number,
        note: body.note ?? null,
        now: now(),
      });
      return c.json(withAns(serializePayout(payout, await paymentMethodsOf(id))), 201);
    });
  });

  router.get('/payout-requests', readAuth, async (c) => {
    const { id } = c.get('agent');
    const status = c.req.query('status') || undefined;
    if (status !== undefined && !(PAYOUT_STATUSES as readonly string[]).includes(status)) {
      throw new AnsError('validation_error', `status must be one of ${PAYOUT_STATUSES.join(', ')}`, { details: { status } });
    }
    const [rows, methods] = await Promise.all([listPayouts(status as PayoutStatus | undefined, { agentId: id, limit: 100 }), paymentMethodsOf(id)]);
    return c.json(withAns({ payoutRequests: rows.map((r) => serializePayout(r, methods)) }));
  });

  return router;
}

export const walletRouter = createWalletRouter();
export default walletRouter;
