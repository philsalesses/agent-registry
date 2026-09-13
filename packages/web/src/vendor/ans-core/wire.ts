/**
 * JSON wire shapes for public API responses.
 *
 * One contract shared by the API (producer), the SDK, the MCP server and the web app (consumers).
 * Rules: timestamps are ISO 8601 strings, money is USD micros as decimal strings,
 * nullable fields are present with null rather than omitted.
 */
import type { ReceiptState, ReceiptRole, ReceiptVia, CreditClass, ReceiptActor } from './receipts';

export type WireAgentType = 'assistant' | 'autonomous' | 'tool' | 'service';
export type WireAgentStatus = 'online' | 'offline' | 'maintenance' | 'unknown';

export interface WireTrust {
  score: number;
  confidence: number;
  rank: number;
  computedAt: string | null;
}

export interface WireReceiptCounts {
  confirmed: number;
  unconfirmed: number;
  unreviewed: number;
  negative: number;
  noReview: number;
}

export interface WirePolicy {
  requireRegistered: boolean;
  minTrust: number;
}

/** The `_ans` block carried by public JSON responses */
export interface WireAnsBlock {
  docs: string;
  register: string;
  skill: string;
  verify: string;
}

/** Compact party reference used inside receipts, offers and feeds */
export interface WireAgentRef {
  id: string;
  handle: string | null;
  name: string;
  avatar: string | null;
  trust: { score: number; confidence: number; rank: number };
  isHouse: boolean;
}

export interface WireOfferSummary {
  id: string;
  /** '@handle/slug@version' */
  name: string;
  slug: string;
  version: number;
  title: string;
  description: string;
  tags: string[];
  priceMicros: string;
  status: 'active' | 'paused' | 'retired';
  /** Top-level property names of the input schema, required ones first */
  inputFields: string[];
  outputFields: string[];
  stats: WireOfferStats;
  owner: WireAgentRef;
  urls: WireOfferUrls;
}

export interface WireOfferStats {
  calls: number;
  ok: number;
  failed: number;
  timeout: number;
  inputInvalid: number;
  outputInvalid: number;
  p50Ms: number | null;
  p95Ms: number | null;
  lastCalledAt: string | null;
}

export interface WireOfferUrls {
  page: string;
  mcp: string;
  skill: string;
  inputSchema: string;
  outputSchema: string;
  badge: string;
}

export interface WireOffer extends WireOfferSummary {
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  inputSchemaHash: string;
  outputSchemaHash: string;
  examples: { input: unknown; output: unknown }[];
  endpointHost: string | null;
  timeoutMs: number;
  mode: 'sync';
  requires: { secrets?: string[]; callbackUrl?: boolean; notes?: string } | null;
  feeds: string[];
  probeOk: boolean | null;
  probedAt: string | null;
  createdAt: string;
}

export interface WireRating {
  raterId: string;
  subjectId: string;
  score: number;
  tags: string[];
  note: string | null;
  createdAt: string;
}

export interface WireReceiptEvent {
  id: string;
  fromState: ReceiptState | null;
  toState: ReceiptState;
  actor: ReceiptActor;
  note: string | null;
  createdAt: string;
}

/**
 * The public receipt record: never includes payloads, claim tokens or hint contact details.
 */
export interface WireReceipt {
  id: string;
  url: string;
  state: ReceiptState;
  confirmed: boolean;
  via: ReceiptVia;
  initiatorRole: ReceiptRole;
  client: WireAgentRef | null;
  provider: WireAgentRef | null;
  /** Present only while the counterparty is an unclaimed hint; url is plain text, never a link */
  counterpartyHint: { name: string; url: string | null } | null;
  task: string;
  offer: { id: string; name: string; title: string } | null;
  priceMicros: string;
  feeMicros: string;
  feeBps: number;
  creditClass: CreditClass;
  inputHash: string | null;
  outputHash: string | null;
  deadlineAt: string;
  reviewWindowSec: number;
  termsHash: string;
  signatures: {
    initiator: boolean;
    counterparty: boolean;
    deliver: boolean;
    verdict: boolean;
    /** 'attested' for proxy receipts: the registry verified the caller's request signature at open */
    callerSig: 'signed' | 'attested';
    /** Signatures the registry attested on a party's behalf (api-key and proxy flows) instead of the party signing */
    attested: ('initiator' | 'counterparty' | 'deliver' | 'verdict')[];
  };
  ratings: {
    /** Ratings stay sealed until both are in or the review window closes */
    revealed: boolean;
    client: WireRating | null;
    provider: WireRating | null;
  };
  hash: string | null;
  prevHashClient: string | null;
  prevHashProvider: string | null;
  openedAt: string | null;
  acceptedAt: string | null;
  deliveredAt: string | null;
  verdictAt: string | null;
  sealedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
  events?: WireReceiptEvent[];
}

export interface WireReceiptList {
  receipts: WireReceipt[];
  nextCursor: string | null;
}

export interface WireBalances {
  available: string;
  held: string;
}

export interface WireWallet {
  agentId: string;
  cash: WireBalances;
  payoutEligibleMicros: string;
  caps: { cashBalanceMicros: string; payoutHoldDays: number };
  topup: { enabled: boolean; packsMicros: string[]; reason: string | null };
  manualPayouts: boolean;
  ledgerUrl: string;
}

export interface WireLedgerEntry {
  txnId: string;
  type: string;
  refType: string | null;
  refId: string | null;
  klass: 'cash';
  kind: 'available' | 'held';
  amountMicros: string;
  createdAt: string;
}

export interface WireVerify {
  registered: boolean;
  id: string | null;
  handle: string | null;
  name: string | null;
  trust: { score: number; confidence: number; rank: number } | null;
  receipts: WireReceiptCounts | null;
  tier: number | null;
  lastSeen: string | null;
  policy: { requireRegistered: boolean; minTrust: number } | null;
  isHouse: boolean;
  fix: { url: string; command: string; docs: string } | null;
  _ans: WireAnsBlock;
}

export interface WireRegistryTotals {
  agents: number;
  receiptsSealed: number;
  receiptsOpen: number;
  offersActive: number;
  volumeMicros: string;
  feeBps: number;
}
