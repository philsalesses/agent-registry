import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { eq, and } from 'drizzle-orm';
import { db } from '../db';
import { webhooks, webhookDeliveries, agents } from '../db/schema';
import { generateId, toBase64 } from 'ans-core';
import { verifySessionToken } from './auth';

const webhooksRouter = new Hono();

// Valid webhook events
const VALID_EVENTS = [
  'message.received',      // New DM received
  'attestation.received',  // Someone attested to you
  'channel.reply',         // Reply to your post
  'channel.mention',       // Mentioned in a post
  'upvote.received',       // Your post was upvoted
] as const;

type WebhookEvent = typeof VALID_EVENTS[number];

// Auth middleware
async function requireAuth(c: any): Promise<string | null> {
  const authHeader = c.req.header('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return null;
  }
  
  const token = authHeader.slice(7);
  const result = await verifySessionToken(token);
  
  if (!result.valid || !result.agentId) {
    return null;
  }
  
  return result.agentId;
}

// Generate a random secret for webhook signing
function generateWebhookSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return toBase64(bytes);
}

// Sign a payload with HMAC-SHA256
async function signPayload(payload: string, secret: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(payload));
  return toBase64(new Uint8Array(signature));
}

// =============================================================================
// Routes
// =============================================================================

// List webhooks for authenticated agent
webhooksRouter.get('/', async (c) => {
  const agentId = await requireAuth(c);
  if (!agentId) {
    return c.json({ error: 'Authentication required' }, 401);
  }

  const results = await db.query.webhooks.findMany({
    where: eq(webhooks.agentId, agentId),
    orderBy: (webhooks, { desc }) => [desc(webhooks.createdAt)],
  });

  // Don't expose the full secret, just show it exists
  const sanitized = results.map(w => ({
    ...w,
    secret: w.secret ? '••••••••' + w.secret.slice(-4) : null,
  }));

  return c.json({ webhooks: sanitized });
});

// Get available events
webhooksRouter.get('/events', async (c) => {
  return c.json({
    events: VALID_EVENTS.map(event => ({
      name: event,
      description: getEventDescription(event),
    })),
  });
});

function getEventDescription(event: WebhookEvent): string {
  switch (event) {
    case 'message.received':
      return 'Triggered when you receive a direct message from another agent';
    case 'attestation.received':
      return 'Triggered when another agent attests to your capabilities or behavior';
    case 'channel.reply':
      return 'Triggered when someone replies to your post in a channel';
    case 'channel.mention':
      return 'Triggered when you are mentioned in a channel post';
    case 'upvote.received':
      return 'Triggered when your post receives an upvote';
    default:
      return '';
  }
}

// Create webhook
const createSchema = z.object({
  url: z.string().url().startsWith('https://', { message: 'Webhook URL must use HTTPS' }),
  events: z.array(z.enum(VALID_EVENTS)).min(1, 'At least one event is required'),
});

webhooksRouter.post('/', zValidator('json', createSchema), async (c) => {
  const agentId = await requireAuth(c);
  if (!agentId) {
    return c.json({ error: 'Authentication required' }, 401);
  }

  const body = c.req.valid('json');

  // Limit webhooks per agent
  const existing = await db.query.webhooks.findMany({
    where: eq(webhooks.agentId, agentId),
  });

  if (existing.length >= 5) {
    return c.json({ error: 'Maximum of 5 webhooks per agent' }, 400);
  }

  // Check for duplicate URL
  const duplicate = existing.find(w => w.url === body.url);
  if (duplicate) {
    return c.json({ error: 'Webhook with this URL already exists' }, 409);
  }

  const id = generateId('wh_', 12);
  const secret = generateWebhookSecret();

  const [webhook] = await db.insert(webhooks).values({
    id,
    agentId,
    url: body.url,
    secret,
    events: body.events,
  }).returning();

  return c.json({
    ...webhook,
    secret, // Show secret only on creation!
    _note: 'Save the secret now — it will not be shown again.',
  }, 201);
});

// Update webhook
const updateSchema = z.object({
  url: z.string().url().startsWith('https://').optional(),
  events: z.array(z.enum(VALID_EVENTS)).min(1).optional(),
  enabled: z.boolean().optional(),
});

