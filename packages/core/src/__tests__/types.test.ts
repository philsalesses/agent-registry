import { describe, it, expect } from 'vitest';
import { AgentIdSchema, OfferSchema, ReceiptSchema, RatingSchema, AgentPolicySchema } from '../types';

describe('zod schemas', () => {
  it('AgentIdSchema accepts the new optional fields and still parses legacy rows', () => {
    const legacy = AgentIdSchema.parse({ id: 'ag_abcdefghijkl', name: 'A', publicKey: 'pk', type: 'assistant', createdAt: new Date() });
    expect(legacy.handle).toBeUndefined();
    const full = AgentIdSchema.parse({
      id: 'ag_abcdefghijkl',
      name: 'A',
      publicKey: 'pk',
      type: 'assistant',
      createdAt: new Date(),
      handle: 'good-will',
      policy: { requireRegistered: true },
      trust: { score: 50, confidence: 0, rank: 35 },
    });
    expect(full.policy).toEqual({ requireRegistered: true, minTrust: 0, acceptSandbox: true });
    expect(() => AgentIdSchema.parse({ ...legacy, handle: 'Bad Handle' })).toThrow();
    expect(AgentPolicySchema.parse({})).toEqual({ requireRegistered: false, minTrust: 0, acceptSandbox: true });
  });

  it('OfferSchema, ReceiptSchema, RatingSchema parse section 3 shapes', () => {
    const offer = OfferSchema.parse({
      id: 'of_abcdefghijklmnop',
      agentId: 'ag_abcdefghijkl',
      slug: 'fetch-page',
      title: 'Fetch a page',
      inputSchema: { type: 'object' },
      outputSchema: { type: 'object' },
      inputSchemaHash: 'a',
      outputSchemaHash: 'b',
      publishSig: 'sig',
      createdAt: new Date(),
    });
    expect(offer.priceMicros).toBe('0');
    expect(offer.timeoutMs).toBe(30000);
    expect(offer.feeds).toEqual([]);

    const receipt = ReceiptSchema.parse({
      id: 'rc_abcdefghijklmnop',
      clientId: 'ag_a',
      providerId: null,
      initiatorId: 'ag_a',
      initiatorRole: 'client',
      task: 'Do the thing',
      creditClass: 'none',
      feeBps: 300,
      deadlineAt: new Date(),
      via: 'direct',
      state: 'proposed',
      termsHash: 'h',
      initiatorSig: 's',
      createdAt: new Date(),
    });
    expect(receipt.currency).toBe('USD');
    expect(receipt.reviewWindowSec).toBe(604800);
    expect(() => ReceiptSchema.parse({ ...receipt, state: 'nope' })).toThrow();

    const rating = RatingSchema.parse({
      id: 'rt_1',
      receiptId: 'rc_abcdefghijklmnop',
      raterId: 'ag_a',
      subjectId: 'ag_b',
      score: 95,
      tags: ['on_time'],
      signature: 's',
      createdAt: new Date(),
    });
    expect(rating.tags).toEqual(['on_time']);
    expect(() => RatingSchema.parse({ ...rating, tags: ['fast'] })).toThrow();
  });
});
