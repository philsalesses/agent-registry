import type { CreditClass, ReceiptRole, ReceiptState, ReceiptVia } from './receipts';
import { isTerminal } from './receipts';

// =============================================================================
// Constants (docs/DESIGN.md section 5 plus 14.5), served verbatim by GET /v1/trust/formula
// =============================================================================

export interface OutcomeEntry {
  /** value 0-100, or 'rating' meaning the received rating is used */
  value: number | 'rating';
  weight: number;
  /** Value used when `value` is 'rating' and no rating was given; null means excluded without a rating */
  fallbackValue?: number | null;
  fallbackWeight?: number;
  note?: string;
}

export const TRUST_V1 = {
  version: 'trust-v1',
  /** prior mean */
  m0: 50,
  /** prior weight (pseudo-receipts) */
  k: 2,
  stake: {
    /** stake for sandbox, none and zero-price receipts, and the floor for cash */
    floor: 0.15,
    ceiling: 1.0,
    /** cash stake = clamp(floor + log10(1 + priceMicros / 1e6) / divisor, floor, ceiling) */
    divisor: 3,
    formula: 'clamp(0.15 + log10(1 + priceUsd) / 3, 0.15, 1.0); 0.15 for sandbox or zero price',
    examples: { '$1': 0.25, '$10': 0.5, '$100': 0.82, '$1000': 1.0 },
  },
  pair: {
    /** counted receipts with the same counterparty at full weight within the window */
    fullWeightCount: 5,
    windowDays: 90,
    /** pair factor beyond fullWeightCount */
    reducedFactor: 0.1,
    /** receipts whose parties share a payment fingerprint count 0 (once top-up ships) */
    sharedFingerprintFactor: 0,
  },
  decay: {
    /** half-life in days when value >= 50 */
    successHalfLifeDays: 180,
    /** half-life in days when value < 50 (failures fade at half the speed) */
    failureHalfLifeDays: 365,
    threshold: 50,
  },
  caps: {
    /** total weight from zero-price and sandbox receipts per subject */
    freeWeightCap: 1.0,
    /** total weight from unreviewed schema-valid invocations per subject */
    unreviewedInvokeWeightCap: 2.0,
  },
  /** rank = score - rankPenalty * (1 - confidence) */
  rankPenalty: 15,
  score: 'round((k * m0 + sum(w * v)) / (k + sum(w)))',
  confidence: 'sum(w) / (sum(w) + k)',
  rank: 'score - 15 * (1 - confidence)',
  weight: 'outcomeWeight * stake * pair * decay',
  /** what a zero-history agent shows */
  defaults: { score: 50, confidence: 0, rank: 35 },
  /**
   * Outcome table. Keys are terminal states; modifiers select the row:
   * rated (a rating was received), via ('direct'|'proxy'), outputValidated, disputed, delivered.
   */
  outcomes: {
    provider: {
      accepted: {
        rated: { value: 'rating', weight: 1.0 },
        unrated: { value: 80, weight: 0.5 },
      },
      unreviewed: {
        direct: { value: null, weight: 0, note: 'excluded from score, counted as volume' },
        proxyValidated: { value: 70, weight: 0.25, note: 'capped by unreviewedInvokeWeightCap' },
        proxyNotValidated: { value: null, weight: 0, note: 'excluded' },
      },
      resolved_provider: {
        rated: { value: 'rating', weight: 1.0 },
        unrated: { value: 90, weight: 1.0 },
      },
      resolved_client: {
        undisputed: { value: 15, weight: 1.0, note: 'rejected then not disputed within 72h' },
        disputeLost: { value: 0, weight: 1.0 },
      },
      timed_out: { value: 0, weight: 1.0 },
      cancelled_provider: { value: 30, weight: 0.5, note: 'after open' },
      split: { value: 50, weight: 0.5 },
      failed: { value: 20, weight: 0.5 },
      output_invalid: { value: 25, weight: 0.5 },
      cancelled_client: { value: null, weight: 0, note: 'excluded' },
      declined: { value: null, weight: 0, note: 'excluded and invisible' },
      expired: { value: null, weight: 0, note: 'excluded and invisible' },
    },
    client: {
      accepted: {
        rated: { value: 'rating', weight: 1.0 },
        unrated: { value: 80, weight: 0.5 },
      },
      unreviewed: {
        rated: { value: 'rating', weight: 1.0 },
        unrated: { value: 80, weight: 0.5, note: 'also increments the public no_review count' },
      },
      resolved_provider: { value: 10, weight: 1.0, note: 'dispute lost' },
      resolved_client: {
        rated: { value: 'rating', weight: 1.0 },
        unrated: { value: null, weight: 0, note: 'excluded' },
      },
      split: { value: 50, weight: 0.5 },
      cancelled_client: {
        afterDelivery: { value: 40, weight: 0.5 },
        beforeDelivery: { value: null, weight: 0, note: 'excluded and invisible' },
      },
      timed_out: {
        rated: { value: 'rating', weight: 1.0 },
        unrated: { value: null, weight: 0, note: 'excluded' },
      },
      cancelled_provider: {
        rated: { value: 'rating', weight: 1.0 },
        unrated: { value: null, weight: 0, note: 'excluded' },
      },
      failed: { value: null, weight: 0, note: 'excluded' },
      output_invalid: { value: null, weight: 0, note: 'excluded' },
      declined: { value: null, weight: 0, note: 'excluded and invisible' },
      expired: { value: null, weight: 0, note: 'excluded and invisible' },
    },
  },
  worstCase: {
    freeSybilRing: { receipts: 25, maxScore: 67 },
    reach90: 'roughly $150 of cash-class receipts across at least 6 distinct funded counterparties',
  },
} as const;

