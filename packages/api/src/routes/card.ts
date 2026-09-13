import { Hono } from 'hono';
import { db } from '../db';
import { agents } from '../db/schema';
import { config } from '../config';
import { resolveAgent } from '../lib/auth';
import { jsonAns, teach } from '../lib/errors';
import { receiptCountsOf, trustOf } from './agents';
import { agentFlatSvg, agentRecordSvg, escapeXml } from '../lib/badges';

/**
 * Embeddable SVG badges. The badge shows the materialized trust score and
 * its confidence (docs/DESIGN.md section 5: a 50 at confidence 0 must look
 * different from a 50 at confidence 0.9). No local trust computation.
 */

const cardRouter = new Hono();

type AgentRow = typeof agents.$inferSelect;
type CardStyle = 'flat' | 'flat-square' | 'badge';

export interface CardInput {
  name: string;
  handle: string | null;
  score: number;
  confidence: number;
  confirmed: number;
  type: string;
  isHouse?: boolean;
}

export function generateAgentCardSvg(agent: CardInput, style: CardStyle = 'flat'): string {
  if (style === 'badge') return agentRecordSvg(agent);
  return agentFlatSvg(agent, style === 'flat-square');
}

function cardInput(agent: AgentRow): CardInput {
  const trust = trustOf(agent);
  return {
    name: agent.name,
    handle: agent.handle,
    score: trust.score,
    confidence: trust.confidence,
    confirmed: receiptCountsOf(agent).confirmed,
    type: agent.type,
    isHouse: agent.isHouse,
  };
}

function parseStyle(s: string | undefined): CardStyle {
  return s === 'flat-square' || s === 'badge' ? s : 'flat';
}

// GET /v1/agents/:id/card?style=flat|flat-square|badge&format=svg
cardRouter.get('/:id/card', async (c) => {
  const agent = await resolveAgent(c.req.param('id'));
  if (!agent) return teach(c, 404, 'not_found', `Agent ${c.req.param('id')} not found`);
  const style = parseStyle(c.req.query('style'));
  const format = c.req.query('format') ?? 'svg';
  const svg = generateAgentCardSvg(cardInput(agent), style);

  if (format !== 'svg') {
    return teach(c, 400, 'bad_request', 'Only format=svg is available', { details: { svg } });
  }
  return new Response(svg, {
    headers: {
      'Content-Type': 'image/svg+xml',
      'Cache-Control': 'public, max-age=300',
    },
  });
});

// GET /v1/agents/:id/card/embed
cardRouter.get('/:id/card/embed', async (c) => {
  const agent = await resolveAgent(c.req.param('id'));
  if (!agent) return teach(c, 404, 'not_found', `Agent ${c.req.param('id')} not found`);
  const style = parseStyle(c.req.query('style'));
  const cardUrl = `${config.publicApiUrl}/v1/agents/${agent.id}/card?style=${style}`;
  const profileUrl = `${config.publicWebUrl}/agent/${agent.handle ?? agent.id}`;
  const alt = `${agent.name} on ANS: trust ${trustOf(agent).score}`;
  return jsonAns(c, {
    cardUrl,
    profileUrl,
    markdown: `[![${alt}](${cardUrl})](${profileUrl})`,
    html: `<a href="${profileUrl}"><img src="${cardUrl}" alt="${escapeXml(alt)}" /></a>`,
    bbcode: `[url=${profileUrl}][img]${cardUrl}[/img][/url]`,
  });
});

export { cardRouter };
