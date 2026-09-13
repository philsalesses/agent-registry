import Link from 'next/link';
import type { WireReceipt } from '@/vendor/ans-core';
import { bpsPercent, isoDate, isoStamp, partyLabel, priceLabel, shortHash, shortId, stateWord, timeAgo, SEALED_STATES } from '@/lib/format';
import StateWord from './StateWord';
import { OpenMark, SealMark } from './marks';

type Size = 'hero' | 'ticket' | 'row';

function Row({ label, children, title }: { label: string; children: React.ReactNode; title?: string }) {
  return (
    <div className="paper-row">
      <span>{label}</span>
      <span title={title}>{children}</span>
    </div>
  );
}

function Dash() {
  return <hr className="rule-dash" />;
}

function creditLabel(r: WireReceipt): string {
  if (r.priceMicros === '0') return 'free';
  return r.creditClass === 'sandbox' ? 'sandbox credit' : 'cash credit';
}

function ratingsLine(r: WireReceipt): string | null {
  if (!r.ratings.revealed) return r.deliveredAt ? 'sealed until both rate' : null;
  const toProvider = r.ratings.provider?.score;
  const toClient = r.ratings.client?.score;
  if (toProvider === undefined && toClient === undefined) return null;
  return `${toProvider ?? '-'} for provider · ${toClient ?? '-'} for client`;
}

function counterpartyName(r: WireReceipt, role: 'client' | 'provider'): string {
  const party = role === 'client' ? r.client : r.provider;
  if (party) return partyLabel(party);
  if (r.counterpartyHint) return `${r.counterpartyHint.name} (unclaimed)`;
  return 'unclaimed';
}

/**
 * The receipt: the signature artifact of ANS, drawn from real API data.
 * hero: the full record. ticket: a compact slip for the rail. row: a torn strip for the ledger.
 */
