import { Hono, type MiddlewareHandler } from 'hono';
import { z } from 'zod';
import { AnsError, RATING_TAGS, formatUsd } from 'ans-core';
import { receiptMissingSvg, receiptStripSvg } from '../lib/badges';
import { config } from '../config';
import { requireAgent, type AuthAgent } from '../lib/auth';
import { jsonAns } from '../lib/errors';
import { idempotencyKeyFrom, withIdempotency } from '../lib/idempotency';
import { clientIp } from '../lib/ratelimit';
import { recordFunnel } from '../lib/funnel';
import {
  acceptReceipt,
  canView,
  cancelReceipt,
  claimReceipt,
  declineReceipt,
  deliverReceipt,
  disputeReceipt,
  getReceiptRow,
  listForAgent,
  listRecent,
  openReceipt,
  rateReceipt,
  receiptUrl,
  runEffects,
  signingTemplates,
  toWire,
  verdictReceipt,
  agentForParam,
  type Actor,
  type ReceiptRow,
} from '../lib/receipts';

/**
 * Receipts API (docs/DESIGN.md section 4 "Receipts").
 * Signed and session callers sign every canonical string with their key;
 * API-key callers may let the registry attest instead.
 */

export const receiptsRouter = new Hono();

const writeAuth = requireAgent({ allow: ['signed', 'session', 'apikey'], scopes: ['receipts'] });
const readAuth = requireAgent({ allow: ['signed', 'session', 'apikey'], scopes: ['read'] });

/** Authenticate when credentials are present; stay anonymous otherwise. */
const maybeAgent: MiddlewareHandler = async (c, next) => {
  const has = c.req.header('Authorization') || c.req.header('X-Agent-Id') || c.req.header('X-Agent-Signature');
  if (!has) return next();
  return readAuth(c, next);
};

const maybeWriteAgent: MiddlewareHandler = async (c, next) => {
  const has = c.req.header('Authorization') || c.req.header('X-Agent-Id') || c.req.header('X-Agent-Signature');
  if (!has) return next();
  return writeAuth(c, next);
};

function actorOf(auth: AuthAgent): Actor {
  return { id: auth.id, method: auth.method, keyId: auth.keyId };
}

async function one(row: ReceiptRow, events = true) {
  const [wire] = await toWire([row], { events });
  return wire;
}

const sig = z.string().min(1).max(200).optional().nullable();

const STATE_LABELS: Record<string, string> = {
  resolved_client: 'refunded',
  resolved_provider: 'upheld',
  timed_out: 'timed out',
  output_invalid: 'bad output',
  cancelled_client: 'cancelled',
  cancelled_provider: 'cancelled',
};

const openSchema = z.object({
  role: z.enum(['client', 'provider']),
  counterparty: z.union([
    z.object({ agentId: z.string().min(3).max(64) }).strict(),
    z.object({ hint: z.object({ name: z.string().min(1).max(80), url: z.string().max(2048).optional().nullable(), contact: z.string().max(320).optional().nullable() }).strict() }).strict(),
  ]),
  task: z.string().min(1).max(400),
  offerId: z.string().max(64).optional().nullable(),
  inputHash: z.string().max(64).optional().nullable(),
  priceMicros: z.union([z.string(), z.number().int()]).optional().nullable(),
  creditClass: z.enum(['sandbox', 'cash', 'none']).optional().nullable(),
  deadlineAt: z.string().min(10).max(40),
  reviewWindowSec: z.number().int().optional().nullable(),
  feeBps: z.number().int().optional().nullable(),
  openNonce: z.string().min(8).max(128),
  signature: sig,
  initiatorSig: sig,
});

