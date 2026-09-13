/**
 * Test support for the MCP suites (packages/api/src/__tests__/mcp.test.ts and
 * packages/mcp/src/__tests__/cli.integration.test.ts). Never imported by the
 * app. It lives here so the ans-mcp package tests can reach the API database
 * without depending on drizzle themselves.
 */
import { and, eq, inArray, or } from 'drizzle-orm';
import { db } from '../db';
import { agents, funnelEvents, ledgerTxns, notifications, offers, ratings, receiptEvents, receipts } from '../db/schema';
import { agentAccountIds, deleteTestAgents, purgeLedger } from '../__tests__/helpers';

/** Delete everything the MCP tests create for these agents: receipts, ratings, offers, ledger rows, notifications, keys, the agents. */
export async function deleteMcpTestData(agentIds: string[]): Promise<void> {
  if (agentIds.length === 0) return;
  const receiptRows = await db
    .select({ id: receipts.id })
    .from(receipts)
    .where(or(inArray(receipts.clientId, agentIds), inArray(receipts.providerId, agentIds), inArray(receipts.initiatorId, agentIds)));
  const receiptIds = receiptRows.map((r) => r.id);
  const offerRows = await db.select({ id: offers.id }).from(offers).where(inArray(offers.agentId, agentIds));
  const offerIds = offerRows.map((o) => o.id);
  const txns = await db
    .select({ id: ledgerTxns.id })
    .from(ledgerTxns)
    .where(
      or(
        and(eq(ledgerTxns.refType, 'agent'), inArray(ledgerTxns.refId, agentIds)),
        receiptIds.length ? and(eq(ledgerTxns.refType, 'receipt'), inArray(ledgerTxns.refId, receiptIds)) : undefined,
      ),
    );
  if (receiptIds.length) {
    await db.delete(ratings).where(inArray(ratings.receiptId, receiptIds));
    await db.delete(receiptEvents).where(inArray(receiptEvents.receiptId, receiptIds));
    await db.delete(funnelEvents).where(inArray(funnelEvents.receiptId, receiptIds));
    await db.delete(receipts).where(inArray(receipts.id, receiptIds));
  }
  if (offerIds.length) {
    await db.delete(funnelEvents).where(inArray(funnelEvents.offerId, offerIds));
    await db.delete(offers).where(inArray(offers.id, offerIds));
  }
  await purgeLedger({ txnIds: txns.map((t) => t.id), accountIds: await agentAccountIds(agentIds) });
  await db.delete(funnelEvents).where(inArray(funnelEvents.agentId, agentIds));
  await db.delete(notifications).where(inArray(notifications.agentId, agentIds));
  await deleteTestAgents(agentIds);
}

/** The stored signatures of a receipt and its ratings (to assert real signatures versus registry attestations). */
export async function receiptSignaturesForTest(receiptId: string) {
  const [row] = await db.select().from(receipts).where(eq(receipts.id, receiptId));
  const rows = await db.select({ raterId: ratings.raterId, signature: ratings.signature }).from(ratings).where(eq(ratings.receiptId, receiptId));
  return row
    ? { initiatorSig: row.initiatorSig, counterpartySig: row.counterpartySig, deliverSig: row.deliverSig, verdictSig: row.verdictSig, state: row.state, ratings: rows }
    : null;
}

/** The agent row's registration metadata. */
export async function agentMetadataForTest(agentId: string): Promise<{ handle: string | null; metadata: Record<string, unknown> | null } | null> {
  const [row] = await db.select({ handle: agents.handle, metadata: agents.metadata }).from(agents).where(eq(agents.id, agentId));
  return row ? { handle: row.handle, metadata: (row.metadata as Record<string, unknown> | null) ?? null } : null;
}
