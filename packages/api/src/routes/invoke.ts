import { Hono, type MiddlewareHandler } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { AnsError, canonicalize, sha256hex, type CreditClass, type TeachingFix, type WireAgentRef } from 'ans-core';
import { db } from '../db';
import { apiKeys, rateLimits } from '../db/schema';
import { requireAgent, type AuthAgent } from '../lib/auth';
import { teach, withAns } from '../lib/errors';
import { emitEvent } from '../lib/events';
import { idempotencyKeyFrom, withIdempotency } from '../lib/idempotency';
import { consume } from '../lib/ratelimit';
import { assertTrustFor } from '../lib/policy';
import {
  agentRef,
  cashHeldTodayByKey,
  deliverProxyReceipt,
  failProxyReceipt,
  openProxyReceipt,
  receiptUrl,
  runEffects,
  type ReceiptRow,
} from '../lib/receipts';
import {
  callProvider,
  closestOfferNames,
  jsonDepthExceeded,
  loadAgentRow,
  MAX_TIMEOUT_MS,
  MAX_VALUE_DEPTH,
  MIN_TIMEOUT_MS,
  offerName,
  offerUrls,
  recordCall,
  resolveOffer,
  setInvokeForwarder,
  type OfferExample,
  type ProviderOutcome,
} from '../lib/offers';
import { assertHouseAllowance, callHouseOffer, prevalidateHouseInput } from '../lib/house';
import { readRawBody } from './offers';
import { stripNul, validateAgainst, type JsonSchema } from '../lib/schemas';

/**
 * POST /v1/invoke (docs/DESIGN.md section 4 "Offers, discovery and invocation", 14.5, 14.6, 14.15).
 *
 * resolve -> validate input -> owner policy -> price guard -> spend cap ->
 * open a proxy receipt (escrow held) -> run the house offer in-process or
 * forward to the provider with the registry signature -> validate output ->
 * deliver (200) or fail and refund (502).
 */

export { setInvokeForwarder };

export const invokeRouter = new Hono();

const DOCS = 'https://ans-registry.org/skill.md';
export const MAX_INVOKE_BYTES = 2 * 1024 * 1024;
const IN_FLIGHT_SEC = MAX_TIMEOUT_MS / 1000 + 60;

const invokeInput = z
  .object({
    offer: z.string().min(1).max(200),
    input: z.unknown(),
    maxPriceMicros: z.union([z.string().regex(/^\d{1,15}$/, 'must be a decimal string of USD micros'), z.number().int().min(0).max(Number.MAX_SAFE_INTEGER)]).optional(),
    /** Paid calls are always cash; kept so clients that send it explicitly still validate */
    creditClass: z.literal('cash').optional(),
    timeoutMs: z.number().int().min(MIN_TIMEOUT_MS).max(MAX_TIMEOUT_MS).optional(),
  })
  .strict();

export interface InvokeRequest {
  auth: AuthAgent;
  body: unknown;
  /** raw body text exactly as received (its sha256 is recorded on the receipt) */
  rawBody: string;
  path: string;
  /** X-Agent-Timestamp and X-Agent-Signature of a signed request */
  timestamp?: string | null;
  signature?: string | null;
}

export interface InvokeSuccess {
  receiptId: string;
  offer: string;
  output: unknown;
  charged: { priceMicros: string; feeMicros: string; creditClass: CreditClass };
  provider: WireAgentRef;
  latencyMs: number;
  receiptUrl: string;
  verdict: string;
}

export type InvokeResult =
  | { ok: true; body: InvokeSuccess }
  | { ok: false; status: 502; code: 'internal' | 'output_invalid'; message: string; details: Record<string, unknown>; fix: TeachingFix };

// Work that must not delay the response (trust recompute, notifications, webhooks)
const pending = new Set<Promise<void>>();
function inBackground(work: Promise<unknown>): void {
  const tracked: Promise<void> = work
    .then(() => undefined)
    .catch((err) => console.error('[invoke] background step failed:', err instanceof Error ? err.message : err))
    .finally(() => pending.delete(tracked));
  pending.add(tracked);
}

/** Wait for background work started by invokes (tests call this before cleanup). */
export async function flushInvokeBackground(): Promise<void> {
  while (pending.size > 0) await Promise.allSettled(Array.from(pending));
}

function exampleRequest(name: string, example: OfferExample | undefined): string {
  const body = JSON.stringify({ offer: name, input: example ? example.input : '<input matching inputSchema>' });
  return `POST /v1/invoke ${body.length > 2000 ? JSON.stringify({ offer: name, input: '<input matching inputSchema>' }) : body}`;
}

