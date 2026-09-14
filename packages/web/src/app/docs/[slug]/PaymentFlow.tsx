'use client';

import { useId, useState } from 'react';
import styles from './docs.module.css';

const dollars = (amount: number) => amount.toLocaleString('en-US', { style: 'currency', currency: 'USD' });

export default function PaymentFlow() {
  const id = useId();
  const [price, setPrice] = useState(100);
  const [outcome, setOutcome] = useState<'accepted' | 'refunded'>('accepted');
  const fee = Math.ceil(price * 1_000_000 * 50 / 10_000) / 1_000_000;
  const paid = outcome === 'accepted';

  return (
    <figure className={styles.payment} aria-labelledby={`${id}-title`}>
      <figcaption className={styles.visualHeading}>
        <h2 id={`${id}-title`}>Follow the money.</h2>
        <p>An example job. Move the price, then choose the outcome.</p>
      </figcaption>
      <div className={styles.priceControl}>
        <label htmlFor={`${id}-price`}>Agreed price</label>
        <output htmlFor={`${id}-price`}>{dollars(price)}</output>
        <input id={`${id}-price`} type="range" min={10} max={500} step={10} value={price} onChange={(event) => setPrice(Number(event.target.value))} aria-valuetext={dollars(price)} />
        <span>$10</span><span>$500</span>
      </div>
      <div className={styles.moneyRoute}>
        <div className={styles.moneyStop}>
          <span>Buyer wallet</span>
          <strong>{dollars(price)}</strong>
          <p>Committed to this job</p>
        </div>
        <svg className={styles.routeArrow} viewBox="0 0 64 20" aria-hidden="true"><path d="M4 10H58M51 3l7 7-7 7" /><circle cx="7" cy="10" r="2.5" /></svg>
        <div className={`${styles.moneyStop} ${styles.holdStop}`}>
          <span>Held by ANS</span>
          <strong>{dollars(price)}</strong>
          <p>Reserved while work happens</p>
        </div>
      </div>
      <fieldset className={styles.outcomeControl}>
        <legend>How does the job end?</legend>
        <label data-selected={paid}>
          <input type="radio" name={`${id}-outcome`} value="accepted" checked={paid} onChange={() => setOutcome('accepted')} />
          Work accepted
        </label>
        <label data-selected={!paid}>
          <input type="radio" name={`${id}-outcome`} value="refunded" checked={!paid} onChange={() => setOutcome('refunded')} />
          Refund due
        </label>
      </fieldset>
      <div className={styles.moneyResult} aria-live="polite" aria-atomic="true">
        <div>
          <span>{paid ? 'Seller receives' : 'Returned to buyer'}</span>
          <strong>{dollars(paid ? price - fee : price)}</strong>
        </div>
        <div>
          <span>ANS fee {paid ? '(0.5%)' : ''}</span>
          <strong>{dollars(paid ? fee : 0)}</strong>
        </div>
        <p>{paid ? 'Released on acceptance or when the review window ends. Earned money becomes eligible for payout after 14 days.' : 'Refunded if nothing is delivered or a rejection stands. The buyer gets the full job price back.'}</p>
      </div>
      <p className={styles.visualNote}>Illustration only. No payment is made here. See the rules below for disputes and split decisions.</p>
    </figure>
  );
}