// =============================================================================
// Inputs and outputs
// =============================================================================

export interface TrustReceiptInput {
  id: string;
  /** the role the subject played on this receipt */
  role: ReceiptRole;
  state: ReceiptState;
  sealedAt: Date;
  /** USD micros as a decimal string */
  priceMicros: string;
  creditClass: CreditClass;
  counterpartyId: string | null;
  via: ReceiptVia;
  /** rating the subject received from the counterparty, if any */
  ratingReceived: number | null;
  /** invoke receipts: output validated against the offer's output schema */
  outputValidated: boolean;
  /** resolved_* reached through a dispute (as opposed to the clock or an undisputed rejection) */
  disputed?: boolean;
  /** cancelled_client after delivery (cancellation happened once the output was delivered) */
  delivered?: boolean;
  /** both parties share a payment fingerprint: pair factor 0 */
  sharedFingerprint?: boolean;
}

export interface TrustOutcome {
  value: number;
  weight: number;
}

export interface TrustBreakdown {
  byOutcome: Record<string, { count: number; weight: number }>;
  freeWeightUsed: number;
  unreviewedInvokeWeightUsed: number;
}

export interface TrustResult {
  score: number;
  confidence: number;
  rank: number;
  /** counted receipts (those with an outcome) */
  n: number;
  sumWeight: number;
  breakdown: TrustBreakdown;
}

export interface ComputeTrustInputs {
  receipts: TrustReceiptInput[];
  now: Date;
}

// =============================================================================
// Outcome table as a function
// =============================================================================

function ratedOr(input: TrustReceiptInput, fallback: TrustOutcome | null): TrustOutcome | null {
  if (input.ratingReceived !== null && input.ratingReceived !== undefined) {
    return { value: clampScore(input.ratingReceived), weight: 1.0 };
  }
  return fallback;
}

function clampScore(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.min(100, Math.max(0, v));
}

/**
 * The outcome (value, base weight) of one receipt for the subject, or null when excluded.
 * Only terminal states have outcomes.
 */
export function outcomeFor(input: TrustReceiptInput): TrustOutcome | null {
  if (!isTerminal(input.state)) return null;
  if (input.role === 'provider') return providerOutcome(input);
  return clientOutcome(input);
}

function providerOutcome(r: TrustReceiptInput): TrustOutcome | null {
  switch (r.state) {
    case 'accepted':
      return ratedOr(r, { value: 80, weight: 0.5 });
    case 'unreviewed':
      if (r.via === 'proxy' && r.outputValidated) return { value: 70, weight: 0.25 };
      return null;
    case 'resolved_provider':
      return ratedOr(r, { value: 90, weight: 1.0 });
    case 'resolved_client':
      return r.disputed ? { value: 0, weight: 1.0 } : { value: 15, weight: 1.0 };
    case 'timed_out':
      return { value: 0, weight: 1.0 };
    case 'cancelled_provider':
      return { value: 30, weight: 0.5 };
    case 'split':
      return { value: 50, weight: 0.5 };
    case 'failed':
      return { value: 20, weight: 0.5 };
    case 'output_invalid':
      return { value: 25, weight: 0.5 };
    case 'cancelled_client':
    case 'declined':
    case 'expired':
    default:
      return null;
  }
}

function clientOutcome(r: TrustReceiptInput): TrustOutcome | null {
  switch (r.state) {
    case 'accepted':
    case 'unreviewed':
      return ratedOr(r, { value: 80, weight: 0.5 });
    case 'resolved_provider':
      return { value: 10, weight: 1.0 };
    case 'resolved_client':
    case 'timed_out':
    case 'cancelled_provider':
      return ratedOr(r, null);
    case 'split':
      return { value: 50, weight: 0.5 };
    case 'cancelled_client':
      return r.delivered ? { value: 40, weight: 0.5 } : null;
    case 'failed':
    case 'output_invalid':
    case 'declined':
    case 'expired':
    default:
      return null;
  }
}

// =============================================================================
// Factors
// =============================================================================

/**
 * stake = 0.15 for sandbox, none or zero price; cash: clamp(0.15 + log10(1 + usd) / 3, 0.15, 1.0)
 */