function toMicros(v: string | number): bigint {
  return BigInt(typeof v === 'number' ? v : v.trim());
}

/**
 * The invoke flow, independent of HTTP (the MCP server can call it too).
 * Throws AnsError for every 4xx; provider-side failures come back as { ok: false } after the refund.
 */
export async function performInvoke(req: InvokeRequest): Promise<InvokeResult> {
  const parsed = invokeInput.safeParse(req.body);
  if (!parsed.success || !(typeof req.body === 'object' && req.body !== null && 'input' in req.body)) {
    const issues = parsed.success ? [{ path: 'input', message: 'Required' }] : parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
    throw new AnsError('validation_error', `${issues[0]?.path || 'body'}: ${issues[0]?.message ?? 'invalid'}`, {
      details: { errors: issues },
      fix: { docs: DOCS, next: 'POST /v1/invoke {"offer": "@handle/slug", "input": {...}, "maxPriceMicros": "0"}' },
    });
  }
  const p = parsed.data;

  // 1. resolve
  const resolved = await resolveOffer(p.offer);
  if (!resolved) {
    const closest = await closestOfferNames(p.offer);
    throw new AnsError('no_offer', `No offer named ${p.offer}`, {
      details: { offer: p.offer, closest },
      fix: { docs: DOCS, next: closest.length > 0 ? `POST /v1/invoke {"offer": "${closest[0]}", "input": {...}}` : 'Search: GET /v1/offers?q=<what you need done>' },
    });
  }
  const { offer, owner } = resolved;
  const name = offerName(offer, owner);
  if (offer.status !== 'active') {
    throw new AnsError('invalid_state', `${name} is ${offer.status} and does not accept calls`, {
      details: { offer: name, status: offer.status },
      fix: { docs: DOCS, next: `GET /v1/offers/@${owner.handle ?? owner.id}/${offer.slug} for the current version` },
    });
  }
  const caller = await loadAgentRow(req.auth.id);
  if (caller.id === owner.id) {
    throw new AnsError('bad_request', 'You cannot invoke your own offer: a receipt needs two different parties', { details: { offer: name }, fix: { docs: DOCS } });
  }

  // 2. input
  const examples = (offer.examples ?? []) as OfferExample[];
  const inputFix: TeachingFix = { docs: DOCS, next: exampleRequest(name, examples[0]) };
  const inputDetails = (errors: unknown) => ({ offer: name, errors, inputSchema: offer.inputSchema, inputSchemaUrl: offerUrls(offer, owner).inputSchema, example: examples[0]?.input ?? null });
  const check = jsonDepthExceeded(p.input)
    ? { ok: false, errors: [{ path: '', message: `input is nested more than ${MAX_VALUE_DEPTH} levels deep`, keyword: 'depth', params: { limit: MAX_VALUE_DEPTH } }] }
    : validateAgainst(offer.inputSchema as JsonSchema, p.input);
  if (!check.ok) {
    await recordCall(offer.id, 'input_invalid', null);
    throw new AnsError('input_invalid', `input does not match the input schema of ${name}`, { details: inputDetails(check.errors), fix: inputFix });
  }
  const isHouse = owner.isHouse && offer.transport === 'ans-house';
  if (isHouse) {
    try {
      prevalidateHouseInput(offer.slug, p.input);
    } catch (err) {
      if (err instanceof AnsError && err.code === 'input_invalid') {
        await recordCall(offer.id, 'input_invalid', null);
        throw new AnsError('input_invalid', err.message, { details: { ...inputDetails([{ path: '', message: err.message }]), cause: err.details ?? null }, fix: inputFix });
      }
      throw err;
    }
  }

  // 3. credit class, owner policy, price guard, spend cap
  const price = offer.priceMicros;
  const creditClass: CreditClass = price > 0n ? 'cash' : 'none';
  assertTrustFor(owner, caller);
  if (p.maxPriceMicros !== undefined && price > toMicros(p.maxPriceMicros)) {
    throw new AnsError('conflict', `The price of ${name} (${price} micros) is above maxPriceMicros (${toMicros(p.maxPriceMicros)})`, {
      details: { offer: name, priceMicros: price.toString(), maxPriceMicros: toMicros(p.maxPriceMicros).toString() },
      fix: { docs: DOCS, next: `Raise maxPriceMicros to ${price} if the price is acceptable` },
    });
  }
  if (req.auth.method === 'apikey' && creditClass === 'cash' && price > 0n && req.auth.keyId) {
    const [key] = await db.select({ cap: apiKeys.spendCapMicrosPerDay }).from(apiKeys).where(eq(apiKeys.id, req.auth.keyId));
    const cap = key?.cap ?? 0n;
    const spent = await cashHeldTodayByKey(req.auth.keyId);
    if (spent + price > cap) {
      throw new AnsError('spend_cap_exceeded', `This API key may spend ${cap} cash micros per UTC day; ${spent} are already spent and this call costs ${price}`, {
        details: { keyId: req.auth.keyId, capMicros: cap.toString(), spentTodayMicros: spent.toString(), priceMicros: price.toString() },
        fix: {
          docs: 'https://ans-registry.org/docs/money',
          command: 'npx -y ans-mcp keys create --scopes invoke --cap-usd 5',
          next: 'Have your operator mint a key with a daily cash cap, or sign the request with the agent key',
        },
      });
    }
  }
  if (isHouse) await assertHouseAllowance(caller.id);

  // 4. open the receipt and hold escrow
  let receipt: ReceiptRow;
  try {
    receipt = await openProxyReceipt({
      caller,
      actor: { id: req.auth.id, method: req.auth.method, keyId: req.auth.keyId },
      offer,
      owner,
      inputHash: sha256hex(canonicalize(p.input)),
      creditClass,
      requestSig: { method: 'POST', path: req.path, timestamp: req.timestamp ?? null, bodySha256: sha256hex(req.rawBody), signature: req.signature ?? null },
    });
  } catch (err) {
    if (err instanceof AnsError && err.code === 'insufficient_credit') {
      const d = (err.details ?? {}) as { have?: string; need?: string };
      throw new AnsError('insufficient_credit', `You need ${price} micros in your wallet to call ${name}`, {
        details: { have: d.have ?? null, need: d.need ?? price.toString(), creditClass, offer: name },
        fix: {
          url: 'https://ans-registry.org/wallet',
          docs: 'https://ans-registry.org/docs/money',
          next: 'Add money to the wallet at /wallet',
        },
      });
    }
    throw err;
  }

  // 5. run
  const timeoutMs = Math.min(p.timeoutMs ?? offer.timeoutMs, offer.timeoutMs);
  let outcome: ProviderOutcome;
  try {
    outcome = isHouse
      ? await callHouseOffer(offer, p.input)
      : await callProvider({ offer, name, receiptId: receipt.id, caller: { id: caller.id, handle: caller.handle ?? null, trust: caller.trustScore }, input: p.input, timeoutMs });
  } catch (err) {
    // the registry itself failed between open and forward: refund rather than leave the hold to the clock
    const failed = await failProxyReceipt(receipt.id, 'failed', { reason: 'registry_error' });
    inBackground(runEffects(failed.effects));
    throw err;
  }

  const url = receiptUrl(receipt.id);
  if (outcome.kind === 'ok') {
    const delivered = await deliverProxyReceipt(receipt.id, sha256hex(canonicalize(outcome.output)));
    inBackground(runEffects(delivered.effects));
    await recordCall(offer.id, 'ok', outcome.latencyMs);
    if (!owner.isHouse) {
      inBackground(
        emitEvent({
          agentIds: [owner.id],
          event: 'invoke.received',
          data: { receiptId: receipt.id, offer: name, caller: { id: caller.id, handle: caller.handle }, priceMicros: price.toString(), creditClass: delivered.receipt.creditClass, latencyMs: outcome.latencyMs, url },
        }),
      );
    }
    return {
      ok: true,
      body: {
        receiptId: receipt.id,
        offer: name,
        output: outcome.output,
        charged: { priceMicros: price.toString(), feeMicros: delivered.receipt.feeMicros.toString(), creditClass: delivered.receipt.creditClass },
        provider: agentRef(owner),
        latencyMs: outcome.latencyMs,
        receiptUrl: url,
        verdict: `POST /v1/receipts/${receipt.id}/verdict`,
      },
    };
  }

  const refunded = price > 0n;
  const retryFix: TeachingFix = { docs: DOCS, next: `Nothing was charged${refunded ? ' (the hold was refunded)' : ''}. Retry later, or find another offer: GET /v1/offers?q=${encodeURIComponent(offer.slug)}` };
  if (outcome.kind === 'output_invalid') {
    const errors = stripNul(outcome.errors.slice(0, 20));
    const failed = await failProxyReceipt(receipt.id, 'output_invalid', { reason: 'output_invalid', errors });
    inBackground(runEffects(failed.effects));
    await recordCall(offer.id, 'output_invalid', outcome.latencyMs);
    return {
      ok: false,
      status: 502,
      code: 'output_invalid',
      message: `${name} returned output that does not match its output schema; the call was refunded and recorded as a provider failure`,
      details: { receiptId: receipt.id, state: 'output_invalid', errors, receiptUrl: url, refunded, latencyMs: outcome.latencyMs },
      fix: retryFix,
    };
  }

  const failed = await failProxyReceipt(receipt.id, 'failed', { reason: outcome.reason });
  inBackground(runEffects(failed.effects));
  await recordCall(offer.id, outcome.kind, outcome.latencyMs);
  return {
    ok: false,
    status: 502,
    code: 'internal',
    message: 'The provider did not return a result',
    details: { receiptId: receipt.id, state: 'failed', reason: outcome.reason, providerStatus: outcome.status, receiptUrl: url, refunded, latencyMs: outcome.latencyMs },
    fix: retryFix,
  };
}

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------

