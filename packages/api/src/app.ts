import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { rateLimit } from './middleware/rateLimit';
import { agentsRouter } from './routes/agents';
import { capabilitiesRouter } from './routes/capabilities';
import { attestationsRouter } from './routes/attestations';
import { discoveryRouter } from './routes/discovery';
import { authRouter } from './routes/auth';
import { reputationRouter } from './routes/reputation';
import { claimRouter } from './routes/claim';
import { a2aRouter } from './routes/a2a';
import { mcpRouter } from './routes/mcp';
import { webhooksRouter } from './routes/webhooks';
import { analyticsRouter } from './routes/analytics';

export function createApp() {
  const app = new Hono();

  // Middleware
  app.use('*', logger());
  app.use('*', cors({
    origin: ['https://ans-registry.org', 'https://web-gold-beta-31.vercel.app', 'http://localhost:3000'],
    allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'X-Agent-Signature', 'X-Agent-Timestamp'],
  }));
  app.use('*', rateLimit);

  // Health check
  app.get('/', (c) => c.json({ 
    name: 'AgentRegistry API',
    version: '0.1.0',
    status: 'ok',
  }));

  app.get('/health', (c) => c.json({ status: 'ok' }));

  // Routes
  app.route('/v1/agents', agentsRouter);
  app.route('/v1/capabilities', capabilitiesRouter);
  app.route('/v1/attestations', attestationsRouter);
  app.route('/v1/discover', discoveryRouter);
  app.route('/v1/auth', authRouter);
  app.route('/v1/reputation', reputationRouter);
  app.route('/v1/claim', claimRouter);
  
  // Protocol-specific endpoints
  app.route('/v1/a2a', a2aRouter);   // Google A2A
  app.route('/v1/mcp', mcpRouter);   // Anthropic MCP
  app.route('/v1/webhooks', webhooksRouter);
  app.route('/v1/analytics', analyticsRouter);

  // 404 handler
  app.notFound((c) => c.json({ error: 'Not found' }, 404));

  // Error handler
  app.onError((err, c) => {
    console.error('API Error:', err);
    return c.json({ error: 'Internal server error' }, 500);
  });

  return app;
}