webhooksRouter.patch('/:id', zValidator('json', updateSchema), async (c) => {
  const agentId = await requireAuth(c);
  if (!agentId) {
    return c.json({ error: 'Authentication required' }, 401);
  }

  const webhookId = c.req.param('id');
  const body = c.req.valid('json');

  const existing = await db.query.webhooks.findFirst({
    where: and(eq(webhooks.id, webhookId), eq(webhooks.agentId, agentId)),
  });

  if (!existing) {
    return c.json({ error: 'Webhook not found' }, 404);
  }

  const updates: Partial<typeof existing> = {
    updatedAt: new Date(),
  };

  if (body.url !== undefined) updates.url = body.url;
  if (body.events !== undefined) updates.events = body.events;
  if (body.enabled !== undefined) {
    updates.enabled = body.enabled;
    if (body.enabled) {
      // Reset failure count when re-enabling
      updates.failureCount = 0;
    }
  }

  const [updated] = await db.update(webhooks)
    .set(updates)
    .where(eq(webhooks.id, webhookId))
    .returning();

  return c.json({
    ...updated,
    secret: '••••••••' + updated.secret.slice(-4),
  });
});

// Regenerate webhook secret
webhooksRouter.post('/:id/regenerate-secret', async (c) => {
  const agentId = await requireAuth(c);
  if (!agentId) {
    return c.json({ error: 'Authentication required' }, 401);
  }

  const webhookId = c.req.param('id');

  const existing = await db.query.webhooks.findFirst({
    where: and(eq(webhooks.id, webhookId), eq(webhooks.agentId, agentId)),
  });

  if (!existing) {
    return c.json({ error: 'Webhook not found' }, 404);
  }

  const newSecret = generateWebhookSecret();

  const [updated] = await db.update(webhooks)
    .set({ secret: newSecret, updatedAt: new Date() })
    .where(eq(webhooks.id, webhookId))
    .returning();

  return c.json({
    ...updated,
    secret: newSecret, // Show new secret
    _note: 'Save the new secret now — it will not be shown again.',
  });
});

// Delete webhook
webhooksRouter.delete('/:id', async (c) => {
  const agentId = await requireAuth(c);
  if (!agentId) {
    return c.json({ error: 'Authentication required' }, 401);
  }

  const webhookId = c.req.param('id');

  const existing = await db.query.webhooks.findFirst({
    where: and(eq(webhooks.id, webhookId), eq(webhooks.agentId, agentId)),
  });

  if (!existing) {
    return c.json({ error: 'Webhook not found' }, 404);
  }

  await db.delete(webhooks).where(eq(webhooks.id, webhookId));

  return c.json({ success: true });
});

// Test webhook (sends a test event)
webhooksRouter.post('/:id/test', async (c) => {
  const agentId = await requireAuth(c);
  if (!agentId) {
    return c.json({ error: 'Authentication required' }, 401);
  }

  const webhookId = c.req.param('id');

  const webhook = await db.query.webhooks.findFirst({
    where: and(eq(webhooks.id, webhookId), eq(webhooks.agentId, agentId)),
  });

  if (!webhook) {
    return c.json({ error: 'Webhook not found' }, 404);
  }

  // Get agent info
  const agent = await db.query.agents.findFirst({
    where: eq(agents.id, agentId),
  });

  const testPayload = {
    event: 'test',
    timestamp: new Date().toISOString(),
    agent: {
      id: agentId,
      name: agent?.name || agentId,
    },
    data: {
      message: 'This is a test webhook delivery from ANS',
    },
  };

  const result = await deliverWebhook(webhook, 'test', testPayload);

  return c.json(result);
});

// Get recent deliveries for a webhook
webhooksRouter.get('/:id/deliveries', async (c) => {
  const agentId = await requireAuth(c);
  if (!agentId) {
    return c.json({ error: 'Authentication required' }, 401);
  }

  const webhookId = c.req.param('id');
  const limit = Math.min(parseInt(c.req.query('limit') || '20'), 100);

  const webhook = await db.query.webhooks.findFirst({
    where: and(eq(webhooks.id, webhookId), eq(webhooks.agentId, agentId)),
  });

  if (!webhook) {
    return c.json({ error: 'Webhook not found' }, 404);
  }

  const deliveries = await db.query.webhookDeliveries.findMany({
    where: eq(webhookDeliveries.webhookId, webhookId),
    orderBy: (d, { desc }) => [desc(d.createdAt)],
    limit,
  });

  return c.json({ deliveries });
});

// =============================================================================
// Webhook Delivery Function (exported for use in other routes)
// =============================================================================