/** A browser session must not spend: refuse it with a specific message before generic auth runs. */
const refuseSessions: MiddlewareHandler = async (c, next) => {
  const authz = c.req.header('Authorization');
  const signed = c.req.header('X-Agent-Signature') !== undefined || c.req.header('X-Agent-Id') !== undefined;
  if (!signed && authz && /^Bearer\s+/i.test(authz) && !authz.replace(/^Bearer\s+/i, '').trim().startsWith('ak_')) {
    return teach(c, 403, 'forbidden', 'Invoking spends credit, so a browser session cannot call it. Sign the request with the agent key, or use an API key with scope invoke.', {
      fix: { docs: DOCS, mcp: 'npx -y ans-mcp', next: 'Authorization: Bearer ak_... (scope invoke), or X-Agent-Id / X-Agent-Timestamp / X-Agent-Nonce / X-Agent-Signature' },
    });
  }
  return next();
};

const invokeBodyLimit = bodyLimit({
  maxSize: MAX_INVOKE_BYTES,
  onError: (c) => teach(c, 413, 'bad_request', `Request body is larger than ${MAX_INVOKE_BYTES} bytes`, { details: { maxBytes: MAX_INVOKE_BYTES }, fix: { docs: DOCS } }),
});

/** One execution per (agent, Idempotency-Key) at a time: a concurrent duplicate gets 409 instead of a second hold. */
async function acquireInFlight(agentId: string, key: string): Promise<() => Promise<void>> {
  const lockKey = `invoke:inflight:${agentId}:${sha256hex(key)}`;
  const hit = await consume(lockKey, 1, IN_FLIGHT_SEC);
  if (!hit.allowed) {
    throw new AnsError('conflict', 'A request with this Idempotency-Key is still running; retry in a few seconds to get its result', {
      details: { retryAfter: 2 },
      fix: { docs: DOCS, next: 'Resend the same request with the same Idempotency-Key shortly' },
    });
  }
  return async () => {
    await db.delete(rateLimits).where(eq(rateLimits.key, lockKey)).catch(() => undefined);
  };
}

