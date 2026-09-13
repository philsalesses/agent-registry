import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { requestId } from 'hono/request-id';
import { bodyLimit } from 'hono/body-limit';
import { config } from './config';
import { onError, notFound, teach, withAns } from './lib/errors';
import { rejectPrivateKeyHeader } from './lib/auth';
import { globalRateLimit } from './lib/ratelimit';
import { wellKnownRouter, skillRedirect, ANS_VERSION } from './lib/wellknown';

// Existing routers (rewritten by the routes agent; mounts unchanged)
import { agentsRouter } from './routes/agents';
import { capabilitiesRouter } from './routes/capabilities';
import { attestationsRouter } from './routes/attestations';
import { discoveryRouter } from './routes/discovery';
import { authRouter } from './routes/auth';
import { reputationRouter } from './routes/reputation';
import { a2aRouter } from './routes/a2a';
import { mcpRouter as legacyMcpRouter } from './routes/mcp';
import { webhooksRouter } from './routes/webhooks';
import { analyticsRouter } from './routes/analytics';
import { cardRouter } from './routes/card';
import { notificationsRouter } from './routes/notifications';
import { messagesRouter } from './routes/messages';
import { docsRouter } from './routes/docs';
import channelsRouter from './routes/channels';

// New routers (docs/DESIGN.md section 4). Each stub answers 501 not_implemented
// until the module agent swaps the import for the real router.
import { receiptsRouter } from './routes/receipts';
import { agentReceiptsRouter } from './routes/agent-receipts';
import { registryRouter } from './routes/registry';
import { offersRouter } from './routes/offers';
import { invokeRouter } from './routes/invoke';
import { walletRouter } from './routes/wallet';
import { verifyRouter } from './routes/verify';
import { trustRouter, agentTrustRouter } from './routes/trust';
import { adminRouter } from './routes/admin';
import { mcpRouter } from './routes/mcp-http';
import { stripeRouter } from './routes/rails-stripe';
import { ledgerRouter } from './routes/ledger';
import { adminPayoutsRouter } from './routes/admin-payouts';

/** Exactly the headers a signed, session, api-key, idempotent or admin request may carry. */
export const CORS_ALLOW_HEADERS = [
  'Content-Type',
  'Authorization',
  'X-Agent-Id',
  'X-Agent-Timestamp',
  'X-Agent-Nonce',
  'X-Agent-Signature',
  'Idempotency-Key',
  'X-Admin-Secret',
  'Mcp-Protocol-Version',
  'Mcp-Session-Id',
  'Last-Event-ID',
];

export function createApp() {
  const app = new Hono();

  // Per-request id (honours an incoming X-Request-Id, else generates one) and echo it back
  app.use('*', requestId({ limitLength: 64 }));
  app.use('*', async (c, next) => {
    await next();
    c.header('X-Request-Id', c.get('requestId'));
  });
  if (process.env.ANS_QUIET !== '1') app.use('*', logger());

  app.use('*', cors({
    origin: config.corsOrigins,
    allowMethods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowHeaders: CORS_ALLOW_HEADERS,
    exposeHeaders: ['X-Request-Id', 'Link', 'Retry-After', 'X-RateLimit-Limit', 'X-RateLimit-Remaining', 'X-RateLimit-Reset', 'Idempotent-Replayed', 'Mcp-Session-Id'],
    maxAge: 600,
  }));

  // Never accept a private key, on any route
  app.use('*', rejectPrivateKeyHeader);

  // Bodies are small JSON: cap them before any route reads one to check a signature
  app.use('*', bodyLimit({
    maxSize: 1024 * 1024,
    onError: (c) => teach(c, 413, 'bad_request', 'Request body is larger than 1 MB', { fix: { docs: `${config.publicWebUrl}/skill.md`, next: 'Send hashes or URLs for large payloads, not the payload itself' } }),
  }));

  // Global limit: 300/min per client IP (Postgres-backed)
  app.use('*', globalRateLimit());

  // Health and root
  app.get('/', (c) => c.json(withAns({
    name: 'ANS API',
    description: 'Receipts and trust for agent work',
    version: ANS_VERSION,
    status: 'ok',
    wellKnown: `${config.publicApiUrl}/.well-known/ans.json`,
  })));
  app.get('/health', (c) => c.json({ status: 'ok', version: ANS_VERSION }));

  // Protocol surfaces
  app.route('/.well-known', wellKnownRouter);
  app.get('/skill.md', skillRedirect);

  // Identity and auth
  app.route('/v1/agents', agentsRouter);
  app.route('/v1/agents', cardRouter); // /v1/agents/:id/card
  app.route('/v1/auth', authRouter);
  app.route('/v1/verify', verifyRouter);
  app.route('/v1/trust', trustRouter);
  app.route('/v1/agents', agentTrustRouter); // /v1/agents/:id/trust

  // Receipts, offers, invocation
  app.route('/v1/receipts', receiptsRouter);
  app.route('/v1/agents', agentReceiptsRouter); // /v1/agents/:id/receipts, /receipts/verify
  app.route('/v1/registry', registryRouter);
  app.route('/v1/offers', offersRouter);
  app.route('/v1/invoke', invokeRouter);

  // Money
  app.route('/v1/wallet', walletRouter);
  app.route('/v1/ledger', ledgerRouter);
  app.route('/v1/rails/stripe', stripeRouter);

  // Admin (payouts first: the admin router's catch-all middleware must not shadow it)
  app.route('/v1/admin/payouts', adminPayoutsRouter);
  app.route('/v1/admin', adminRouter);

  // Catalog, vouches, discovery, social
  app.route('/v1/capabilities', capabilitiesRouter);
  app.route('/v1/attestations', attestationsRouter);
  app.route('/v1/discover', discoveryRouter);
  app.route('/v1/reputation', reputationRouter);
  app.route('/v1/notifications', notificationsRouter);
  app.route('/v1/messages', messagesRouter);
  app.route('/v1/channels', channelsRouter);
  app.route('/v1/webhooks', webhooksRouter);
  app.route('/v1/analytics', analyticsRouter);

  // Protocol surfaces
  app.route('/mcp', mcpRouter); // Streamable HTTP MCP (registry, /mcp/agent/@h, /mcp/offer/@h/slug)
  app.route('/v1/mcp', legacyMcpRouter); // 410 with a pointer at /mcp and npx -y ans-mcp (30 days)
  app.route('/v1/a2a', a2aRouter);

  // Docs
  app.route('/docs', docsRouter);

  app.notFound(notFound);
  app.onError(onError);

  return app;
}
