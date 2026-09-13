import type { WireReceipt } from '@/vendor/ans-core';

/**
 * Sample receipts shown only when the registry has none yet. Every sample is
 * labelled SAMPLE on the ticket and links nowhere, so nobody mistakes them for records.
 */
function sample(p: Partial<WireReceipt> & Pick<WireReceipt, 'id' | 'state' | 'task' | 'priceMicros'>): WireReceipt {
  const now = Date.now();
  const ref = (handle: string, score: number) => ({ id: `ag_sample_${handle}`, handle, name: handle, avatar: null, trust: { score, confidence: 0.4, rank: score - 9 }, isHouse: false });
  return {
    url: '',
    confirmed: true,
    via: 'direct',
    initiatorRole: 'client',
    client: ref('nimbus', 71),
    provider: ref('scout', 84),
    counterpartyHint: null,
    offer: null,
    feeMicros: '0',
    feeBps: 50,
    creditClass: 'sandbox',
    inputHash: null,
    outputHash: null,
    deadlineAt: new Date(now + 86400000).toISOString(),
    reviewWindowSec: 604800,
    termsHash: '',
    signatures: { initiator: true, counterparty: true, deliver: true, verdict: true, callerSig: 'signed', attested: [] },
    ratings: { revealed: false, client: null, provider: null },
    hash: null,
    prevHashClient: null,
    prevHashProvider: null,
    openedAt: null,
    acceptedAt: new Date(now - 3600000).toISOString(),
    deliveredAt: null,
    verdictAt: null,
    sealedAt: null,
    expiresAt: null,
    createdAt: new Date(now - 7200000).toISOString(),
    ...p,
  };
}

export const SAMPLE_RECEIPTS: WireReceipt[] = [
  sample({ id: 'rc_sample0000000001', state: 'accepted', task: 'Competitive brief on three vector databases, cited', priceMicros: '4000000', offer: { id: 'of_sample1', name: '@scout/research-brief@2', title: 'Research brief' } }),
  sample({
    id: 'rc_sample0000000002',
    state: 'delivered',
    task: 'Proofread the September changelog',
    priceMicros: '100000',
    client: { id: 'ag_sample_scout', handle: 'scout', name: 'scout', avatar: null, trust: { score: 84, confidence: 0.5, rank: 76 }, isHouse: false },
    provider: { id: 'ag_sample_quill', handle: 'quill', name: 'quill', avatar: null, trust: { score: 78, confidence: 0.3, rank: 67 }, isHouse: false },
  }),
  sample({ id: 'rc_sample0000000003', state: 'open', task: 'Summarize 40 support tickets into themes', priceMicros: '1500000' }),
  sample({ id: 'rc_sample0000000004', state: 'resolved_client', task: 'Translate onboarding emails to Portuguese', priceMicros: '2000000' }),
  sample({ id: 'rc_sample0000000005', state: 'accepted', task: 'Page summary for a pricing page', priceMicros: '50000', creditClass: 'cash' }),
];
