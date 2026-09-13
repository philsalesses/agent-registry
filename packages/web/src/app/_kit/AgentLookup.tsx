'use client';

import { useEffect, useId, useRef, useState } from 'react';
import type { WireVerify } from '@/vendor/ans-core';
import { api } from '@/lib/api';
import { errorText } from '@/lib/api-extra';
import { confidenceLabel, plural } from '@/lib/format';

type Result = { state: 'idle' } | { state: 'checking' } | { state: 'invalid' } | { state: 'missing'; query: string } | { state: 'self' } | { state: 'found'; agent: WireVerify } | { state: 'error'; message: string };

const HANDLE = /^[a-z0-9-]{3,32}$/;

/** '@Scout ' -> 'scout'; ids keep their case */
export function agentQuery(raw: string): string {
  const t = raw.trim();
  if (/^ag_/i.test(t)) return t;
  return t.replace(/^@/, '').toLowerCase();
}

/**
 * A handle or id field that asks GET /v1/verify/:idOrHandle as you type and shows
 * what the registry knows before anything is sent: registered, trust, confidence, receipts.
 */
export default function AgentLookup({
  label,
  value,
  onChange,
  onResolved,
  selfId,
  selfNote = 'That is your own agent.',
  showPolicy = false,
  autoFocus = false,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  onResolved: (agent: WireVerify | null) => void;
  selfId?: string | null;
  selfNote?: string;
  showPolicy?: boolean;
  autoFocus?: boolean;
}) {
  const id = useId();
  const q = agentQuery(value);
  const valid = q.startsWith('ag_') || HANDLE.test(q);
  // The answer for one query; anything typed since shows as checking until its own answer lands
  const [answer, setAnswer] = useState<{ key: string; result: Result } | null>(null);
  const key = `${q}|${selfId ?? ''}`;
  const result: Result = !q ? { state: 'idle' } : !valid ? { state: 'invalid' } : answer && answer.key === key ? answer.result : { state: 'checking' };

  const resolved = useRef(onResolved);
  useEffect(() => {
    resolved.current = onResolved;
  });

  useEffect(() => {
    resolved.current(null);
    if (!q || !valid) return;
    const ctrl = new AbortController();
    const settle = (r: Result, agent: WireVerify | null) => {
      if (ctrl.signal.aborted) return;
      setAnswer({ key, result: r });
      resolved.current(agent);
    };
    const timer = window.setTimeout(async () => {
      try {
        const v = await api<WireVerify>(`/v1/verify/${encodeURIComponent(q)}`, { signal: ctrl.signal });
        if (!v.registered || !v.id) settle({ state: 'missing', query: q }, null);
        else if (selfId && v.id === selfId) settle({ state: 'self' }, null);
        else settle({ state: 'found', agent: v }, v);
      } catch (e) {
        settle({ state: 'error', message: errorText(e) }, null);
      }
    }, 320);
    return () => {
      ctrl.abort();
      window.clearTimeout(timer);
    };
  }, [q, valid, key, selfId]);

  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-[13px] text-muted">
        {label}
      </label>
      <input id={id} className="field" value={value} onChange={(e) => onChange(e.target.value)} placeholder="@handle or ag_ id" autoComplete="off" autoCapitalize="none" spellCheck={false} autoFocus={autoFocus} />
      <p className="mt-2 min-h-[1.4rem] text-[13px] leading-[1.5]" aria-live="polite">
        <LookupLine result={result} selfNote={selfNote} showPolicy={showPolicy} />
      </p>
    </div>
  );
}

function LookupLine({ result, selfNote, showPolicy }: { result: Result; selfNote: string; showPolicy: boolean }) {
  switch (result.state) {
    case 'idle':
      return null;
    case 'checking':
      return <span className="text-muted">Checking the registry</span>;
    case 'invalid':
      return <span className="text-muted">A handle is 3 to 32 lowercase letters, digits or hyphens.</span>;
    case 'self':
      return <span className="text-muted">{selfNote}</span>;
    case 'error':
      return <span className="text-bad">{result.message}</span>;
    case 'missing':
      return (
        <>
          <span className="text-bad">not registered</span>
          <span className="text-muted"> · nothing answers to </span>
          <span className="figure text-text">{result.query}</span>
        </>
      );
    case 'found': {
      const a = result.agent;
      const trust = a.trust;
      const confirmed = a.receipts?.confirmed ?? 0;
      return (
        <>
          <span className="text-ok">registered</span>
          <span className="text-muted"> · </span>
          <span className="figure text-text">{a.handle ? `@${a.handle}` : a.name}</span>
          {a.isHouse ? <span className="text-muted"> · house agent</span> : null}
          {trust ? (
            <>
              <span className="text-muted"> · trust </span>
              <span className="figure text-text">{trust.score}</span>
              <span className="text-muted"> · confidence </span>
              <span className="figure text-text">{confidenceLabel(trust.confidence)}</span>
            </>
          ) : null}
          <span className="text-muted"> · {plural(confirmed, 'confirmed receipt')}</span>
          {showPolicy && a.policy && a.policy.minTrust > 0 ? <span className="text-wait"> · takes messages from trust {a.policy.minTrust}</span> : null}
        </>
      );
    }
  }
}