export default function Receipt({ receipt: r, size = 'hero', link = true, sample = false, className = '' }: { receipt: WireReceipt; size?: Size; link?: boolean; sample?: boolean; className?: string }) {
  const sealed = !!r.hash || SEALED_STATES.has(r.state);
  const Mark = sealed ? SealMark : OpenMark;
  const href = `/r/${r.id}`;

  if (size === 'row') {
    const work = r.offer?.name ?? r.task;
    const body = (
      <div className="paper torn-r grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-5 gap-y-0.5 py-2.5 pl-4 pr-8 md:grid-cols-[minmax(0,1.15fr)_minmax(0,1.25fr)_4.75rem_6rem_4.25rem]">
        <span className="truncate" title={`${counterpartyName(r, 'provider')} for ${counterpartyName(r, 'client')}`}>
          {counterpartyName(r, 'provider')} <span className="text-paper-muted">for</span> {counterpartyName(r, 'client')}
        </span>
        <span className="hidden truncate text-paper-muted md:block" title={work}>
          {work}
        </span>
        <span className="text-right tabular-nums">{priceLabel(r.priceMicros)}</span>
        <StateWord state={r.state} surface="paper" className="hidden text-right md:block" />
        <span className="hidden text-right text-paper-muted md:block">{timeAgo(r.sealedAt ?? r.acceptedAt ?? r.createdAt)}</span>
        <span className="col-span-2 flex justify-between gap-4 text-paper-muted md:hidden">
          <span className="truncate">{work}</span>
          <StateWord state={r.state} surface="paper" className="shrink-0" />
        </span>
      </div>
    );
    return (
      <div className={`paper-shadow ${className}`}>
        {link ? (
          <Link href={href} className="block transition-[filter] hover:brightness-[0.97]" aria-label={`Receipt ${r.id}, ${stateWord(r.state).label}`}>
            {body}
          </Link>
        ) : (
          body
        )}
      </div>
    );
  }

  if (size === 'ticket') {
    const body = (
      <div className="paper torn-b w-[248px] px-[18px] pb-7 pt-4">
        <div className="flex items-center justify-between gap-3">
          <span className={`receipt-head text-[12px] ${sample ? 'text-paper-bad' : ''}`}>{sample ? 'Sample receipt' : 'ANS receipt'}</span>
          <Mark size={14} className="text-paper-muted" />
        </div>
        <div className="paper-row mt-1 text-[12px]">
          <span>{shortId(r.id)}</span>
          <span>{timeAgo(r.sealedAt ?? r.acceptedAt ?? r.createdAt)}</span>
        </div>
        <Dash />
        <p className="leading-[1.45]">
          {counterpartyName(r, 'provider')} <span className="text-paper-muted">for</span> {counterpartyName(r, 'client')}
        </p>
        <p className="mt-1 line-clamp-2 text-paper-muted" title={r.offer?.name ?? r.task}>
          {r.offer?.name ?? r.task}
        </p>
        <Dash />
        <div className="paper-row">
          <span className="!text-paper-ink tabular-nums">{priceLabel(r.priceMicros)}</span>
          <StateWord state={r.state} surface="paper" />
        </div>
      </div>
    );
    return link ? (
      <Link href={href} className="block" aria-label={`Receipt ${r.id}`}>
        {body}
      </Link>
    ) : (
      body
    );
  }

  const ratings = ratingsLine(r);
  return (
    <div className={`paper-shadow w-full max-w-[420px] ${className}`}>
      <article className="paper torn-b px-6 pb-10 pt-5" aria-label={`Receipt ${r.id}`}>
        <div className="flex items-center justify-between gap-4">
          <span className="receipt-head">ANS receipt</span>
          <Mark size={18} className={sealed ? 'text-paper-ink' : 'text-paper-muted'} title={sealed ? 'sealed into both chains' : 'in progress'} />
        </div>
        <div className="paper-row mt-1">
          <span className="!text-paper-ink">{r.id}</span>
          <span>{isoDate(r.createdAt)}</span>
        </div>
        <Dash />
        <Row label="provider">{counterpartyName(r, 'provider')}</Row>
        <Row label="client">{counterpartyName(r, 'client')}</Row>
        {r.offer ? <Row label="offer" title={r.offer.title}>{r.offer.name}</Row> : null}
        <div className="mt-1">
          <span className="text-paper-muted">task</span>
          <p className="mt-0.5 whitespace-pre-wrap break-words">{r.task}</p>
        </div>
        <Dash />
        <Row label="price">{priceLabel(r.priceMicros)}</Row>
        {r.priceMicros !== '0' ? <Row label={`fee ${bpsPercent(r.feeBps)}`}>{priceLabel(r.feeMicros)}</Row> : null}
        <Row label="paid with">{creditLabel(r)}</Row>
        <Row label="deadline">{isoStamp(r.deadlineAt)}</Row>
        <Dash />
        <div className="paper-row">
          <span>state</span>
          <StateWord state={r.state} surface="paper" className="font-semibold" />
        </div>
        {ratings ? <Row label="ratings">{ratings}</Row> : null}
        {r.deliveredAt ? <Row label="delivered">{isoStamp(r.deliveredAt)}</Row> : null}
        {r.sealedAt ? <Row label="sealed">{isoStamp(r.sealedAt)}</Row> : null}
        <Row label="signed" title={r.signatures.attested.length ? `registry attested: ${r.signatures.attested.join(', ')}` : 'every signature is the party’s own key'}>
          {[r.signatures.initiator && 'terms', r.signatures.counterparty && 'accept', r.signatures.deliver && 'delivery', r.signatures.verdict && 'verdict'].filter(Boolean).join(' · ') || 'terms'}
        </Row>
        {r.hash ? (
          <>
            <Dash />
            <Row label="hash" title={r.hash}>{shortHash(r.hash, 6, 6)}</Row>
            <Row label="prev (provider)" title={r.prevHashProvider ?? 'first in chain'}>{r.prevHashProvider ? shortHash(r.prevHashProvider, 6, 6) : 'first'}</Row>
            <Row label="prev (client)" title={r.prevHashClient ?? 'first in chain'}>{r.prevHashClient ? shortHash(r.prevHashClient, 6, 6) : 'first'}</Row>
          </>
        ) : null}
        <Dash />
        <p className="truncate text-center text-[12px] text-paper-muted">ans-registry.org/r/{r.id}</p>
      </article>
    </div>
  );
}
