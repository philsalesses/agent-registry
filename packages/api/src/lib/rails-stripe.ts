import Stripe from 'stripe';
import { and, eq, inArray, sql } from 'drizzle-orm';
import {
  ANS_BLOCK,
  AnsError,
  CASH_BALANCE_CAP_MICROS,
  STRIPE_SURCHARGE_BPS,
  STRIPE_SURCHARGE_FIXED_MICROS,
  TOPUP_PACKS_MICROS,
  formatUsd,
  isTopupPack,
  topupQuote,
} from 'ans-core';
import { db } from '../db';
import { agents, ledgerAccounts, ledgerEntries, ledgerTxns, offers, systemFlags } from '../db/schema';
import { config } from '../config';
import { alert } from './alerts';
import { emitEvent } from './events';
import { LEDGER_LOCK_KEY, SYSTEM_ACCOUNTS, assertLedgerOpen, getOrCreateAccount, postTxn, toBig, type DbClient, type Tx } from './ledger';
import type { Rail } from './rails';

/**
 * The Stripe top-up rail (docs/DESIGN.md section 6, sprint item 18).
 *
 * Money in: a human pays a Stripe Checkout Session with two line items (the
 * credit pack and the card processing surcharge). `checkout.session.completed`
 * posts a `topup` txn stripe_clearing -> agent cash available, idempotent on
 * the session id. Money back out: `charge.refunded` and
 * `charge.dispute.created` post a `reversal` txn agent cash available ->
 * stripe_clearing. When the agent has already spent the credit, what exists
 * is reversed, the rest is recorded as a shortfall, the agent's offers are
 * paused and the founder is alerted.
 *
 * Ledger refs: the topup txn carries ref (stripe_payment_intent, pi_...) so a
 * refund or dispute, which only knows the payment intent, finds the credit it
 * claws back. Reversals use the same ref. Shortfall records live in
 * system_flags under `stripe_shortfall:<agentId>:<eventKey>` because
 * agents.metadata is public and owner-writable; agents.metadata only mirrors
 * the totals (capExceeded, negativeBalanceMicros).
 */

export const CARD_TOPUPS_DISABLED_REASON = 'Card top-ups are not enabled yet. Sandbox credit works everywhere sandbox is accepted.';

export const STRIPE_REF_PAYMENT_INTENT = 'stripe_payment_intent';
export const STRIPE_REF_CHECKOUT_SESSION = 'stripe_checkout_session';
export const SHORTFALL_FLAG_PREFIX = 'stripe_shortfall:';

const MICROS_PER_CENT = 10_000n;

function moneyFix(next?: string) {
  return { docs: ANS_BLOCK.docs, url: `${config.publicWebUrl}/docs/money`, ...(next ? { next } : {}) };
}

/** The 503 every Stripe entry point answers while STRIPE_ENABLED is off. */
export function cardTopupsDisabledError(): AnsError {
  return new AnsError('not_implemented', CARD_TOPUPS_DISABLED_REASON, {
    status: 503,
    fix: moneyFix('Use creditClass "sandbox" on receipts and invokes where the provider accepts sandbox'),
  });
}

// ---------------------------------------------------------------------------
// Client, amounts, Checkout Session parameters
// ---------------------------------------------------------------------------

let cachedClient: Stripe | null = null;

/** The Stripe API client, created on first use from STRIPE_SECRET_KEY. */
export function stripeClient(): Stripe {
  if (!config.stripeSecretKey) throw cardTopupsDisabledError();
  cachedClient ??= new Stripe(config.stripeSecretKey, {
    maxNetworkRetries: 2,
    timeout: 20_000,
    appInfo: { name: 'ans-registry', url: config.publicWebUrl },
  });
  return cachedClient;
}

/** USD micros to whole cents, rounded up so a charge never under-collects. */
export function microsToCents(micros: bigint): number {
  if (micros < 0n) throw new Error('microsToCents: amount must not be negative');
  return Number((micros + MICROS_PER_CENT - 1n) / MICROS_PER_CENT);
}

export function centsToMicros(cents: number): bigint {
  if (!Number.isSafeInteger(cents)) throw new Error(`centsToMicros: ${cents} is not an integer`);
  return BigInt(cents) * MICROS_PER_CENT;
}

