import { formatUsd, FEE_BPS } from '@/vendor/ans-core';
import type { ReceiptState } from '@/vendor/ans-core';

export { formatUsd, FEE_BPS };

export type Tone = 'ok' | 'wait' | 'bad' | 'dim';

const STATE_WORDS: Record<ReceiptState, { label: string; tone: Tone }> = {
  proposed: { label: 'proposed', tone: 'wait' },
  open: { label: 'open', tone: 'wait' },
  delivered: { label: 'delivered', tone: 'wait' },
  accepted: { label: 'accepted', tone: 'ok' },
  rejected: { label: 'rejected', tone: 'bad' },
  disputed: { label: 'disputed', tone: 'wait' },
  resolved_client: { label: 'refunded', tone: 'bad' },
  resolved_provider: { label: 'upheld', tone: 'ok' },
  split: { label: 'split', tone: 'wait' },
  unreviewed: { label: 'unreviewed', tone: 'wait' },
  timed_out: { label: 'timed out', tone: 'bad' },
  failed: { label: 'failed', tone: 'bad' },
  output_invalid: { label: 'bad output', tone: 'bad' },
  cancelled_client: { label: 'cancelled', tone: 'dim' },
  cancelled_provider: { label: 'cancelled', tone: 'dim' },
  declined: { label: 'declined', tone: 'dim' },
  expired: { label: 'expired', tone: 'dim' },
};

export function stateWord(state: string): { label: string; tone: Tone } {
  return STATE_WORDS[state as ReceiptState] ?? { label: state.replace(/_/g, ' '), tone: 'dim' };
}

export const SEALED_STATES = new Set<string>([
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
]);

/** '9f1c…e42a' */
export function shortHash(hash: string | null | undefined, head = 4, tail = 4): string {
  if (!hash) return '';
  if (hash.length <= head + tail + 1) return hash;
  return `${hash.slice(0, head)}…${hash.slice(-tail)}`;
}

/** 'rc_7Hq2…8sT1' keeps the prefix readable */
export function shortId(id: string | null | undefined): string {
  if (!id) return '';
  const underscore = id.indexOf('_');
  if (underscore < 0 || id.length <= 12) return id;
  return `${id.slice(0, underscore + 5)}…${id.slice(-4)}`;
}

export function timeAgo(iso: string | null | undefined, now: number = Date.now()): string {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '';
  const s = Math.round((now - t) / 1000);
  if (s < 0) return 'just now';
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 36) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 45) return `${d}d ago`;
  return isoDate(iso);
}

/** '2026-09-13' */
export function isoDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString().slice(0, 10);
}

/** '12:04:31Z' */
export function isoTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.toISOString().slice(11, 19)}Z`;
}

/** '2026-09-13 12:04Z' */
export function isoStamp(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.toISOString().slice(0, 10)} ${d.toISOString().slice(11, 16)}Z`;
}

/** '3.00%' from basis points */
export function bpsPercent(bps: number): string {
  return `${parseFloat((bps / 100).toFixed(2))}%`;
}

/** '@scout' when a handle exists, else the display name */
export function partyLabel(party: { handle: string | null; name: string } | null | undefined): string {
  if (!party) return 'unclaimed';
  return party.handle ? `@${party.handle}` : party.name;
}

/** Whole cents, rounded down so a balance is never overstated: '$23.24' */
export function usdCents(micros: string | bigint): string {
  const m = typeof micros === 'bigint' ? micros : BigInt(micros);
  const cents = (m < 0n ? -m : m) / 10_000n;
  return `${m < 0n ? '-' : ''}${formatUsd((cents * 10_000n).toString())}`;
}

/** Price label: '$4.00', or 'free' for zero */
export function priceLabel(micros: string | null | undefined): string {
  if (!micros || micros === '0') return 'free';
  try {
    return formatUsd(micros);
  } catch {
    return micros;
  }
}

export function confidenceLabel(confidence: number): string {
  return confidence.toFixed(2);
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;
}
