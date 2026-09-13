import { canonicalize, sha256hex } from './canonical';

// =============================================================================
// States and transitions (docs/DESIGN.md sections 4, 5 and 14.5)
// =============================================================================

export type ReceiptState =
  | 'proposed'
  | 'open'
  | 'delivered'
  | 'accepted'
  | 'rejected'
  | 'disputed'
  | 'resolved_client'
  | 'resolved_provider'
  | 'split'
  | 'unreviewed'
  | 'timed_out'
  | 'failed'
  | 'output_invalid'
  | 'cancelled_client'
  | 'cancelled_provider'
  | 'declined'
  | 'expired';

export const RECEIPT_STATES: readonly ReceiptState[] = [
  'proposed',
  'open',
  'delivered',
  'accepted',
  'rejected',
  'disputed',
  'resolved_client',
  'resolved_provider',
  'split',
  'unreviewed',
  'timed_out',
  'failed',
  'output_invalid',
  'cancelled_client',
  'cancelled_provider',
  'declined',
  'expired',
];

/**
 * States after which the receipt's money is settled and the trust formula reads it.
 * `unreviewed` is terminal for settlement, but the client may still dispute it
 * within 7 days, which is why allowedTransitions lists unreviewed -> disputed.
 */
export const TERMINAL_STATES: ReadonlySet<ReceiptState> = new Set<ReceiptState>([
  'accepted',
  'resolved_client',
  'resolved_provider',
  'split',
  'unreviewed',
  'timed_out',
  'failed',
  'output_invalid',
  'cancelled_client',
  'cancelled_provider',
  'declined',
  'expired',
]);

/**
 * States that never had both signatures: they appear on no profile and never enter trust.
 */
export const UNCONFIRMED_STATES: ReadonlySet<ReceiptState> = new Set<ReceiptState>([
  'proposed',
  'declined',
  'expired',
]);

export function isTerminal(state: ReceiptState): boolean {
  return TERMINAL_STATES.has(state);
}

export function isConfirmedState(state: ReceiptState): boolean {
  return !UNCONFIRMED_STATES.has(state);
}

export type ReceiptActor = 'client' | 'provider' | 'clock' | 'admin';

/**
 * from -> to[]
 * - proposed: accept/claim -> open; decline -> declined; clock 7d -> expired; either party may cancel
 * - open: deliver -> delivered; clock deadline + 24h -> timed_out; either party may cancel;
 *   invoke receipts may end in failed or output_invalid
 * - delivered: verdict -> accepted | rejected; clock review window -> unreviewed; only the provider may cancel
 * - rejected: provider dispute within 72h -> disputed; clock 72h -> resolved_client
 * - unreviewed: client dispute within 7d -> disputed
 * - disputed: admin ruling -> resolved_client | resolved_provider | split; clock 7d -> split
 */
export const allowedTransitions: Readonly<Record<ReceiptState, readonly ReceiptState[]>> = {
  proposed: ['open', 'declined', 'expired', 'cancelled_client', 'cancelled_provider'],
  open: ['delivered', 'timed_out', 'cancelled_client', 'cancelled_provider', 'failed', 'output_invalid'],
  delivered: ['accepted', 'rejected', 'unreviewed', 'cancelled_provider'],
  rejected: ['disputed', 'resolved_client'],
  unreviewed: ['disputed'],
  disputed: ['resolved_client', 'resolved_provider', 'split'],
  accepted: [],
  resolved_client: [],
  resolved_provider: [],
  split: [],
  timed_out: [],
  failed: [],
  output_invalid: [],
  cancelled_client: [],
  cancelled_provider: [],
  declined: [],
  expired: [],
};

export function canTransition(from: ReceiptState, to: ReceiptState): boolean {
  return allowedTransitions[from]?.includes(to) ?? false;
}

/**
 * Throws with a clear message when the transition is not allowed
 */
export function assertTransition(from: ReceiptState, to: ReceiptState): void {
  if (!canTransition(from, to)) {
    throw new Error(`receipt transition ${from} -> ${to} is not allowed`);
  }
}

// =============================================================================
// Clock windows (seconds)
// =============================================================================

