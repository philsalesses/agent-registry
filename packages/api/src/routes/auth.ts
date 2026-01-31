import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { eq, and, isNull, gt } from 'drizzle-orm';
import { db } from '../db';
import { challenges, agents } from '../db/schema';
import { generateId, toBase64, fromBase64, sign, verify, verifyAgentSignature } from 'ans-core';

const authRouter = new Hono();

// Session token secret (in production, use env var)
const SESSION_SECRET = process.env.SESSION_SECRET || 'ans-registry-session-secret-change-in-prod';
const SESSION_DURATION_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Simple JWT-like session token
 * Format: base64(JSON{agentId, exp}) + '.' + base64(HMAC-SHA256 signature)
 */
async function createSessionToken(agentId: string): Promise<string> {
  const payload = {
    agentId,
    exp: Date.now() + SESSION_DURATION_MS,
  };
  const payloadB64 = btoa(JSON.stringify(payload));
  
  // Create signature using Web Crypto
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(SESSION_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(payloadB64));
  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(signature)));
  
  return `${payloadB64}.${sigB64}`;
}

async function verifySessionToken(token: string): Promise<{ valid: boolean; agentId?: string }> {
  try {
    const [payloadB64, sigB64] = token.split('.');
    if (!payloadB64 || !sigB64) return { valid: false };
    
    // Verify signature
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(SESSION_SECRET),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify']
    );
    const signature = Uint8Array.from(atob(sigB64), c => c.charCodeAt(0));
    const valid = await crypto.subtle.verify('HMAC', key, signature, encoder.encode(payloadB64));
    
    if (!valid) return { valid: false };
    
    // Parse and check expiration
    const payload = JSON.parse(atob(payloadB64));
    if (payload.exp < Date.now()) return { valid: false };
    
    return { valid: true, agentId: payload.agentId };
  } catch {
    return { valid: false };
  }
}

// Export for use in other routes
export { verifySessionToken };

// Request a challenge for authentication
authRouter.post('/challenge', async (c) => {
  const id = generateId('ch_', 16);
  const nonce = toBase64(crypto.getRandomValues(new Uint8Array(32)));
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 5 * 60 * 1000); // 5 minutes

  const [challenge] = await db.insert(challenges).values({
    id,
    nonce,
    expiresAt,
  }).returning();

  return c.json({
    id: challenge.id,
    nonce: challenge.nonce,
    expiresAt: challenge.expiresAt.toISOString(),
  });
});

// Verify a challenge response
const verifySchema = z.object({
  challengeId: z.string(),
  agentId: z.string(),
  signature: z.string(),
});

authRouter.post('/verify', zValidator('json', verifySchema), async (c) => {
  const body = c.req.valid('json');

  // Get the challenge
  const challenge = await db.query.challenges.findFirst({
    where: and(
      eq(challenges.id, body.challengeId),
      isNull(challenges.usedAt),
      gt(challenges.expiresAt, new Date())
    ),
  });

  if (!challenge) {
    return c.json({ error: 'Invalid or expired challenge' }, 400);
  }

  // Get the agent's public key
  const agent = await db.query.agents.findFirst({
    where: eq(agents.id, body.agentId),
  });

  if (!agent) {
    return c.json({ error: 'Agent not found' }, 404);
  }

  // Verify the signature
  const isValid = await verifyAgentSignature(
    challenge.nonce,
    body.signature,
    agent.publicKey
  );

  if (!isValid) {
    return c.json({ error: 'Invalid signature' }, 401);
  }

  // Mark challenge as used
  await db.update(challenges)
    .set({ usedAt: new Date() })
    .where(eq(challenges.id, body.challengeId));

  // Mark challenge as used
  await db.update(challenges)
    .set({ usedAt: new Date() })
    .where(eq(challenges.id, body.challengeId));

  // Generate session token
  const token = await createSessionToken(agent.id);

  return c.json({
    authenticated: true,
    token,
    expiresIn: SESSION_DURATION_MS,
    agent: {
      id: agent.id,
      name: agent.name,
      type: agent.type,
    },
  });
});

// Create session from private key (for web UI)
// This avoids sending raw private key on every request
const sessionSchema = z.object({
  agentId: z.string(),
  privateKey: z.string(),
});

authRouter.post('/session', zValidator('json', sessionSchema), async (c) => {
  const { agentId, privateKey } = c.req.valid('json');

  // Get the agent
  const agent = await db.query.agents.findFirst({
    where: eq(agents.id, agentId),
  });

  if (!agent) {
    return c.json({ error: 'Agent not found' }, 404);
  }

  // Verify the private key matches the public key
  try {
    const testMessage = new TextEncoder().encode('verify-session');
    const privKey = fromBase64(privateKey);
    const sig = await sign(testMessage, privKey);
    const pubKey = fromBase64(agent.publicKey);
    const isValid = await verify(sig, testMessage, pubKey);
    
    if (!isValid) {
      return c.json({ error: 'Invalid private key' }, 401);
    }
  } catch (e) {
    return c.json({ error: 'Invalid private key format' }, 401);
  }

  // Generate session token
  const token = await createSessionToken(agent.id);

  return c.json({
    token,
    expiresIn: SESSION_DURATION_MS,
    agent: {
      id: agent.id,
      name: agent.name,
      type: agent.type,
      avatar: agent.avatar,
    },
  });
});

// Validate a session token
authRouter.get('/session', async (c) => {
  const authHeader = c.req.header('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return c.json({ valid: false, error: 'No token provided' }, 401);
  }

  const token = authHeader.slice(7);
  const result = await verifySessionToken(token);

  if (!result.valid) {
    return c.json({ valid: false, error: 'Invalid or expired token' }, 401);
  }

  // Get agent info
  const agent = await db.query.agents.findFirst({
    where: eq(agents.id, result.agentId!),
  });

  if (!agent) {
    return c.json({ valid: false, error: 'Agent not found' }, 401);
  }

  return c.json({
    valid: true,
    agent: {
      id: agent.id,
      name: agent.name,
      type: agent.type,
      avatar: agent.avatar,
    },
  });
});

export { authRouter };