/** 400 for an amount that is not one of the $20, $50, $100 packs. */
export function topupPackError(amountMicros: bigint): AnsError {
  return new AnsError('validation_error', `amountMicros must be a top-up pack: ${TOPUP_PACKS_MICROS.map((p) => formatUsd(p)).join(', ')}`, {
    details: { amountMicros: amountMicros.toString(), packsMicros: TOPUP_PACKS_MICROS.map(String) },
    fix: moneyFix('POST /v1/wallet/topup {"amountMicros": "20000000", "rail": "stripe"}'),
  });
}

function surchargeLabel(): string {
  return `${STRIPE_SURCHARGE_BPS / 100}% + ${formatUsd(STRIPE_SURCHARGE_FIXED_MICROS)}`;
}

/**
 * Checkout Session parameters for a top-up: the credit and the surcharge as
 * two line items (amounts from ans-core topupQuote), card only so completion
 * means paid, metadata {agentId, amountMicros} on the session and on the
 * payment intent, success and cancel back to `${publicWebUrl}/wallet`.
 */
export function buildCheckoutSessionParams(agentId: string, amountMicros: bigint, webUrl: string = config.publicWebUrl): Stripe.Checkout.SessionCreateParams {
  if (!isTopupPack(amountMicros)) throw topupPackError(amountMicros);
  const quote = topupQuote(amountMicros);
  const base = webUrl.replace(/\/+$/, '');
  const credit = quote.credit.toString();
  return {
    mode: 'payment',
    payment_method_types: ['card'],
    client_reference_id: agentId,
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: 'usd',
          unit_amount: microsToCents(quote.credit),
          product_data: {
            name: `ANS cash credit ${formatUsd(quote.credit)}`,
            description: `Prepaid credit for paid receipts and offers, added to the wallet of ${agentId}`,
          },
        },
      },
      {
        quantity: 1,
        price_data: {
          currency: 'usd',
          unit_amount: microsToCents(quote.surcharge),
          product_data: {
            name: 'Card processing surcharge',
            description: `${surchargeLabel()}, so the full credit reaches the wallet`,
          },
        },
      },
    ],
    metadata: {
      agentId,
      amountMicros: credit,
      surchargeMicros: quote.surcharge.toString(),
      totalMicros: quote.total.toString(),
      rail: 'stripe',
    },
    payment_intent_data: {
      description: `ANS cash credit for ${agentId}`,
      metadata: { agentId, amountMicros: credit },
    },
    success_url: `${base}/wallet?topup=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${base}/wallet?topup=cancelled`,
  };
}

// ---------------------------------------------------------------------------
// The rail
// ---------------------------------------------------------------------------

/** The slice of the Stripe client the rail uses (injectable in tests). */
export interface CheckoutSessionCreator {
  checkout: {
    sessions: {
      create(params: Stripe.Checkout.SessionCreateParams): Promise<{ id: string; url: string | null }>;
    };
  };
}

export interface StripeRailOptions {
  enabled?: () => boolean;
  client?: () => CheckoutSessionCreator;
  webUrl?: () => string;
}

export function createStripeRail(opts: StripeRailOptions = {}): Rail {
  const enabled = opts.enabled ?? (() => config.stripeEnabled);
  const getClient: () => CheckoutSessionCreator = opts.client ?? stripeClient;
  const webUrl = opts.webUrl ?? (() => config.publicWebUrl);

  return {
    id: 'stripe',
    enabled,
    async topup(agentId: string, amountMicros: bigint) {
      if (!enabled()) throw cardTopupsDisabledError();
      const params = buildCheckoutSessionParams(agentId, amountMicros, webUrl());
      let session: { id: string; url: string | null };
      try {
        session = await getClient().checkout.sessions.create(params);
      } catch (err) {
        if (err instanceof AnsError) throw err;
        console.error('[rails-stripe] checkout session create failed:', err instanceof Error ? err.message : err);
        throw new AnsError('internal', 'Stripe Checkout is unavailable right now; try the top-up again shortly', { status: 502, fix: moneyFix() });
      }
      if (!session.url) throw new AnsError('internal', 'Stripe did not return a Checkout URL', { status: 502, fix: moneyFix() });
      return { url: session.url };
    },
    async onSettled(event: unknown) {
      await handleStripeEvent(event);
    },
  };
}

export const stripeRail: Rail = createStripeRail();