export const RECEIPT_CLOCK = {
  /** proposed receipts expire after 7 days */
  proposedTtlSec: 7 * 86400,
  /** open receipts time out at deadline plus 24h grace */
  deliveryGraceSec: 86400,
  /** default review window for task receipts */
  defaultReviewWindowSec: 7 * 86400,
  /** default review window for invoke receipts */
  invokeReviewWindowSec: 86400,
  /** minimum review window */
  minReviewWindowSec: 3600,
  /** provider may dispute a rejection within 72h */
  disputeAfterRejectSec: 72 * 3600,
  /** client may dispute an unreviewed receipt within 7 days */
  disputeAfterUnreviewedSec: 7 * 86400,
  /** disputes auto-split after 7 days with no ruling */
  disputeAutoSplitSec: 7 * 86400,
  /** maximum deadline from open */
  maxDeadlineSec: 30 * 86400,
  /** task text length */
  maxTaskLength: 280,
} as const;

// =============================================================================
// Types
// =============================================================================

export type ReceiptRole = 'client' | 'provider';
export type ReceiptVia = 'direct' | 'proxy';
export type CreditClass = 'sandbox' | 'cash' | 'none';
export type ReceiptCurrency = 'USD';
export type ReceiptVerdict = 'accept' | 'reject';

export const RATING_TAGS = [
  'on_time',
  'as_specified',
  'over_delivered',
  'unresponsive',
  'wrong_output',
  'overcharged',
] as const;
export type RatingTag = (typeof RATING_TAGS)[number];

export interface CounterpartyHint {
  name: string;
  url?: string | null;
  /** sha256hex of the contact detail; ANS never stores the contact itself */
  contactHash?: string | null;
}

/**
 * Everything the initiator signs when opening a receipt (section 14.3 `terms`).
 * No server-minted id is inside the signed payload.
 */
export interface ReceiptTerms {
  initiatorId: string;
  initiatorRole: ReceiptRole;
  counterpartyId: string | null;
  counterpartyHint: CounterpartyHint | null;
  task: string;
  offerId: string | null;
  inputHash: string | null;
  /** USD micros as a decimal string (bigint safe) */
  priceMicros: string;
  currency: ReceiptCurrency;
  creditClass: CreditClass;
  feeBps: number;
  /** ISO 8601 UTC */
  deadlineAt: string;
  reviewWindowSec: number;
  /** random nonce chosen by the initiator, base64url */
  openNonce: string;
}

export interface CanonicalResult {
  canonical: string;
  /** sha256hex(canonical) */
  hash: string;
}

export const RECEIPT_CANONICAL_VERSIONS = {
  terms: 'ans-receipt-terms-v1',
  accept: 'ans-receipt-accept-v1',
  deliver: 'ans-receipt-deliver-v1',
  verdict: 'ans-receipt-verdict-v1',
  rating: 'ans-receipt-rating-v1',
} as const;

function result(payload: unknown): CanonicalResult {
  const canonical = canonicalize(payload);
  return { canonical, hash: sha256hex(canonical) };
}

function normalizeHint(hint: CounterpartyHint | null | undefined): CounterpartyHint | null {
  if (!hint) return null;
  return {
    name: hint.name,
    url: hint.url ?? null,
    contactHash: hint.contactHash ?? null,
  };
}

/**
 * `terms` canonical string; the initiator signs `canonical`, the server stores `hash` as terms_hash
 */
export function buildTermsCanonical(terms: ReceiptTerms): CanonicalResult {
  if (typeof terms.priceMicros !== 'string') {
    throw new Error('buildTermsCanonical: priceMicros must be a decimal string');
  }
  return result({
    v: RECEIPT_CANONICAL_VERSIONS.terms,
    initiatorId: terms.initiatorId,
    initiatorRole: terms.initiatorRole,
    counterpartyId: terms.counterpartyId ?? null,
    counterpartyHint: normalizeHint(terms.counterpartyHint),
    task: terms.task,
    offerId: terms.offerId ?? null,
    inputHash: terms.inputHash ?? null,
    priceMicros: terms.priceMicros,
    currency: terms.currency,
    creditClass: terms.creditClass,
    feeBps: terms.feeBps,
    deadlineAt: terms.deadlineAt,
    reviewWindowSec: terms.reviewWindowSec,
    openNonce: terms.openNonce,
  });
}

/**
 * `accept` canonical string; the counterparty (or claimant) signs it
 */
export function buildAcceptCanonical(input: {
  receiptId: string;
  termsHash: string;
  acceptorId: string;
}): CanonicalResult {
  return result({
    v: RECEIPT_CANONICAL_VERSIONS.accept,
    receiptId: input.receiptId,
    termsHash: input.termsHash,
    acceptorId: input.acceptorId,
  });
}

/**
 * `deliver` canonical string; the provider signs it
 */
