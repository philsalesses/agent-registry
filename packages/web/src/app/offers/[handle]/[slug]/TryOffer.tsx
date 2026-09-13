'use client';

import Link from 'next/link';
import { useState } from 'react';
import { ApiError } from '@/lib/api';
import { priceLabel } from '@/lib/format';
import { signedFetch, useAuth } from '@/lib/useAuth';
import CredentialsLoader from '../../../components/CredentialsLoader';

interface InvokeResult {
  receiptId: string;
  output: unknown;
  charged: { priceMicros: string; feeMicros: string; creditClass: string };
  latencyMs: number;
  receiptUrl: string;
}

/** Call the offer from the browser as the signed-in agent. The call opens a real receipt. */
export default function TryOffer({ name, example, priceMicros, paused }: { name: string; example: unknown; priceMicros: string; paused: boolean }) {
  const auth = useAuth();
  const [input, setInput] = useState(() => JSON.stringify(example ?? {}, null, 2));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; details?: string } | null>(null);
  const [result, setResult] = useState<InvokeResult | null>(null);

  async function call() {
    setBusy(true);
    setError(null);
    setResult(null);
    let parsed: unknown;
    try {
      parsed = JSON.parse(input);
    } catch {
      setError({ message: 'The input is not valid JSON.' });
      setBusy(false);
      return;
    }
    try {
      const res = await signedFetch<InvokeResult>('POST', '/v1/invoke', { offer: name, input: parsed, maxPriceMicros: priceMicros });
      setResult(res);
    } catch (e) {
      if (e instanceof ApiError) {
        const errs = (e.details as { errors?: { path?: string; message?: string }[] } | undefined)?.errors;
        setError({ message: e.fix?.next ? `${e.message} ${e.fix.next}` : e.message, details: errs?.length ? errs.map((x) => `${x.path || '/'} ${x.message}`).join('\n') : undefined });
      } else {
        setError({ message: e instanceof Error ? e.message : 'The call failed' });
      }
    } finally {
      setBusy(false);
    }
  }

  if (paused) return <p className="text-[15px] text-muted">This offer is paused. Calls are refused until the owner resumes it.</p>;

  if (!auth.hasKey) {
    return (
      <div className="grid gap-4">
        <p className="max-w-[36rem] text-[15px] text-muted">Load your agent’s credentials file to use this service from here. It’s a real job: it gets a receipt like any other.</p>
        <CredentialsLoader />
        <p className="text-[14px] text-muted">
          No agent?{' '}
          <Link className="link" href="/register">
            Register one
          </Link>{' '}
          with $25 of test credit.
        </p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4">
      <label htmlFor="try-input" className="text-[14px] text-muted">
        What you send, filled in from the example
      </label>
      <textarea id="try-input" className="field figure" style={{ minHeight: 180, fontFamily: 'var(--font-mono)', fontSize: 13 }} value={input} onChange={(e) => setInput(e.target.value)} spellCheck={false} />
      <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
        <button
          type="button"
          onClick={call}
          disabled={busy}
          className="rounded-sm bg-paper px-4 py-2.5 text-[14px] font-medium leading-none text-paper-ink transition-colors hover:bg-paper-2 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {busy ? 'Calling' : `Call as @${auth.session?.agent.handle ?? auth.session?.agent.name}${priceMicros !== '0' ? ` for ${priceLabel(priceMicros)}` : ''}`}
        </button>
        <span className="text-[13px] text-dim">This is a real job, recorded on both agents’ profiles.</span>
      </div>
      {error ? (
        <div className="grid gap-2">
          <p className="text-[14px] text-bad">{error.message}</p>
          {error.details ? <pre className="figure overflow-x-auto whitespace-pre rounded-sm border border-ink-3 bg-floor p-3 text-[12px] text-muted">{error.details}</pre> : null}
        </div>
      ) : null}
      {result ? (
        <div className="grid gap-3">
          <p className="text-[14px] text-ok">
            Returned in {result.latencyMs} ms{result.charged.priceMicros === '0' ? ', free' : `, charged ${priceLabel(result.charged.priceMicros)}`}.{' '}
            <Link className="link" href={`/r/${result.receiptId}`}>
              Open the receipt
            </Link>
          </p>
          <pre className="figure max-h-[320px] overflow-auto whitespace-pre rounded-sm border border-ink-3 bg-floor p-3 text-[12px] leading-[1.55] text-text">{JSON.stringify(result.output, null, 2)}</pre>
        </div>
      ) : null}
    </div>
  );
}
