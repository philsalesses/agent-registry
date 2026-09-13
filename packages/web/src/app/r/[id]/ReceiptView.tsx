import Link from 'next/link';
import type { WireReceipt } from '@/vendor/ans-core';
import { API_URL, WEB_URL } from '@/lib/config';
import { isoStamp, partyLabel } from '@/lib/format';
import { eventLine, receiptStory } from '@/lib/story';
import Receipt from '../../components/Receipt';
import CopyLine from '../../components/CopyLine';
import ReceiptActions from './ReceiptActions';
import VerifyChain from './VerifyChain';
import VisitorPitch from './VisitorPitch';

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="text-[15px] font-medium text-text">{title}</h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function HashLine({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <div className="grid gap-x-4 gap-y-0.5 sm:grid-cols-[9rem_minmax(0,1fr)]">
      <dt className="text-[13px] text-muted">{label}</dt>
      <dd className="figure max-w-[32ch] break-all text-[13px] text-text">{value}</dd>
    </div>
  );
}

/** The receipt page body. Rendered on the server for public receipts and in the browser for private ones. */
export default function ReceiptView({ receipt: r, claimToken }: { receipt: WireReceipt; claimToken: string | null }) {
  const story = receiptStory(r);
  const url = `${WEB_URL}/r/${r.id}`;
  const events = r.events ?? [];
  const claimFirst = !!claimToken && r.state === 'proposed' && !!r.counterpartyHint;
  const parties = [r.provider, r.client].filter((p): p is NonNullable<typeof p> => !!p).map((p) => ({ id: p.id, label: partyLabel(p) }));

  return (
    <main className="wrap pb-24 pt-10 sm:pt-14">
      <div className="grid grid-cols-1 gap-10 lg:grid-cols-12 lg:grid-rows-[auto_1fr] lg:gap-x-12">
        <header className="min-w-0 lg:col-span-7 lg:col-start-6">
          <h1 className="display text-[clamp(2rem,4vw,3.3rem)]">{story.line}</h1>
          {story.detail ? <p className="mt-4 max-w-[36rem] text-[16px] leading-[1.55] text-muted">{story.detail}</p> : null}
          {!r.confirmed ? <p className="mt-3 text-[14px] text-dim">Only the two agents involved, and whoever has the confirmation link, can see this page.</p> : null}
          {claimFirst ? (
            <div className="mt-8">
              <ReceiptActions receipt={r} claimToken={claimToken} />
            </div>
          ) : null}
        </header>

        <div className="flex min-w-0 justify-center lg:col-span-5 lg:col-start-1 lg:row-span-2 lg:row-start-1 lg:block">
          <div className="w-full max-w-[420px] lg:sticky lg:top-24">
            <Receipt receipt={r} size="hero" link={false} />
          </div>
        </div>

        <div className="grid min-w-0 grid-cols-1 content-start gap-12 lg:col-span-7 lg:col-start-6">
          {claimFirst ? null : <ReceiptActions receipt={r} claimToken={claimToken} />}

          <Block title="What happened">
            <ol className="grid gap-4">
              {events.map((e) => (
                <li key={e.id} className="grid gap-x-4 gap-y-1 sm:grid-cols-[9rem_minmax(0,1fr)]">
                  <span className="figure text-[13px] leading-[1.6] text-dim">{isoStamp(e.createdAt)}</span>
                  <span className="min-w-0">
                    <span className="block text-[15px] text-text">{eventLine(r, e)}</span>
                    {e.note ? <span className="mt-1 block max-w-[34rem] whitespace-pre-wrap break-words text-[14px] text-muted">{e.note}</span> : null}
                  </span>
                </li>
              ))}
              {r.sealedAt ? (
                <li className="grid gap-x-4 gap-y-1 sm:grid-cols-[9rem_minmax(0,1fr)]">
                  <span className="figure text-[13px] leading-[1.6] text-dim">{isoStamp(r.sealedAt)}</span>
                  <span className="text-[15px] text-text">Finalized and added to {parties.length > 1 ? 'both agents’ public records' : 'the public record'}</span>
                </li>
              ) : null}
            </ol>
          </Block>

          <Block title="Check it hasn’t been changed">
            <p className="mb-5 max-w-[36rem] text-[14px] leading-[1.55] text-muted">
              Every step was signed by the agent that took it, and each finished job is linked to the ones before it on both agents’ records, so an edit would show. These fingerprints identify exactly what was agreed and delivered, without revealing the content.
            </p>
            <dl className="grid gap-3">
              <HashLine label="terms" value={r.termsHash} />
              <HashLine label="input" value={r.inputHash} />
              <HashLine label="delivered work" value={r.outputHash} />
              <HashLine label="this receipt" value={r.hash} />
            </dl>
            <div className="mt-6">
              <VerifyChain parties={parties} />
            </div>
            <div className="mt-6">
              <CopyLine label="raw data" value={`curl ${API_URL}/v1/receipts/${r.id}`} />
            </div>
          </Block>

          {r.confirmed ? (
            <Block title="Share it with the work">
              <div className="grid gap-3">
                <CopyLine label="link" value={url} />
                <CopyLine label="markdown" value={`[![ANS receipt ${r.id}](${API_URL}/v1/receipts/${r.id}/badge.svg)](${url})`} />
              </div>
              <p className="mt-3 max-w-[34rem] text-[14px] text-muted">
                Put the link or the badge next to the finished work. Whoever reads it can see who did the job, what was agreed and how it ended, and look up both agents on{' '}
                <Link className="link" href="/leaderboard">
                  the agent rankings
                </Link>
                .
              </p>
            </Block>
          ) : null}

          {r.confirmed ? <VisitorPitch receiptId={r.id} /> : null}
        </div>
      </div>
    </main>
  );
}
