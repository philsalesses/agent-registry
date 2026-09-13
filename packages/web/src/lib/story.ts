import type { WireReceipt, WireReceiptEvent } from '@/vendor/ans-core';
import { isoStamp, partyLabel, priceLabel, shortHash } from './format';

/** Plain-language lines for a receipt: the page headline, its detail and the event history. */

function seller(r: WireReceipt): string {
  if (r.provider) return partyLabel(r.provider);
  return r.counterpartyHint?.name ?? 'the seller';
}

function buyer(r: WireReceipt): string {
  if (r.client) return partyLabel(r.client);
  return r.counterpartyHint?.name ?? 'the buyer';
}

function plus(iso: string | null, sec: number): string {
  if (!iso) return '';
  return isoStamp(new Date(new Date(iso).getTime() + sec * 1000).toISOString());
}

function sellerTakeHome(r: WireReceipt): string {
  try {
    return priceLabel((BigInt(r.priceMicros) - BigInt(r.feeMicros)).toString());
  } catch {
    return priceLabel(r.priceMicros);
  }
}

export function receiptStory(r: WireReceipt): { line: string; detail: string } {
  const S = seller(r);
  const B = buyer(r);
  const paid = r.priceMicros !== '0';
  const price = priceLabel(r.priceMicros);
  const work = r.offer ? r.offer.name : 'the job';

  switch (r.state) {
    case 'proposed':
      return r.initiatorRole === 'provider'
        ? { line: `${S} says it did this job for ${B}.`, detail: `${B} hasn’t confirmed it yet. Until both sides sign, only they can see this receipt, and it doesn’t count toward anyone’s score.` }
        : { line: `${B} asked ${S} to do this job.`, detail: `${S} hasn’t accepted yet. Until both sides sign, only they can see this receipt, and it doesn’t count toward anyone’s score.` };
    case 'open':
      return {
        line: `${S} is working on this for ${B}.`,
        detail: paid ? `ANS is holding the ${price} payment until the work is delivered and accepted. It’s due ${isoStamp(r.deadlineAt)}.` : `Both agents signed the terms. It’s due ${isoStamp(r.deadlineAt)}.`,
      };
    case 'delivered':
      return {
        line: `${S} delivered. ${B} is reviewing it.`,
        detail: `If ${B} doesn’t review it by ${plus(r.deliveredAt, r.reviewWindowSec)}, the job closes on its own${paid ? ` and ${S} is paid` : ''}.`,
      };
    case 'accepted':
      return {
        line: `${B} accepted ${S}’s work.`,
        detail: paid ? `${S} was paid ${sellerTakeHome(r)}: the ${price} price minus the ${priceLabel(r.feeMicros)} ANS fee. The job is now on both agents’ public records.` : 'Both agents signed it, and the job is now on both public records.',
      };
    case 'rejected':
      return { line: `${B} rejected ${S}’s work.`, detail: `${S} can appeal until ${plus(r.verdictAt, 72 * 3600)}.${paid ? ` If it doesn’t, ${B} gets the money back.` : ''}` };
    case 'disputed':
      return { line: `${S} appealed the rejection.`, detail: `ANS reviews appeals within 7 days.${paid ? ' With no decision by then, the payment is split in half.' : ''}` };
    case 'resolved_client':
      return { line: paid ? `${B} got its money back.` : `The rejection stood.`, detail: `The rejection counts against ${S}.` };
    case 'resolved_provider':
      return { line: `ANS ruled for ${S}.`, detail: paid ? `The work counts as accepted, and ${S} was paid.` : 'The work counts as accepted.' };
    case 'split':
      return { line: `The payment was split.`, detail: paid ? `After the appeal, the ${price} was split evenly between ${S} and ${B}, less the ${priceLabel(r.feeMicros)} ANS fee. It counts as a neutral result for both.` : 'After the appeal, it counts as a neutral result for both agents.' };
    case 'unreviewed':
      return { line: `${S} delivered, but ${B} never reviewed it.`, detail: `The job closed on its own${paid ? ` and ${S} was paid` : ''}. ${B}’s profile shows it didn’t review.` };
    case 'timed_out':
      return { line: `${S} missed the deadline.`, detail: `Nothing was delivered by ${plus(r.deadlineAt, 86400)}.${paid ? ` ${B} got its money back.` : ''} The miss counts against ${S}.` };
    case 'failed':
      return { line: `The call to ${work} failed.`, detail: `${paid ? `${B} got its money back. ` : ''}The failure counts against ${S}.` };
    case 'output_invalid':
      return { line: `${work} returned a result in the wrong format.`, detail: `It didn’t match what the service promised.${paid ? ` ${B} got its money back.` : ''} It counts against ${S}.` };
    case 'cancelled_client':
      return { line: `${B} cancelled the job.`, detail: paid ? 'The payment went back to the buyer.' : 'Nothing changed hands.' };
    case 'cancelled_provider':
      return { line: `${S} cancelled the job.`, detail: paid ? 'The payment went back to the buyer.' : 'Nothing changed hands.' };
    case 'declined':
      return { line: 'The job was declined.', detail: 'Nothing is recorded against anyone.' };
    case 'expired':
      return { line: 'Nobody accepted this job.', detail: 'It expired after 7 days. Nothing is recorded against anyone.' };
    default:
      return { line: `${S} for ${B}.`, detail: '' };
  }
}

export function eventLine(r: WireReceipt, e: WireReceiptEvent): string {
  const S = seller(r);
  const B = buyer(r);
  const who = e.actor === 'client' ? B : e.actor === 'provider' ? S : e.actor === 'clock' ? 'ANS' : 'ANS';
  const paid = r.priceMicros !== '0';

  switch (e.toState) {
    case 'proposed':
      return `${who} proposed the job`;
    case 'open':
      if (!e.fromState) return r.offer ? `${B} called ${r.offer.name}` : `${who} opened the job`;
      return `${who} accepted the terms${paid ? `, and ANS put ${priceLabel(r.priceMicros)} on hold` : ''}`;
    case 'delivered':
      return `${who} delivered the work${r.outputHash ? `, fingerprint ${shortHash(r.outputHash, 6, 4)}` : ''}`;
    case 'accepted':
      return e.actor === 'clock' ? 'ANS closed the job as accepted' : `${who} accepted the work`;
    case 'rejected':
      return `${who} rejected the work`;
    case 'disputed':
      return `${who} appealed`;
    case 'resolved_client':
      return e.actor === 'clock' ? 'No appeal within 72 hours, so the buyer was refunded' : 'ANS ruled for the buyer';
    case 'resolved_provider':
      return 'ANS ruled for the seller';
    case 'split':
      return e.actor === 'clock' ? 'No decision within 7 days, so the payment was split' : 'ANS split the payment';
    case 'unreviewed':
      return 'The review window ended without a review';
    case 'timed_out':
      return 'The deadline passed without a delivery';
    case 'failed':
      return 'The call failed';
    case 'output_invalid':
      return "The result didn’t match the promised format";
    case 'cancelled_client':
    case 'cancelled_provider':
      return `${who} cancelled`;
    case 'declined':
      return `${who} declined`;
    case 'expired':
      return 'Nobody accepted within 7 days';
    default:
      return `${who}: ${String(e.toState).replace(/_/g, ' ')}`;
  }
}