export function buildDeliverCanonical(input: { receiptId: string; outputHash: string }): CanonicalResult {
  return result({
    v: RECEIPT_CANONICAL_VERSIONS.deliver,
    receiptId: input.receiptId,
    outputHash: input.outputHash,
  });
}

/**
 * `verdict` canonical string; the client signs it
 */
export function buildVerdictCanonical(input: {
  receiptId: string;
  outputHash: string;
  verdict: ReceiptVerdict;
}): CanonicalResult {
  return result({
    v: RECEIPT_CANONICAL_VERSIONS.verdict,
    receiptId: input.receiptId,
    outputHash: input.outputHash,
    verdict: input.verdict,
  });
}

/**
 * `rating` canonical string; the rater signs it. Tags are sorted so order never changes the hash.
 */
export function buildRatingCanonical(input: {
  receiptId: string;
  subjectId: string;
  score: number;
  tags?: readonly string[] | null;
}): CanonicalResult {
  if (!Number.isInteger(input.score) || input.score < 0 || input.score > 100) {
    throw new Error('buildRatingCanonical: score must be an integer 0-100');
  }
  const tags = [...(input.tags ?? [])].sort();
  return result({
    v: RECEIPT_CANONICAL_VERSIONS.rating,
    receiptId: input.receiptId,
    subjectId: input.subjectId,
    score: input.score,
    tags,
  });
}

/**
 * Offer publication canonical (section 4, POST /v1/offers publishSig).
 * The owner's signature over this is the provider's standing acceptance of invocations.
 */
export function buildOfferPublishCanonical(input: {
  agentId: string;
  slug: string;
  version: number;
  inputSchemaHash: string;
  outputSchemaHash: string;
  priceMicros: string;
  endpoint: string | null;
}): CanonicalResult {
  if (typeof input.priceMicros !== 'string') {
    throw new Error('buildOfferPublishCanonical: priceMicros must be a decimal string');
  }
  return result({
    agentId: input.agentId,
    slug: input.slug,
    version: input.version,
    inputSchemaHash: input.inputSchemaHash,
    outputSchemaHash: input.outputSchemaHash,
    priceMicros: input.priceMicros,
    endpoint: input.endpoint ?? null,
    standingAccept: true,
  });
}

/**
 * The message the registry signs when forwarding an invocation to a provider:
 * `${receiptId}:${timestamp}:${sha256hex(body)}`
 */
export function buildInvokeForwardMessage(input: {
  receiptId: string;
  timestamp: string | number;
  body: string;
}): string {
  return `${input.receiptId}:${String(input.timestamp)}:${sha256hex(input.body)}`;
}

/**
 * Hash of a counterparty contact detail (email, URL or handle) as stored in a hint.
 * Normalized: trimmed and lowercased. ANS never stores the contact itself.
 */
export function contactHashFor(contact: string): string {
  return sha256hex(contact.trim().toLowerCase());
}

/**
 * The sealed record of a receipt: what the per-agent hash chain covers.
 * Timestamps are ISO strings at whole-second precision.
 */
export interface SealedReceiptRecord {
  id: string;
  via: ReceiptVia;
  initiatorRole: ReceiptRole;
  clientId: string | null;
  providerId: string | null;
  task: string;
  offerId: string | null;
  inputHash: string | null;
  outputHash: string | null;
  priceMicros: string;
  creditClass: CreditClass;
  feeBps: number;
  feeMicros: string;
  deadlineAt: string;
  reviewWindowSec: number;
  termsHash: string;
  initiatorSig: string;
  counterpartySig: string | null;
  deliverSig: string | null;
  verdictSig: string | null;
  state: ReceiptState;
  openedAt: string | null;
  acceptedAt: string | null;
  deliveredAt: string | null;
  verdictAt: string | null;
  sealedAt: string;
  prevHashClient: string | null;
  prevHashProvider: string | null;
}

export const SEALED_RECORD_VERSION = 'ans-receipt-sealed-v1';

/** sha256hex of the canonical sealed record: the receipt's chain hash */
export function sealedReceiptHash(record: SealedReceiptRecord): string {
  return sha256hex(canonicalize({ v: SEALED_RECORD_VERSION, ...record }));
}

/** Signature values the registry stores when it attests instead of the party signing (api-key and proxy flows) */
export const ATTESTED_PREFIX = 'attested:';

export function isAttestedSig(sig: string | null | undefined): boolean {
  return typeof sig === 'string' && sig.startsWith(ATTESTED_PREFIX);
}
