import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { db } from '../db';
import { agents, agentCapabilities, capabilities } from '../db/schema';

/**
 * Google A2A (Agent-to-Agent) Protocol Support
 * Spec: https://google.github.io/A2A/
 * 
 * Provides:
 * - Agent Card discovery (/.well-known/agent.json format)
 * - Agent Card lookup by ID
 * - Registry-wide agent discovery
 */

const a2aRouter = new Hono();

/**
 * Get Agent Card for a specific agent (A2A format)
 * This is what other agents fetch to discover capabilities
 */
a2aRouter.get('/agent/:id/agent.json', async (c) => {
  const agentId = c.req.param('id');
  
  const agent = await db.query.agents.findFirst({
    where: eq(agents.id, agentId),
  });

  if (!agent) {
    return c.json({ error: 'Agent not found' }, 404);
  }

  // Get agent's capabilities
  const agentCaps = await db.query.agentCapabilities.findMany({
    where: eq(agentCapabilities.agentId, agentId),
  });

  // Build A2A Agent Card
  const agentCard = {
    // Required fields
    name: agent.name,
    description: agent.description || `${agent.name} - ${agent.type} agent`,
    url: agent.endpoint || `https://agentregistry.ai/agent/${agent.id}`,
    
    // Provider info
    provider: {
      organization: agent.operatorName || 'Unknown',
      url: agent.homepage,
    },

    // Version
    version: '1.0.0',

    // Capabilities in A2A format
    capabilities: {
      streaming: agent.protocols?.includes('websocket') || false,
      pushNotifications: false,
      stateTransitionHistory: false,
    },

    // Skills (mapped from our capabilities)
    skills: agentCaps.map(cap => ({
      id: cap.capabilityId,
      name: cap.capabilityId?.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
      description: `Agent has ${cap.capabilityId} capability`,
      tags: [cap.capabilityId],
      examples: [],
    })),

    // Authentication
    authentication: {
      schemes: ['public_key'],
      credentials: agent.publicKey,
    },

    // Default input/output modes
    defaultInputModes: ['text'],
    defaultOutputModes: ['text'],

    // AgentRegistry extensions
    'x-agent-registry': {
      id: agent.id,
      type: agent.type,
      status: agent.status,
      protocols: agent.protocols || [],
      tags: agent.tags || [],
      paymentMethods: agent.paymentMethods || [],
      registeredAt: agent.createdAt,
      publicKey: agent.publicKey,
    },
  };

  return c.json(agentCard);
});

/**
 * List all agents in A2A Agent Card format
 */
a2aRouter.get('/agents', async (c) => {
  const limit = parseInt(c.req.query('limit') || '50', 10);
  const offset = parseInt(c.req.query('offset') || '0', 10);

  const allAgents = await db.query.agents.findMany({
    limit,
    offset,
    orderBy: (agents, { desc }) => [desc(agents.createdAt)],
  });

  const agentCards = allAgents.map(agent => ({
    name: agent.name,
    description: agent.description || `${agent.name} - ${agent.type} agent`,
    url: agent.endpoint || `https://agentregistry.ai/agent/${agent.id}`,
    provider: {
      organization: agent.operatorName || 'Unknown',
    },
    'x-agent-registry': {
      id: agent.id,
      type: agent.type,
      status: agent.status,
    },
  }));

  return c.json({
    agents: agentCards,
    total: allAgents.length,
    limit,
    offset,
  });
});

/**
 * A2A JSON-RPC endpoint for task execution
 * This proxies to the agent's actual endpoint
 */
a2aRouter.post('/agent/:id/rpc', async (c) => {
  const agentId = c.req.param('id');
  
  const agent = await db.query.agents.findFirst({
    where: eq(agents.id, agentId),
  });

  if (!agent) {
    return c.json({ 
      jsonrpc: '2.0',
      error: { code: -32001, message: 'Agent not found' },
      id: null,
    }, 404);
  }

  if (!agent.endpoint) {
    return c.json({ 
      jsonrpc: '2.0',
      error: { code: -32002, message: 'Agent has no endpoint configured' },
      id: null,
    }, 400);
  }

  // Forward the JSON-RPC request to the agent
  try {
    const body = await c.req.json();
    const response = await fetch(agent.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Forwarded-For-Agent': agentId,
      },
      body: JSON.stringify(body),
    });

    const result = await response.json();
    return c.json(result);
  } catch (error: any) {
    return c.json({ 
      jsonrpc: '2.0',
      error: { code: -32003, message: `Failed to reach agent: ${error.message}` },
      id: null,
    }, 502);
  }
});

export { a2aRouter };
