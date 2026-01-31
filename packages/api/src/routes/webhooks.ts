import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { eq, and } from 'drizzle-orm';
import { db } from '../db';
import { agents } from '../db/schema';
import { pgTable, text, timestamp, jsonb } from 'drizzle-orm/pg-core';

// Webhook subscriptions table (we'll add this to schema)
// For now, store in agent metadata

const webhooksRouter = new Hono();

/**
 * Webhook events:
 * - agent.registered - New agent registered
 * - agent.updated - Agent profile updated
 * - attestation.created - Someone attested to an agent
 * - attestation.received - Your agent received an attestation
 */

const subscribeSchema = z.object({
  url: z.string().url(),
  events: z.array(z.enum([
    'agent.registered',
    'agent.updated', 
    'attestation.created',
    'attestation.received',
  ])),
  secret: z.string().optional(), // For HMAC signing
});

/**
 * Subscribe to webhooks for your agent
 */
webhooksRouter.post('/subscribe', zValidator('json', subscribeSchema), async (c) => {
  const agentId = c.req.header('X-Agent-Id');
  const privateKey = c.req.header('X-Agent-Private-Key');
  
  if (!agentId || !privateKey) {
    return c.json({ error: 'Authentication required (X-Agent-Id and X-Agent-Private-Key headers)' }, 401);
  }

  const agent = await db.query.agents.findFirst({
    where: eq(agents.id, agentId),
  });

  if (!agent) {
    return c.json({ error: 'Agent not found' }, 404);
  }

  // Verify private key matches public key
  const { sign, toBase64, fromBase64, verify } = await import('ans-core');
  try {
    const testMessage = new TextEncoder().encode('verify');
    const pk = fromBase64(privateKey);
    const sig = await sign(testMessage, pk);
    const pubKey = fromBase64(agent.publicKey);
    const isValid = await verify(sig, testMessage, pubKey);
    if (!isValid) {
      return c.json({ error: 'Invalid private key' }, 401);
    }
  } catch {
    return c.json({ error: 'Invalid private key format' }, 401);
  }

  const body = c.req.valid('json');

  // Store webhook config in agent metadata
  const webhooks = {
    url: body.url,
    events: body.events,
    secret: body.secret,
    createdAt: new Date().toISOString(),
  };

  await db.update(agents)
    .set({
      metadata: { ...(agent.metadata as object || {}), webhooks },
      updatedAt: new Date(),
    })
    .where(eq(agents.id, agentId));

  return c.json({ 
    success: true, 
    message: 'Webhook subscription created',
    events: body.events,
  });
});

/**
 * Get webhook subscription for your agent
 */
webhooksRouter.get('/subscription', async (c) => {
  const agentId = c.req.header('X-Agent-Id');
  
  if (!agentId) {
    return c.json({ error: 'X-Agent-Id header required' }, 400);
  }

  const agent = await db.query.agents.findFirst({
    where: eq(agents.id, agentId),
  });

  if (!agent) {
    return c.json({ error: 'Agent not found' }, 404);
  }

  const webhooks = (agent.metadata as any)?.webhooks;
  
  if (!webhooks) {
    return c.json({ subscribed: false });
  }

  return c.json({
    subscribed: true,
    url: webhooks.url,
    events: webhooks.events,
    createdAt: webhooks.createdAt,
  });
});

/**
 * Unsubscribe from webhooks
 */
webhooksRouter.delete('/subscription', async (c) => {
  const agentId = c.req.header('X-Agent-Id');
  const privateKey = c.req.header('X-Agent-Private-Key');
  
  if (!agentId || !privateKey) {
    return c.json({ error: 'Authentication required' }, 401);
  }

  const agent = await db.query.agents.findFirst({
    where: eq(agents.id, agentId),
  });

  if (!agent) {
    return c.json({ error: 'Agent not found' }, 404);
  }

  // Remove webhooks from metadata
  const metadata = { ...(agent.metadata as object || {}) };
  delete (metadata as any).webhooks;

  await db.update(agents)
    .set({ metadata, updatedAt: new Date() })
    .where(eq(agents.id, agentId));

  return c.json({ success: true, message: 'Webhook subscription removed' });
});

/**
 * Send a webhook (internal use)
 */
export async function sendWebhook(
  agentId: string, 
  event: string, 
  payload: any
): Promise<void> {
  const agent = await db.query.agents.findFirst({
    where: eq(agents.id, agentId),
  });

  if (!agent) return;

  const webhooks = (agent.metadata as any)?.webhooks;
  if (!webhooks || !webhooks.events.includes(event)) return;

  const body = JSON.stringify({
    event,
    timestamp: new Date().toISOString(),
    agentId,
    data: payload,
  });

  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-AgentRegistry-Event': event,
    };

    // HMAC signature if secret provided
    if (webhooks.secret) {
      const encoder = new TextEncoder();
      const key = await crypto.subtle.importKey(
        'raw',
        encoder.encode(webhooks.secret),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign']
      );
      const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(body));
      const signatureHex = Array.from(new Uint8Array(signature))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
      headers['X-AgentRegistry-Signature'] = `sha256=${signatureHex}`;
    }

    await fetch(webhooks.url, {
      method: 'POST',
      headers,
      body,
      signal: AbortSignal.timeout(10000), // 10s timeout
    });
  } catch (error) {
    console.error(`Webhook delivery failed for ${agentId}:`, error);
  }
}

export { webhooksRouter };
