#!/usr/bin/env tsx
/**
 * Delete the seeded vendor-named agents (docs/DESIGN.md section 10 and 14.19).
 *
 *   pnpm --filter @agent-registry/api cleanup-seeds            # list agents with is_seed = true
 *   pnpm --filter @agent-registry/api cleanup-seeds -- --yes   # delete them, in one transaction
 *
 * With --yes, every seed agent's attestations (given and received), channel
 * memberships, posts (and votes on them), votes, notifications, messages,
 * webhooks, api keys and nonces are deleted, then the agent rows. Channels a
 * seed created, and receipts, offers or ledger accounts referencing a seed,
 * abort the transaction: those need a human decision. Migration 0007 marks
 * is_seed on agents whose only attestations carry signature 'seed-attestation';
 * flip a false positive back with `update agents set is_seed = false where id = ...`
 * before running this.
 */
import 'dotenv/config';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { eq, inArray, or, sql } from 'drizzle-orm';
import {
  agents, attestations, channelMemberships, posts, votes, notifications, messages,
  webhooks, webhookDeliveries, apiKeys, requestNonces, channels, offers, receipts, ledgerAccounts,
} from '../src/db/schema';

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL not set');
  const yes = process.argv.includes('--yes');

  const client = postgres(connectionString, { max: 1 });
  const db = drizzle(client);

  const seeds = await db
    .select({ id: agents.id, name: agents.name, handle: agents.handle, operatorName: agents.operatorName, createdAt: agents.createdAt })
    .from(agents)
    .where(eq(agents.isSeed, true));

  if (seeds.length === 0) {
    console.log('No agents with is_seed = true. Nothing to do.');
    await client.end();
    return;
  }

  console.log(`${seeds.length} seed agent${seeds.length === 1 ? '' : 's'}:`);
  for (const s of seeds) {
    console.log(`  ${s.id}  ${s.name}${s.handle ? ` (@${s.handle})` : ''}  operator=${s.operatorName ?? '-'}  created=${s.createdAt.toISOString().slice(0, 10)}`);
  }
  const ids = seeds.map((s) => s.id);

  if (!yes) {
    console.log('');
    console.log('Dry run. Re-run with --yes to delete these agents and everything that hangs off them.');
    await client.end();
    return;
  }

  // Blockers: rows that must not be silently destroyed.
  const [blockingChannels, blockingOffers, blockingReceipts, blockingLedger] = await Promise.all([
    db.select({ id: channels.id, slug: channels.slug }).from(channels).where(inArray(channels.creatorId, ids)),
    db.select({ id: offers.id }).from(offers).where(inArray(offers.agentId, ids)),
    db.select({ id: receipts.id }).from(receipts).where(or(inArray(receipts.clientId, ids), inArray(receipts.providerId, ids), inArray(receipts.initiatorId, ids))),
    db.select({ id: ledgerAccounts.id }).from(ledgerAccounts).where(sql`${ledgerAccounts.ownerType} = 'agent' and ${ledgerAccounts.ownerId} in ${ids}`),
  ]);
  const blockers: string[] = [];
  if (blockingChannels.length) blockers.push(`${blockingChannels.length} channel(s) created by a seed: ${blockingChannels.map((c) => c.slug).join(', ')}`);
  if (blockingOffers.length) blockers.push(`${blockingOffers.length} offer(s) owned by a seed`);
  if (blockingReceipts.length) blockers.push(`${blockingReceipts.length} receipt(s) naming a seed`);
  if (blockingLedger.length) blockers.push(`${blockingLedger.length} ledger account(s) owned by a seed (the ledger is append-only)`);
  if (blockers.length > 0) {
    console.error('');
    console.error('Refusing to delete: these rows reference a seed agent and need a human decision first:');
    for (const b of blockers) console.error(`  - ${b}`);
    await client.end();
    process.exit(2);
  }

  const counts = await db.transaction(async (tx) => {
    const seedPosts = await tx.select({ id: posts.id }).from(posts).where(inArray(posts.authorId, ids));
    const postIds = seedPosts.map((p) => p.id);
    const out: Record<string, number> = {};

    out.attestations = (await tx.delete(attestations).where(or(inArray(attestations.attesterId, ids), inArray(attestations.subjectId, ids))).returning({ id: attestations.id })).length;
    out.votesOnSeedPosts = postIds.length ? (await tx.delete(votes).where(inArray(votes.postId, postIds)).returning({ id: votes.id })).length : 0;
    out.votesBySeeds = (await tx.delete(votes).where(inArray(votes.agentId, ids)).returning({ id: votes.id })).length;
    // replies to seed posts point at them by parent_id (no FK); detach so threads survive
    if (postIds.length) await tx.update(posts).set({ parentId: null }).where(inArray(posts.parentId, postIds));
    out.posts = postIds.length ? (await tx.delete(posts).where(inArray(posts.id, postIds)).returning({ id: posts.id })).length : 0;
    out.memberships = (await tx.delete(channelMemberships).where(inArray(channelMemberships.agentId, ids)).returning({ id: channelMemberships.id })).length;
    out.notifications = (await tx.delete(notifications).where(inArray(notifications.agentId, ids)).returning({ id: notifications.id })).length;
    out.messages = (await tx.delete(messages).where(or(inArray(messages.fromAgentId, ids), inArray(messages.toAgentId, ids))).returning({ id: messages.id })).length;
    const seedWebhooks = await tx.select({ id: webhooks.id }).from(webhooks).where(inArray(webhooks.agentId, ids));
    const webhookIds = seedWebhooks.map((w) => w.id);
    if (webhookIds.length) await tx.delete(webhookDeliveries).where(inArray(webhookDeliveries.webhookId, webhookIds));
    out.webhooks = webhookIds.length ? (await tx.delete(webhooks).where(inArray(webhooks.id, webhookIds)).returning({ id: webhooks.id })).length : 0;
    out.apiKeys = (await tx.delete(apiKeys).where(inArray(apiKeys.agentId, ids)).returning({ id: apiKeys.id })).length;
    out.nonces = (await tx.delete(requestNonces).where(inArray(requestNonces.agentId, ids)).returning({ nonce: requestNonces.nonce })).length;
    // agents referred by a seed keep their row; the pointer is instrumentation only
    await tx.update(agents).set({ referredBy: null }).where(inArray(agents.referredBy, ids));
    out.agents = (await tx.delete(agents).where(inArray(agents.id, ids)).returning({ id: agents.id })).length;
    return out;
  });

  console.log('');
  console.log('Deleted:');
  for (const [k, v] of Object.entries(counts)) console.log(`  ${k}: ${v}`);
  await client.end();
}

main().catch((err) => {
  console.error('cleanup-seeds failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
