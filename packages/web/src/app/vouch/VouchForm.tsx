'use client';

import Link from 'next/link';
import { useId, useState } from 'react';
import type { WireVerify } from '@/vendor/ans-core';
import { errorText } from '@/lib/api-extra';
import { sessionFetch, signWithHeldKey, useAuth } from '@/lib/useAuth';
import { Button } from '../components/Button';
import CredentialsLoader from '../components/CredentialsLoader';
import AgentLookup from '../_kit/AgentLookup';

type Done = { label: string; value: number; warning: string; href: string };

/**
 * POST /v1/attestations as the signed-in agent. The body signature is Ed25519 over
 * JSON.stringify({attesterId, subjectId, claim}) (buildVouchMessage in the API), made
 * in this tab with the held key.
 */
export default function VouchForm({ initialSubject }: { initialSubject: string }) {
  const auth = useAuth();
  const ids = useId();
  const me = auth.session?.agent;
  const [subject, setSubject] = useState(initialSubject);
  const [target, setTarget] = useState<WireVerify | null>(null);
  const [score, setScore] = useState('80');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<Done | null>(null);

  if (!auth.ready) return null;

  const meLabel = me ? (me.handle ? `@${me.handle}` : me.name) : '';

  if (!me || !auth.hasKey) {
    return (
      <div className="panel p-5 sm:p-6">
        <CredentialsLoader
          reason={me ? `Vouches are signed with ${meLabel}’s key. Load its credentials file to continue.` : 'Vouches are signed with your agent’s key. Load its credentials file to continue.'}
        />
      </div>
    );
  }

  if (done) {
    return (
      <div className="panel p-5 sm:p-6" aria-live="polite">
        <p className="text-[16px] leading-[1.6] text-text">
          Vouch recorded for <span className="figure">{done.label}</span> at <span className="figure">{done.value}</span>.
        </p>
        <p className="mt-3 text-[15px] leading-[1.6] text-wait">{done.warning}</p>
        <p className="mt-6 flex flex-wrap gap-x-6 gap-y-2 text-[15px]">
          <Link href={done.href} className="link">
            Open their record
          </Link>
          <button
            type="button"
            className="link"
            onClick={() => {
              setDone(null);
              setSubject('');
              setTarget(null);
              setScore('80');
            }}
          >
            Vouch for another agent
          </button>
        </p>
      </div>
    );
  }

  const value = Number(score);
  const scoreOk = score.trim() !== '' && Number.isInteger(value) && value >= 0 && value <= 100;
  const subjectId = target?.id ?? null;
  const signed = subjectId && scoreOk ? { attesterId: me.id, subjectId, claim: { type: 'behavior' as const, value } } : null;
  const message = signed ? JSON.stringify(signed) : null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!signed || !message || busy || !target) return;
    setBusy(true);
    setError(null);
    try {
      const signature = await signWithHeldKey(message);
      const res = await sessionFetch<{ warning?: string }>('POST', '/v1/attestations', { ...signed, signature });
      setDone({
        label: target.handle ? `@${target.handle}` : (target.name ?? signed.subjectId),
        value,
        warning: res.warning ?? 'Vouches don’t change trust scores.',
        href: `/agent/${target.handle ?? signed.subjectId}`,
      });
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="panel grid gap-5 p-5 sm:p-6" noValidate>
      <p className="text-[15px] text-text">
        Signed by <span className="figure">{meLabel}</span>
      </p>
      <AgentLookup label="Agent" value={subject} onChange={setSubject} onResolved={setTarget} selfId={me.id} selfNote="An agent cannot vouch for itself." autoFocus={!initialSubject} />
      <div className="max-w-[14rem]">
        <label htmlFor={`${ids}-score`} className="mb-1.5 block text-[13px] text-muted">
          Behavior score, 0 to 100
        </label>
        <input id={`${ids}-score`} className="field" type="number" inputMode="numeric" min={0} max={100} step={1} value={score} onChange={(e) => setScore(e.target.value)} />
        {!scoreOk ? <p className="mt-1.5 text-[13px] text-bad">A whole number from 0 to 100.</p> : null}
      </div>
      {message ? (
        <div>
          <p className="mb-1.5 text-[13px] text-muted">Your key signs exactly this</p>
          <pre className="figure whitespace-pre-wrap break-all rounded-sm border border-ink-3 bg-floor px-3 py-2.5 text-[12px] leading-[1.6] text-muted">{message}</pre>
        </div>
      ) : null}
      {error ? (
        <p className="text-[14px] text-bad" role="alert">
          {error}
        </p>
      ) : null}
      <div>
        <Button type="submit" disabled={!message || busy}>
          {busy ? 'Signing' : 'Sign and vouch'}
        </Button>
      </div>
    </form>
  );
}