// ---------------------------------------------------------------------------
// Webhook verification
// ---------------------------------------------------------------------------

/**
 * Verify the Stripe-Signature header over the raw request text and parse the
 * event. Throws Stripe's signature error on mismatch or a stale timestamp
 * (300 s tolerance). `secret` defaults to STRIPE_WEBHOOK_SECRET.
 */
export function constructStripeEvent(rawBody: string, signature: string, secret: string | undefined = config.stripeWebhookSecret): Stripe.Event {
  if (!secret) throw new AnsError('not_implemented', 'STRIPE_WEBHOOK_SECRET is not configured', { status: 503, fix: moneyFix() });
  return Stripe.webhooks.constructEvent(rawBody, signature, secret);
}

// ---------------------------------------------------------------------------
// Event handling
// ---------------------------------------------------------------------------

export interface StripeEventResult {
  handled: boolean;
  action: 'credited' | 'reversed' | 'ignored';
  eventId: string | null;
  type: string;
  agentId?: string;
  /** credited amount, or the reversal this event claimed after caps */
  amountMicros?: string;
  reversedMicros?: string;
  shortfallMicros?: string;
  txnId?: string | null;
  /** true when this event had already been applied (Stripe redelivery) */
  replayed?: boolean;
  capExceeded?: boolean;
  offersPaused?: number;
  reason?: string;
}

/** A shortfall the agent could not cover when Stripe took money back (system_flags value). */
export interface ShortfallMarker {
  agentId: string;
  paymentIntentId: string;
  chargeId: string | null;
  disputeId: string | null;
  eventKey: string;
  requestedMicros: string;
  reversedMicros: string;
  shortfallMicros: string;
  txnId: string | null;
  pausedOfferIds: string[];
  createdAt: string;
}

type Obj = Record<string, unknown>;

interface ParsedEvent {
  id: string | null;
  type: string;
  object: Obj;
}

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null);
/** Expandable Stripe field: an id string or the expanded object */
const idOf = (v: unknown): string | null => str(v) ?? (isObj(v) ? str(v.id) : null);
const int = (v: unknown): number | null => (typeof v === 'number' && Number.isSafeInteger(v) ? v : null);

function parseEvent(event: unknown): ParsedEvent | null {
  if (!isObj(event) || typeof event.type !== 'string' || !isObj(event.data) || !isObj(event.data.object)) return null;
  return { id: str(event.id), type: event.type, object: event.data.object };
}

function ignored(e: ParsedEvent, reason: string): StripeEventResult {
  return { handled: false, action: 'ignored', eventId: e.id, type: e.type, reason };
}

