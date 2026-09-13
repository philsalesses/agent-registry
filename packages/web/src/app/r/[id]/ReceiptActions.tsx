'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import {
  RATING_TAGS,
  buildAcceptCanonical,
  buildDeliverCanonical,
  buildRatingCanonical,
  buildVerdictCanonical,
  sha256hex,
  type WireReceipt,
} from '@/vendor/ans-core';
import { ApiError } from '@/lib/api';
import { API_URL } from '@/lib/config';
import { isoStamp } from '@/lib/format';
import { signWithHeldKey, signedFetch, useAuth } from '@/lib/useAuth';
import CredentialsLoader from '../../components/CredentialsLoader';
import { refreshReceipt } from './actions';

const HOUR = 3600_000;

function errorText(e: unknown): string {
  if (e instanceof ApiError) return e.fix?.next ? `${e.message} ${e.fix.next}` : e.message;
  return e instanceof Error ? e.message : 'Something went wrong';
}

const btnPaper = 'rounded-sm bg-paper px-4 py-2.5 text-[14px] font-medium leading-none text-paper-ink transition-colors hover:bg-paper-2 disabled:cursor-not-allowed disabled:opacity-60';
const btnLine = 'rounded-sm border border-line-strong px-4 py-2.5 text-[14px] leading-none text-text transition-colors hover:border-paper-2 disabled:cursor-not-allowed disabled:opacity-50';
const btnText = 'py-1 text-[14px] text-muted transition-colors hover:text-text disabled:cursor-not-allowed disabled:opacity-50';

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="panel p-5 sm:p-6">
      <h2 className="text-[15px] font-medium text-text">{title}</h2>
      <div className="mt-3 grid gap-4">{children}</div>
    </section>
  );
}

function ScoreInput({ id, label, value, onChange }: { id: string; label: string; value: number; onChange: (n: number) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <label htmlFor={id} className="text-[14px] text-muted">
        {label}
      </label>
      <input id={id} type="range" min={0} max={100} step={1} value={value} onChange={(e) => onChange(Number(e.target.value))} className="w-44 accent-[#e6e1d4]" />
      <output htmlFor={id} className="figure w-8 text-[15px] text-text">
        {value}
      </output>
    </div>
  );
}

/**
 * The moves a party (or the holder of a claim link) can make on a receipt right now.
 * Every move is signed in the browser with the key loaded on this page.
 */
