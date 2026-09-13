import Link from 'next/link';
import type { WireOfferSummary } from '@/vendor/ans-core';
import { confidenceLabel, priceLabel } from '@/lib/format';

/** '@handle/slug@3' -> ['handle', 'slug'] */
export function offerPath(name: string): string {
  const [handle, slug] = name.replace(/^@/, '').split('@')[0].split('/');
  return `/offers/${handle}/${slug}`;
}

/** The name without its version suffix: '@scout/brief' */
export function offerLabel(name: string): string {
  return name.replace(/@\d+$/, '');
}

function OfferLine({ offer, showOwner }: { offer: WireOfferSummary; showOwner: boolean }) {
  return (
    <li>
      <Link
        href={offerPath(offer.name)}
        className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-6 gap-y-1 rounded-sm px-4 py-4 transition-colors hover:bg-ink-3 md:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)_6rem_7rem] md:items-baseline"
      >
        <span className="min-w-0">
          <span className="figure block truncate text-[14px] text-text">{offerLabel(offer.name)}</span>
          <span className="mt-0.5 block truncate text-[14px] text-muted">{offer.title}</span>
        </span>
        <span className="figure hidden truncate text-[13px] text-muted md:block" title={offer.inputFields.join(', ')}>
          {offer.inputFields.slice(0, 3).join(', ') || 'no input'}
        </span>
        <span className="figure hidden truncate text-[13px] text-muted md:block" title={offer.outputFields.join(', ')}>
          {offer.outputFields.slice(0, 3).join(', ') || 'no output'}
        </span>
        <span className="figure text-right text-[14px] text-text">{priceLabel(offer.priceMicros)}</span>
        <span className="figure hidden text-right text-[13px] text-muted md:block">
          {showOwner
            ? offer.owner.isHouse
              ? 'house'
              : `${offer.owner.trust.score} · ${confidenceLabel(offer.owner.trust.confidence)}`
            : offer.stats.calls > 0
              ? `${Math.round((offer.stats.ok / Math.max(offer.stats.calls, 1)) * 100)}% ok`
              : 'no calls'}
        </span>
      </Link>
    </li>
  );
}

/** A table of typed offers: name and title, what it takes, what it returns, price, and owner trust or call health. */
export default function OfferRows({ offers, showOwner = true, empty }: { offers: WireOfferSummary[]; showOwner?: boolean; empty?: React.ReactNode }) {
  return (
    <div className="panel overflow-hidden">
      <div className="hidden grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)_6rem_7rem] gap-x-6 px-4 pb-2 pt-4 text-[12px] text-dim md:grid">
        <span>offer</span>
        <span>takes</span>
        <span>returns</span>
        <span className="text-right">price</span>
        <span className="text-right">{showOwner ? 'owner trust' : 'calls'}</span>
      </div>
      {offers.length > 0 ? <ul className="grid pb-1">{offers.map((o) => <OfferLine key={o.id} offer={o} showOwner={showOwner} />)}</ul> : <div className="px-4 py-10">{empty}</div>}
    </div>
  );
}
