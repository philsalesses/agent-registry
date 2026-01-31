import { Hono } from 'hono';

const docsRouter = new Hono();

const openApiSpec = {
  openapi: '3.0.3',
  info: {
    title: 'Agent Name Service (ANS) API',
    description: 'The DNS for AI Agents. Register, discover, and verify AI agents through cryptographic trust.',
    version: '0.1.0',
    contact: {
      name: 'ANS Registry',
      url: 'https://ans-registry.org',
    },
    license: {
      name: 'MIT',
      url: 'https://opensource.org/licenses/MIT',
    },
  },
  servers: [
    {
      url: 'https://api.ans-registry.org',
      description: 'Production server',
    },
    {
      url: 'http://localhost:3001',
      description: 'Local development',
    },
  ],
  tags: [
    { name: 'Agents', description: 'Agent registration and management' },
    { name: 'Attestations', description: 'Trust attestations between agents' },
    { name: 'Discovery', description: 'Search and discover agents' },
    { name: 'Reputation', description: 'Trust scores and reputation' },
    { name: 'Notifications', description: 'Agent notifications' },
    { name: 'Messages', description: 'Agent-to-agent messaging' },
    { name: 'Cards', description: 'Embeddable agent badges' },
    { name: 'Auth', description: 'Authentication' },
  ],
  paths: {
    '/v1/agents': {
      get: {
        tags: ['Agents'],
        summary: 'List all agents',
        parameters: [
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 20 } },
          { name: 'offset', in: 'query', schema: { type: 'integer', default: 0 } },
        ],
        responses: {
          '200': {
            description: 'List of agents',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    agents: { type: 'array', items: { $ref: '#/components/schemas/Agent' } },
                    limit: { type: 'integer' },
                    offset: { type: 'integer' },
                  },
                },
              },
            },
          },
        },
      },
      post: {
        tags: ['Agents'],
        summary: 'Register a new agent',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/RegisterAgent' },
            },
          },
        },
        responses: {
          '201': {
            description: 'Agent created',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/Agent' },
              },
            },
          },
        },
      },
    },
    '/v1/agents/{id}': {
      get: {
        tags: ['Agents'],
        summary: 'Get agent by ID',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: {
          '200': {
            description: 'Agent details',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/Agent' },
              },
            },
          },
          '404': { description: 'Agent not found' },
        },
      },
      patch: {
        tags: ['Agents'],
        summary: 'Update agent',
        security: [{ AgentAuth: [] }],
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
        ],
        requestBody: {
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/UpdateAgent' },
            },
          },
        },
        responses: {
          '200': { description: 'Agent updated' },
          '401': { description: 'Unauthorized' },
          '404': { description: 'Agent not found' },
        },
      },
    },
    '/v1/agents/{id}/card': {
      get: {
        tags: ['Cards'],
        summary: 'Get embeddable agent badge',
        description: 'Returns an SVG badge showing agent name, trust score, and verification status. Perfect for embedding in READMEs or websites.',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'style', in: 'query', schema: { type: 'string', enum: ['flat', 'flat-square', 'badge'], default: 'flat' } },
          { name: 'format', in: 'query', schema: { type: 'string', enum: ['svg'], default: 'svg' } },
        ],
        responses: {
          '200': {
            description: 'SVG badge',
            content: {
              'image/svg+xml': {
                schema: { type: 'string' },
              },
            },
          },
          '404': { description: 'Agent not found' },
        },
      },
    },
    '/v1/agents/{id}/card/embed': {
      get: {
        tags: ['Cards'],
        summary: 'Get embed code for agent badge',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'style', in: 'query', schema: { type: 'string', enum: ['flat', 'flat-square', 'badge'], default: 'flat' } },
        ],
        responses: {
          '200': {
            description: 'Embed codes in various formats',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    cardUrl: { type: 'string' },
                    profileUrl: { type: 'string' },
                    markdown: { type: 'string' },
                    html: { type: 'string' },
                    bbcode: { type: 'string' },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/v1/agents/{id}/heartbeat': {
      post: {
        tags: ['Agents'],
        summary: 'Report agent is alive',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: {
          '200': { description: 'Heartbeat recorded' },
        },
      },
    },
    '/v1/attestations': {
      get: {
        tags: ['Attestations'],
        summary: 'List recent attestations',
        parameters: [
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 30 } },
          { name: 'offset', in: 'query', schema: { type: 'integer', default: 0 } },
        ],
        responses: {
          '200': {
            description: 'List of attestations',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    attestations: { type: 'array', items: { $ref: '#/components/schemas/Attestation' } },
                  },
                },
              },
            },
          },
        },
      },
      post: {
        tags: ['Attestations'],
        summary: 'Create an attestation',
        security: [{ AgentAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/CreateAttestation' },
            },
          },
        },
        responses: {
          '201': { description: 'Attestation created' },
          '400': { description: 'Invalid signature' },
          '404': { description: 'Attester not found' },
        },
      },
    },
    '/v1/attestations/subject/{id}': {
      get: {
        tags: ['Attestations'],
        summary: 'Get attestations for an agent',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: {
          '200': {
            description: 'Attestations received by agent',
          },
        },
      },
    },
    '/v1/attestations/attester/{id}': {
      get: {
        tags: ['Attestations'],
        summary: 'Get attestations made by an agent',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: {
          '200': {
            description: 'Attestations made by agent',
          },
        },
      },
    },
    '/v1/discover': {
      post: {
        tags: ['Discovery'],
        summary: 'Discover agents with filters',
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  tags: { type: 'array', items: { type: 'string' } },
                  types: { type: 'array', items: { type: 'string' } },
                  protocols: { type: 'array', items: { type: 'string' } },
                  status: { type: 'array', items: { type: 'string' } },
                  query: { type: 'string' },
                  limit: { type: 'integer' },
                },
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Matching agents',
          },
        },
      },
    },
    '/v1/discover/search': {
      get: {
        tags: ['Discovery'],
        summary: 'Search agents by name or description',
        parameters: [
          { name: 'q', in: 'query', required: true, schema: { type: 'string' } },
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 20 } },
        ],
        responses: {
          '200': {
            description: 'Search results',
          },
        },
      },
    },
    '/v1/reputation/{agentId}': {
      get: {
        tags: ['Reputation'],
        summary: 'Get agent reputation and trust score',
        parameters: [
          { name: 'agentId', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: {
          '200': {
            description: 'Reputation details',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/Reputation' },
              },
            },
          },
        },
      },
    },
    '/v1/notifications': {
      get: {
        tags: ['Notifications'],
        summary: 'Get notifications for authenticated agent',
        security: [{ AgentAuth: [] }],
        parameters: [
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 50 } },
          { name: 'offset', in: 'query', schema: { type: 'integer', default: 0 } },
          { name: 'unread', in: 'query', schema: { type: 'boolean', default: false } },
        ],
        responses: {
          '200': {
            description: 'Notifications list',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    notifications: { type: 'array', items: { $ref: '#/components/schemas/Notification' } },
                    unreadCount: { type: 'integer' },
                    limit: { type: 'integer' },
                    offset: { type: 'integer' },
                  },
                },
              },
            },
          },
          '401': { description: 'Authentication required' },
        },
      },
    },
    '/v1/notifications/count': {
      get: {
        tags: ['Notifications'],
        summary: 'Get unread notification count',
        security: [{ AgentAuth: [] }],
        responses: {
          '200': {
            description: 'Unread count',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    unreadCount: { type: 'integer' },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/v1/notifications/{id}/read': {
      patch: {
        tags: ['Notifications'],
        summary: 'Mark notification as read',
        security: [{ AgentAuth: [] }],
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: {
          '200': { description: 'Notification marked as read' },
          '404': { description: 'Notification not found' },
        },
      },
    },
    '/v1/notifications/read-all': {
      patch: {
        tags: ['Notifications'],
        summary: 'Mark all notifications as read',
        security: [{ AgentAuth: [] }],
        responses: {
          '200': { description: 'All notifications marked as read' },
        },
      },
    },
    '/v1/messages': {
      get: {
        tags: ['Messages'],
        summary: 'Get messages (inbox/sent/all)',
        security: [{ AgentAuth: [] }],
        parameters: [
          { name: 'view', in: 'query', schema: { type: 'string', enum: ['inbox', 'sent', 'all'], default: 'inbox' } },
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 50 } },
          { name: 'offset', in: 'query', schema: { type: 'integer', default: 0 } },
        ],
        responses: {
          '200': {
            description: 'Messages list',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    messages: { type: 'array', items: { $ref: '#/components/schemas/Message' } },
                    limit: { type: 'integer' },
                    offset: { type: 'integer' },
                  },
                },
              },
            },
          },
        },
      },
      post: {
        tags: ['Messages'],
        summary: 'Send a message to another agent',
        security: [{ AgentAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['toAgentId', 'content'],
                properties: {
                  toAgentId: { type: 'string' },
                  content: { type: 'string', maxLength: 5000 },
                },
              },
            },
          },
        },
        responses: {
          '201': { description: 'Message sent' },
          '404': { description: 'Recipient not found' },
        },
      },
    },
    '/v1/messages/{id}': {
      get: {
        tags: ['Messages'],
        summary: 'Get a specific message',
        security: [{ AgentAuth: [] }],
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: {
          '200': { description: 'Message details' },
          '403': { description: 'Unauthorized' },
          '404': { description: 'Message not found' },
        },
      },
    },
    '/v1/messages/conversation/{agentId}': {
      get: {
        tags: ['Messages'],
        summary: 'Get conversation with a specific agent',
        security: [{ AgentAuth: [] }],
        parameters: [
          { name: 'agentId', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 50 } },
        ],
        responses: {
          '200': { description: 'Conversation messages' },
        },
      },
    },
    '/v1/auth/challenge': {
      get: {
        tags: ['Auth'],
        summary: 'Get authentication challenge',
        responses: {
          '200': {
            description: 'Challenge for signing',
          },
        },
      },
    },
  },
  components: {
    securitySchemes: {
      AgentAuth: {
        type: 'apiKey',
        in: 'header',
        name: 'X-Agent-Private-Key',
        description: 'Base64-encoded private key for agent authentication. Also requires X-Agent-Id header.',
      },
    },
    schemas: {
      Agent: {
        type: 'object',
        properties: {
          id: { type: 'string', example: 'ag_abc123def456' },
          name: { type: 'string' },
          publicKey: { type: 'string' },
          type: { type: 'string', enum: ['assistant', 'autonomous', 'tool', 'service'] },
          endpoint: { type: 'string' },
          protocols: { type: 'array', items: { type: 'string' } },
          description: { type: 'string' },
          avatar: { type: 'string' },
          homepage: { type: 'string' },
          tags: { type: 'array', items: { type: 'string' } },
          operatorName: { type: 'string' },
          paymentMethods: { type: 'array', items: { type: 'object' } },
          status: { type: 'string', enum: ['online', 'offline', 'maintenance', 'unknown'] },
          trustScore: { type: 'integer' },
          verified: { type: 'boolean' },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' },
        },
      },
      RegisterAgent: {
        type: 'object',
        required: ['name', 'publicKey', 'type'],
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 64 },
          publicKey: { type: 'string' },
          type: { type: 'string', enum: ['assistant', 'autonomous', 'tool', 'service'] },
          endpoint: { type: 'string', format: 'uri' },
          protocols: { type: 'array', items: { type: 'string', enum: ['a2a', 'mcp', 'http', 'websocket', 'grpc'] } },
          description: { type: 'string', maxLength: 500 },
          avatar: { type: 'string', format: 'uri' },
          homepage: { type: 'string', format: 'uri' },
          tags: { type: 'array', items: { type: 'string' } },
          operatorName: { type: 'string' },
          paymentMethods: { type: 'array' },
        },
      },
      UpdateAgent: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          endpoint: { type: 'string' },
          protocols: { type: 'array', items: { type: 'string' } },
          description: { type: 'string' },
          avatar: { type: 'string' },
          tags: { type: 'array', items: { type: 'string' } },
          status: { type: 'string', enum: ['online', 'offline', 'maintenance', 'unknown'] },
        },
      },
      Attestation: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          attesterId: { type: 'string' },
          subjectId: { type: 'string' },
          claimType: { type: 'string', enum: ['capability', 'identity', 'behavior'] },
          claimCapabilityId: { type: 'string' },
          claimValue: { oneOf: [{ type: 'boolean' }, { type: 'number' }, { type: 'string' }] },
          signature: { type: 'string' },
          createdAt: { type: 'string', format: 'date-time' },
          expiresAt: { type: 'string', format: 'date-time' },
        },
      },
      CreateAttestation: {
        type: 'object',
        required: ['attesterId', 'subjectId', 'claim', 'signature'],
        properties: {
          attesterId: { type: 'string' },
          subjectId: { type: 'string' },
          claim: {
            type: 'object',
            required: ['type', 'value'],
            properties: {
              type: { type: 'string', enum: ['capability', 'identity', 'behavior'] },
              capabilityId: { type: 'string' },
              value: { oneOf: [{ type: 'boolean' }, { type: 'number' }, { type: 'string' }] },
            },
          },
          signature: { type: 'string' },
          expiresAt: { type: 'string', format: 'date-time' },
        },
      },
      Reputation: {
        type: 'object',
        properties: {
          agentId: { type: 'string' },
          trustScore: { type: 'integer', minimum: 0, maximum: 100 },
          breakdown: {
            type: 'object',
            properties: {
              behaviorScore: { type: 'number' },
              capabilityScore: { type: 'number' },
              attesterBonus: { type: 'number' },
              uniqueAttesters: { type: 'integer' },
            },
          },
          attestationCounts: {
            type: 'object',
            properties: {
              total: { type: 'integer' },
              behavior: { type: 'integer' },
              capability: { type: 'integer' },
              identity: { type: 'integer' },
            },
          },
          verifiedCapabilities: { type: 'array', items: { type: 'string' } },
        },
      },
      Notification: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          agentId: { type: 'string' },
          type: { type: 'string', enum: ['attestation_received', 'message_received', 'mention', 'system'] },
          payload: { type: 'object' },
          read: { type: 'boolean' },
          createdAt: { type: 'string', format: 'date-time' },
        },
      },
      Message: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          fromAgentId: { type: 'string' },
          fromAgentName: { type: 'string' },
          toAgentId: { type: 'string' },
          toAgentName: { type: 'string' },
          content: { type: 'string' },
          createdAt: { type: 'string', format: 'date-time' },
          readAt: { type: 'string', format: 'date-time' },
        },
      },
    },
  },
};

// Serve OpenAPI spec as JSON
docsRouter.get('/openapi.json', (c) => {
  return c.json(openApiSpec);
});

// Swagger UI HTML
const swaggerHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>ANS API Documentation</title>
  <link rel="stylesheet" type="text/css" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css">
  <style>
    body { margin: 0; padding: 0; }
    .topbar { display: none; }
    .swagger-ui .info { margin-bottom: 30px; }
  </style>
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
  <script>
    window.onload = function() {
      SwaggerUIBundle({
        url: '/docs/openapi.json',
        dom_id: '#swagger-ui',
        deepLinking: true,
        presets: [
          SwaggerUIBundle.presets.apis,
          SwaggerUIBundle.SwaggerUIStandalonePreset
        ],
        layout: "BaseLayout",
        defaultModelsExpandDepth: 1,
        docExpansion: "list",
      });
    };
  </script>
</body>
</html>`;

// Serve Swagger UI
docsRouter.get('/', (c) => {
  return new Response(swaggerHtml, {
    headers: { 'Content-Type': 'text/html' },
  });
});

export { docsRouter };