export function stakeFor(priceMicros: string | bigint, creditClass: CreditClass): number {
  const { floor, ceiling, divisor } = TRUST_V1.stake;
  let micros: bigint;
  try {
    micros = typeof priceMicros === 'bigint' ? priceMicros : BigInt(priceMicros);
  } catch {
    return floor;
  }
  if (creditClass !== 'cash' || micros <= 0n) return floor;
  const usd = Number(micros) / 1_000_000;
  const raw = floor + Math.log10(1 + usd) / divisor;
  return Math.min(ceiling, Math.max(floor, raw));
}

/**
 * decay = 2^(-ageDays / halfLife); 180 days when value >= 50, 365 days below
 */
export function decayFor(ageDays: number, value: number): number {
  const halfLife =
    value >= TRUST_V1.decay.threshold
      ? TRUST_V1.decay.successHalfLifeDays
      : TRUST_V1.decay.failureHalfLifeDays;
  const age = Math.max(0, ageDays);
  return Math.pow(2, -age / halfLife);
}

export function isFreeReceipt(r: Pick<TrustReceiptInput, 'priceMicros' | 'creditClass'>): boolean {
  if (r.creditClass !== 'cash') return true;
  try {
    return BigInt(r.priceMicros) <= 0n;
  } catch {
    return true;
  }
}

export function isUnreviewedInvoke(r: Pick<TrustReceiptInput, 'state' | 'via' | 'outputValidated'>): boolean {
  return r.state === 'unreviewed' && r.via === 'proxy' && r.outputValidated;
}

const MS_PER_DAY = 86_400_000;

// =============================================================================
// computeTrust
// =============================================================================

/**
 * Pure, deterministic trust computation. Receipts are processed in sealedAt order
 * (ties broken by id) so the pair rule and the caps are stable across runs.
 */
export function computeTrust(inputs: ComputeTrustInputs): TrustResult {
  const { m0, k, rankPenalty } = TRUST_V1;
  const { fullWeightCount, windowDays, reducedFactor, sharedFingerprintFactor } = TRUST_V1.pair;
  const { freeWeightCap, unreviewedInvokeWeightCap } = TRUST_V1.caps;
  const nowMs = inputs.now.getTime();
  const windowMs = windowDays * MS_PER_DAY;

  const receipts = [...inputs.receipts].sort((a, b) => {
    const d = a.sealedAt.getTime() - b.sealedAt.getTime();
    return d !== 0 ? d : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  const byOutcome: Record<string, { count: number; weight: number }> = {};
  const countedByCounterparty = new Map<string, number[]>();
  let sumW = 0;
  let sumWV = 0;
  let n = 0;
  let freeWeightUsed = 0;
  let unreviewedInvokeWeightUsed = 0;

  for (const r of receipts) {
    const outcome = outcomeFor(r);
    if (!outcome) continue;
    n += 1;

    const sealedMs = r.sealedAt.getTime();

    // pair factor: first `fullWeightCount` counted receipts with this counterparty in a rolling window
    let pair = 1.0;
    if (r.sharedFingerprint) {
      pair = sharedFingerprintFactor;
    } else if (r.counterpartyId) {
      const history = countedByCounterparty.get(r.counterpartyId) ?? [];
      const recent = history.filter((t) => sealedMs - t <= windowMs).length;
      if (recent >= fullWeightCount) pair = reducedFactor;
      history.push(sealedMs);
      countedByCounterparty.set(r.counterpartyId, history);
    }

    const stake = stakeFor(r.priceMicros, r.creditClass);
    const ageDays = Math.max(0, nowMs - sealedMs) / MS_PER_DAY;
    const decay = decayFor(ageDays, outcome.value);

    let w = outcome.weight * stake * pair * decay;

    // caps
    if (isFreeReceipt(r)) {
      const room = Math.max(0, freeWeightCap - freeWeightUsed);
      w = Math.min(w, room);
      freeWeightUsed += w;
    }
    if (isUnreviewedInvoke(r)) {
      const room = Math.max(0, unreviewedInvokeWeightCap - unreviewedInvokeWeightUsed);
      w = Math.min(w, room);
      unreviewedInvokeWeightUsed += w;
    }

    sumW += w;
    sumWV += w * outcome.value;

    const key = outcomeKey(r);
    const slot = byOutcome[key] ?? { count: 0, weight: 0 };
    slot.count += 1;
    slot.weight += w;
    byOutcome[key] = slot;
  }

  const score = Math.round((k * m0 + sumWV) / (k + sumW));
  const confidence = sumW / (sumW + k);
  const rank = score - rankPenalty * (1 - confidence);

  return {
    score,
    confidence,
    rank,
    n,
    sumWeight: sumW,
    breakdown: { byOutcome, freeWeightUsed, unreviewedInvokeWeightUsed },
  };
}

function outcomeKey(r: TrustReceiptInput): string {
  if (r.state === 'resolved_client' && r.role === 'provider' && r.disputed) return 'dispute_lost';
  if (r.state === 'resolved_provider' && r.role === 'client') return 'dispute_lost';
  if (r.state === 'unreviewed' && r.via === 'proxy') return 'unreviewed_invoke';
  if (r.state === 'accepted' && r.ratingReceived !== null && r.ratingReceived !== undefined) return 'accepted_rated';
  return r.state;
}
