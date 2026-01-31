import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { eq, and } from 'drizzle-orm';
import { db } from '../db';
import { attestations, agents } from '../db/schema';
import { verifyAgentSignature, generateId } from 'ans-core';
import { createNotification } from './notifications';

const attestationsRouter = new Hono();

// Create an attestation
const createAttestationSchema = z.object({
  attesterId: z.string(),
  subjectId: z.string(),
  claim: z.object({
    type: z.enum(['capability', 'identity', 'behavior']),
    capabilityId: z.string().optional(),
    value: z.union([z.boolean(), z.number(), z.string()]),
  }),
  signature: z.string(),
  expiresAt: z.string().datetime().optional(),
});

attestationsRouter.post('/', zValidator('json', createAttestationSchema), async (c) => {
  const body = c.req.valid('json');

  // Get attester's public key
  const attester = await db.query.agents.findFirst({
    where: eq(agents.id, body.attesterId),
  });

  if (!attester) {
    return c.json({ error: 'Attester not found' }, 404);
  }

  // Check for private key header (web UI auth)
  const privateKeyHeader = c.req.header('X-Agent-Private-Key');
  
  if (privateKeyHeader) {
    // Verify private key matches public key
    const { sign, toBase64, fromBase64, verify } = await import('ans-core');
    try {
      const testMessage = new TextEncoder().encode('verify');
      const privateKey = fromBase64(privateKeyHeader);
      const sig = await sign(testMessage, privateKey);
      const publicKey = fromBase64(attester.publicKey);
      const isValid = await verify(sig, testMessage, publicKey);
      if (!isValid) {
        return c.json({ error: 'Invalid private key' }, 401);
      }
    } catch {
      return c.json({ error: 'Invalid private key format' }, 401);
    }
  } else {
    // Verify the signature
    const message = JSON.stringify({
      attesterId: body.attesterId,
      subjectId: body.subjectId,
      claim: body.claim,
    });

    const isValid = await verifyAgentSignature(message, body.signature, attester.publicKey);
    if (!isValid) {
      return c.json({ error: 'Invalid signature' }, 400);
    }
  }

  // Store the attestation
  const id = generateId('att_', 16);
  const [attestation] = await db.insert(attestations).values({
    id,
    attesterId: body.attesterId,
    subjectId: body.subjectId,
    claimType: body.claim.type,
    claimCapabilityId: body.claim.capabilityId,
    claimValue: body.claim.value,
    signature: body.signature,
    expiresAt: body.expiresAt ? new Date(body.expiresAt) : undefined,
  }).returning();

  // Create notification for the subject agent
  try {
    await createNotification(body.subjectId, 'attestation_received', {
      attesterId: body.attesterId,
      attesterName: attester.name,
      attestationId: id,
      claimType: body.claim.type,
      claimValue: body.claim.value,
      claimCapabilityId: body.claim.capabilityId,
    });
  } catch (e) {
    // Don't fail if notification fails
    console.error('Failed to create notification:', e);
  }

  return c.json(attestation, 201);
});

// Get attestations for an agent
attestationsRouter.get('/subject/:id', async (c) => {
  const subjectId = c.req.param('id');

  const results = await db.query.attestations.findMany({
    where: eq(attestations.subjectId, subjectId),
    orderBy: (attestations, { desc }) => [desc(attestations.createdAt)],
  });

  return c.json({ attestations: results });
});

// Get attestations made by an agent
attestationsRouter.get('/attester/:id', async (c) => {
  const attesterId = c.req.param('id');

  const results = await db.query.attestations.findMany({
    where: eq(attestations.attesterId, attesterId),
    orderBy: (attestations, { desc }) => [desc(attestations.createdAt)],
  });

  return c.json({ attestations: results });
});

// List recent attestations (for activity feed)
attestationsRouter.get('/', async (c) => {
  const limit = parseInt(c.req.query('limit') || '30', 10);
  const offset = parseInt(c.req.query('offset') || '0', 10);

  const results = await db.query.attestations.findMany({
    orderBy: (attestations, { desc }) => [desc(attestations.createdAt)],
    limit: Math.min(limit, 100),
    offset,
  });

  return c.json({ attestations: results });
});

export { attestationsRouter };
