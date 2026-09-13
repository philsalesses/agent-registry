'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { isoStamp, shortHash } from '@/lib/format';
import { useAuth, type SignInStep } from '@/lib/useAuth';
import CredentialsLoader from '../components/CredentialsLoader';
import { OpenMark, SealMark } from '../components/marks';

function SignInSlip({ steps, who }: { steps: SignInStep[]; who: string | null }) {
  const challenge = steps.find((s): s is Extract<SignInStep, { kind: 'challenge' }> => s.kind === 'challenge');
  const signed = steps.find((s): s is Extract<SignInStep, { kind: 'signed' }> => s.kind === 'signed');
  const session = steps.find((s): s is Extract<SignInStep, { kind: 'session' }> => s.kind === 'session');
  const Mark = session ? SealMark : OpenMark;
  return (
    <div className="paper-shadow w-full max-w-[360px]">
      <div className="paper torn-b px-6 pb-10 pt-5">
        <div className="flex items-center justify-between gap-4">
          <span className="receipt-head">Sign-in</span>
          <Mark size={18} className={session ? 'text-paper-ink' : 'text-paper-muted'} title={session ? 'signed in' : 'waiting'} />
        </div>
        <hr className="rule-dash" />
        <div className="paper-row">
          <span>agent</span>
          <span>{who ?? 'from your file'}</span>
        </div>
        <div className="paper-row">
          <span>challenge</span>
          <span>{challenge ? shortHash(challenge.nonce, 8, 6) : 'not asked yet'}</span>
        </div>
        <div className="paper-row">
          <span>signature</span>
          <span>{signed ? shortHash(signed.signature, 8, 6) : 'made in this tab'}</span>
        </div>
        <hr className="rule-dash" />
        <div className="paper-row">
          <span>session</span>
          <span>{session ? `until ${isoStamp(new Date(session.expiresAt).toISOString())}` : 'none'}</span>
        </div>
        <div className="paper-row">
          <span>private key sent</span>
          <span>never</span>
        </div>
      </div>
    </div>
  );
}

export default function LoginFlow({ next }: { next: string | null }) {
  const router = useRouter();
  const auth = useAuth();
  const [steps, setSteps] = useState<SignInStep[]>([]);
  const who = auth.session ? (auth.session.agent.handle ? `@${auth.session.agent.handle}` : auth.session.agent.name) : null;

  return (
    <main className="wrap pb-24 pt-10 sm:pt-14">
      <div className="grid grid-cols-1 gap-12 lg:grid-cols-12 lg:gap-x-12">
        <div className="min-w-0 lg:col-span-7">
          {auth.session && (steps.length === 0 || steps.some((st) => st.kind === 'session')) ? (
            <>
              <h1 className="display text-[clamp(2.2rem,4.6vw,3.6rem)]">Signed in as {who}.</h1>
              <p className="mt-4 max-w-[34rem] text-[16px] leading-[1.55] text-muted">
                {auth.hasKey ? 'The key is loaded in this tab, so you can sign receipt moves.' : 'The session is active. Load the credentials file again when you need to sign a receipt move.'}
              </p>
              {!auth.hasKey ? (
                <div className="mt-8 max-w-[34rem]">
                  <CredentialsLoader onStep={(s) => setSteps((prev) => (s.kind === 'challenge' ? [s] : [...prev, s]))} onReady={() => (next ? router.push(next) : undefined)} />
                </div>
              ) : null}
              <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-3 text-[15px]">
                {next ? (
                  <Link href={next} className="rounded-sm bg-paper px-4 py-2.5 text-[14px] font-medium leading-none text-paper-ink transition-colors hover:bg-paper-2">
                    Continue
                  </Link>
                ) : null}
                <Link className="link" href={`/agent/${auth.session.agent.handle ?? auth.session.agent.id}`}>
                  Profile
                </Link>
                <Link className="link" href="/manage">
                  Settings and keys
                </Link>
                <Link className="link" href="/wallet">
                  Wallet
                </Link>
                <button type="button" onClick={() => auth.signOut()} className="text-[15px] text-muted transition-colors hover:text-text">
                  Sign out
                </button>
              </div>
            </>
          ) : (
            <>
              <h1 className="display text-[clamp(2.2rem,4.6vw,3.6rem)]">{auth.session ? `Signed in as ${who}.` : 'Sign in with the agent’s key.'}</h1>
              <p className="mt-4 max-w-[34rem] text-[16px] leading-[1.55] text-muted">
                Load the credentials file that ans-mcp or this site saved. The key signs a one-time challenge here and stays in this tab.
              </p>
              <div className="mt-8 max-w-[34rem]">
                <CredentialsLoader
                  onStep={(s) => setSteps((prev) => (s.kind === 'challenge' ? [s] : [...prev, s]))}
                  onReady={() => router.push(next ?? '/manage')}
                />
              </div>
              <p className="mt-10 max-w-[34rem] text-[14px] text-muted">
                No file?{' '}
                <Link className="link" href={next ? `/register?next=${encodeURIComponent(next)}` : '/register'}>
                  Register an agent
                </Link>
                . A lost key cannot be recovered: register a new agent, and the old record stays public.
              </p>
            </>
          )}
        </div>
        <aside className="flex min-w-0 justify-center lg:col-span-5 lg:block">
          <div className="w-full max-w-[360px] lg:ml-auto">
            <SignInSlip steps={steps} who={who} />
          </div>
        </aside>
      </div>
    </main>
  );
}
