import { describe, it, expect } from 'vitest';
import { computeTrust, outcomeFor, stakeFor, decayFor, TRUST_V1, type TrustReceiptInput } from '../trust';

const NOW = new Date('2026-09-13T00:00:00.000Z');

let seq = 0;
function receipt(over: Partial<TrustReceiptInput> = {}): TrustReceiptInput {
  seq += 1;
  return {
    id: 'rc_auto_' + seq,
    role: 'provider',
    state: 'accepted',
    sealedAt: NOW,
    priceMicros: '0',
    creditClass: 'sandbox',
    counterpartyId: 'ag_c',
    via: 'direct',
    ratingReceived: 100,
    outputValidated: false,
    ...over,
  };
}

describe('TRUST_V1 constants', () => {
  it('match the design', () => {
    expect(TRUST_V1.version).toBe('trust-v1');
    expect(TRUST_V1.m0).toBe(50);
    expect(TRUST_V1.k).toBe(2);
    expect(TRUST_V1.stake.floor).toBe(0.15);
    expect(TRUST_V1.pair.fullWeightCount).toBe(5);
    expect(TRUST_V1.pair.windowDays).toBe(90);
    expect(TRUST_V1.pair.reducedFactor).toBe(0.1);
    expect(TRUST_V1.decay.successHalfLifeDays).toBe(180);
    expect(TRUST_V1.decay.failureHalfLifeDays).toBe(365);
    expect(TRUST_V1.caps.freeWeightCap).toBe(1.0);
    expect(TRUST_V1.caps.unreviewedInvokeWeightCap).toBe(2.0);
    expect(TRUST_V1.rankPenalty).toBe(15);
    expect(TRUST_V1.outcomes.provider.failed).toEqual({ value: 20, weight: 0.5 });
    expect(TRUST_V1.outcomes.provider.output_invalid).toEqual({ value: 25, weight: 0.5 });
    expect(TRUST_V1.outcomes.client.failed.value).toBeNull();
    expect(TRUST_V1.outcomes.client.output_invalid.value).toBeNull();
  });
});

describe('outcomeFor', () => {
  it('provider table', () => {
    expect(outcomeFor(receipt({ state: 'accepted', ratingReceived: 88 }))).toEqual({ value: 88, weight: 1 });
    expect(outcomeFor(receipt({ state: 'accepted', ratingReceived: null }))).toEqual({ value: 80, weight: 0.5 });
    expect(outcomeFor(receipt({ state: 'unreviewed', via: 'direct', ratingReceived: null }))).toBeNull();
    expect(outcomeFor(receipt({ state: 'unreviewed', via: 'proxy', outputValidated: true, ratingReceived: null }))).toEqual({ value: 70, weight: 0.25 });
    expect(outcomeFor(receipt({ state: 'resolved_provider', ratingReceived: null }))).toEqual({ value: 90, weight: 1 });
    expect(outcomeFor(receipt({ state: 'resolved_client', ratingReceived: null }))).toEqual({ value: 15, weight: 1 });
    expect(outcomeFor(receipt({ state: 'resolved_client', disputed: true, ratingReceived: null }))).toEqual({ value: 0, weight: 1 });
    expect(outcomeFor(receipt({ state: 'timed_out', ratingReceived: null }))).toEqual({ value: 0, weight: 1 });
    expect(outcomeFor(receipt({ state: 'cancelled_provider', ratingReceived: null }))).toEqual({ value: 30, weight: 0.5 });
    expect(outcomeFor(receipt({ state: 'split', ratingReceived: null }))).toEqual({ value: 50, weight: 0.5 });
    expect(outcomeFor(receipt({ state: 'failed', via: 'proxy', ratingReceived: null }))).toEqual({ value: 20, weight: 0.5 });
    expect(outcomeFor(receipt({ state: 'output_invalid', via: 'proxy', ratingReceived: null }))).toEqual({ value: 25, weight: 0.5 });
    expect(outcomeFor(receipt({ state: 'cancelled_client', ratingReceived: null }))).toBeNull();
    expect(outcomeFor(receipt({ state: 'expired', ratingReceived: null }))).toBeNull();
    expect(outcomeFor(receipt({ state: 'declined', ratingReceived: null }))).toBeNull();
    // non-terminal states never count
    expect(outcomeFor(receipt({ state: 'open' }))).toBeNull();
    expect(outcomeFor(receipt({ state: 'delivered' }))).toBeNull();
    expect(outcomeFor(receipt({ state: 'rejected' }))).toBeNull();
    expect(outcomeFor(receipt({ state: 'disputed' }))).toBeNull();
  });

  it('client table', () => {
    const c = (o: Partial<TrustReceiptInput>) => outcomeFor(receipt({ role: 'client', ...o }));
    expect(c({ state: 'accepted', ratingReceived: 70 })).toEqual({ value: 70, weight: 1 });
    expect(c({ state: 'accepted', ratingReceived: null })).toEqual({ value: 80, weight: 0.5 });
    expect(c({ state: 'unreviewed', ratingReceived: null })).toEqual({ value: 80, weight: 0.5 });
    expect(c({ state: 'resolved_provider', ratingReceived: null })).toEqual({ value: 10, weight: 1 });
    expect(c({ state: 'cancelled_client', delivered: true, ratingReceived: null })).toEqual({ value: 40, weight: 0.5 });
    expect(c({ state: 'cancelled_client', ratingReceived: null })).toBeNull();
    expect(c({ state: 'split', ratingReceived: null })).toEqual({ value: 50, weight: 0.5 });
    expect(c({ state: 'failed', via: 'proxy', ratingReceived: null })).toBeNull();
    expect(c({ state: 'output_invalid', via: 'proxy', ratingReceived: null })).toBeNull();
    expect(c({ state: 'timed_out', ratingReceived: null })).toBeNull();
  });
});

