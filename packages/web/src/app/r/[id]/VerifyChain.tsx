'use client';

import { useState } from 'react';
import { API_URL } from '@/lib/config';
import { plural, shortId } from '@/lib/format';

interface ChainResult {
  label: string;
  ok: boolean;
  checked: number;
  breakAt: string | null;
  signatures: { verified: number; attested: number; failed: number };
  note?: string;
}

/** Re-checks both parties' receipt chains and signatures against the registry, on demand. */
export default function VerifyChain({ parties }: { parties: { id: string; label: string }[] }) {
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<ChainResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      const out = await Promise.all(
        parties.map(async (p) => {
          const res = await fetch(`${API_URL}/v1/agents/${encodeURIComponent(p.id)}/receipts/verify`, { headers: { Accept: 'application/json' }, cache: 'no-store' });
          if (!res.ok) throw new Error(`Could not check ${p.label} (${res.status})`);
          const json = await res.json();
          return { label: p.label, ok: !!json.ok, checked: json.checked ?? 0, breakAt: json.breakAt ?? null, signatures: json.signatures ?? { verified: 0, attested: 0, failed: 0 }, note: json.note } as ChainResult;
        }),
      );
      setResults(out);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The check did not complete');
    } finally {
      setBusy(false);
    }
  }

  if (parties.length === 0) return null;

  return (
    <div className="grid gap-3">
      <div>
        <button
          type="button"
          onClick={run}
          disabled={busy}
          className="rounded-sm border border-line-strong px-4 py-2.5 text-[14px] leading-none text-text transition-colors hover:border-paper-2 disabled:opacity-60"
        >
          {busy ? 'Checking' : results ? 'Check again' : parties.length > 1 ? 'Check both agents’ records' : 'Check the agent’s record'}
        </button>
      </div>
      {error ? <p className="text-[14px] text-bad">{error}</p> : null}
      {results ? (
        <ul className="grid gap-2">
          {results.map((r) => (
            <li key={r.label} className="grid gap-x-4 gap-y-0.5 text-[14px] sm:grid-cols-[9rem_minmax(0,1fr)]">
              <span className="figure truncate text-text">{r.label}</span>
              <span className={r.ok && r.signatures.failed === 0 ? 'text-ok' : 'text-bad'}>
                {r.ok ? `intact across ${plural(r.checked, 'finished job')}` : `altered at ${shortId(r.breakAt)}`}
                <span className="text-muted">
                  {' '}
                  · {plural(r.signatures.verified, 'signature')} valid
                  {r.signatures.attested ? `, ${r.signatures.attested} made by ANS on the agent’s behalf` : ''}
                  {r.signatures.failed ? `, ${r.signatures.failed} invalid` : ''}
                </span>
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      {results?.[0]?.note ? <p className="text-[13px] text-dim">{results[0].note}</p> : null}
    </div>
  );
}
