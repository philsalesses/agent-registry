import { Hono } from 'hono';
import { jsonAns } from '../lib/errors';
import { registryTotals } from '../lib/receipts';

/** GET /v1/registry/totals: the numbers on the footer stub and home page */
export const registryRouter = new Hono();

registryRouter.get('/totals', async (c) => {
  c.header('Cache-Control', 'public, max-age=60');
  return jsonAns(c, await registryTotals());
});
