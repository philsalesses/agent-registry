import { describe, it, expect } from 'vitest';
import {
  allowedTransitions,
  canTransition,
  assertTransition,
  isTerminal,
  TERMINAL_STATES,
  RECEIPT_STATES,
  buildTermsCanonical,
  buildAcceptCanonical,
  buildDeliverCanonical,
  buildVerdictCanonical,
  buildRatingCanonical,
  type ReceiptTerms,
  type ReceiptState,
} from '../receipts';
import { sha256hex } from '../canonical';

describe('receipt states', () => {
  it('has exactly the documented 17 states and every state has a transition row', () => {
    expect(RECEIPT_STATES).toHaveLength(17);
    for (const s of RECEIPT_STATES) expect(allowedTransitions[s]).toBeDefined();
  });

  it('terminal states have no outgoing transitions except unreviewed -> disputed', () => {
    for (const s of TERMINAL_STATES) {
      expect(isTerminal(s)).toBe(true);
      const outs = allowedTransitions[s];
      if (s === 'unreviewed') expect(outs).toEqual(['disputed']);
      else expect(outs).toEqual([]);
    }
    for (const s of ['proposed', 'open', 'delivered', 'rejected', 'disputed'] as ReceiptState[]) {
      expect(isTerminal(s)).toBe(false);
      expect(allowedTransitions[s].length).toBeGreaterThan(0);
    }
  });

  it('follows the happy path and the clock paths', () => {
    expect(canTransition('proposed', 'open')).toBe(true);
    expect(canTransition('open', 'delivered')).toBe(true);
    expect(canTransition('delivered', 'accepted')).toBe(true);
    expect(canTransition('delivered', 'rejected')).toBe(true);
    expect(canTransition('rejected', 'disputed')).toBe(true);
    expect(canTransition('rejected', 'resolved_client')).toBe(true);
    expect(canTransition('disputed', 'split')).toBe(true);
    expect(canTransition('proposed', 'expired')).toBe(true);
    expect(canTransition('open', 'timed_out')).toBe(true);
    expect(canTransition('delivered', 'unreviewed')).toBe(true);
    expect(canTransition('open', 'failed')).toBe(true);
    expect(canTransition('open', 'output_invalid')).toBe(true);
    expect(canTransition('delivered', 'cancelled_provider')).toBe(true);
  });

  it('rejects the wrong moves', () => {
    expect(canTransition('proposed', 'delivered')).toBe(false);
    expect(canTransition('delivered', 'cancelled_client')).toBe(false);
    expect(canTransition('accepted', 'rejected')).toBe(false);
    expect(canTransition('open', 'accepted')).toBe(false);
    expect(canTransition('proposed', 'timed_out')).toBe(false);
    expect(() => assertTransition('accepted', 'open')).toThrow(/not allowed/);
    expect(() => assertTransition('open', 'delivered')).not.toThrow();
  });
});

describe('receipt canonical builders (section 14.3)', () => {
  const terms: ReceiptTerms = {
    initiatorId: 'ag_client',
    initiatorRole: 'client',
    counterpartyId: 'ag_provider',
    counterpartyHint: null,
    task: 'Review PR #12',
    offerId: null,
    inputHash: null,
    priceMicros: '1000000',
    currency: 'USD',
    creditClass: 'cash',
    feeBps: 300,
    deadlineAt: '2026-10-01T00:00:00.000Z',
    reviewWindowSec: 604800,
    openNonce: 'abc',
  };

  it('terms carries the version tag, sorted keys and a matching hash', () => {
    const { canonical, hash } = buildTermsCanonical(terms);
    expect(canonical.startsWith('{"counterpartyHint":null,"counterpartyId":"ag_provider","creditClass":"cash"')).toBe(true);
    expect(canonical).toContain('"v":"ans-receipt-terms-v1"');
    expect(canonical).toContain('"priceMicros":"1000000"');
    expect(hash).toBe(sha256hex(canonical));
    expect(buildTermsCanonical({ ...terms }).hash).toBe(hash);
    expect(buildTermsCanonical({ ...terms, task: 'x' }).hash).not.toBe(hash);
  });

  it('normalizes a hint counterparty', () => {
    const { canonical } = buildTermsCanonical({
      ...terms,
      counterpartyId: null,
      counterpartyHint: { name: 'Bob' },
    });
    expect(canonical).toContain('"counterpartyHint":{"contactHash":null,"name":"Bob","url":null}');
  });

  it('rejects a bigint price', () => {
    expect(() => buildTermsCanonical({ ...terms, priceMicros: 5n as unknown as string })).toThrow(/decimal string/);
  });

  it('accept, deliver, verdict and rating canonicals', () => {
    expect(buildAcceptCanonical({ receiptId: 'rc_1', termsHash: 'h', acceptorId: 'ag_p' }).canonical).toBe(
      '{"acceptorId":"ag_p","receiptId":"rc_1","termsHash":"h","v":"ans-receipt-accept-v1"}'
    );
    expect(buildDeliverCanonical({ receiptId: 'rc_1', outputHash: 'o' }).canonical).toBe(
      '{"outputHash":"o","receiptId":"rc_1","v":"ans-receipt-deliver-v1"}'
    );
    expect(buildVerdictCanonical({ receiptId: 'rc_1', outputHash: 'o', verdict: 'accept' }).canonical).toBe(
      '{"outputHash":"o","receiptId":"rc_1","v":"ans-receipt-verdict-v1","verdict":"accept"}'
    );
    const rating = buildRatingCanonical({ receiptId: 'rc_1', subjectId: 'ag_p', score: 90, tags: ['on_time', 'as_specified'] });
    expect(rating.canonical).toBe(
      '{"receiptId":"rc_1","score":90,"subjectId":"ag_p","tags":["as_specified","on_time"],"v":"ans-receipt-rating-v1"}'
    );
    expect(buildRatingCanonical({ receiptId: 'rc_1', subjectId: 'ag_p', score: 90, tags: ['as_specified', 'on_time'] }).hash).toBe(rating.hash);
    expect(() => buildRatingCanonical({ receiptId: 'rc_1', subjectId: 'ag_p', score: 101 })).toThrow();
  });
});
