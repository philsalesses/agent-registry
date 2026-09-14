import Link from 'next/link';
import type { WireOfferSummary } from '@/vendor/ans-core';
import { confidenceLabel, priceLabel } from '@/lib/format';
import styles from '../directory-public.module.css';

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
  const rate = offer.stats.calls > 0 ? Math.round((offer.stats.ok / offer.stats.calls) * 100) : null;
  return (
    <li>
      <Link href={offerPath(offer.name)} className={styles.offerRow}>
        <span className={styles.offerIdentity}>
          <span className={styles.offerTitle}>{offer.title}</span>
          <span className={`${styles.offerName} figure`}>{offerLabel(offer.name)}</span>
        </span>
        <span className={styles.contract}>
          <span className={styles.contractPart}>
            <span className={styles.contractLabel}>You send</span>
            <span className={`${styles.contractValue} figure`}>{offer.inputFields.join(', ') || 'No input'}</span>
          </span>
          <svg className={styles.flowArrow} width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M2 8h11m-4-4 4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span className={styles.contractPart}>
            <span className={styles.contractLabel}>You get</span>
            <span className={`${styles.contractValue} figure`}>{offer.outputFields.join(', ') || 'No output'}</span>
          </span>
        </span>
        <span className={styles.offerPrice}>
          {priceLabel(offer.priceMicros)}
          <small>{offer.priceMicros === '0' ? 'to use' : 'per call'}</small>
        </span>
        <span className={styles.offerTrust}>
          {showOwner ? (
            offer.owner.isHouse ? <>Run by ANS<small>Free utility</small></> : <><strong>{offer.owner.trust.score}<span className="sr-only"> out of 100</span></strong><small>seller trust</small><small>{confidenceLabel(offer.owner.trust.confidence)} confidence</small></>
          ) : rate === null ? <>No calls yet</> : <><strong>{rate}%</strong><small>successful calls</small></>}
        </span>
      </Link>
    </li>
  );
}

/** Every breakpoint shows the contract, price and trust, so discovery stays useful on mobile. */
export default function OfferRows({ offers, showOwner = true, empty }: { offers: WireOfferSummary[]; showOwner?: boolean; empty?: React.ReactNode }) {
  return (
    <div className={styles.offerList}>
      {offers.length > 0 ? (
        <>
          <div className={styles.offerHeader} aria-hidden="true">
            <span>Service</span><span>The contract</span><span>Price</span><span>{showOwner ? 'Track record' : 'Reliability'}</span>
          </div>
          <ul>{offers.map((offer) => <OfferLine key={offer.id} offer={offer} showOwner={showOwner} />)}</ul>
        </>
      ) : <div className={styles.empty}>{empty}</div>}
    </div>
  );
}
