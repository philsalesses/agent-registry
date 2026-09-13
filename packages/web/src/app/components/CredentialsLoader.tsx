'use client';

import { useRef, useState } from 'react';
import { parseCredentials, useAuth, type SignInStep } from '@/lib/useAuth';
import { ApiError } from '@/lib/api';

/**
 * Load a credentials file (or pasted JSON) to sign in and hold the key in memory for
 * this page. The private key is used only in the browser: the API sees a signature.
 */
export default function CredentialsLoader({ reason, onReady, onStep, compact = false }: { reason?: string; onReady?: () => void; onStep?: (step: SignInStep) => void; compact?: boolean }) {
  const auth = useAuth();
  const fileRef = useRef<HTMLInputElement>(null);
  const [paste, setPaste] = useState('');
  const [showPaste, setShowPaste] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load(text: string) {
    setBusy(true);
    setError(null);
    try {
      await auth.signIn(parseCredentials(text), onStep);
      setPaste('');
      onReady?.();
    } catch (e) {
      setError(e instanceof ApiError ? `${e.message}${e.code ? ` (${e.code})` : ''}` : e instanceof Error ? e.message : 'Could not sign in');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={compact ? '' : 'grid gap-3'}>
      {reason ? <p className="text-[14px] text-muted">{reason}</p> : null}
      <div className="flex flex-wrap items-center gap-3">
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          className="sr-only"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (f) await load(await f.text());
            e.target.value = '';
          }}
        />
        <button
          type="button"
          disabled={busy}
          onClick={() => fileRef.current?.click()}
          className="rounded-sm bg-paper px-4 py-2.5 text-[14px] font-medium leading-none text-paper-ink transition-colors hover:bg-paper-2 disabled:opacity-60"
        >
          {busy ? 'Signing in' : 'Load credentials file'}
        </button>
        <button type="button" onClick={() => setShowPaste((v) => !v)} className="text-[14px] text-muted transition-colors hover:text-text">
          {showPaste ? 'Hide paste box' : 'Paste JSON instead'}
        </button>
      </div>
      {showPaste ? (
        <div className="grid gap-2">
          <textarea
            className="field figure min-h-[110px] text-[12px]"
            placeholder='{"agentId": "ag_...", "privateKey": "..."}'
            value={paste}
            onChange={(e) => setPaste(e.target.value)}
            spellCheck={false}
            autoComplete="off"
          />
          <div>
            <button
              type="button"
              disabled={busy || paste.trim().length === 0}
              onClick={() => load(paste)}
              className="rounded-sm border border-line-strong px-4 py-2.5 text-[14px] leading-none text-text transition-colors hover:border-paper-2 disabled:opacity-50"
            >
              Sign in with pasted credentials
            </button>
          </div>
        </div>
      ) : null}
      {error ? <p className="text-[14px] text-bad">{error}</p> : null}
      <p className="text-[12px] text-dim">Your key signs in this tab and is never sent anywhere.</p>
    </div>
  );
}
