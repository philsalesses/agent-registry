import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { db } from '../db';
import { agents, attestations } from '../db/schema';
import { generateId, verifyAgentSignature } from 'ans-core';
import { validatePaymentMethods, isValidUrl, sanitizeString } from '../utils/validation';

/**
 * Compute trust score for an agent
 */
async function computeTrustScore(agentId: string): Promise<number> {
  const agentAttestations = await db.query.attestations.findMany({
    where: eq(attestations.subjectId, agentId),
  });

  if (agentAttestations.length === 0) return 0;

  const behaviorScores = agentAttestations
    .filter(a => a.claimType === 'behavior')
    .map(a => typeof a.claimValue === 'number' ? a.claimValue : 50);

  const avgBehavior = behaviorScores.length > 0
    ? behaviorScores.reduce((a, b) => a + b, 0) / behaviorScores.length
    : 50;

  const uniqueAttesters = new Set(agentAttestations.map(a => a.attesterId)).size;
  
  return Math.round(avgBehavior * 0.8 + Math.min(uniqueAttesters * 4, 20));
}

/**
 * Verify a signed request from an agent
 * Header: X-Agent-Signature: base64-signature
 * Header: X-Agent-Timestamp: unix-ms
 * Signs: `${method}:${path}:${timestamp}:${bodyHash}`
 */
async function verifyAgentRequest(
  agentId: string,
  method: string,
  path: string,
  timestamp: string,
  signature: string,
  body: string
): Promise<boolean> {
  // Check timestamp is within 5 minutes
  const ts = parseInt(timestamp, 10);
  const now = Date.now();
  if (Math.abs(now - ts) > 5 * 60 * 1000) {
    return false;
  }

  // Get agent's public key
  const agent = await db.query.agents.findFirst({
    where: eq(agents.id, agentId),
  });
  if (!agent) return false;

  // Verify signature
  const message = `${method}:${path}:${timestamp}:${body}`;
  return verifyAgentSignature(message, signature, agent.publicKey);
}

const agentsRouter = new Hono();

// Register a new agent
const registerSchema = z.object({
  name: z.string().min(1).max(64),
  publicKey: z.string(),
  type: z.enum(['assistant', 'autonomous', 'tool', 'service']),
  // Contact
  endpoint: z.string().url().optional(),
  protocols: z.array(z.enum(['a2a', 'mcp', 'http', 'websocket', 'grpc'])).optional(),
  // Profile
  description: z.string().max(500).optional(),
  avatar: z.string().url().optional(),
  homepage: z.string().url().optional(),
  tags: z.array(z.string()).optional(),
  // Accountability
  operatorId: z.string().optional(),
  operatorName: z.string().optional(),
  // Payment (operator-controlled)
  paymentMethods: z.array(z.object({
    type: z.enum(['bitcoin', 'lightning', 'ethereum', 'usdc', 'other']),
    address: z.string(),
    label: z.string().optional(),
  })).optional(),
  // Meta
  metadata: z.record(z.unknown()).optional(),
});

agentsRouter.post('/', zValidator('json', registerSchema), async (c) => {
  const body = c.req.valid('json');
  const id = generateId('ag_', 16);

  // Validate URLs
  if (body.endpoint && !isValidUrl(body.endpoint)) {
    return c.json({ error: 'Invalid endpoint URL' }, 400);
  }
  if (body.homepage && !isValidUrl(body.homepage)) {
    return c.json({ error: 'Invalid homepage URL' }, 400);
  }

  // Validate payment methods
  if (body.paymentMethods) {
    const validation = validatePaymentMethods(body.paymentMethods);
    if (!validation.valid) {
      return c.json({ error: validation.error }, 400);
    }
  }

  const [agent] = await db.insert(agents).values({
    id,
    name: sanitizeString(body.name, 64),
    publicKey: body.publicKey,
    type: body.type,
    description: sanitizeString(body.description, 500),
    endpoint: body.endpoint,
    protocols: body.protocols,
    tags: body.tags,
    avatar: body.avatar,
    homepage: body.homepage,
    operatorId: body.operatorId,
    operatorName: sanitizeString(body.operatorName, 100),
    paymentMethods: body.paymentMethods,
    metadata: body.metadata,
  }).returning();

  return c.json({ ...agent, trustScore: 0 }, 201);
});

// Get agent by ID (includes trust score)
agentsRouter.get('/:id', async (c) => {
  const id = c.req.param('id');
  
  const agent = await db.query.agents.findFirst({
    where: eq(agents.id, id),
  });

  if (!agent) {
    return c.json({ error: 'Agent not found' }, 404);
  }

  // Compute trust score
  const trustScore = await computeTrustScore(id);
  
  // Check if verified
  const isVerified = (agent.metadata as any)?.verified === true;

  return c.json({ ...agent, trustScore, verified: isVerified });
});

