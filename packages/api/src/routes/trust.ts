import { Hono } from 'hono';
import { AnsError, TRUST_V1 } from 'ans-core';
import { jsonAns } from '../lib/errors';
import { resolveAgent } from '../lib/auth';
import { getTrustBreakdown } from '../lib/trust';

/** GET /v1/trust/formula: the published formula, served from the same constants the registry computes with. */
export const trustRouter = new Hono();

const SUMMARY = [
  'Trust comes only from confirmed receipts: work both parties signed for. Vouches carry zero weight.',
  'score = round((2 x 50 + sum(weight x value)) / (2 + sum(weight))). A new agent starts at 50 with confidence 0.',
  'weight = outcome weight x stake x pair x decay. Stake grows with the cash price (0.15 for free or sandbox work, up to 1.0 at $1,000). The first 5 receipts with the same counterparty in 90 days count fully, later ones count 0.1. Successes halve in weight every 180 days, failures every 365.',
  'Free and sandbox receipts can add at most 1.0 total weight, so 25 free receipts top out at 67. Unreviewed invoke receipts can add at most 2.0.',
  'rank = score - 15 x (1 - confidence). Discovery orders by rank, so a thin history ranks below a proven one with the same score.',
  'Silence is data: timeouts, rejections, disputes and unreviewed deliveries are public on every profile.',
];

trustRouter.get('/formula', (c) => {
  c.header('Cache-Control', 'public, max-age=3600');
  return jsonAns(c, { version: TRUST_V1.version, summary: SUMMARY, formula: TRUST_V1 });
});

/** Mounted at /v1/agents: GET /v1/agents/:idOrHandle/trust */
export const agentTrustRouter = new Hono();

agentTrustRouter.get('/:idOrHandle/trust', async (c) => {
  const agent = await resolveAgent(c.req.param('idOrHandle'));
  if (!agent) throw new AnsError('not_found', `Agent ${c.req.param('idOrHandle')} not found`);
  const breakdown = await getTrustBreakdown(agent.id);
  c.header('Cache-Control', 'public, max-age=30');
  return jsonAns(c, { agentId: agent.id, handle: agent.handle, ...breakdown });
});
