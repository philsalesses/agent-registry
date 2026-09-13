import type { WireReceipt, WireReceiptEvent } from '@/vendor/ans-core';
import { isoStamp, partyLabel, priceLabel, shortHash } from './format';

/** Plain-language lines for a receipt: the page headline, its detail and the event history. */

function provider(r: WireReceipt): string {
  if (r.provider) return partyLabel(r.provider);
  return r.counterpartyHint?.name ?? 'the provider';
}

function client(r: WireReceipt): string {
  if (r.client) return partyLabel(r.client);
  return r.counterpartyHint?.name ?? 'the client';
}

function plus(iso: string | null, sec: number): string {
  if (!iso) return '';
  return isoStamp(new Date(new Date(iso).getTime() + sec * 1000).toISOString());
}

export function receiptStory(r: WireReceipt): { line: string; detail: string } {
  const P = provider(r);
  const C = client(r);
  const paid = r.priceMicros !== '0';
  const price = priceLabel(r.priceMicros);
  const work = r.offer ? r.offer.name : 'the work';

  switch (r.state) {
    case 'proposed':
      return r.initiatorRole === 'provider'
        ? { line: `${P} says it did this for ${C}.`, detail: `Waiting for ${C} to confirm. Until both sign, the receipt is private and counts for nothing.` }
        : { line: `${C} asked ${P} for this.`, detail: `Waiting for ${P} to accept. Until both sign, the receipt is private and counts for nothing.` };
    case 'open':
      return {
        line: `${P} is on it for ${C}.`,
        detail: paid ? `${price} is held in escrow until the work is delivered and reviewed. Due ${isoStamp(r.deadlineAt)}.` : `Both signed the terms. Due ${isoStamp(r.deadlineAt)}.`,
      };
    case 'delivered':
      return {
        line: `${P} delivered. ${C} is reviewing.`,
        detail: `If nobody reviews by ${plus(r.deliveredAt, r.reviewWindowSec)}, the clock closes it as unreviewed${paid ? ' and pays the provider' : ''}.`,
      };
    case 'accepted':
      return {
        line: `${P} delivered and ${C} accepted.`,
        detail: paid ? `${price} left escrow for the provider, less the ${priceLabel(r.feeMicros)} fee. Signed by both and sealed into both histories.` : 'Signed by both and sealed into both histories.',
      };
    case 'rejected':
      return { line: `${C} rejected ${P}'s delivery.`, detail: `The provider can dispute until ${plus(r.verdictAt, 72 * 3600)}. After that the client is refunded.` };
    case 'disputed':
      return { line: `The delivery is in dispute.`, detail: 'The registry rules within 7 days. With no ruling, the price splits in half.' };
    case 'resolved_client':
      return { line: `${C} was refunded.`, detail: `The rejection stood. It stays on ${P}'s record.` };
    case 'resolved_provider':
      return { line: `The registry upheld ${P}'s delivery.`, detail: paid ? `${price} went to the provider, less the fee.` : 'The delivery counts as accepted.' };
    case 'split':
      return { line: `${P} and ${C} split it.`, detail: paid ? `Half of ${price} to each side, fee on the whole.` : 'Both sides carry half the weight.' };
    case 'unreviewed':
      return { line: `${P} delivered. ${C} never reviewed it.`, detail: `The clock closed it${paid ? ' and paid the provider' : ''}. The silence stays on the client's record.` };
    case 'timed_out':
      return { line: `${P} missed the deadline.`, detail: `Nothing was delivered by ${plus(r.deadlineAt, 86400)}.${paid ? ' The client was refunded.' : ''} The miss stays on the provider's record.` };
    case 'failed':
      return { line: `The call to ${work} failed.`, detail: `${paid ? 'The caller was refunded. ' : ''}The failure counts against ${P}.` };
    case 'output_invalid':
      return { line: `${work} returned output that broke its own contract.`, detail: `${paid ? 'The caller was refunded. ' : ''}It counts against ${P}.` };
    case 'cancelled_client':
      return { line: `${C} cancelled.`, detail: paid ? 'Escrow went back to the client.' : 'Nothing changed hands.' };
    case 'cancelled_provider':
      return { line: `${P} cancelled.`, detail: paid ? 'Escrow went back to the client.' : 'Nothing changed hands.' };
    case 'declined':
      return { line: 'Declined.', detail: 'The other side did not confirm. Nothing is recorded against anyone.' };
    case 'expired':
      return { line: 'Nobody confirmed it.', detail: 'It expired after 7 days. Nothing is recorded against anyone.' };
    default:
      return { line: `${P} for ${C}.`, detail: '' };
  }
}

export function eventLine(r: WireReceipt, e: WireReceiptEvent): string {
  const P = provider(r);
  const C = client(r);
  const who = e.actor === 'client' ? C : e.actor === 'provider' ? P : e.actor === 'clock' ? 'The clock' : 'The registry';
  const paid = r.priceMicros !== '0';

  switch (e.toState) {
    case 'proposed':
      return `${who} proposed the terms`;
    case 'open':
      if (!e.fromState) return r.offer ? `${C} called ${r.offer.name}` : `${who} opened it`;
      return `${who} accepted the terms${paid ? `, ${priceLabel(r.priceMicros)} into escrow` : ''}`;
    case 'delivered':
      return `${who} delivered${r.outputHash ? ` output ${shortHash(r.outputHash, 6, 4)}` : ''}`;
    case 'accepted':
      return e.actor === 'clock' ? 'The clock accepted it' : `${who} accepted the delivery`;
    case 'rejected':
      return `${who} rejected the delivery`;
    case 'disputed':
      return `${who} disputed`;
    case 'resolved_client':
      return e.actor === 'clock' ? 'No dispute in 72 hours: refunded' : 'The registry ruled for the client';
    case 'resolved_provider':
      return 'The registry ruled for the provider';
    case 'split':
      return e.actor === 'clock' ? 'No ruling in 7 days: split' : 'The registry split it';
    case 'unreviewed':
      return 'The review window closed with no verdict';
    case 'timed_out':
      return 'The deadline passed with no delivery';
    case 'failed':
      return 'The call failed';
    case 'output_invalid':
      return 'The output failed the offer schema';
    case 'cancelled_client':
    case 'cancelled_provider':
      return `${who} cancelled`;
    case 'declined':
      return `${who} declined`;
    case 'expired':
      return 'Nobody confirmed within 7 days';
    default:
      return `${who}: ${String(e.toState).replace(/_/g, ' ')}`;
  }
}
