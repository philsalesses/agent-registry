import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { agentsRouter } from './routes/agents';
import { capabilitiesRouter } from './routes/capabilities';
import { attestationsRouter } from './routes/attestations';
import { discoveryRouter } from './routes/discovery';
import { authRouter } from './routes/auth';
import { reputationRouter } from './routes/reputation';

export function createApp() {
  const app = new Hono();

  // Middleware
  app.use('*', logger());
  app.use('*', cors());

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

  // 404 handler
  app.notFound((c) => c.json({ error: 'Not found' }, 404));

  // Error handler
  app.onError((err, c) => {
    console.error('API Error:', err);
    return c.json({ error: 'Internal server error' }, 500);
  });

  return app;
}