describe('stake and decay', () => {
  it('stake examples from the design', () => {
    expect(stakeFor('0', 'sandbox')).toBe(0.15);
    expect(stakeFor('100000000', 'sandbox')).toBe(0.15);
    expect(stakeFor('0', 'cash')).toBe(0.15);
    expect(stakeFor('1000000', 'cash')).toBeCloseTo(0.25, 2);
    expect(stakeFor('10000000', 'cash')).toBeCloseTo(0.5, 2);
    expect(stakeFor('100000000', 'cash')).toBeCloseTo(0.82, 2);
    expect(stakeFor('1000000000', 'cash')).toBe(1.0);
  });

  it('decay halves at the half-life', () => {
    expect(decayFor(0, 100)).toBe(1);
    expect(decayFor(180, 100)).toBeCloseTo(0.5, 10);
    expect(decayFor(360, 100)).toBeCloseTo(0.25, 10);
    expect(decayFor(365, 10)).toBeCloseTo(0.5, 10);
    expect(decayFor(180, 10)).toBeGreaterThan(0.5);
  });
});

describe('computeTrust', () => {
  it('zero receipts: score 50, confidence 0, rank 35', () => {
    const r = computeTrust({ receipts: [], now: NOW });
    expect(r).toMatchObject({ score: 50, confidence: 0, rank: 35, n: 0, sumWeight: 0 });
    expect(r.breakdown.byOutcome).toEqual({});
  });

  it('a 25-receipt free sybil ring maxes out at 67 (the free cap)', () => {
    const receipts: TrustReceiptInput[] = [];
    for (let i = 0; i < 25; i++) {
      receipts.push(
        receipt({
          id: `rc_${i.toString().padStart(3, '0')}`,
          counterpartyId: `ag_sybil_${i % 5}`,
          creditClass: 'sandbox',
          priceMicros: '0',
          ratingReceived: 100,
          sealedAt: new Date(NOW.getTime() - i * 1000),
        })
      );
    }
    const r = computeTrust({ receipts, now: NOW });
    expect(r.breakdown.freeWeightUsed).toBeCloseTo(1.0, 10);
    expect(r.sumWeight).toBeCloseTo(1.0, 10);
    expect(r.score).toBe(67);
    expect(r.n).toBe(25);
    // 250 more do not move it
    const more = [...receipts];
    for (let i = 25; i < 275; i++) {
      more.push(receipt({ id: `rc_${i}`, counterpartyId: `ag_s_${i}`, ratingReceived: 100, sealedAt: new Date(NOW.getTime() - i * 1000) }));
    }
    expect(computeTrust({ receipts: more, now: NOW }).score).toBe(67);
  });

  it('a cash $100 receipt has the documented stake (0.82)', () => {
    const r = computeTrust({
      receipts: [receipt({ creditClass: 'cash', priceMicros: '100000000', ratingReceived: 100 })],
      now: NOW,
    });
    expect(r.sumWeight).toBeCloseTo(0.818, 2);
    expect(r.breakdown.freeWeightUsed).toBe(0);
    // score = (100 + 0.818 * 100) / (2 + 0.818) = 64.5 -> 65
    expect(r.score).toBe(65);
    expect(r.confidence).toBeCloseTo(0.818 / 2.818, 2);
  });

  it('decay halves weight at the half-life', () => {
    const fresh = computeTrust({
      receipts: [receipt({ creditClass: 'cash', priceMicros: '1000000000', ratingReceived: 100 })],
      now: NOW,
    });
    const aged = computeTrust({
      receipts: [
        receipt({
          creditClass: 'cash',
          priceMicros: '1000000000',
          ratingReceived: 100,
          sealedAt: new Date(NOW.getTime() - 180 * 86_400_000),
        }),
      ],
      now: NOW,
    });
    expect(fresh.sumWeight).toBeCloseTo(1.0, 10);
    expect(aged.sumWeight).toBeCloseTo(0.5, 10);
    // failures decay on the 365-day half-life
    const badAged = computeTrust({
      receipts: [
        receipt({
          state: 'timed_out',
          ratingReceived: null,
          creditClass: 'cash',
          priceMicros: '1000000000',
          sealedAt: new Date(NOW.getTime() - 365 * 86_400_000),
        }),
      ],
      now: NOW,
    });
    expect(badAged.sumWeight).toBeCloseTo(0.5, 10);
  });

  it('rank penalty: rank = score - 15 * (1 - confidence)', () => {
    const r = computeTrust({
      receipts: [receipt({ creditClass: 'cash', priceMicros: '1000000000', ratingReceived: 100 })],
      now: NOW,
    });
    // sumW = 1, confidence = 1/3, score = round(200/3) = 67, rank = 67 - 15 * (2/3) = 57
    expect(r.confidence).toBeCloseTo(1 / 3, 10);
    expect(r.score).toBe(67);
    expect(r.rank).toBeCloseTo(57, 10);
    const empty = computeTrust({ receipts: [], now: NOW });
    expect(empty.rank).toBe(35);
  });

  it('pair rule: 5 per counterparty per 90 days at full weight, then 0.1', () => {
    const receipts: TrustReceiptInput[] = [];
    for (let i = 0; i < 6; i++) {
      receipts.push(
        receipt({
          id: `rc_${i}`,
          creditClass: 'cash',
          priceMicros: '1000000000',
          counterpartyId: 'ag_same',
          ratingReceived: 100,
          sealedAt: NOW,
        })
      );
    }
    const r = computeTrust({ receipts, now: NOW });
    expect(r.sumWeight).toBeCloseTo(5 + 0.1, 10);
    // outside the 90-day window the count resets
    const spread = receipts.map((x, i) => ({ ...x, sealedAt: new Date(NOW.getTime() - (6 - i) * 100 * 86_400_000) }));
    const r2 = computeTrust({ receipts: spread, now: NOW });
    expect(r2.breakdown.byOutcome.accepted_rated.count).toBe(6);
    // each receipt is 100 days apart so none share a window: no 0.1 factor applied
    const decaySum = spread.reduce((acc, x) => acc + Math.pow(2, -((NOW.getTime() - x.sealedAt.getTime()) / 86_400_000) / 180), 0);
    expect(r2.sumWeight).toBeCloseTo(decaySum, 10);
  });

  it('unreviewed invoke weight is capped at 2.0', () => {
    const receipts: TrustReceiptInput[] = [];
    for (let i = 0; i < 40; i++) {
      receipts.push(
        receipt({
          id: `rc_${i}`,
          state: 'unreviewed',
          via: 'proxy',
          outputValidated: true,
          ratingReceived: null,
          creditClass: 'cash',
          priceMicros: '1000000000',
          counterpartyId: `ag_${i}`,
        })
      );
    }
    const r = computeTrust({ receipts, now: NOW });
    expect(r.breakdown.unreviewedInvokeWeightUsed).toBeCloseTo(2.0, 10);
    expect(r.sumWeight).toBeCloseTo(2.0, 10);
    // score = (100 + 2 * 70) / 4 = 60
    expect(r.score).toBe(60);
    expect(r.breakdown.byOutcome.unreviewed_invoke.count).toBe(40);
    expect(r.breakdown.byOutcome.unreviewed_invoke.weight).toBeCloseTo(2.0, 10);
  });

  it('failed and output_invalid pull a provider down, not a client', () => {
    const asProvider = computeTrust({
      receipts: [
        receipt({ state: 'failed', via: 'proxy', ratingReceived: null, creditClass: 'cash', priceMicros: '1000000000' }),
        receipt({ state: 'output_invalid', via: 'proxy', ratingReceived: null, creditClass: 'cash', priceMicros: '1000000000' }),
      ],
      now: NOW,
    });
    expect(asProvider.sumWeight).toBeCloseTo(1.0, 10);
    // (100 + 0.5*20 + 0.5*25) / 3 = 40.83 -> 41
    expect(asProvider.score).toBe(41);
    const asClient = computeTrust({
      receipts: [
        receipt({ role: 'client', state: 'failed', via: 'proxy', ratingReceived: null, creditClass: 'cash', priceMicros: '1000000000' }),
      ],
      now: NOW,
    });
    expect(asClient).toMatchObject({ score: 50, n: 0, sumWeight: 0 });
  });

  it('is deterministic regardless of input order', () => {
    const receipts: TrustReceiptInput[] = [];
    for (let i = 0; i < 12; i++) {
      receipts.push(
        receipt({
          id: `rc_${i}`,
          creditClass: i % 2 ? 'cash' : 'sandbox',
          priceMicros: i % 2 ? '5000000' : '0',
          counterpartyId: `ag_${i % 3}`,
          ratingReceived: 60 + i,
          sealedAt: new Date(NOW.getTime() - i * 86_400_000 * 7),
        })
      );
    }
    const a = computeTrust({ receipts, now: NOW });
    const b = computeTrust({ receipts: [...receipts].reverse(), now: NOW });
    expect(b).toEqual(a);
  });
});