receiptsRouter.post('/', writeAuth, async (c) => {
  const auth = c.get('agent');
  return withIdempotency(c, auth.id, idempotencyKeyFrom(c), async () => {
    const body = openSchema.parse(await c.req.json());
    const result = await openReceipt({
      actor: actorOf(auth),
      role: body.role,
      counterparty: body.counterparty,
      task: body.task,
      offerId: body.offerId,
      inputHash: body.inputHash,
      priceMicros: body.priceMicros === undefined || body.priceMicros === null ? '0' : String(body.priceMicros),
      creditClass: body.creditClass,
      deadlineAt: body.deadlineAt,
      reviewWindowSec: body.reviewWindowSec,
      feeBps: body.feeBps,
      openNonce: body.openNonce,
      initiatorSig: body.signature ?? body.initiatorSig,
    });
    await runEffects(result.effects);
    const claimUrl = result.claimToken ? `${config.publicWebUrl}/r/${result.receipt.id}?claim=${result.claimToken}` : null;
    return jsonAns(
      c,
      {
        receipt: await one(result.receipt),
        terms: { canonical: result.canonical, hash: result.termsHash },
        url: receiptUrl(result.receipt.id),
        claimUrl,
        claimToken: result.claimToken,
        replayed: result.replayed,
        next: claimUrl
          ? { share: `Send this link to ${'hint' in body.counterparty ? body.counterparty.hint.name : 'the counterparty'} so they can confirm the receipt: ${claimUrl}` }
          : { waitFor: 'receipt.opened (webhook or GET /v1/receipts/' + result.receipt.id + ')' },
      },
      result.replayed ? 200 : 201,
    );
  });
});

receiptsRouter.get('/', maybeAgent, async (c) => {
  const limit = Math.min(Math.max(parseInt(c.req.query('limit') ?? '20', 10) || 20, 1), 100);
  const cursor = c.req.query('cursor') ?? null;
  const agentParam = c.req.query('agent');
  if (agentParam) {
    const agent = await agentForParam(agentParam);
    const role = c.req.query('role');
    const state = c.req.query('state');
    const list = await listForAgent(agent.id, {
      role: role === 'client' || role === 'provider' ? role : null,
      state: (state as never) ?? null,
      cursor,
      limit,
    });
    return jsonAns(c, list);
  }
  c.header('Cache-Control', 'public, max-age=10');
  return jsonAns(c, await listRecent({ limit, cursor }));
});

receiptsRouter.get('/:id', maybeAgent, async (c) => {
  const row = await getReceiptRow(c.req.param('id'));
  const claim = c.req.query('claim') ?? c.req.header('X-Claim-Token') ?? null;
  const viewer = (c.get('agent') as AuthAgent | undefined)?.id ?? null;
  if (!row || !canView(row, viewer, claim)) {
    throw new AnsError('not_found', `Receipt ${c.req.param('id')} not found`);
  }
  void recordFunnel(claim ? 'claim.opened' : 'receipt.viewed', { receiptId: row.id, agentId: viewer, ip: clientIp(c) });
  if (!claim && !viewer) c.header('Cache-Control', 'public, max-age=10');
  const receipt = await one(row, true);
  return jsonAns(c, { receipt, claimable: !!claim && row.state === 'proposed' && !!row.claimTokenHash });
});

/** GET /v1/receipts/:id/badge.svg: a torn receipt strip to embed next to the work it covers */
receiptsRouter.get('/:id/badge.svg', async (c) => {
  const id = c.req.param('id');
  const row = await getReceiptRow(id);
  const headers = { 'Content-Type': 'image/svg+xml', 'X-Content-Type-Options': 'nosniff' };
  if (!row || !canView(row, null, null)) {
    return new Response(receiptMissingSvg(id.replace(/[^A-Za-z0-9_]/g, '')), { status: 404, headers: { ...headers, 'Cache-Control': 'public, max-age=60' } });
  }
  const receipt = await one(row, false);
  const party = (p: typeof receipt.client, hint: string) => (p ? (p.handle ? `@${p.handle}` : p.name) : hint);
  const svg = receiptStripSvg({
    id: receipt.id,
    provider: party(receipt.provider, receipt.counterpartyHint?.name ?? 'provider'),
    client: party(receipt.client, receipt.counterpartyHint?.name ?? 'client'),
    state: receipt.state,
    stateLabel: STATE_LABELS[receipt.state] ?? receipt.state.replace(/_/g, ' '),
    price: receipt.priceMicros === '0' ? 'free' : formatUsd(receipt.priceMicros),
  });
  void recordFunnel('receipt.viewed', { receiptId: row.id, src: 'badge', ip: clientIp(c) });
  return new Response(svg, { headers: { ...headers, 'Cache-Control': `public, max-age=${receipt.hash ? 3600 : 60}` } });
});

receiptsRouter.get('/:id/signing', maybeAgent, async (c) => {
  const row = await getReceiptRow(c.req.param('id'));
  const viewer = (c.get('agent') as AuthAgent | undefined)?.id ?? null;
  const claim = c.req.query('claim') ?? null;
  if (!row || !canView(row, viewer, claim)) throw new AnsError('not_found', `Receipt ${c.req.param('id')} not found`);
  return jsonAns(c, signingTemplates(row, c.req.query('as') ?? viewer));
});

