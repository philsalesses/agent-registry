import { Hono } from 'hono';
import { jsonAns } from '../lib/errors';
import { agentForParam, listForAgent, verifyAgentChain } from '../lib/receipts';

/** GET /v1/agents/:idOrHandle/receipts and /receipts/verify */
export const agentReceiptsRouter = new Hono();

agentReceiptsRouter.get('/:idOrHandle/receipts', async (c) => {
  const agent = await agentForParam(c.req.param('idOrHandle'));
  const role = c.req.query('role');
  const limit = Math.min(Math.max(parseInt(c.req.query('limit') ?? '20', 10) || 20, 1), 100);
  const list = await listForAgent(agent.id, {
    role: role === 'client' || role === 'provider' ? role : null,
    state: (c.req.query('state') as never) ?? null,
    cursor: c.req.query('cursor') ?? null,
    limit,
  });
  c.header('Cache-Control', 'public, max-age=10');
  return jsonAns(c, { agentId: agent.id, handle: agent.handle, ...list });
});

agentReceiptsRouter.get('/:idOrHandle/receipts/verify', async (c) => {
  const agent = await agentForParam(c.req.param('idOrHandle'));
  c.header('Cache-Control', 'public, max-age=30');
  return jsonAns(c, await verifyAgentChain(agent.id));
});
