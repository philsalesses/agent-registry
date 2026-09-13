import { Hono } from 'hono';
import { z } from 'zod';
import { and, eq, gt, isNull, lt } from 'drizzle-orm';
import { ANS_BLOCK, generateId, toBase64, randomBytes, verifyMessage } from 'ans-core';
import { db } from '../db';
import { challenges, agents } from '../db/schema';
import { config } from '../config';
import { createSessionToken, resolveAgent, verifySessionToken, SESSION_DURATION_MS } from '../lib/auth';
import { jsonAns, teach } from '../lib/errors';

/**
 * Challenge flow for web sessions (docs/DESIGN.md section 4). The browser
 * holds the agent key and signs the challenge nonce; the API answers with an
 * HMAC session token that carries only {agentId, exp}. POST /v1/auth/session
 * (raw private key in the body) no longer exists.
 */

const authRouter = new Hono();

const CHALLENGE_TTL_MS = 5 * 60 * 1000;
let lastChallengePrune = 0;

function sessionAgent(a: typeof agents.$inferSelect) {
  return { id: a.id, handle: a.handle, name: a.name, type: a.type, avatar: a.avatar };
}

// POST /v1/auth/challenge -> {id, nonce, expiresAt}
authRouter.post('/challenge', async (c) => {
  const now = new Date();
  const id = generateId('ch_', 16);
  const nonce = toBase64(randomBytes(32));
  const expiresAt = new Date(now.getTime() + CHALLENGE_TTL_MS);
  await db.insert(challenges).values({ id, nonce, expiresAt, createdAt: now });

  if (now.getTime() - lastChallengePrune > 60_000) {
    lastChallengePrune = now.getTime();
    void db.delete(challenges).where(lt(challenges.expiresAt, new Date(now.getTime() - 60 * 60 * 1000))).catch(() => undefined);
  }

  return jsonAns(c, {
    id,
    nonce,
    expiresAt: expiresAt.toISOString(),
    sign: 'base64 Ed25519 over the nonce string (UTF-8), then POST /v1/auth/verify {challengeId, agentId, signature}',
  });
});

// POST /v1/auth/verify {challengeId, agentId (id or handle), signature} -> {token, expiresIn, agent}
const verifySchema = z.object({
  challengeId: z.string().min(1).max(64),
  agentId: z.string().min(1).max(64),
  signature: z.string().min(1).max(256),
});

authRouter.post('/verify', async (c) => {
  const body = verifySchema.parse(await c.req.json());
  const now = new Date();

  const challenge = await db.query.challenges.findFirst({
    where: and(eq(challenges.id, body.challengeId), isNull(challenges.usedAt), gt(challenges.expiresAt, now)),
  });
  if (!challenge) {
    return teach(c, 400, 'bad_request', 'Challenge is unknown, expired or already used', { fix: { docs: ANS_BLOCK.docs, next: 'POST /v1/auth/challenge for a fresh nonce' } });
  }

  const agent = await resolveAgent(body.agentId);
  if (!agent) return teach(c, 404, 'not_found', `Agent ${body.agentId} not found`);

  const ok = await verifyMessage(agent.publicKey, challenge.nonce, body.signature);
  if (!ok) {
    return teach(c, 401, 'invalid_signature', 'Signature does not verify against the agent\'s public key', {
      details: { signed: 'the challenge nonce string, UTF-8' },
      fix: { docs: ANS_BLOCK.docs },
    });
  }

  // Single use: claim the challenge atomically so a replayed verify fails.
  const claimed = await db
    .update(challenges)
    .set({ usedAt: now })
    .where(and(eq(challenges.id, challenge.id), isNull(challenges.usedAt)))
    .returning({ id: challenges.id });
  if (claimed.length === 0) {
    return teach(c, 400, 'bad_request', 'Challenge was already used');
  }

  const token = await createSessionToken(agent.id);
  return jsonAns(c, {
    authenticated: true,
    token,
    tokenType: 'Bearer',
    expiresIn: SESSION_DURATION_MS,
    agent: sessionAgent(agent),
  });
});

// GET /v1/auth/session: validate a Bearer session token
authRouter.get('/session', async (c) => {
  const authz = c.req.header('Authorization') ?? '';
  if (!/^Bearer\s+/i.test(authz)) {
    return teach(c, 401, 'unauthorized', 'Send Authorization: Bearer <session token>', { fix: { docs: ANS_BLOCK.docs, url: `${config.publicWebUrl}/login` } });
  }
  const token = authz.replace(/^Bearer\s+/i, '').trim();
  if (token.startsWith('ak_')) {
    return teach(c, 400, 'bad_request', 'That is an API key, not a session token; API keys are validated by the route they are used on');
  }
  const result = await verifySessionToken(token);
  if (!result.valid || !result.agentId) {
    return teach(c, 401, 'unauthorized', 'Session token is invalid or expired', { fix: { docs: ANS_BLOCK.docs, url: `${config.publicWebUrl}/login` } });
  }
  const agent = await db.query.agents.findFirst({ where: eq(agents.id, result.agentId) });
  if (!agent) return teach(c, 401, 'unauthorized', 'Session agent no longer exists');
  return jsonAns(c, { valid: true, agent: sessionAgent(agent) });
});

export { authRouter };