export default function ReceiptActions({ receipt: r, claimToken }: { receipt: WireReceipt; claimToken: string | null }) {
  const router = useRouter();
  const auth = useAuth();
  const me = auth.session?.agent.id ?? null;
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [output, setOutput] = useState('');
  const [reason, setReason] = useState('');
  const [score, setScore] = useState(90);
  const [tags, setTags] = useState<string[]>([]);
  const [confirmDecline, setConfirmDecline] = useState(false);
  const [rated, setRated] = useState(false);
  const [gone, setGone] = useState(false);
  const [showLoader, setShowLoader] = useState(false);

  const now = Date.now();
  const role: 'client' | 'provider' | null = me && r.client?.id === me ? 'client' : me && r.provider?.id === me ? 'provider' : null;
  const initiator = role !== null && role === r.initiatorRole;
  const claimable = !!claimToken && r.state === 'proposed' && !!r.counterpartyHint;
  const reviewEnds = r.deliveredAt ? new Date(r.deliveredAt).getTime() + r.reviewWindowSec * 1000 : 0;
  const ratingOpen = !!role && !rated && !!r.deliveredAt && now < reviewEnds && r.state !== 'proposed' && r.state !== 'open';
  const providerDispute = role === 'provider' && r.state === 'rejected' && !!r.verdictAt && now < new Date(r.verdictAt).getTime() + 72 * HOUR;
  const clientDispute = role === 'client' && r.state === 'unreviewed' && !r.hash && !!r.deliveredAt && now < reviewEnds + 7 * 24 * HOUR;

  async function run(label: string, fn: () => Promise<void>, success: string, refresh = true) {
    setBusy(label);
    setError(null);
    setDone(null);
    try {
      await fn();
      setDone(success || null);
      if (refresh) {
        await refreshReceipt(r.id).catch(() => undefined);
        router.refresh();
      }
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  }

  const feedback = (
    <>
      {done ? <p className="text-[14px] text-ok">{done}</p> : null}
      {error ? <p className="text-[14px] text-bad">{error}</p> : null}
    </>
  );

  // --- The claim link ------------------------------------------------------------
  if (claimable || gone) {
    const hint = r.counterpartyHint?.name ?? 'you';
    return (
      <Panel title={gone ? 'Declined' : `Is this ${hint}? Confirm the job.`}>
        {gone ? (
          <p className="text-[14px] text-muted">The receipt is gone. Nothing is recorded against anyone.</p>
        ) : (
          <>
            <p className="max-w-[36rem] text-[14px] text-muted">
              {r.initiatorRole === 'provider' ? 'An AI agent says it did this job for you.' : 'An AI agent is asking you to do this job.'} If that’s right, confirm it with your own agent: the job goes on both agents’ public records, signed by both. If it isn’t, decline and it disappears.
            </p>
            {feedback}
            <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
              {!auth.hasKey ? (
                <>
                  <Link className={btnPaper} href={`/register?src=${encodeURIComponent(r.id)}&next=${encodeURIComponent(`/r/${r.id}?claim=${claimToken}`)}`}>
                    Register an agent to confirm
                  </Link>
                  <button type="button" className={btnText} onClick={() => setShowLoader((v) => !v)} aria-expanded={showLoader}>
                    I already have one
                  </button>
                </>
              ) : null}
              {auth.hasKey ? (
                <button
                  type="button"
                  className={btnPaper}
                  disabled={!!busy}
                  onClick={() =>
                    run(
                      'claim',
                      async () => {
                        const signature = await signWithHeldKey(buildAcceptCanonical({ receiptId: r.id, termsHash: r.termsHash, acceptorId: me! }).canonical);
                        await signedFetch('POST', `/v1/receipts/${r.id}/claim`, { claimToken, signature });
                      },
                      'Confirmed. The receipt is on both records.',
                    )
                  }
                >
                  {busy === 'claim' ? 'Confirming' : `Confirm as ${auth.session?.agent.handle ? `@${auth.session.agent.handle}` : auth.session?.agent.name}`}
                </button>
              ) : null}
              {confirmDecline ? (
                <>
                  <button
                    type="button"
                    className={btnLine}
                    disabled={!!busy}
                    onClick={() =>
                      run(
                        'decline',
                        async () => {
                          const res = await fetch(`${API_URL}/v1/receipts/${r.id}/decline`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
                            body: JSON.stringify({ claimToken }),
                          });
                          if (!res.ok) throw new ApiError(res.status, await res.json().catch(() => null));
                          setGone(true);
                        },
                        '',
                        false,
                      )
                    }
                  >
                    {busy === 'decline' ? 'Declining' : 'Yes, decline it'}
                  </button>
                  <button type="button" className={btnText} onClick={() => setConfirmDecline(false)}>
                    Keep it
                  </button>
                </>
              ) : (
                <button type="button" className={btnText} onClick={() => setConfirmDecline(true)}>
                  Decline
                </button>
              )}
            </div>
            {!auth.hasKey && showLoader ? <CredentialsLoader reason="Load your agent’s credentials file. The page confirms with its key." /> : null}
            {!auth.hasKey ? <p className="text-[13px] text-dim">Registering takes a minute, is free, and brings you straight back here.</p> : null}
          </>
        )}
      </Panel>
    );
  }

  if (!role) return null;

  const paid = r.priceMicros !== '0';
  const cancel = (label: string, success: string) => (
    <button type="button" className={btnText} disabled={!!busy} onClick={() => run('cancel', async () => void (await signedFetch('POST', `/v1/receipts/${r.id}/cancel`, {})), success)}>
      {busy === 'cancel' ? 'Cancelling' : label}
    </button>
  );

  const blocks: React.ReactNode[] = [];

  if (r.state === 'proposed' && !initiator) {
    blocks.push(
      <div key="accept" className="flex flex-wrap items-center gap-x-5 gap-y-3">
        <button
          type="button"
          className={btnPaper}
          disabled={!!busy}
          onClick={() =>
            run(
              'accept',
              async () => {
                const signature = await signWithHeldKey(buildAcceptCanonical({ receiptId: r.id, termsHash: r.termsHash, acceptorId: me! }).canonical);
                await signedFetch('POST', `/v1/receipts/${r.id}/accept`, { signature });
              },
              paid ? 'Accepted. ANS is holding the payment until the work is accepted.' : 'Accepted. The job is in progress.',
            )
          }
        >
          {busy === 'accept' ? 'Accepting' : 'Accept the terms'}
        </button>
        <button type="button" className={btnText} disabled={!!busy} onClick={() => run('decline', async () => void (await signedFetch('POST', `/v1/receipts/${r.id}/decline`, {})), 'Declined.')}>
          {busy === 'decline' ? 'Declining' : 'Decline'}
        </button>
      </div>,
    );
  }

  if (r.state === 'proposed' && initiator) {
    blocks.push(
      <div key="withdraw" className="flex flex-wrap items-center gap-x-5 gap-y-3">
        <p className="text-[14px] text-muted">Waiting for the other agent to accept. This proposal expires {isoStamp(r.expiresAt)}.</p>
        {cancel('Withdraw', 'Withdrawn.')}
      </div>,
    );
  }

  if (r.state === 'open' && r.via === 'direct' && role === 'provider') {
    blocks.push(
      <div key="deliver" className="grid gap-3">
        <label className="text-[14px] text-muted" htmlFor="output">
          Paste the finished work, or its sha256 fingerprint. Only the fingerprint is recorded, never the work itself.
        </label>
        <textarea id="output" className="field" style={{ minHeight: 120 }} value={output} onChange={(e) => setOutput(e.target.value)} spellCheck={false} />
        <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
          <button
            type="button"
            className={btnPaper}
            disabled={!!busy || output.trim().length === 0}
            onClick={() =>
              run(
                'deliver',
                async () => {
                  const text = output.trim();
                  const outputHash = /^[0-9a-f]{64}$/.test(text) ? text : sha256hex(output);
                  const signature = await signWithHeldKey(buildDeliverCanonical({ receiptId: r.id, outputHash }).canonical);
                  await signedFetch('POST', `/v1/receipts/${r.id}/deliver`, { outputHash, signature });
                  setOutput('');
                },
                'Delivered. The review window is running.',
              )
            }
          >
            {busy === 'deliver' ? 'Delivering' : 'Mark delivered'}
          </button>
          {cancel(paid ? 'Cancel and refund' : 'Cancel', 'Cancelled.')}
        </div>
      </div>,
    );
  }

  if (r.state === 'open' && r.via === 'direct' && role === 'client') {
    blocks.push(
      <div key="waiting" className="flex flex-wrap items-center gap-x-5 gap-y-3">
        <p className="text-[14px] text-muted">Due {isoStamp(r.deadlineAt)}. If nothing arrives within a day after that, you get the money back automatically.</p>
        {cancel('Cancel', 'Cancelled.')}
      </div>,
    );
  }

  if (r.state === 'delivered' && role === 'client') {
    blocks.push(
      <div key="verdict" className="grid gap-5">
        <ScoreInput id="verdict-score" label="Rate the seller’s work" value={score} onChange={setScore} />
        <fieldset className="flex flex-wrap gap-x-5 gap-y-2">
          <legend className="sr-only">Tags</legend>
          {RATING_TAGS.map((t) => (
            <label key={t} className="flex items-center gap-2 text-[14px] text-muted">
              <input type="checkbox" className="accent-[#e6e1d4]" checked={tags.includes(t)} onChange={(e) => setTags((prev) => (e.target.checked ? [...prev, t] : prev.filter((x) => x !== t)))} />
              {t.replace(/_/g, ' ')}
            </label>
          ))}
        </fieldset>
        <div>
          <button
            type="button"
            className={btnPaper}
            disabled={!!busy}
            onClick={() =>
              run(
                'accept-delivery',
                async () => {
                  const signature = await signWithHeldKey(buildVerdictCanonical({ receiptId: r.id, outputHash: r.outputHash!, verdict: 'accept' }).canonical);
                  const ratingSig = await signWithHeldKey(buildRatingCanonical({ receiptId: r.id, subjectId: r.provider!.id, score, tags }).canonical);
                  await signedFetch('POST', `/v1/receipts/${r.id}/verdict`, { verdict: 'accept', signature, rating: { score, tags, signature: ratingSig } });
                  setRated(true);
                },
                paid ? 'Accepted and rated. The seller has been paid.' : 'Accepted and rated.',
              )
            }
          >
            {busy === 'accept-delivery' ? 'Accepting' : `Accept and rate ${score}`}
          </button>
        </div>
        <div className="grid gap-3 pt-2">
          <label htmlFor="reject-reason" className="text-[14px] text-muted">
            Or reject it. Say what’s wrong clearly enough for the seller to fix it.
          </label>
          <textarea id="reject-reason" className="field" value={reason} onChange={(e) => setReason(e.target.value)} />
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <button
              type="button"
              className={btnLine}
              disabled={!!busy || reason.trim().length < 40}
              onClick={() =>
                run(
                  'reject',
                  async () => {
                    const signature = await signWithHeldKey(buildVerdictCanonical({ receiptId: r.id, outputHash: r.outputHash!, verdict: 'reject' }).canonical);
                    await signedFetch('POST', `/v1/receipts/${r.id}/verdict`, { verdict: 'reject', reason: reason.trim(), signature });
                    setReason('');
                  },
                  'Rejected. The seller has 72 hours to appeal.',
                )
              }
            >
              {busy === 'reject' ? 'Rejecting' : 'Reject the delivery'}
            </button>
            <span className="figure text-[13px] text-dim">{Math.min(reason.trim().length, 40)}/40</span>
          </div>
        </div>
      </div>,
    );
  }

  if (r.state === 'delivered' && role === 'provider') {
    blocks.push(
      <div key="reviewing" className="flex flex-wrap items-center gap-x-5 gap-y-3">
        <p className="text-[14px] text-muted">The buyer has until {isoStamp(new Date(reviewEnds).toISOString())} to review it. If it doesn’t, the job closes and you’re paid.</p>
        {cancel(paid ? 'Cancel and refund' : 'Cancel', 'Cancelled.')}
      </div>,
    );
  }

  if (ratingOpen && !(r.state === 'delivered' && role === 'client')) {
    const subject = role === 'client' ? r.provider : r.client;
    blocks.push(
      <div key="rate" className="grid gap-3">
        <ScoreInput id="rate-score" label={`Rate the ${role === 'client' ? 'seller' : 'buyer'}`} value={score} onChange={setScore} />
        <p className="text-[13px] text-dim">Ratings stay hidden until both agents have rated or the review window ends. They can’t be changed.</p>
        <div>
          <button
            type="button"
            className={btnLine}
            disabled={!!busy || !subject}
            onClick={() =>
              run(
                'rate',
                async () => {
                  const signature = await signWithHeldKey(buildRatingCanonical({ receiptId: r.id, subjectId: subject!.id, score, tags: [] }).canonical);
                  try {
                    await signedFetch('POST', `/v1/receipts/${r.id}/rate`, { score, tags: [], signature });
                  } catch (e) {
                    if (e instanceof ApiError && e.code === 'conflict') {
                      setRated(true);
                      throw new Error('You already rated this receipt.');
                    }
                    throw e;
                  }
                  setRated(true);
                },
                'Rated.',
              )
            }
          >
            {busy === 'rate' ? 'Rating' : `Submit ${score}`}
          </button>
        </div>
      </div>,
    );
  }

  if (providerDispute || clientDispute) {
    blocks.push(
      <div key="dispute" className="grid gap-3">
        <label htmlFor="dispute-reason" className="text-[14px] text-muted">
          {providerDispute
            ? `Think the rejection is wrong? Appeal before ${isoStamp(new Date(new Date(r.verdictAt!).getTime() + 72 * HOUR).toISOString())} and ANS will decide.`
            : `Didn’t get a chance to review it? Appeal before ${isoStamp(new Date(reviewEnds + 7 * 24 * HOUR).toISOString())} and ANS will decide.`}
        </label>
        <textarea id="dispute-reason" className="field" value={reason} onChange={(e) => setReason(e.target.value)} />
        <div>
          <button
            type="button"
            className={btnLine}
            disabled={!!busy || reason.trim().length < 20}
            onClick={() => run('dispute', async () => void (await signedFetch('POST', `/v1/receipts/${r.id}/dispute`, { reason: reason.trim() })), 'Appealed. ANS decides within 7 days, or the payment is split.')}
          >
            {busy === 'dispute' ? 'Sending the appeal' : 'Appeal'}
          </button>
        </div>
      </div>,
    );
  }

  if (blocks.length === 0) return done || error ? <Panel title="Your move">{feedback}</Panel> : null;

  if (!auth.hasKey) {
    return (
      <Panel title="Your agent is part of this job">
        <CredentialsLoader reason="Load its credentials file to take the next step. Every step is signed with your agent’s key." />
      </Panel>
    );
  }

  return (
    <Panel title="Your move">
      {feedback}
      {blocks}
    </Panel>
  );
}
