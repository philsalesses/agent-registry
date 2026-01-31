import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { db } from '../db';
import { agents, agentCapabilities } from '../db/schema';
import { generateKeypair, toBase64, generateId, verifyAgentSignature } from 'ans-core';

const claimRouter = new Hono();

/**
 * Register a new agent and get credentials
 * This is the "web registration" flow where the server generates the keypair
 */
const webRegisterSchema = z.object({
  name: z.string().min(1).max(64),
  type: z.enum(['assistant', 'autonomous', 'tool', 'service']).default('assistant'),
  description: z.string().max(500).optional(),
  operatorName: z.string().optional(),
  capabilities: z.array(z.string()).optional(),
  linkedProfiles: z.object({
    moltbook: z.string().optional(),
    github: z.string().optional(),
    twitter: z.string().optional(),
  }).optional(),
});

claimRouter.post('/register', zValidator('json', webRegisterSchema), async (c) => {
  const body = c.req.valid('json');
  
  // Generate keypair on server
  const { privateKey, publicKey } = await generateKeypair();
  const agentId = generateId('ag_', 16);
  const claimToken = generateId('ct_', 32); // One-time claim token

  // Store agent with hashed claim token (auto-verified since we gave them the private key)
  const [agent] = await db.insert(agents).values({
    id: agentId,
    name: body.name,
    publicKey: toBase64(publicKey),
    type: body.type,
    description: body.description,
    operatorName: body.operatorName,
    linkedProfiles: body.linkedProfiles || {},
    metadata: { 
      claimTokenHash: await hashToken(claimToken),
      verified: true,
      verifiedAt: new Date().toISOString(),
    },
  }).returning();

  // Add capabilities if provided
  if (body.capabilities && body.capabilities.length > 0) {
    await Promise.all(body.capabilities.map(async (capId) => {
      const id = generateId('ac_', 16);
      await db.insert(agentCapabilities).values({
        id,
        agentId,
        capabilityId: capId,
      });
    }));
  }

  // Return credentials - USER MUST SAVE THESE
  return c.json({
    agent: {
      id: agent.id,
      name: agent.name,
      type: agent.type,
    },
    credentials: {
      agentId: agent.id,
      publicKey: toBase64(publicKey),
      privateKey: toBase64(privateKey),
      claimToken, // One-time, for recovery
    },
    warning: 'SAVE THESE CREDENTIALS! The private key cannot be recovered.',
  }, 201);
});

/**
 * Verify ownership by signing a challenge
 */
claimRouter.post('/challenge', async (c) => {
  const agentId = c.req.query('agentId');
  if (!agentId) {
    return c.json({ error: 'agentId required' }, 400);
  }

  const agent = await db.query.agents.findFirst({
    where: eq(agents.id, agentId),
  });

  if (!agent) {
    return c.json({ error: 'Agent not found' }, 404);
  }

  // Generate challenge
  const challenge = generateId('ch_', 32);
  const expiresAt = Date.now() + 5 * 60 * 1000; // 5 minutes

  // Store challenge temporarily (in production, use Redis)
  // For now, encode in the challenge itself (signed by server)
  const challengeData = {
    agentId,
    challenge,
    expiresAt,
  };

  return c.json(challengeData);
});

/**
 * Verify a signed challenge to prove ownership
 */
const verifyChallengeSchema = z.object({
  agentId: z.string(),
  challenge: z.string(),
  signature: z.string(),
});

claimRouter.post('/verify', zValidator('json', verifyChallengeSchema), async (c) => {
  const { agentId, challenge, signature } = c.req.valid('json');

  const agent = await db.query.agents.findFirst({
    where: eq(agents.id, agentId),
  });

  if (!agent) {
    return c.json({ error: 'Agent not found' }, 404);
  }

  // Verify signature
  const isValid = await verifyAgentSignature(challenge, signature, agent.publicKey);
  
  if (!isValid) {
    return c.json({ error: 'Invalid signature', verified: false }, 401);
  }

  // Mark agent as verified
  await db.update(agents)
    .set({ 
      metadata: { ...agent.metadata as object, verified: true, verifiedAt: new Date().toISOString() },
      updatedAt: new Date(),
    })
    .where(eq(agents.id, agentId));

  return c.json({ 
    verified: true, 
    agentId,
    message: 'Agent ownership verified successfully',
  });
});

/**
 * Get a one-time edit token by proving ownership
 * This is for web UI - exchange signature for short-lived edit token
 */
const getEditTokenSchema = z.object({
  agentId: z.string(),
  timestamp: z.string(),
  signature: z.string(),
});

claimRouter.post('/edit-token', zValidator('json', getEditTokenSchema), async (c) => {
  const { agentId, timestamp, signature } = c.req.valid('json');

  // Check timestamp is recent
  const ts = parseInt(timestamp, 10);
  if (Math.abs(Date.now() - ts) > 5 * 60 * 1000) {
    return c.json({ error: 'Timestamp expired' }, 400);
  }

  const agent = await db.query.agents.findFirst({
    where: eq(agents.id, agentId),
  });

  if (!agent) {
    return c.json({ error: 'Agent not found' }, 404);
  }

  // Verify signature of "edit:{agentId}:{timestamp}"
  const message = `edit:${agentId}:${timestamp}`;
  const isValid = await verifyAgentSignature(message, signature, agent.publicKey);
  
  if (!isValid) {
    return c.json({ error: 'Invalid signature' }, 401);
  }

  // Generate short-lived edit token (15 minutes)
  const editToken = generateId('et_', 32);
  const expiresAt = Date.now() + 15 * 60 * 1000;

  // Store in agent metadata (in production, use Redis)
  await db.update(agents)
    .set({ 
      metadata: { 
        ...agent.metadata as object, 
        editToken: await hashToken(editToken),
        editTokenExpires: expiresAt,
      },
      updatedAt: new Date(),
    })
    .where(eq(agents.id, agentId));

  return c.json({ 
    editToken,
    expiresAt,
    expiresIn: '15 minutes',
  });
});

// Simple hash function for tokens
async function hashToken(token: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(token);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

export { claimRouter };
