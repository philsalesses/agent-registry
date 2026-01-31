import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { eq, and, isNull, gt } from 'drizzle-orm';
import { db } from '../db';
import { challenges, agents } from '../db/schema';
import { generateId, toBase64, verifyAgentSignature } from 'ans-core';

const authRouter = new Hono();

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

  // Return success with agent info
  // In production, you'd generate a JWT or session token here
  return c.json({
    authenticated: true,
    agent: {
      id: agent.id,
      name: agent.name,
      type: agent.type,
    },
  });
});

export { authRouter };