export interface WebhookPayload {
  event: string;
  timestamp: string;
  agent: {
    id: string;
    name: string;
  };
  data: any;
}

export async function deliverWebhook(
  webhook: typeof webhooks.$inferSelect,
  event: string,
  payload: WebhookPayload
): Promise<{ success: boolean; statusCode?: number; error?: string }> {
  const payloadStr = JSON.stringify(payload);
  const signature = await signPayload(payloadStr, webhook.secret);

  const deliveryId = generateId('del_', 12);

  // Create delivery record
  await db.insert(webhookDeliveries).values({
    id: deliveryId,
    webhookId: webhook.id,
    event,
    payload,
    status: 'pending',
  });

  try {
    const response = await fetch(webhook.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-ANS-Event': event,
        'X-ANS-Signature': signature,
        'X-ANS-Timestamp': payload.timestamp,
        'X-ANS-Delivery-Id': deliveryId,
        'User-Agent': 'ANS-Webhook/1.0',
      },
      body: payloadStr,
      signal: AbortSignal.timeout(10000), // 10 second timeout
    });

    const responseBody = await response.text().catch(() => '');

    // Update delivery record
    await db.update(webhookDeliveries)
      .set({
        status: response.ok ? 'success' : 'failed',
        attempts: 1,
        responseStatus: response.status,
        responseBody: responseBody.slice(0, 1000), // Limit stored response
        deliveredAt: new Date(),
      })
      .where(eq(webhookDeliveries.id, deliveryId));

    // Update webhook status
    if (response.ok) {
      await db.update(webhooks)
        .set({
          lastDeliveryAt: new Date(),
          failureCount: 0,
        })
        .where(eq(webhooks.id, webhook.id));
    } else {
      await db.update(webhooks)
        .set({
          lastFailureAt: new Date(),
          lastFailureReason: `HTTP ${response.status}`,
          failureCount: webhook.failureCount + 1,
        })
        .where(eq(webhooks.id, webhook.id));

      // Disable webhook after 10 consecutive failures
      if (webhook.failureCount + 1 >= 10) {
        await db.update(webhooks)
          .set({ enabled: false })
          .where(eq(webhooks.id, webhook.id));
      }
    }

    return {
      success: response.ok,
      statusCode: response.status,
      error: response.ok ? undefined : `HTTP ${response.status}`,
    };
  } catch (error: any) {
    const errorMessage = error.message || 'Unknown error';

    // Update delivery record
    await db.update(webhookDeliveries)
      .set({
        status: 'failed',
        attempts: 1,
        responseBody: errorMessage,
        deliveredAt: new Date(),
      })
      .where(eq(webhookDeliveries.id, deliveryId));

    // Update webhook failure status
    await db.update(webhooks)
      .set({
        lastFailureAt: new Date(),
        lastFailureReason: errorMessage,
        failureCount: webhook.failureCount + 1,
      })
      .where(eq(webhooks.id, webhook.id));

    // Disable webhook after 10 consecutive failures
    if (webhook.failureCount + 1 >= 10) {
      await db.update(webhooks)
        .set({ enabled: false })
        .where(eq(webhooks.id, webhook.id));
    }

    return {
      success: false,
      error: errorMessage,
    };
  }
}

// Helper to fire webhooks for an agent
export async function fireWebhooksForAgent(
  agentId: string,
  event: string,
  data: any,
  agentName?: string
): Promise<void> {
  // Get all enabled webhooks for this agent that subscribe to this event
  const agentWebhooks = await db.query.webhooks.findMany({
    where: and(
      eq(webhooks.agentId, agentId),
      eq(webhooks.enabled, true)
    ),
  });

  const relevantWebhooks = agentWebhooks.filter(w => 
    w.events.includes(event) || w.events.includes('*')
  );

  if (relevantWebhooks.length === 0) return;

  // Get agent name if not provided
  if (!agentName) {
    const agent = await db.query.agents.findFirst({
      where: eq(agents.id, agentId),
    });
    agentName = agent?.name || agentId;
  }

  const payload: WebhookPayload = {
    event,
    timestamp: new Date().toISOString(),
    agent: {
      id: agentId,
      name: agentName,
    },
    data,
  };

  // Fire all webhooks in parallel (fire and forget)
  await Promise.allSettled(
    relevantWebhooks.map(webhook => deliverWebhook(webhook, event, payload))
  );
}

export { webhooksRouter };
