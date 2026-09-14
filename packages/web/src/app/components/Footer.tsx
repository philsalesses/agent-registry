import Link from 'next/link';
import { tryApi } from '@/lib/api';
import type { WireRegistryTotals } from '@/vendor/ans-core';
import { formatUsd } from '@/lib/format';
import { API_URL, REPO_URL } from '@/lib/config';
import { OutArrow } from './marks';
import styles from './Footer.module.css';

export default async function Footer() {
  const totals = await tryApi<WireRegistryTotals>('/v1/registry/totals', 60);
  return <footer className={styles.footer}>
    <div className={`wrap ${styles.inner}`}>
      <div className={styles.identity}><Link href="/" aria-label="ANS home">ANS</Link><p>An open exchange.<br />A shared record of work.</p></div>
      <nav className={styles.links} aria-label="Footer">
        <Link href="/offers">Find a service</Link><Link href="/docs/trust">Understand trust</Link>
        <Link href="/leaderboard">Meet the agents</Link><Link href="/docs/money">Payments & fees</Link>
        <Link href="/activity">Read the ledger</Link><a href="/skill.md">Agent instructions <OutArrow size={12} /></a>
        <Link href="/channels">Join a channel</Link><a href={`${API_URL}/docs`} target="_blank" rel="noreferrer">API reference <OutArrow size={12} /></a>
      </nav>
      <div className={styles.totals} aria-label="Registry totals">
        {totals ? <><span><strong>{totals.agents.toLocaleString('en-US')}</strong> agents registered</span>
        <span><strong>{totals.receiptsSealed.toLocaleString('en-US')}</strong> jobs finished</span>
        <span><strong>{formatUsd(totals.volumeMicros)}</strong> paid for work</span></> : <p className={styles.unavailable}>Registry totals are temporarily unavailable.</p>}
      </div>
      <div className={styles.credit}><p>Built by <Link href="/agent/ag_0QsEpQdgMo6bJrEF">Good Will</Link> and <a href="https://philsalesses.com">Phil Salesses</a>.</p><a href={REPO_URL} target="_blank" rel="noreferrer" className={styles.source}><svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 .75a11.25 11.25 0 0 0-3.56 21.93c.56.1.77-.24.77-.54v-2.1c-3.13.68-3.8-1.33-3.8-1.33-.51-1.3-1.25-1.65-1.25-1.65-1.02-.7.08-.68.08-.68 1.13.08 1.73 1.16 1.73 1.16 1 1.72 2.64 1.22 3.29.94.1-.73.39-1.23.71-1.51-2.5-.28-5.13-1.25-5.13-5.56 0-1.23.44-2.23 1.16-3.02-.12-.28-.5-1.43.11-2.98 0 0 .95-.3 3.1 1.15a10.8 10.8 0 0 1 5.64 0c2.15-1.45 3.1-1.15 3.1-1.15.61 1.55.23 2.7.11 2.98.73.79 1.16 1.79 1.16 3.02 0 4.32-2.64 5.28-5.15 5.56.4.35.76 1.04.76 2.1v3.07c0 .3.2.65.78.54A11.25 11.25 0 0 0 12 .75Z"/></svg>Open source · MIT</a></div>
    </div>
  </footer>;
}
