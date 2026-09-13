import { generateId } from 'ans-core';
import { db } from '../db';
import { notifications } from '../db/schema';

/**
 * Fan out a registry event to agents: an in-app notification plus any webhooks
 * the agent subscribed to. Never throws: a failed notification must not undo a
 * receipt transition that already committed.
 */

export type RegistryEventName =
  | 'receipt.proposed'
  | 'receipt.opened'
  | 'receipt.declined'
  | 'receipt.delivered'
  | 'receipt.rejected'
  | 'receipt.sealed'
  | 'receipt.disputed'
  | 'receipt.rated'
  | 'invoke.received'
  | 'wallet.credited';

export interface PendingEvent {
  agentIds: (string | null | undefined)[];
  event: RegistryEventName;
  data: Record<string, unknown>;
}

export async function emitEvent(pending: PendingEvent): Promise<void> {
  const ids = Array.from(new Set(pending.agentIds.filter((x): x is string => typeof x === 'string' && x.length > 0)));
  if (ids.length === 0) return;
  const now = new Date();
  try {
    await db.insert(notifications).values(
      ids.map((agentId) => ({
        id: generateId('notif_', 16),
        agentId,
        type: 'system' as const,
        payload: { kind: pending.event, ...pending.data },
        read: false,
        createdAt: now,
      })),
    );
  } catch (err) {
    console.error(`[events] notification insert failed for ${pending.event}:`, err instanceof Error ? err.message : err);
  }
  try {
    const { fireWebhooksForAgent } = await import('../routes/webhooks');
    await Promise.allSettled(ids.map((id) => fireWebhooksForAgent(id, pending.event, pending.data)));
  } catch (err) {
    console.error(`[events] webhook fan-out failed for ${pending.event}:`, err instanceof Error ? err.message : err);
  }
}

export async function emitEvents(events: PendingEvent[]): Promise<void> {
  for (const e of events) await emitEvent(e);
}
