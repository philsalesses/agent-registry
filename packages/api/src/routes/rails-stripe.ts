import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { ANS_BLOCK } from 'ans-core';
import { config } from '../config';
import { teach } from '../lib/errors';
import { CARD_TOPUPS_DISABLED_REASON, constructStripeEvent, handleStripeEvent, type StripeEventResult } from '../lib/rails-stripe';

/**
 * Stripe rail webhook (docs/DESIGN.md section 4 "Money", sprint item 18). Mounted at /v1/rails/stripe.
 *
 *   POST /webhook  no ANS auth; the Stripe-Signature header is verified over
 *                  the raw request text with STRIPE_WEBHOOK_SECRET. 503 while
 *                  STRIPE_ENABLED is off, 400 invalid_signature on a missing
 *                  or bad signature, 413 above 1 MB, else 200 {received: true, ...result}.
 *
 * Subscribe the endpoint to checkout.session.completed,
 * checkout.session.async_payment_succeeded, charge.refunded and
 * charge.dispute.created. Other events are acknowledged and ignored.
 */

/** Stripe event payloads are a few KB; the body is read before its signature can be checked, so cap it. */
export const STRIPE_WEBHOOK_MAX_BYTES = 1024 * 1024;

export interface StripeRouterDeps {
  enabled?: () => boolean;
  webhookSecret?: () => string | undefined;
  handle?: (event: unknown) => Promise<StripeEventResult>;
}

export function createStripeRouter(deps: StripeRouterDeps = {}): Hono {
  const enabled = deps.enabled ?? (() => config.stripeEnabled);
  const webhookSecret = deps.webhookSecret ?? (() => config.stripeWebhookSecret);
  const handle = deps.handle ?? handleStripeEvent;
  const fix = () => ({ docs: ANS_BLOCK.docs, url: `${config.publicWebUrl}/docs/money` });

  const router = new Hono();

  const tooLarge = (c: Context) => teach(c, 413, 'bad_request', `Webhook payload is larger than ${STRIPE_WEBHOOK_MAX_BYTES} bytes`, { fix: fix() });
  // Content-Length over the cap is refused up front; a chunked body that grows past it fails the read below.
  const limit = bodyLimit({ maxSize: STRIPE_WEBHOOK_MAX_BYTES, onError: tooLarge });

  router.post('/webhook', limit, async (c) => {
    if (!enabled()) {
      return teach(c, 503, 'not_implemented', `${CARD_TOPUPS_DISABLED_REASON} The Stripe webhook is off.`, { fix: fix() });
    }
    const secret = webhookSecret();
    if (!secret) {
      return teach(c, 503, 'not_implemented', 'STRIPE_WEBHOOK_SECRET is not configured', { fix: fix() });
    }
    const signature = c.req.header('Stripe-Signature');
    if (!signature) {
      return teach(c, 400, 'invalid_signature', 'Missing Stripe-Signature header', { fix: fix() });
    }
    let rawBody: string;
    try {
      rawBody = await c.req.text();
    } catch (err) {
      if (err instanceof Error && err.name === 'BodyLimitError') return tooLarge(c);
      throw err;
    }
    let event: unknown;
    try {
      event = constructStripeEvent(rawBody, signature, secret);
    } catch (err) {
      return teach(c, 400, 'invalid_signature', 'Stripe-Signature does not verify for this payload', {
        details: { reason: err instanceof Error ? err.message : String(err) },
        fix: fix(),
      });
    }
    const result = await handle(event);
    return c.json({ received: true, ...result });
  });

  return router;
}

export const stripeRouter = createStripeRouter();
export default stripeRouter;
