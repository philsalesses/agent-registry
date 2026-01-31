import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { db } from '../db';
import { agents, agentCapabilities, capabilities } from '../db/schema';

/**
 * Anthropic MCP (Model Context Protocol) Support
 * Spec: https://modelcontextprotocol.io/
 * 
 * Provides:
 * - MCP server manifest for agents
 * - Tool/resource discovery
 * - Registry as an MCP server itself
 */

const mcpRouter = new Hono();

/**
 * Get MCP manifest for a specific agent
 * Describes the agent as an MCP server
 */
mcpRouter.get('/agent/:id/manifest', async (c) => {
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

  // Build MCP Server Manifest
  const manifest = {
    // Server info
    name: agent.name,
    version: '1.0.0',
    description: agent.description || `${agent.name} - ${agent.type} agent`,
    
    // Protocol info
    protocol: 'mcp',
    protocolVersion: '2024-11-05',

    // Server capabilities
    capabilities: {
      tools: agentCaps.length > 0,
      resources: false,
      prompts: false,
      logging: false,
    },

    // Tools (mapped from capabilities)
    tools: agentCaps.map(cap => ({
      name: cap.capabilityId,
      description: `Invoke ${cap.capabilityId} capability`,
      inputSchema: {
        type: 'object',
        properties: {
          input: { type: 'string', description: 'Input for the capability' },
        },
        required: ['input'],
      },
    })),

    // Connection info
    transport: {
      type: agent.protocols?.includes('websocket') ? 'websocket' : 'http',
      url: agent.endpoint,
    },

    // AgentRegistry extensions
    'x-agent-registry': {
      id: agent.id,
      type: agent.type,
      status: agent.status,
      protocols: agent.protocols || [],
      tags: agent.tags || [],
      operatorName: agent.operatorName,
      publicKey: agent.publicKey,
    },
  };

  return c.json(manifest);
});

/**
 * Registry itself as an MCP server
 * Exposes agent discovery as MCP tools
 */
mcpRouter.get('/manifest', async (c) => {
  const manifest = {
    name: 'AgentRegistry',
    version: '1.0.0',
    description: 'DNS + Yellow Pages for AI Agents. Discover and connect with other agents.',
    
    protocol: 'mcp',
    protocolVersion: '2024-11-05',

    capabilities: {
      tools: true,
      resources: true,
      prompts: false,
      logging: false,
    },

    tools: [
      {
        name: 'search_agents',
        description: 'Search for agents by name or description',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Search query' },
            limit: { type: 'number', description: 'Max results', default: 10 },
          },
          required: ['query'],
        },
      },
      {
        name: 'get_agent',
        description: 'Get details about a specific agent',
        inputSchema: {
          type: 'object',
          properties: {
            agentId: { type: 'string', description: 'Agent ID (ag_...)' },
          },
          required: ['agentId'],
        },
      },
      {
        name: 'discover_agents',
        description: 'Discover agents by capability, tags, or type',
        inputSchema: {
          type: 'object',
          properties: {
            capabilities: { type: 'array', items: { type: 'string' }, description: 'Required capabilities' },
            tags: { type: 'array', items: { type: 'string' }, description: 'Tags to filter by' },
            type: { type: 'string', enum: ['assistant', 'autonomous', 'tool', 'service'] },
            status: { type: 'string', enum: ['online', 'offline', 'maintenance', 'unknown'] },
            limit: { type: 'number', default: 20 },
          },
        },
      },
      {
        name: 'list_capabilities',
        description: 'List all registered capabilities',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
    ],

    resources: [
      {
        uri: 'agents://registry/all',
        name: 'All Agents',
        description: 'List of all registered agents',
        mimeType: 'application/json',
      },
      {
        uri: 'agents://registry/capabilities',
        name: 'Capabilities Catalog',
        description: 'All registered capabilities',
        mimeType: 'application/json',
      },
    ],

    transport: {
      type: 'http',
      url: 'https://api.ans-registry.org/v1/mcp',
    },
  };

  return c.json(manifest);
});

/**
 * MCP JSON-RPC endpoint for the registry
 */
mcpRouter.post('/rpc', async (c) => {
  const body = await c.req.json();
  const { method, params, id } = body;

  try {
    let result;

    switch (method) {
      case 'initialize':
        result = {
          protocolVersion: '2024-11-05',
          serverInfo: {
            name: 'AgentRegistry',
            version: '1.0.0',
          },
          capabilities: {
            tools: {},
            resources: {},
          },
        };
        break;

      case 'tools/list':
        result = {
          tools: [
            { name: 'search_agents', description: 'Search for agents' },
            { name: 'get_agent', description: 'Get agent details' },
            { name: 'discover_agents', description: 'Discover agents by criteria' },
            { name: 'list_capabilities', description: 'List all capabilities' },
          ],
        };
        break;

      case 'tools/call':
        const toolName = params?.name;
        const toolArgs = params?.arguments || {};

        switch (toolName) {
          case 'search_agents':
            const searchResults = await db.query.agents.findMany({
              limit: toolArgs.limit || 10,
            });
            result = {
              content: [{ type: 'text', text: JSON.stringify(searchResults, null, 2) }],
            };
            break;

          case 'get_agent':
            const agent = await db.query.agents.findFirst({
              where: eq(agents.id, toolArgs.agentId),
            });
            result = {
              content: [{ type: 'text', text: agent ? JSON.stringify(agent, null, 2) : 'Agent not found' }],
            };
            break;

          case 'list_capabilities':
            const caps = await db.query.capabilities.findMany();
            result = {
              content: [{ type: 'text', text: JSON.stringify(caps, null, 2) }],
            };
            break;

          default:
            throw new Error(`Unknown tool: ${toolName}`);
        }
        break;

      case 'resources/list':
        result = {
          resources: [
            { uri: 'agents://registry/all', name: 'All Agents', mimeType: 'application/json' },
            { uri: 'agents://registry/capabilities', name: 'Capabilities', mimeType: 'application/json' },
          ],
        };
        break;

      case 'resources/read':
        const uri = params?.uri;
        if (uri === 'agents://registry/all') {
          const allAgents = await db.query.agents.findMany();
          result = {
            contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(allAgents) }],
          };
        } else if (uri === 'agents://registry/capabilities') {
          const allCaps = await db.query.capabilities.findMany();
          result = {
            contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(allCaps) }],
          };
        } else {
          throw new Error(`Unknown resource: ${uri}`);
        }
        break;

      default:
        return c.json({
          jsonrpc: '2.0',
          error: { code: -32601, message: `Method not found: ${method}` },
          id,
        });
    }

    return c.json({ jsonrpc: '2.0', result, id });
  } catch (error: any) {
    return c.json({
      jsonrpc: '2.0',
      error: { code: -32000, message: error.message },
      id,
    });
  }
});

export { mcpRouter };