async function lockLedger(tx: Tx): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(${LEDGER_LOCK_KEY})`);
}

/**
 * Side effects after commit (alerts, notifications, agent webhooks) must not
 * hold up the answer to Stripe: they run in the background, and are awaited
 * only under ANS_DISABLE_JOBS=1 (tests), the same convention as lib/receipts.ts.
 */
async function afterCommit(task: () => Promise<void>): Promise<void> {
  const run = task().catch((err) => console.error('[rails-stripe] after-commit task failed:', err instanceof Error ? err.message : err));
  if (process.env.ANS_DISABLE_JOBS === '1') await run;
}

async function agentLabel(agentId: string): Promise<string> {
  const row = await db.query.agents.findFirst({ where: eq(agents.id, agentId), columns: { handle: true } });
  return row?.handle ? `@${row.handle} (${agentId})` : agentId;
}

/** Read-modify-write agents.metadata under a row lock. */
async function updateAgentMetadata(tx: Tx, agentId: string, fn: (current: Obj) => Obj): Promise<void> {
  const [row] = await tx.select({ metadata: agents.metadata }).from(agents).where(eq(agents.id, agentId)).for('update');
  if (!row) return;
  const current = isObj(row.metadata) ? { ...row.metadata } : {};
  await tx.update(agents).set({ metadata: fn(current) }).where(eq(agents.id, agentId));
}

/**
 * Apply one Stripe event. Accepts a verified `Stripe.Event` or a plain object
 * of the same shape. Events ANS does not use, and payments that are not ANS
 * top-ups, come back `handled: false` so the webhook still answers 200.
 * Throws only for conditions a Stripe retry can fix (database errors, a
 * frozen ledger, a refund that arrived before its top-up was credited).
 */
export async function handleStripeEvent(event: unknown): Promise<StripeEventResult> {
  const e = parseEvent(event);
  if (!e) throw new AnsError('bad_request', 'Not a Stripe event: expected {id, type, data: {object}}');
  switch (e.type) {
    case 'checkout.session.completed':
    case 'checkout.session.async_payment_succeeded':
      return creditCheckoutSession(e);
    case 'charge.refunded':
      return reverseRefundedCharge(e);
    case 'charge.dispute.created':
      return reverseDispute(e);
    default:
      return ignored(e, `ANS does not act on ${e.type}`);
  }
}

// --- money in --------------------------------------------------------------

async function creditCheckoutSession(e: ParsedEvent): Promise<StripeEventResult> {
  const s = e.object;
  const sessionId = str(s.id);
  const metadata = isObj(s.metadata) ? s.metadata : {};
  const agentId = str(metadata.agentId);
  const amountRaw = str(metadata.amountMicros);
  if (!sessionId) return ignored(e, 'the checkout session has no id');
  if (!agentId && !amountRaw) return ignored(e, 'not an ANS top-up: the session carries no agentId metadata');
  if (!agentId || !amountRaw || !/^\d{1,18}$/.test(amountRaw) || BigInt(amountRaw) === 0n) {
    await afterCommit(() => alert(`Stripe checkout ${sessionId} carries malformed ANS metadata; credit or refund it by hand`, { eventId: e.id, sessionId, metadata }));
    return ignored(e, 'malformed ANS top-up metadata');
  }
  const paymentStatus = str(s.payment_status);
  if (paymentStatus !== 'paid') {
    return ignored(e, `payment_status is ${paymentStatus ?? 'missing'}; the credit posts once the payment settles`);
  }
  const currency = (str(s.currency) ?? 'usd').toLowerCase();
  if (currency !== 'usd') {
    await afterCommit(() => alert(`Stripe checkout ${sessionId} for ${agentId} was paid in ${currency}; ANS credits USD only, refund it by hand`, { eventId: e.id, sessionId }));
    return ignored(e, `currency ${currency} is not usd`);
  }

  const pendingAlerts: { text: string; data: Record<string, unknown> }[] = [];
  let amount = BigInt(amountRaw);
  const totalCents = int(s.amount_total);
  if (totalCents !== null && centsToMicros(totalCents) < amount) {
    // A discount applied outside ANS: credit what was collected, never more.
    pendingAlerts.push({
      text: `Stripe checkout ${sessionId} collected ${formatUsd(centsToMicros(totalCents))} for a ${formatUsd(amount)} credit; only the collected amount was credited`,
      data: { eventId: e.id, sessionId, agentId, metadataAmountMicros: amount.toString(), amountTotalCents: totalCents },
    });
    amount = centsToMicros(totalCents);
  }
  if (amount <= 0n) {
    await afterCommit(() => alert(`Stripe checkout ${sessionId} for ${agentId} collected nothing; no credit posted`, { eventId: e.id, sessionId }));
    return ignored(e, 'nothing was collected');
  }

  const agent = await db.query.agents.findFirst({ where: eq(agents.id, agentId), columns: { id: true, handle: true } });
  if (!agent) {
    await afterCommit(() => alert(`Stripe top-up ${sessionId} was paid for unknown agent ${agentId}; refund it in Stripe`, { eventId: e.id, sessionId, amountMicros: amount.toString() }));
    return ignored(e, `unknown agent ${agentId}`);
  }

  const paymentIntentId = idOf(s.payment_intent);
  const result = await db.transaction(async (tx) => {
    await lockLedger(tx);
    const available = await getOrCreateAccount('agent', agentId, 'available', 'cash', tx);
    const held = await getOrCreateAccount('agent', agentId, 'held', 'cash', tx);
    const posted = await postTxn(tx, {
      type: 'topup',
      refType: paymentIntentId ? STRIPE_REF_PAYMENT_INTENT : STRIPE_REF_CHECKOUT_SESSION,
      refId: paymentIntentId ?? sessionId,
      idempotencyKey: `topup:stripe:${sessionId}`,
      actorAgentId: agentId,
      entries: [
        { accountId: SYSTEM_ACCOUNTS.stripe_clearing.id, amountMicros: -amount },
        { accountId: available.id, amountMicros: amount },
      ],
    });
    const rows = await tx
      .select({ id: ledgerAccounts.id, balance: ledgerAccounts.balanceMicros })
      .from(ledgerAccounts)
      .where(inArray(ledgerAccounts.id, [available.id, held.id]));
    const balanceOf = (id: string) => rows.find((r) => r.id === id)?.balance ?? 0n;
    const balance = { available: balanceOf(available.id), held: balanceOf(held.id) };
    const total = balance.available + balance.held;
    const capExceeded = !posted.replayed && total > CASH_BALANCE_CAP_MICROS;
    if (capExceeded) {
      // Never refuse money that was already collected: credit it, flag the account, tell the founder.
      await updateAgentMetadata(tx, agentId, (m) => ({
        ...m,
        capExceeded: true,
        capExceededAt: new Date().toISOString(),
        capExceededBalanceMicros: total.toString(),
      }));
    }
    return { posted, balance, total, capExceeded };
  });

  const creditedEntry = result.posted.entries.find((en) => en.amountMicros > 0n);
  const credited = creditedEntry?.amountMicros ?? amount;

  if (!result.posted.replayed) {
    const label = agent.handle ? `@${agent.handle} (${agentId})` : agentId;
    if (result.capExceeded) {
      pendingAlerts.push({
        text: `Cash balance cap exceeded for ${label}: ${formatUsd(result.total)} after a ${formatUsd(credited)} Stripe top-up (cap ${formatUsd(CASH_BALANCE_CAP_MICROS)}). The credit was posted; review the account.`,
        data: { agentId, sessionId, balanceMicros: result.total.toString(), capMicros: CASH_BALANCE_CAP_MICROS.toString(), txnId: result.posted.txn.id },
      });
    }
    await afterCommit(async () => {
      for (const a of pendingAlerts) await alert(a.text, a.data);
      await emitEvent({
        agentIds: [agentId],
        event: 'wallet.credited',
        data: {
          agentId,
          klass: 'cash',
          amountMicros: credited.toString(),
          rail: 'stripe',
          txnId: result.posted.txn.id,
          checkoutSessionId: sessionId,
          balance: { available: result.balance.available.toString(), held: result.balance.held.toString() },
        },
      });
    });
  }

  return {
    handled: true,
    action: 'credited',
    eventId: e.id,
    type: e.type,
    agentId,
    amountMicros: credited.toString(),
    txnId: result.posted.txn.id,
    replayed: result.posted.replayed,
    capExceeded: result.capExceeded,
  };
}

// --- money back out --------------------------------------------------------

interface TopupRef {
  agentId: string;
  creditedMicros: bigint;
  txnId: string;
}

/** The credit a Stripe payment intent produced, found through the topup txn's ref. */
async function topupForPaymentIntent(client: DbClient, paymentIntentId: string): Promise<TopupRef | null> {
  const rows = await client
    .select({ txnId: ledgerTxns.id, amount: ledgerEntries.amountMicros, ownerType: ledgerAccounts.ownerType, ownerId: ledgerAccounts.ownerId })
    .from(ledgerTxns)
    .innerJoin(ledgerEntries, eq(ledgerEntries.txnId, ledgerTxns.id))
    .innerJoin(ledgerAccounts, eq(ledgerAccounts.id, ledgerEntries.accountId))
    .where(and(eq(ledgerTxns.type, 'topup'), eq(ledgerTxns.refType, STRIPE_REF_PAYMENT_INTENT), eq(ledgerTxns.refId, paymentIntentId)));
  const credits = rows.filter((r) => r.ownerType === 'agent' && r.amount > 0n);
  if (credits.length === 0) return null;
  return {
    agentId: credits[0].ownerId,
    creditedMicros: credits.filter((r) => r.ownerId === credits[0].ownerId).reduce((s, r) => s + r.amount, 0n),
    txnId: credits[0].txnId,
  };
}

function shortfallKey(agentId: string, eventKey: string): string {
  return `${SHORTFALL_FLAG_PREFIX}${agentId}:${eventKey}`;
}

function isMarker(v: unknown): v is ShortfallMarker {
  return isObj(v) && typeof v.agentId === 'string' && typeof v.paymentIntentId === 'string' && typeof v.eventKey === 'string' && typeof v.shortfallMicros === 'string';
}

/** Every shortfall recorded for an agent (system_flags rows under stripe_shortfall:<agentId>:). */
export async function shortfallMarkers(agentId: string, client: DbClient = db): Promise<ShortfallMarker[]> {
  const prefix = `${SHORTFALL_FLAG_PREFIX}${agentId}:`;
  const rows = await client
    .select({ value: systemFlags.value })
    .from(systemFlags)
    .where(sql`left(${systemFlags.key}, ${prefix.length}) = ${prefix}`);
  return rows.map((r) => r.value).filter(isMarker);
}

/** What the agent still owes after Stripe refunds and disputes it could not cover (0 when none). */
export async function outstandingShortfallMicros(agentId: string, client: DbClient = db): Promise<bigint> {
  const markers = await shortfallMarkers(agentId, client);
  return markers.reduce((sum, m) => sum + toBig(m.shortfallMicros), 0n);
}

interface ReversalHistory {
  /** reversal txns already posted for the payment intent: idempotency key -> micros returned to stripe_clearing */
  posted: Map<string, bigint>;
  /** shortfalls already recorded for the payment intent: event key -> micros */
  shortfalls: Map<string, bigint>;
}

async function reversalHistory(tx: Tx, agentId: string, paymentIntentId: string): Promise<ReversalHistory> {
  const rows = await tx
    .select({ key: ledgerTxns.idempotencyKey, amount: ledgerEntries.amountMicros })
    .from(ledgerTxns)
    .innerJoin(ledgerEntries, eq(ledgerEntries.txnId, ledgerTxns.id))
    .where(and(
      eq(ledgerTxns.type, 'reversal'),
      eq(ledgerTxns.refType, STRIPE_REF_PAYMENT_INTENT),
      eq(ledgerTxns.refId, paymentIntentId),
      eq(ledgerEntries.accountId, SYSTEM_ACCOUNTS.stripe_clearing.id),
    ));
  const posted = new Map<string, bigint>();
  for (const r of rows) posted.set(r.key, (posted.get(r.key) ?? 0n) + r.amount);
  const shortfalls = new Map<string, bigint>();
  for (const m of await shortfallMarkers(agentId, tx)) {
    if (m.paymentIntentId === paymentIntentId) shortfalls.set(m.eventKey, toBig(m.shortfallMicros));
  }
  return { posted, shortfalls };
}

function sumWhere(map: Map<string, bigint>, keep: (key: string) => boolean = () => true): bigint {
  let total = 0n;
  for (const [k, v] of map) if (keep(k)) total += v;
  return total;
}

interface ReversalInput {
  e: ParsedEvent;
  kind: 'refund' | 'dispute';
  /** ledger idempotency key for this event, also the shortfall marker suffix */
  eventKey: string;
  topup: TopupRef;
  paymentIntentId: string;
  chargeId: string | null;
  disputeId: string | null;
  /** micros this event claims back, before the cap at what is left of the credit */
  claim: (history: ReversalHistory) => bigint;
  stripeAmountCents: number;
}

async function applyReversal(input: ReversalInput): Promise<StripeEventResult> {
  const { e, topup } = input;
  const agentId = topup.agentId;
  const markerKey = shortfallKey(agentId, input.eventKey);

  const outcome = await db.transaction(async (tx) => {
    await lockLedger(tx);
    // A frozen ledger's balances are suspect: answer 503 so Stripe retries after reconciliation, even when nothing would post.
    await assertLedgerOpen(tx);

    const [doneTxn] = await tx.select({ id: ledgerTxns.id }).from(ledgerTxns).where(eq(ledgerTxns.idempotencyKey, input.eventKey));
    const [doneMarker] = await tx.select({ value: systemFlags.value }).from(systemFlags).where(eq(systemFlags.key, markerKey));
    if (doneMarker && isMarker(doneMarker.value)) {
      const m = doneMarker.value;
      return { replayed: true, requested: toBig(m.requestedMicros), reversed: toBig(m.reversedMicros), shortfall: toBig(m.shortfallMicros), txnId: m.txnId, pausedOfferIds: m.pausedOfferIds };
    }
    if (doneTxn) {
      const [entry] = await tx
        .select({ amount: ledgerEntries.amountMicros })
        .from(ledgerEntries)
        .where(and(eq(ledgerEntries.txnId, doneTxn.id), eq(ledgerEntries.accountId, SYSTEM_ACCOUNTS.stripe_clearing.id)));
      const reversed = entry?.amount ?? 0n;
      return { replayed: true, requested: reversed, reversed, shortfall: 0n, txnId: doneTxn.id, pausedOfferIds: [] as string[] };
    }

    const history = await reversalHistory(tx, agentId, input.paymentIntentId);
    const accounted = sumWhere(history.posted) + sumWhere(history.shortfalls);
    const left = topup.creditedMicros > accounted ? topup.creditedMicros - accounted : 0n;
    let requested = input.claim(history);
    if (requested < 0n) requested = 0n;
    if (requested > left) requested = left;
    if (requested === 0n) {
      return { replayed: false, requested, reversed: 0n, shortfall: 0n, txnId: null as string | null, pausedOfferIds: [] as string[] };
    }

    const available = await getOrCreateAccount('agent', agentId, 'available', 'cash', tx);
    const [locked] = await tx.select({ balance: ledgerAccounts.balanceMicros }).from(ledgerAccounts).where(eq(ledgerAccounts.id, available.id)).for('update');
    const have = locked && locked.balance > 0n ? locked.balance : 0n;
    const reversed = requested < have ? requested : have;
    const shortfall = requested - reversed;

    let txnId: string | null = null;
    if (reversed > 0n) {
      const posted = await postTxn(tx, {
        type: 'reversal',
        refType: STRIPE_REF_PAYMENT_INTENT,
        refId: input.paymentIntentId,
        idempotencyKey: input.eventKey,
        actorAgentId: null,
        entries: [
          { accountId: available.id, amountMicros: -reversed },
          { accountId: SYSTEM_ACCOUNTS.stripe_clearing.id, amountMicros: reversed },
        ],
      });
      txnId = posted.txn.id;
    }

    let pausedOfferIds: string[] = [];
    if (shortfall > 0n) {
      const now = new Date();
      const paused = await tx
        .update(offers)
        .set({ status: 'paused', updatedAt: now })
        .where(and(eq(offers.agentId, agentId), eq(offers.status, 'active')))
        .returning({ id: offers.id });
      pausedOfferIds = paused.map((p) => p.id);
      const marker: ShortfallMarker = {
        agentId,
        paymentIntentId: input.paymentIntentId,
        chargeId: input.chargeId,
        disputeId: input.disputeId,
        eventKey: input.eventKey,
        requestedMicros: requested.toString(),
        reversedMicros: reversed.toString(),
        shortfallMicros: shortfall.toString(),
        txnId,
        pausedOfferIds,
        createdAt: now.toISOString(),
      };
      await tx.insert(systemFlags).values({ key: markerKey, value: marker, updatedAt: now });
      const owed = await outstandingShortfallMicros(agentId, tx);
      await updateAgentMetadata(tx, agentId, (m) => ({
        ...m,
        negativeBalanceMicros: owed.toString(),
        negativeBalanceAt: now.toISOString(),
        ...(pausedOfferIds.length > 0 ? { offersPausedAt: now.toISOString() } : {}),
      }));
    }

    return { replayed: false, requested, reversed, shortfall, txnId, pausedOfferIds };
  });

  if (!outcome.replayed && (outcome.shortfall > 0n || input.kind === 'dispute')) {
    await afterCommit(async () => {
      const label = await agentLabel(agentId);
      const what = input.kind === 'dispute' ? `Stripe dispute ${input.disputeId}` : `Stripe refund on ${input.chargeId}`;
      const data = {
        eventId: e.id,
        agentId,
        paymentIntentId: input.paymentIntentId,
        chargeId: input.chargeId,
        disputeId: input.disputeId,
        stripeAmountCents: input.stripeAmountCents,
        creditedMicros: topup.creditedMicros.toString(),
        requestedMicros: outcome.requested.toString(),
        reversedMicros: outcome.reversed.toString(),
        shortfallMicros: outcome.shortfall.toString(),
        txnId: outcome.txnId,
        pausedOfferIds: outcome.pausedOfferIds,
      };
      if (outcome.shortfall > 0n) {
        await alert(`${what} left ${label} short by ${formatUsd(outcome.shortfall)}: reversed ${formatUsd(outcome.reversed)} of cash, paused ${outcome.pausedOfferIds.length} offer(s)`, data);
      } else {
        await alert(`${what} reversed ${formatUsd(outcome.reversed)} of cash credit from ${label}`, data);
      }
    });
  }

  return {
    handled: true,
    action: 'reversed',
    eventId: e.id,
    type: e.type,
    agentId,
    amountMicros: outcome.requested.toString(),
    reversedMicros: outcome.reversed.toString(),
    shortfallMicros: outcome.shortfall.toString(),
    txnId: outcome.txnId,
    replayed: outcome.replayed,
    offersPaused: outcome.pausedOfferIds.length,
    ...(outcome.requested === 0n && !outcome.replayed ? { reason: 'nothing left of the credit to reverse' } : {}),
  };
}

async function reverseRefundedCharge(e: ParsedEvent): Promise<StripeEventResult> {
  const charge = e.object;
  const chargeId = str(charge.id);
  if (!chargeId) return ignored(e, 'the charge has no id');
  const refundedCents = int(charge.amount_refunded);
  if (refundedCents === null || refundedCents <= 0) return ignored(e, 'nothing has been refunded on this charge');
  const currency = (str(charge.currency) ?? 'usd').toLowerCase();
  if (currency !== 'usd') return ignored(e, `currency ${currency} is not usd`);

  const metadata = isObj(charge.metadata) ? charge.metadata : {};
  const paymentIntentId = idOf(charge.payment_intent);
  const topup = paymentIntentId ? await topupForPaymentIntent(db, paymentIntentId) : null;
  if (!topup || !paymentIntentId) {
    if (paymentIntentId && str(metadata.agentId)) {
      // An ANS top-up charge whose credit has not posted yet (events out of order): a non-2xx makes Stripe retry.
      throw new AnsError('conflict', `Charge ${chargeId} was refunded before its top-up was credited; Stripe will retry this event`, {
        details: { chargeId, paymentIntentId, agentId: metadata.agentId },
      });
    }
    if (str(metadata.agentId)) {
      await afterCommit(() => alert(`Stripe refund on ${chargeId} names ANS agent ${String(metadata.agentId)} but has no payment intent; reverse it by hand`, { eventId: e.id, chargeId }));
    }
    return ignored(e, 'no ANS top-up matches this charge');
  }

  const refundPrefix = `reversal:stripe:refund:${chargeId}:`;
  return applyReversal({
    e,
    kind: 'refund',
    eventKey: `${refundPrefix}${refundedCents}`,
    topup,
    paymentIntentId,
    chargeId,
    disputeId: null,
    stripeAmountCents: refundedCents,
    claim: (history) => {
      // amount_refunded is cumulative across partial refunds: claim the part not yet reversed or recorded
      const refunded = centsToMicros(refundedCents);
      const target = refunded < topup.creditedMicros ? refunded : topup.creditedMicros;
      const already = sumWhere(history.posted, (k) => k.startsWith(refundPrefix)) + sumWhere(history.shortfalls, (k) => k.startsWith(refundPrefix));
      return target - already;
    },
  });
}

async function reverseDispute(e: ParsedEvent): Promise<StripeEventResult> {
  const dispute = e.object;
  const disputeId = str(dispute.id);
  if (!disputeId) return ignored(e, 'the dispute has no id');
  const cents = int(dispute.amount);
  if (cents === null || cents <= 0) return ignored(e, 'the dispute has no amount');
  const currency = (str(dispute.currency) ?? 'usd').toLowerCase();
  if (currency !== 'usd') return ignored(e, `currency ${currency} is not usd`);

  const chargeId = idOf(dispute.charge);
  const paymentIntentId = idOf(dispute.payment_intent);
  const topup = paymentIntentId ? await topupForPaymentIntent(db, paymentIntentId) : null;
  if (!topup || !paymentIntentId) {
    await afterCommit(() => alert(`Stripe dispute ${disputeId} (${formatUsd(centsToMicros(cents))}) matches no ANS top-up; review it in Stripe`, { eventId: e.id, disputeId, chargeId, paymentIntentId }));
    return ignored(e, 'no ANS top-up matches this dispute');
  }

  return applyReversal({
    e,
    kind: 'dispute',
    eventKey: `reversal:stripe:dispute:${disputeId}`,
    topup,
    paymentIntentId,
    chargeId,
    disputeId,
    stripeAmountCents: cents,
    claim: () => centsToMicros(cents),
  });
}