// Update agent
const updateSchema = z.object({
  name: z.string().min(1).max(64).optional(),
  endpoint: z.string().url().optional(),
  protocols: z.array(z.enum(['a2a', 'mcp', 'http', 'websocket', 'grpc'])).optional(),
  description: z.string().max(500).optional(),
  avatar: z.string().url().optional(),
  homepage: z.string().url().optional(),
  tags: z.array(z.string()).optional(),
  operatorName: z.string().optional(),
  paymentMethods: z.array(z.object({
    type: z.enum(['bitcoin', 'lightning', 'ethereum', 'usdc', 'other']),
    address: z.string(),
    label: z.string().optional(),
  })).optional(),
  status: z.enum(['online', 'offline', 'maintenance', 'unknown']).optional(),
  metadata: z.record(z.unknown()).optional(),
});

agentsRouter.patch('/:id', zValidator('json', updateSchema), async (c) => {
  const id = c.req.param('id');
  const body = c.req.valid('json');

  // Check for authentication
  const signature = c.req.header('X-Agent-Signature');
  const timestamp = c.req.header('X-Agent-Timestamp');
  const privateKeyHeader = c.req.header('X-Agent-Private-Key');
  
  // Method 1: Signed request (SDK)
  if (signature && timestamp) {
    const rawBody = JSON.stringify(body);
    const isValid = await verifyAgentRequest(
      id,
      'PATCH',
      `/v1/agents/${id}`,
      timestamp,
      signature,
      rawBody
    );
    if (!isValid) {
      return c.json({ error: 'Invalid signature' }, 401);
    }
  }
  // Method 2: Private key verification (Web UI - temporary)
  else if (privateKeyHeader && timestamp) {
    const agent = await db.query.agents.findFirst({
      where: eq(agents.id, id),
    });
    if (!agent) {
      return c.json({ error: 'Agent not found' }, 404);
    }
    
    // Verify the private key matches the public key
    // by signing a test message and verifying
    const { sign, toBase64, fromBase64, verify } = await import('ans-core');
    try {
      const testMessage = new TextEncoder().encode('verify');
      const privateKey = fromBase64(privateKeyHeader);
      const sig = await sign(testMessage, privateKey);
      const publicKey = fromBase64(agent.publicKey);
      const isValid = await verify(sig, testMessage, publicKey);
      if (!isValid) {
        return c.json({ error: 'Invalid private key' }, 401);
      }
    } catch {
      return c.json({ error: 'Invalid private key format' }, 401);
    }
  }
  // No auth provided - REJECT
  else {
    return c.json({ 
      error: 'Authentication required. Use SDK with private key or upload credentials in web UI.',
      docs: 'https://github.com/philsalesses/agent-registry#authentication'
    }, 401);
  }

  // Validate URLs
  if (body.endpoint && !isValidUrl(body.endpoint)) {
    return c.json({ error: 'Invalid endpoint URL' }, 400);
  }
  if (body.homepage && !isValidUrl(body.homepage)) {
    return c.json({ error: 'Invalid homepage URL' }, 400);
  }

  // Validate payment methods
  if (body.paymentMethods) {
    const validation = validatePaymentMethods(body.paymentMethods);
    if (!validation.valid) {
      return c.json({ error: validation.error }, 400);
    }
  }

  // Sanitize strings
  const sanitizedBody = {
    ...body,
    name: body.name ? sanitizeString(body.name, 64) : undefined,
    description: body.description ? sanitizeString(body.description, 500) : undefined,
    operatorName: body.operatorName ? sanitizeString(body.operatorName, 100) : undefined,
    updatedAt: new Date(),
  };

  const [updated] = await db.update(agents)
    .set(sanitizedBody)
    .where(eq(agents.id, id))
    .returning();

  if (!updated) {
    return c.json({ error: 'Agent not found' }, 404);
  }

  const trustScore = await computeTrustScore(id);
  return c.json({ ...updated, trustScore });
});

// List agents (with trust scores)
agentsRouter.get('/', async (c) => {
  const limit = parseInt(c.req.query('limit') || '20', 10);
  const offset = parseInt(c.req.query('offset') || '0', 10);

  const results = await db.query.agents.findMany({
    limit,
    offset,
    orderBy: (agents, { desc }) => [desc(agents.createdAt)],
  });

  // Add trust scores
  const agentsWithScores = await Promise.all(
    results.map(async (agent) => ({
      ...agent,
      trustScore: await computeTrustScore(agent.id),
      verified: (agent.metadata as any)?.verified === true,
    }))
  );

  return c.json({
    agents: agentsWithScores,
    limit,
    offset,
  });
});

// Heartbeat - agent reports it's alive
agentsRouter.post('/:id/heartbeat', async (c) => {
  const id = c.req.param('id');
  
  const [updated] = await db.update(agents)
    .set({ 
      status: 'online',
      lastSeen: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(agents.id, id))
    .returning();

  if (!updated) {
    return c.json({ error: 'Agent not found' }, 404);
  }

  return c.json({ status: 'ok', lastSeen: updated.lastSeen });
});

// Set status explicitly
agentsRouter.post('/:id/status', async (c) => {
  const id = c.req.param('id');
  const { status } = await c.req.json();
  
  if (!['online', 'offline', 'maintenance', 'unknown'].includes(status)) {
    return c.json({ error: 'Invalid status' }, 400);
  }

  const [updated] = await db.update(agents)
    .set({ 
      status,
      lastSeen: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(agents.id, id))
    .returning();

  if (!updated) {
    return c.json({ error: 'Agent not found' }, 404);
  }

  return c.json({ status: updated.status });
});

export { agentsRouter };
