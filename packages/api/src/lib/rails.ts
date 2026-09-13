import { stripeRail } from './rails-stripe';

/**
 * The rails seam (docs/DESIGN.md section 6). External money only ever enters
 * or leaves the ledger through a `topup` or `payout` txn against a clearing
 * account, so adding x402 USDC or Lightning later is one more Rail registered
 * here; nothing inside the ledger or the receipt code changes.
 */

export type RailId = 'stripe' | 'lightning' | 'usdc';

export const RAIL_IDS: readonly RailId[] = ['stripe', 'lightning', 'usdc'];

export interface RailTopup {
  /** Hosted page where a human completes the payment (Stripe Checkout) */
  url?: string;
  /** Out-of-band instructions for rails without a hosted page */
  instructions?: string;
}

export interface Rail {
  id: RailId;
  /** False while configuration keeps the rail switched off */
  enabled(): boolean;
  /** Start a top-up of `amountMicros` cash credit for `agentId`. The credit posts when the rail settles. */
  topup(agentId: string, amountMicros: bigint): Promise<RailTopup>;
  /** Apply a verified settlement notification from the rail (for Stripe, a webhook event) */
  onSettled(event: unknown): Promise<void>;
  /** Push held cash out to a destination. No rail implements this yet: payouts are manual until Stripe Connect ships. */
  payout?(agentId: string, amountMicros: bigint, destination: unknown): Promise<void>;
}

const registry = new Map<RailId, Rail>();

export function isRailId(id: string): id is RailId {
  return (RAIL_IDS as readonly string[]).includes(id);
}

/** Register (or replace) the implementation for a rail id. */
export function registerRail(rail: Rail): void {
  registry.set(rail.id, rail);
}

/** The registered rail for `id`, or undefined when no implementation exists (lightning and usdc have none). */
export function getRail(id: string): Rail | undefined {
  return isRailId(id) ? registry.get(id) : undefined;
}

export function listRails(): Rail[] {
  return Array.from(registry.values());
}

registerRail(stripeRail);