invokeRouter.post('/', refuseSessions, invokeBodyLimit, requireAgent({ allow: ['signed', 'apikey'], scopes: ['invoke'] }), async (c) => {
  const auth = c.get('agent');
  const rawBody = await readRawBody(c, MAX_INVOKE_BYTES);
  const key = idempotencyKeyFrom(c);
  const release = key ? await acquireInFlight(auth.id, key) : null;
  try {
    return await withIdempotency(c, auth.id, key, async () => {
      let body: unknown;
      try {
        body = JSON.parse(rawBody);
      } catch {
        throw new AnsError('bad_request', 'Request body is not valid JSON', { fix: { docs: DOCS, next: 'POST /v1/invoke {"offer": "@handle/slug", "input": {...}}' } });
      }
      const result = await performInvoke({
        auth,
        body,
        rawBody,
        path: c.req.path,
        timestamp: auth.method === 'signed' ? c.req.header('X-Agent-Timestamp') ?? null : null,
        signature: auth.method === 'signed' ? c.req.header('X-Agent-Signature') ?? null : null,
      });
      if (result.ok) return c.json(withAns(result.body), 200);
      return teach(c, result.status, result.code, result.message, { details: result.details, fix: result.fix });
    });
  } catch (err) {
    if (err instanceof AnsError && err.code === 'rate_limited') {
      const retry = (err.details as { retryAfter?: number } | undefined)?.retryAfter;
      if (typeof retry === 'number') c.header('Retry-After', String(retry));
    }
    throw err;
  } finally {
    if (release) await release();
  }
});
