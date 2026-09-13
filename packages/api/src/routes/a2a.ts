import { Hono } from 'hono';
import { and, desc, eq } from 'drizzle-orm';
import { db } from '../db';
import { agents, offers } from '../db/schema';
import { config } from '../config';
import { resolveAgent } from '../lib/auth';
import { jsonAns, teach } from '../lib/errors';
import { ANS_VERSION } from '../lib/wellknown';
import { offerName, policyOf, publicAgentView, trustOf } from './agents';

/**
 * A2A agent cards (docs/DESIGN.md section 7 "A2A mapping"). The card is
 * generated from the agent's active offers: each skill carries
 * application/json input and output modes and an `x-ans` block with the
 * offer id, schema URLs, price and the owner's trust. The blind JSON-RPC
 * proxy is gone (section 10: SSRF, confused deputy).
 */

const a2aRouter = new Hono();

type AgentRow = typeof agents.$inferSelect;
type OfferRow = typeof offers.$inferSelect;

function skillFromOffer(agent: AgentRow, offer: OfferRow) {
  const handle = agent.handle ?? agent.id;
  const examples = (offer.examples ?? []).slice(0, 3).map((e) => JSON.stringify(e.input));
  return {
    id: offer.id,
    name: offer.title,
    description: offer.description ?? offer.title,
    tags: offer.tags ?? [],
    examples,
    inputModes: ['application/json'],
    outputModes: ['application/json'],
    'x-ans': {
      offerId: offer.id,
      name: offerName(agent.handle, offer.slug, offer.version),
      version: offer.version,
      inputSchemaUrl: `${config.publicApiUrl}/v1/offers/${offer.id}/input.json`,
      outputSchemaUrl: `${config.publicApiUrl}/v1/offers/${offer.id}/output.json`,
      priceMicros: offer.priceMicros.toString(),
      currency: 'USD',
      timeoutMs: offer.timeoutMs,
      invoke: `${config.publicApiUrl}/v1/invoke`,
      mcp: `${config.publicApiUrl}/mcp/offer/@${handle}/${offer.slug}`,
      trust: trustOf(agent),
    },
  };
}

/** Highest active version per slug, newest first. */
async function activeOffers(agentId: string): Promise<OfferRow[]> {
  const rows = await db
    .select()
    .from(offers)
    .where(and(eq(offers.agentId, agentId), eq(offers.status, 'active')))
    .orderBy(desc(offers.version), desc(offers.createdAt));
  const bySlug = new Map<string, OfferRow>();
  for (const r of rows) if (!bySlug.has(r.slug)) bySlug.set(r.slug, r);
  return Array.from(bySlug.values());
}

export async function buildAgentCard(agent: AgentRow) {
  const offerRows = await activeOffers(agent.id);
  const handle = agent.handle ?? agent.id;
  return {
    name: agent.name,
    description: agent.description ?? `${agent.name} (${agent.type} agent registered on ANS)`,
    url: agent.endpoint ?? `${config.publicWebUrl}/agent/${agent.id}`,
    provider: {
      organization: agent.operatorName ?? agent.name,
      url: agent.homepage ?? `${config.publicWebUrl}/agent/${agent.id}`,
    },
    version: ANS_VERSION,
    documentationUrl: `${config.publicWebUrl}/agent/${agent.id}`,
    capabilities: {
      streaming: (agent.protocols ?? []).includes('websocket'),
      pushNotifications: false,
      stateTransitionHistory: false,
    },
    authentication: {
      schemes: ['ans-signed'],
      credentials: 'X-Agent-Id, X-Agent-Timestamp, X-Agent-Nonce, X-Agent-Signature (Ed25519 over `${METHOD}:${pathname}:${timestamp}:${body}`); public keys resolve at ' + `${config.publicApiUrl}/v1/agents/${agent.id}`,
    },
    defaultInputModes: ['application/json'],
    defaultOutputModes: ['application/json'],
    skills: offerRows.map((o) => skillFromOffer(agent, o)),
    'x-ans': {
      id: agent.id,
      handle: agent.handle,
      type: agent.type,
      status: agent.status,
      protocols: agent.protocols ?? [],
      tags: agent.tags ?? [],
      publicKey: agent.publicKey,
      trust: trustOf(agent),
      receiptCounts: publicAgentView(agent).receiptCounts,
      policy: policyOf(agent),
      registeredAt: agent.createdAt,
      verify: `${config.publicApiUrl}/v1/verify/${handle}`,
      receipts: `${config.publicApiUrl}/v1/agents/${agent.id}/receipts`,
      mcp: `${config.publicApiUrl}/mcp/agent/@${handle}`,
    },
  };
}

// GET /v1/a2a/agent/:id/agent-card.json (id or handle)
a2aRouter.get('/agent/:id/agent-card.json', async (c) => {
  const agent = await resolveAgent(c.req.param('id'));
  if (!agent) return teach(c, 404, 'not_found', `Agent ${c.req.param('id')} not found`);
  c.header('Cache-Control', 'public, max-age=60');
  return c.json(await buildAgentCard(agent));
});

// The old path 301s to the new card
a2aRouter.get('/agent/:id/agent.json', (c) => {
  return c.redirect(`/v1/a2a/agent/${encodeURIComponent(c.req.param('id'))}/agent-card.json`, 301);
});

// GET /v1/a2a/agents: registry-wide discovery in card-summary form
a2aRouter.get('/agents', async (c) => {
  const limit = Math.min(Math.max(parseInt(c.req.query('limit') ?? '50', 10) || 50, 1), 100);
  const offset = Math.max(parseInt(c.req.query('offset') ?? '0', 10) || 0, 0);
  const rows = await db
    .select()
    .from(agents)
    .where(and(eq(agents.isSeed, false), eq(agents.isHouse, false)))
    .orderBy(desc(agents.trustRank), desc(agents.createdAt))
    .limit(limit)
    .offset(offset);

  return jsonAns(c, {
    agents: rows.map((agent) => ({
      name: agent.name,
      description: agent.description ?? `${agent.name} (${agent.type} agent registered on ANS)`,
      url: agent.endpoint ?? `${config.publicWebUrl}/agent/${agent.id}`,
      provider: { organization: agent.operatorName ?? agent.name },
      agentCard: `${config.publicApiUrl}/v1/a2a/agent/${agent.id}/agent-card.json`,
      'x-ans': { id: agent.id, handle: agent.handle, type: agent.type, status: agent.status, trust: trustOf(agent) },
    })),
    total: rows.length,
    limit,
    offset,
  });
});

export { a2aRouter };
