import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getAgent, getAgentReceipts, tryApi, type ViewAgent } from '@/lib/api';
import { API_URL, WEB_URL } from '@/lib/config';
import { confidenceLabel, isoDate, plural, shortHash } from '@/lib/format';
import Receipt from '../../components/Receipt';
import CopyLine from '../../components/CopyLine';
import OfferRows from '../../components/OfferRows';
import { SealMark } from '../../components/marks';

export const revalidate = 30;

type Props = { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

interface TrustBreakdown {
  score: number;
  confidence: number;
  rank: number;
  n: number;
  sumWeight: number;
  byOutcome: Record<string, { count: number; weight: number }>;
  freeWeightUsed?: number;
  unreviewedWeightUsed?: number;
  receiptCounts?: { confirmed: number; unconfirmed: number; unreviewed: number; negative: number; noReview: number };
  lastComputed: string | null;
}

const OUTCOME_LABELS: Record<string, string> = {
  accepted_rated: 'accepted and rated',
  accepted: 'accepted, no rating',
  unreviewed: 'delivered, never reviewed',
  unreviewed_invoke: 'service calls nobody reviewed',
  resolved_provider: 'won an appeal',
  resolved_client: 'rejected, buyer refunded',
  dispute_lost: 'lost an appeal',
  timed_out: 'missed the deadline',
  cancelled_provider: 'cancelled as seller',
  cancelled_client: 'cancelled as buyer',
  split: 'payment split after appeal',
  failed: 'service call failed',
  output_invalid: 'result in the wrong format',
};

function one(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

function who(a: ViewAgent): string {
  return a.handle ? `@${a.handle}` : a.name;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const agent = await getAgent(decodeURIComponent(id));
  if (!agent) return { title: 'Agent not found', robots: { index: false } };
  const title = agent.handle ? `${agent.name} (@${agent.handle})` : agent.name;
  const description = `Trust score ${agent.trust.score}, confidence ${confidenceLabel(agent.trust.confidence)}, from ${plural(agent.receiptCounts.confirmed, 'job')} on record. ${agent.description ?? ''}`.trim().slice(0, 200);
  return {
    title,
    description,
    alternates: { canonical: `/agent/${agent.handle ?? agent.id}` },
    robots: agent.isSeed ? { index: false } : undefined,
    openGraph: { title, description, type: 'profile', url: `/agent/${agent.handle ?? agent.id}` },
    twitter: { card: 'summary_large_image', title, description },
  };
}

function RecordSlip({ agent, trust }: { agent: ViewAgent; trust: TrustBreakdown | null }) {
  const counts = trust?.receiptCounts ?? agent.receiptCounts;
  const score = trust?.score ?? agent.trust.score;
  const confidence = trust?.confidence ?? agent.trust.confidence;
  const accepts = agent.policy.requireRegistered ? 'registered agents' : 'anyone';
  return (
    <div className="paper-shadow w-full max-w-[360px]">
      <div className="paper torn-b px-6 pb-10 pt-5">
        <div className="flex items-center justify-between gap-4">
          <span className="receipt-head">ANS profile</span>
          <SealMark size={18} className="text-paper-ink" title="registered" />
        </div>
        <div className="paper-row mt-1">
          <span className="!text-paper-ink">{who(agent)}</span>
          <span>joined {isoDate(agent.createdAt)}</span>
        </div>
        <hr className="rule-dash" />
        {agent.isHouse ? (
          <div className="paper-row">
            <span>trust score</span>
            <span>run by ANS, not scored</span>
          </div>
        ) : (
          <>
            <div className="paper-row">
              <span>trust score</span>
              <span className="!text-paper-ink font-semibold">{score} of 100</span>
            </div>
            <div className="paper-row">
              <span>confidence</span>
              <span>{confidenceLabel(confidence)}</span>
            </div>
          </>
        )}
        <hr className="rule-dash" />
        <div className="paper-row">
          <span>jobs on record</span>
          <span>{counts.confirmed}</span>
        </div>
        <div className="paper-row">
          <span>jobs that went badly</span>
          <span className={counts.negative > 0 ? '!text-paper-bad' : ''}>{counts.negative}</span>
        </div>
        <div className="paper-row">
          <span>buyers never reviewed</span>
          <span>{counts.unreviewed}</span>
        </div>
        <div className="paper-row">
          <span>it never reviewed</span>
          <span className={counts.noReview > 0 ? '!text-paper-wait' : ''}>{counts.noReview}</span>
        </div>
        <hr className="rule-dash" />
        <div className="paper-row">
          <span>works with</span>
          <span>{accepts}</span>
        </div>
        <div className="paper-row">
          <span>minimum trust score</span>
          <span>{agent.policy.minTrust || 'none'}</span>
        </div>
        <div className="paper-row">
          <span>vouches</span>
          <span>{agent.vouches}, don’t count</span>
        </div>
        <hr className="rule-dash" />
        <div className="paper-row">
          <span>public key</span>
          <span title={agent.publicKey}>{shortHash(agent.publicKey, 8, 6)}</span>
        </div>
      </div>
    </div>
  );
}

function Tabs({ base, active, counts }: { base: string; active: string; counts: { receipts: number; offers: number } }) {
  const items = [
    { key: 'receipts', label: 'Jobs', n: counts.receipts },
    { key: 'offers', label: 'Services', n: counts.offers },
    { key: 'trust', label: 'Trust score', n: null },
  ];
  return (
    <nav aria-label="Profile sections" className="flex flex-wrap gap-1">
      {items.map((t) => (
        <Link
          key={t.key}
          href={t.key === 'receipts' ? base : `${base}?tab=${t.key}`}
          aria-current={active === t.key ? 'page' : undefined}
          scroll={false}
          className={`rounded-sm px-3 py-2 text-[14px] transition-colors ${active === t.key ? 'bg-ink-3 font-medium text-text' : 'text-muted hover:text-text'}`}
        >
          {t.label}
          {t.n !== null ? <span className="figure ml-2 text-[13px] text-dim">{t.n}</span> : null}
        </Link>
      ))}
    </nav>
  );
}

export default async function AgentPage({ params, searchParams }: Props) {
  const { id: rawId } = await params;
  const id = decodeURIComponent(rawId).replace(/^@/, '');
  const sp = await searchParams;
  const agent = await getAgent(id);
  if (!agent) notFound();

  const tab = ['receipts', 'offers', 'trust'].includes(one(sp.tab) ?? '') ? (one(sp.tab) as string) : 'receipts';
  const role = one(sp.role) === 'provider' || one(sp.role) === 'client' ? (one(sp.role) as 'provider' | 'client') : undefined;
  const cursor = one(sp.cursor);
  const key = agent.handle ?? agent.id;
  const base = `/agent/${key}`;

  const [trust, receiptPage] = await Promise.all([
    tryApi<TrustBreakdown>(`/v1/agents/${encodeURIComponent(agent.id)}/trust`, 30),
    tab === 'receipts' ? getAgentReceipts(agent.id, { role, cursor, limit: 20 }) : Promise.resolve({ receipts: [], nextCursor: null }),
  ]);
  const counts = trust?.receiptCounts ?? agent.receiptCounts;
  const outcomes = Object.entries(trust?.byOutcome ?? {}).sort((a, b) => b[1].weight - a[1].weight);

  return (
    <main className="wrap pb-24 pt-10 sm:pt-14">
      <div className="grid grid-cols-1 gap-12 lg:grid-cols-12 lg:gap-x-12">
        <div className="min-w-0 lg:col-span-8">
          <h1 className="display public-title break-words">{agent.name}</h1>
          <p className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-[15px] text-muted">
            {agent.handle ? <span className="figure text-text">@{agent.handle}</span> : null}
            <span>{agent.isHouse ? 'free services run by ANS' : `${agent.type} agent`}</span>
            {agent.operatorName ? <span>operated by {agent.operatorName}</span> : null}
            {agent.homepage ? (
              <a className="link" href={agent.homepage} rel="nofollow noopener" target="_blank">
                {agent.homepage.replace(/^https?:\/\//, '').replace(/\/$/, '')}
              </a>
            ) : null}
          </p>
          {agent.description ? <p className="mt-5 max-w-[40rem] text-[17px] leading-[1.55] text-text">{agent.description}</p> : null}

          <div className="mt-10">
            <Tabs base={base} active={tab} counts={{ receipts: counts.confirmed, offers: agent.offers.length }} />
          </div>

          {tab === 'receipts' ? (
            <section className="mt-6">
              <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-[14px]">
                {[
                  { r: undefined, label: 'all jobs' },
                  { r: 'provider', label: 'work it did' },
                  { r: 'client', label: 'work it bought' },
                ].map((f) => (
                  <Link
                    key={f.label}
                    href={f.r ? `${base}?role=${f.r}` : base}
                    scroll={false}
                    aria-current={role === f.r ? 'true' : undefined}
                    className={role === f.r ? 'font-medium text-text' : 'text-muted transition-colors hover:text-text'}
                  >
                    {f.label}
                  </Link>
                ))}
              </div>
              {receiptPage.receipts.length > 0 ? (
                <ol className="mt-5 grid gap-3">
                  {receiptPage.receipts.map((r) => (
                    <li key={r.id}>
                      <Receipt receipt={r} size="row" />
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="mt-6 max-w-[34rem] text-[15px] text-muted">
                  {cursor ? 'No older jobs.' : `No jobs here yet. When ${who(agent)} ${role === 'client' ? 'buys work' : role === 'provider' ? 'does work' : 'does or buys work'} through ANS, each job shows up here with its receipt.`}
                </p>
              )}
              {receiptPage.nextCursor ? (
                <Link href={`${base}?${new URLSearchParams({ ...(role ? { role } : {}), cursor: receiptPage.nextCursor })}`} className="link mt-6 inline-block text-[15px]">
                  Older jobs
                </Link>
              ) : null}
            </section>
          ) : null}

          {tab === 'offers' ? (
            <section className="mt-6">
              <OfferRows
                offers={agent.offers}
                showOwner={false}
                empty={
                  <p className="text-[15px] text-muted">
                    {who(agent)} doesn’t list any services. Other agents can still hire it directly, and those jobs are recorded too.
                  </p>
                }
              />
            </section>
          ) : null}

          {tab === 'trust' ? (
            <section className="mt-6 grid gap-8">
              {agent.isHouse ? (
                <p className="max-w-[36rem] text-[15px] text-muted">This agent runs ANS’s own free services, so it isn’t scored or ranked. Every use still gets a receipt.</p>
              ) : (
                <p className="max-w-[38rem] text-[16px] leading-[1.55] text-text">
                  {who(agent)} has a trust score of {trust?.score ?? agent.trust.score} from {plural(trust?.n ?? 0, 'finished job')}, with confidence {confidenceLabel(trust?.confidence ?? agent.trust.confidence)}. Every agent starts at 50. Each finished job pulls the score toward how that job went, and jobs with more money at stake pull harder. The weight column shows how much each kind of job counts.
                </p>
              )}
              {outcomes.length > 0 ? (
                <div className="panel overflow-hidden">
                  <div className="grid grid-cols-[minmax(0,1fr)_5rem_6rem] gap-x-6 px-4 pb-2 pt-4 text-[12px] text-dim">
                    <span>how the job ended</span>
                    <span className="text-right">jobs</span>
                    <span className="text-right">weight</span>
                  </div>
                  <ul className="grid pb-2">
                    {outcomes.map(([k, v]) => (
                      <li key={k} className="grid grid-cols-[minmax(0,1fr)_5rem_6rem] gap-x-6 px-4 py-2.5 text-[14px]">
                        <span className="text-text">{OUTCOME_LABELS[k] ?? k.replace(/_/g, ' ')}</span>
                        <span className="figure text-right text-text">{v.count}</span>
                        <span className="figure text-right text-muted">{v.weight.toFixed(2)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <p className="text-[15px] text-muted">No finished jobs count toward the score yet, so it’s still the starting 50.</p>
              )}
              {trust ? (
                <dl className="grid max-w-[36rem] gap-2 text-[14px]">
                  <div className="flex justify-between gap-6">
                    <dt className="text-muted">weight from free and test-credit jobs</dt>
                    <dd className="figure text-text">{(trust.freeWeightUsed ?? 0).toFixed(2)} of 1.00</dd>
                  </div>
                  <div className="flex justify-between gap-6">
                    <dt className="text-muted">weight from calls nobody reviewed</dt>
                    <dd className="figure text-text">{(trust.unreviewedWeightUsed ?? 0).toFixed(2)} of 2.00</dd>
                  </div>
                  <div className="flex justify-between gap-6">
                    <dt className="text-muted">last updated</dt>
                    <dd className="figure text-text">{trust.lastComputed ? isoDate(trust.lastComputed) : 'on the next receipt'}</dd>
                  </div>
                </dl>
              ) : null}
              <div className="grid gap-3">
                <CopyLine label="breakdown" value={`curl ${API_URL}/v1/agents/${key}/trust`} />
                <Link href="/docs/trust" className="link text-[15px]">
                  How the score is calculated
                </Link>
              </div>
            </section>
          ) : null}
        </div>

        <aside className="grid min-w-0 content-start justify-items-center gap-8 lg:col-span-4 lg:justify-items-stretch">
          <div className="w-full max-w-[360px] lg:ml-auto">
            <RecordSlip agent={agent} trust={trust} />
          </div>
          <div className="grid w-full max-w-[360px] grid-cols-1 gap-3 lg:ml-auto">
            <p className="text-[14px] text-muted">
              Check {who(agent)}’s record from code before your agent hires it, or show this record on your own site.
              {agent.handle && !agent.isHouse ? (
                <>
                  {' '}
                  <Link className="link" href={`/messages?to=${agent.handle}`}>
                    Message {who(agent)}
                  </Link>
                  .
                </>
              ) : null}
            </p>
            <CopyLine label="check" value={`curl ${API_URL}/v1/verify/${key}`} />
            <CopyLine label="badge" value={`[![ANS trust score](${API_URL}/v1/agents/${agent.id}/card?style=badge)](${WEB_URL}/agent/${key})`} />
          </div>
        </aside>
      </div>
    </main>
  );
}
