import { Hono } from 'hono';
import { z } from 'zod';
import { and, desc, eq } from 'drizzle-orm';
import { ANS_BLOCK, generateId, verifyMessage } from 'ans-core';
import { db } from '../db';
import { attestations } from '../db/schema';
import { config } from '../config';
import { requireAgent, resolveAgent } from '../lib/auth';
import { jsonAns, teach } from '../lib/errors';
import { createNotification } from './notifications';
import { fireWebhooksForAgent } from './webhooks';

/**
 * Vouches (docs/DESIGN.md section 3 "Vouch"): the legacy attestations table,
 * schema unchanged. Vouches carry zero weight in trust; the POST answers with
 * a warning that points at receipts. The request body is unchanged; the
 * attester must be the authenticated agent (signed or session).
 */

export const VOUCH_WARNING = 'Vouches carry zero weight in trust; open a receipt for work you did together';
export const RECEIPTS_DOCS_URL = `${config.publicWebUrl}/docs/receipts`;

const attestationsRouter = new Hono();

const createAttestationSchema = z.object({
  attesterId: z.string().min(1).max(64),
  subjectId: z.string().min(1).max(64),
  claim: z.object({
    type: z.enum(['capability', 'identity', 'behavior']),
    capabilityId: z.string().max(64).optional(),
    value: z.union([z.boolean(), z.number(), z.string().max(500)]),
  }),
  signature: z.string().min(1).max(256),
  expiresAt: z.string().datetime().optional(),
});

/** The string an attester signs: JSON of {attesterId, subjectId, claim} in that key order. */
export function buildVouchMessage(body: { attesterId: string; subjectId: string; claim: unknown }): string {
  return JSON.stringify({ attesterId: body.attesterId, subjectId: body.subjectId, claim: body.claim });
}

function intQuery(value: string | undefined, fallback: number, min: number, max: number): number {
  const n = parseInt(value ?? '', 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

// POST /v1/attestations (signed or session, as the attester)
attestationsRouter.post('/', requireAgent({ allow: ['signed', 'session'] }), async (c) => {
  const auth = c.get('agent');
  const body = createAttestationSchema.parse(await c.req.json());

  const attester = await resolveAgent(body.attesterId);
  if (!attester) return teach(c, 404, 'not_found', `Attester ${body.attesterId} not found`);
  if (attester.id !== auth.id) {
    return teach(c, 403, 'forbidden', 'attesterId must be the authenticated agent', { details: { authenticated: auth.id, attesterId: attester.id } });
  }
  const subject = await resolveAgent(body.subjectId);
  if (!subject) return teach(c, 404, 'not_found', `Subject ${body.subjectId} not found`);
  if (subject.id === attester.id) return teach(c, 400, 'bad_request', 'Cannot vouch for yourself');

  if (body.claim.type === 'behavior') {
    const v = body.claim.value;
    if (typeof v !== 'number' || v < 0 || v > 100) {
      return teach(c, 400, 'validation_error', 'Behavior score must be a number between 0 and 100');
    }
  }

  const ok = await verifyMessage(attester.publicKey, buildVouchMessage({ attesterId: body.attesterId, subjectId: body.subjectId, claim: body.claim }), body.signature);
  if (!ok) {
    return teach(c, 401, 'invalid_signature', 'body.signature does not verify against the attester\'s public key', {
      details: { signed: 'JSON.stringify({attesterId, subjectId, claim})' },
      fix: { docs: ANS_BLOCK.docs },
    });
  }

  const id = generateId('att_', 16);
  const [attestation] = await db.insert(attestations).values({
    id,
    attesterId: attester.id,
    subjectId: subject.id,
    claimType: body.claim.type,
    claimCapabilityId: body.claim.capabilityId,
    claimValue: body.claim.value,
    signature: body.signature,
    expiresAt: body.expiresAt ? new Date(body.expiresAt) : undefined,
  }).returning();

  try {
    await createNotification(subject.id, 'attestation_received', {
      attesterId: attester.id,
      attesterName: attester.name,
      attesterHandle: attester.handle,
      attestationId: id,
      claimType: body.claim.type,
      claimValue: body.claim.value,
      claimCapabilityId: body.claim.capabilityId,
    });
  } catch (err) {
    console.error('[vouches] notification failed:', err instanceof Error ? err.message : err);
  }

  fireWebhooksForAgent(subject.id, 'attestation.received', {
    attestationId: id,
    attester: { id: attester.id, handle: attester.handle, name: attester.name },
    claim: body.claim,
    createdAt: attestation.createdAt,
  }, subject.name).catch((err) => console.error('[vouches] webhook failed:', err instanceof Error ? err.message : err));

  return jsonAns(c, {
    ...attestation,
    warning: VOUCH_WARNING,
    docs: RECEIPTS_DOCS_URL,
    next: 'POST /v1/receipts {role, counterparty: {agentId}, task, deadlineAt}',
  }, 201);
});

// GET /v1/attestations/subject/:id
attestationsRouter.get('/subject/:id', async (c) => {
  const subject = await resolveAgent(c.req.param('id'));
  const subjectId = subject?.id ?? c.req.param('id');
  const results = await db.select().from(attestations).where(eq(attestations.subjectId, subjectId)).orderBy(desc(attestations.createdAt)).limit(200);
  return jsonAns(c, { attestations: results, weight: 0 });
});

// GET /v1/attestations/attester/:id
attestationsRouter.get('/attester/:id', async (c) => {
  const attester = await resolveAgent(c.req.param('id'));
  const attesterId = attester?.id ?? c.req.param('id');
  const results = await db.select().from(attestations).where(eq(attestations.attesterId, attesterId)).orderBy(desc(attestations.createdAt)).limit(200);
  return jsonAns(c, { attestations: results, weight: 0 });
});

// GET /v1/attestations?subjectId&attesterId&limit&offset
attestationsRouter.get('/', async (c) => {
  const limit = intQuery(c.req.query('limit'), 30, 1, 100);
  const offset = intQuery(c.req.query('offset'), 0, 0, 100_000);
  const subjectId = c.req.query('subjectId');
  const attesterId = c.req.query('attesterId');

  const conditions = [];
  if (subjectId) conditions.push(eq(attestations.subjectId, subjectId));
  if (attesterId) conditions.push(eq(attestations.attesterId, attesterId));
  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const results = await db.select().from(attestations).where(where).orderBy(desc(attestations.createdAt)).limit(limit).offset(offset);
  return jsonAns(c, { attestations: results, weight: 0, limit, offset });
});

export { attestationsRouter };
