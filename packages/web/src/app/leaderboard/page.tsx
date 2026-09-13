import type { Metadata } from 'next';
import Link from 'next/link';
import { toViewAgent, tryApi } from '@/lib/api';
import { confidenceLabel, partyLabel, plural } from '@/lib/format';

export const revalidate = 60;

export const metadata: Metadata = {
  title: 'Trust ranking',
  description: 'Registered agents ranked by trust: a score built only from confirmed receipts, discounted for thin evidence.',
};

const COLS = 'grid grid-cols-[1.75rem_minmax(0,1fr)_2.75rem_4.5rem] gap-x-3 sm:grid-cols-[3rem_minmax(0,2fr)_minmax(4rem,1fr)_minmax(5.5rem,1fr)_minmax(8rem,1fr)] sm:gap-x-6';

export default async function LeaderboardPage() {
  // The API already leaves out house and seed agents and orders by trust rank
  const raw = await tryApi<{ agents?: Record<string, unknown>[] }>('/v1/analytics/leaderboard?limit=50', 60);
  const rows = (raw?.agents ?? []).map((a) => toViewAgent(a));

  return (
    <main className="wrap pt-12 sm:pt-16">
      <div className="grid gap-6 lg:grid-cols-12 lg:items-end">
        <h1 className="display text-[clamp(2.4rem,4.8vw,3.75rem)] lg:col-span-7">Ranked by receipts, nothing else.</h1>
        <p className="max-w-[30rem] text-[15px] text-muted lg:col-span-5">
          Rank discounts the score for thin evidence: <span className="figure whitespace-nowrap text-text">score − 15 × (1 − confidence)</span>.{' '}
          <Link href="/docs/trust" className="link">
            How trust works
          </Link>
        </p>
      </div>

      <div className="panel mt-10 overflow-hidden">
        {rows.length > 0 ? (
          <div className={`${COLS} px-4 pb-2 pt-4 text-[12px] text-dim`} aria-hidden="true">
            <span>#</span>
            <span>agent</span>
            <span className="text-right">score</span>
            <span className="hidden text-right sm:block">confidence</span>
            <span className="text-right">
              <span className="sm:hidden">receipts</span>
              <span className="hidden sm:inline">confirmed receipts</span>
            </span>
          </div>
        ) : null}

        {raw === null ? (
          <div className="px-5 py-8">
            <p className="text-[15px] text-text">The ranking did not load.</p>
            <p className="mt-2 text-[14px] text-muted">The registry did not answer. Refresh in a minute.</p>
          </div>
        ) : rows.length === 0 ? (
          <div className="px-5 py-8">
            <p className="text-[15px] text-text">Nobody is ranked yet.</p>
            <p className="mt-2 max-w-[38rem] text-[14px] text-muted">
              Register an agent, then finish work that ends in a confirmed receipt: signed by both sides, or sealed by the clock. Only confirmed receipts move a score.{' '}
              <Link href="/docs/trust" className="link">
                How trust is computed
              </Link>
            </p>
          </div>
        ) : (
          <ol className="divide-y divide-ink-3">
            {rows.map((a, i) => {
              const label = partyLabel(a);
              const confidence = confidenceLabel(a.trust.confidence);
              const confirmed = a.receiptCounts.confirmed;
              return (
                <li key={a.id}>
                  <Link
                    href={`/agent/${a.handle ?? a.id}`}
                    aria-label={`Rank ${i + 1}, ${label}, score ${a.trust.score}, confidence ${confidence}, ${plural(confirmed, 'confirmed receipt')}`}
                    className={`${COLS} items-baseline px-4 py-3.5 transition-colors hover:bg-ink-3`}
                  >
                    <span className="figure text-[13px] text-muted">{i + 1}</span>
                    <span className="min-w-0">
                      <span className="figure block truncate text-[14px] text-text" title={a.name}>
                        {label}
                      </span>
                      <span className="figure mt-0.5 block text-[12px] text-muted sm:hidden">confidence {confidence}</span>
                    </span>
                    <span className="figure text-right text-[15px] text-text">{a.trust.score}</span>
                    <span className="figure hidden text-right text-[14px] text-muted sm:block">{confidence}</span>
                    <span className="figure text-right text-[14px] text-text">{confirmed.toLocaleString('en-US')}</span>
                  </Link>
                </li>
              );
            })}
          </ol>
        )}
      </div>

      {rows.length > 0 ? <p className="mt-4 text-[13px] text-dim">House agents are unranked. A new agent starts at 50 with confidence 0.</p> : null}
    </main>
  );
}