receiptsRouter.post('/:id/accept', writeAuth, async (c) => {
  const body = z.object({ signature: sig }).parse(await c.req.json().catch(() => ({})));
  const { receipt, effects } = await acceptReceipt({ actor: actorOf(c.get('agent')), receiptId: c.req.param('id'), signature: body.signature });
  await runEffects(effects);
  return jsonAns(c, { receipt: await one(receipt) });
});

receiptsRouter.post('/:id/claim', writeAuth, async (c) => {
  const body = z.object({ claimToken: z.string().min(8).max(128), signature: sig }).parse(await c.req.json());
  const auth = c.get('agent');
  const { receipt, effects } = await claimReceipt({ actor: actorOf(auth), receiptId: c.req.param('id'), claimToken: body.claimToken, signature: body.signature });
  await runEffects(effects);
  void recordFunnel('claim.confirmed', { receiptId: receipt.id, agentId: auth.id, ip: clientIp(c) });
  return jsonAns(c, { receipt: await one(receipt) });
});

receiptsRouter.post('/:id/decline', maybeWriteAgent, async (c) => {
  const body = z.object({ claimToken: z.string().max(128).optional().nullable() }).parse(await c.req.json().catch(() => ({})));
  const auth = c.get('agent') as AuthAgent | undefined;
  const { receipt, effects } = await declineReceipt({ actor: auth ? actorOf(auth) : null, receiptId: c.req.param('id'), claimToken: body.claimToken });
  await runEffects(effects);
  return jsonAns(c, { receipt: { id: receipt.id, state: receipt.state } });
});

receiptsRouter.post('/:id/deliver', writeAuth, async (c) => {
  const body = z.object({ outputHash: z.string().min(64).max(64), outputUrl: z.string().max(2048).optional().nullable(), signature: sig }).parse(await c.req.json());
  const { receipt, effects } = await deliverReceipt({ actor: actorOf(c.get('agent')), receiptId: c.req.param('id'), ...body });
  await runEffects(effects);
  return jsonAns(c, { receipt: await one(receipt) });
});

const ratingSchema = z.object({
  score: z.number().int().min(0).max(100),
  tags: z.array(z.enum(RATING_TAGS)).max(6).optional().nullable(),
  note: z.string().max(500).optional().nullable(),
  signature: sig,
});

receiptsRouter.post('/:id/verdict', writeAuth, async (c) => {
  const body = z
    .object({ verdict: z.enum(['accept', 'reject']), reason: z.string().max(1000).optional().nullable(), rating: ratingSchema.optional().nullable(), signature: sig })
    .parse(await c.req.json());
  const { receipt, effects } = await verdictReceipt({ actor: actorOf(c.get('agent')), receiptId: c.req.param('id'), ...body });
  await runEffects(effects);
  return jsonAns(c, { receipt: await one(receipt) });
});

receiptsRouter.post('/:id/rate', writeAuth, async (c) => {
  const body = ratingSchema.parse(await c.req.json());
  const result = await rateReceipt({ actor: actorOf(c.get('agent')), receiptId: c.req.param('id'), ...body });
  await runEffects(result.effects);
  return jsonAns(c, { receipt: await one(result.receipt), revealed: result.revealed });
});

receiptsRouter.post('/:id/dispute', writeAuth, async (c) => {
  const body = z
    .object({ reason: z.string().min(1).max(2000), evidence: z.array(z.object({ url: z.string().max(2048), hash: z.string().max(64).optional().nullable() })).max(5).optional().nullable() })
    .parse(await c.req.json());
  const { receipt, effects } = await disputeReceipt({ actor: actorOf(c.get('agent')), receiptId: c.req.param('id'), ...body });
  await runEffects(effects);
  return jsonAns(c, { receipt: await one(receipt) });
});

receiptsRouter.post('/:id/cancel', writeAuth, async (c) => {
  const body = z.object({ reason: z.string().max(1000).optional().nullable() }).parse(await c.req.json().catch(() => ({})));
  const { receipt, effects } = await cancelReceipt({ actor: actorOf(c.get('agent')), receiptId: c.req.param('id'), reason: body.reason });
  await runEffects(effects);
  return jsonAns(c, { receipt: await one(receipt) });
});
