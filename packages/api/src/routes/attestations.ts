import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { eq, and } from 'drizzle-orm';
import { db } from '../db';
import { attestations, agents } from '../db/schema';
import { verifyAgentSignature, generateId } from '@agent-registry/core';

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

export { attestationsRouter };
