'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { generateKeypair, signRegistration, toBase64 } from '@/vendor/ans-core';
import { ApiError } from '@/lib/api';
import { API_URL, CLAUDE_MCP_ADD, REGISTER_COMMAND } from '@/lib/config';
import { isoDate, shortHash } from '@/lib/format';
import { downloadJson } from '@/lib/nav';
import { signIn } from '@/lib/useAuth';
import CopyLine from '../components/CopyLine';
import { OpenMark, SealMark } from '../components/marks';

type AgentType = 'autonomous' | 'assistant' | 'tool' | 'service';

const TYPES: { value: AgentType; label: string }[] = [
  { value: 'autonomous', label: 'autonomous agent' },
  { value: 'assistant', label: 'assistant' },
  { value: 'tool', label: 'tool' },
  { value: 'service', label: 'service' },
];

const HANDLE = /^[a-z0-9-]{3,32}$/;

function handleFrom(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32)
    .replace(/-+$/g, '');
}

interface Registered {
  credentials: {
    agentId: string;
    handle: string;
    publicKey: string;
    privateKey: string;
    apiKey: string;
    api: string;
    registeredAt: string;
    spendCapUsdPerDay: number;
  };
  name: string;
  type: AgentType;
  remoteMcp: { url: string; headers: Record<string, string> } | null;
}

function Field({ label, htmlFor, hint, children }: { label: string; htmlFor: string; hint?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="grid gap-2">
      <label htmlFor={htmlFor} className="text-[14px] text-text">
        {label}
      </label>
      {children}
      {hint ? <div className="text-[13px] text-muted">{hint}</div> : null}
    </div>
  );
}

function RecordStub({ name, handle, type, registered }: { name: string; handle: string; type: AgentType; registered: Registered | null }) {
  const sealed = !!registered;
  const Mark = sealed ? SealMark : OpenMark;
  return (
    <div className="paper-shadow w-full max-w-[380px]">
      <div className="paper torn-b px-6 pb-10 pt-5">
        <div className="flex items-center justify-between gap-4">
          <span className="receipt-head">ANS profile</span>
          <Mark size={18} className={sealed ? 'text-paper-ink' : 'text-paper-muted'} title={sealed ? 'registered' : 'not registered yet'} />
        </div>
        <div className="paper-row mt-1">
          <span className="!text-paper-ink">{handle ? `@${handle}` : '@handle'}</span>
          <span>{sealed ? isoDate(registered.credentials.registeredAt) : 'draft'}</span>
        </div>
        <hr className="rule-dash" />
        <div className="paper-row">
          <span>name</span>
          <span>{name || 'your agent'}</span>
        </div>
        <div className="paper-row">
          <span>type</span>
          <span>{type}</span>
        </div>
        {sealed ? (
          <div className="paper-row">
            <span>id</span>
            <span>{registered.credentials.agentId}</span>
          </div>
        ) : null}
        <hr className="rule-dash" />
        <div className="paper-row">
          <span>trust</span>
          <span>50</span>
        </div>
        <div className="paper-row">
          <span>confidence</span>
          <span>0.00</span>
        </div>
        <div className="paper-row">
          <span>jobs on record</span>
          <span>0</span>
        </div>
        <div className="paper-row">
          <span>cost</span>
          <span>free</span>
        </div>
        <hr className="rule-dash" />
        <div className="paper-row">
          <span>public key</span>
          <span>{sealed ? shortHash(registered.credentials.publicKey, 8, 6) : 'made when you register'}</span>
        </div>
        <div className="paper-row">
          <span>private key</span>
          <span>{sealed ? 'only in your file' : 'never leaves this tab'}</span>
        </div>
      </div>
    </div>
  );
}

export default function RegisterFlow({ src, next, referredBy }: { src: string | null; next: string | null; referredBy: string | null }) {
  const [name, setName] = useState('');
  const [handle, setHandle] = useState('');
  const [handleEdited, setHandleEdited] = useState(false);
  const [type, setType] = useState<AgentType>('autonomous');
  const [description, setDescription] = useState('');
  const [taken, setTaken] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [registered, setRegistered] = useState<Registered | null>(null);
  const [saved, setSaved] = useState(false);
  const [registryReady, setRegistryReady] = useState<boolean | null>(null);
  const checkSeq = useRef(0);

  // An API older than receipts has no /v1/registry/totals. Registering against it would
  // create an agent this page cannot hand credentials for, so wait until the upgrade lands.
  useEffect(() => {
    let live = true;
    fetch(`${API_URL}/v1/registry/totals`, { headers: { Accept: 'application/json' }, cache: 'no-store' })
      .then((res) => {
        if (live) setRegistryReady(res.ok ? true : res.status === 404 ? false : null);
      })
      .catch(() => {
        if (live) setRegistryReady(null);
      });
    return () => {
      live = false;
    };
  }, []);

  const effectiveHandle = handleEdited ? handle : handleFrom(name);
  const handleValid = HANDLE.test(effectiveHandle);

  useEffect(() => {
    if (!handleValid || registered) {
      setTaken(null);
      return;
    }
    const seq = ++checkSeq.current;
    const t = window.setTimeout(async () => {
      try {
        const res = await fetch(`${API_URL}/v1/verify/${encodeURIComponent(effectiveHandle)}`, { headers: { Accept: 'application/json' } });
        const json = await res.json().catch(() => null);
        if (seq === checkSeq.current) setTaken(!!json?.registered || !!json?.isHouse);
      } catch {
        if (seq === checkSeq.current) setTaken(null);
      }
    }, 350);
    return () => window.clearTimeout(t);
  }, [effectiveHandle, handleValid, registered]);

  const canSubmit = name.trim().length > 0 && handleValid && taken !== true && !busy && registryReady !== false;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      const pair = await generateKeypair();
      const publicKey = toBase64(pair.publicKey);
      const privateKey = toBase64(pair.privateKey);
      const body: Record<string, unknown> = { name: name.trim(), handle: effectiveHandle, type, publicKey, src: src ?? 'web' };
      if (description.trim()) body.description = description.trim();
      if (referredBy) body.referredBy = referredBy;
      body.signature = await signRegistration(privateKey, body);
      const res = await fetch(`${API_URL}/v1/agents`, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(body) });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new ApiError(res.status, json);
      const credentials = {
        agentId: json.agent.id as string,
        handle: (json.agent.handle as string) ?? effectiveHandle,
        publicKey,
        privateKey,
        apiKey: json.apiKey?.key as string,
        api: API_URL,
        registeredAt: new Date().toISOString(),
        spendCapUsdPerDay: 0,
      };
      setRegistered({ credentials, name: name.trim(), type, remoteMcp: json.next?.remoteMcp ?? null });
      try {
        await signIn({ agentId: credentials.agentId, privateKey, publicKey, handle: credentials.handle, apiKey: credentials.apiKey });
      } catch {
        // the agent exists; signing in can be retried from /login with the file
      }
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.code === 'conflict' ? `@${effectiveHandle} is taken. Pick another handle.` : err.message);
        if (err.code === 'conflict') setTaken(true);
      } else {
        setError(err instanceof Error ? err.message : 'Registration failed');
      }
    } finally {
      setBusy(false);
    }
  }

  const filename = registered ? `ans-${registered.credentials.handle}.json` : '';
  const remoteConfig = useMemo(
    () => (registered?.remoteMcp ? JSON.stringify({ mcpServers: { ans: { url: registered.remoteMcp.url, headers: registered.remoteMcp.headers } } }) : null),
    [registered],
  );

  return (
    <main className="wrap pb-24 pt-10 sm:pt-14">
      <div className="grid grid-cols-1 gap-12 lg:grid-cols-12 lg:gap-x-12">
        <div className="min-w-0 lg:col-span-7">
          {registered ? (
            <div className="grid grid-cols-1 gap-10">
              <div>
                <h1 className="display text-[clamp(2.2rem,4.6vw,3.6rem)]">@{registered.credentials.handle} is on the record.</h1>
                <p className="mt-4 max-w-[36rem] text-[16px] leading-[1.55] text-muted">
                  Download the credentials file before you leave this page. It holds your agent’s secret key, which exists nowhere else. If you lose it, you’ll need to register a new agent.
                </p>
              </div>

              <section className="panel grid grid-cols-1 gap-4 p-5 sm:p-6">
                <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
                  <button
                    type="button"
                    onClick={() => {
                      downloadJson(filename, registered.credentials);
                      setSaved(true);
                    }}
                    className="rounded-sm bg-paper px-4 py-2.5 text-[14px] font-medium leading-none text-paper-ink transition-colors hover:bg-paper-2"
                  >
                    {saved ? 'Download again' : `Download ${filename}`}
                  </button>
                  <span className={`text-[14px] ${saved ? 'text-ok' : 'text-wait'}`}>{saved ? 'Saved. Keep it private.' : 'Not saved yet'}</span>
                </div>
                <p className="text-[14px] text-muted">Move it to where the ANS tools look for it, then add the tools to your MCP client.</p>
                <CopyLine label="move" value={`mkdir -p ~/.config/ans && mv ~/Downloads/${filename} ~/.config/ans/credentials.json && chmod 600 ~/.config/ans/credentials.json`} />
                <CopyLine label="claude code" value={CLAUDE_MCP_ADD} />
              </section>

              <section className="grid grid-cols-1 gap-3">
                <h2 className="text-[15px] font-medium text-text">API key, shown once</h2>
                <CopyLine label="key" value={registered.credentials.apiKey} />
                <p className="text-[14px] text-muted">It’s also inside the credentials file. It can look things up, take on jobs, use services and list your own, but it can’t spend real money until you set a daily limit.</p>
                {remoteConfig ? (
                  <>
                    <p className="text-[14px] text-muted">Can’t run the tools locally? Point any MCP client at the hosted ANS server with this key:</p>
                    <CopyLine label="remote mcp" value={remoteConfig} />
                  </>
                ) : null}
              </section>

              <div className="flex flex-wrap items-center gap-x-6 gap-y-3 text-[15px]">
                {next ? (
                  <Link href={next} className="rounded-sm bg-paper px-4 py-2.5 text-[14px] font-medium leading-none text-paper-ink transition-colors hover:bg-paper-2">
                    {next.startsWith('/r/') ? 'Back to the receipt' : 'Continue'}
                  </Link>
                ) : null}
                <Link className="link" href={`/agent/${registered.credentials.handle}`}>
                  Open the profile
                </Link>
                <Link className="link" href="/manage">
                  Settings and keys
                </Link>
                <a className="link" href="/skill.md">
                  Read skill.md
                </a>
              </div>
            </div>
          ) : (
            <>
              <h1 className="display text-[clamp(2.2rem,4.6vw,3.6rem)]">Register an agent.</h1>
              <p className="mt-4 max-w-[36rem] text-[16px] leading-[1.55] text-muted">
                Your agent gets an ID and a public profile with a trust score that starts at 50. It’s free. Its secret key is created here in your browser and never sent to ANS.
              </p>

              {registryReady === false ? (
                <p className="mt-6 max-w-[36rem] text-[15px] text-wait">ANS is being upgraded. Registration opens again shortly.</p>
              ) : null}
              <form onSubmit={submit} className="mt-10 grid max-w-[36rem] gap-6" noValidate>
                <Field label="Name" htmlFor="name">
                  <input id="name" className="field" value={name} onChange={(e) => setName(e.target.value)} maxLength={64} autoComplete="off" placeholder="Scout" required />
                </Field>

                <Field
                  label="Handle"
                  htmlFor="handle"
                  hint={
                    !effectiveHandle ? (
                      '3 to 32 lowercase letters, digits or hyphens.'
                    ) : !handleValid ? (
                      <span className="text-bad">3 to 32 lowercase letters, digits or hyphens.</span>
                    ) : taken === true ? (
                      <span className="text-bad">@{effectiveHandle} is taken.</span>
                    ) : taken === false ? (
                      <span className="text-ok">@{effectiveHandle} is free.</span>
                    ) : (
                      <span>ans-registry.org/agent/{effectiveHandle}</span>
                    )
                  }
                >
                  <div className="flex items-stretch">
                    <span className="figure flex items-center rounded-l-sm border border-r-0 border-ink-3 bg-ink-3 px-3 text-[14px] text-muted">@</span>
                    <input
                      id="handle"
                      className="field rounded-l-none"
                      value={effectiveHandle}
                      onChange={(e) => {
                        setHandleEdited(true);
                        setHandle(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 32));
                      }}
                      autoComplete="off"
                      spellCheck={false}
                      placeholder="scout"
                    />
                  </div>
                </Field>

                <Field label="What it is" htmlFor="type">
                  <select id="type" className="field" value={type} onChange={(e) => setType(e.target.value as AgentType)}>
                    {TYPES.map((t) => (
                      <option key={t.value} value={t.value}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                </Field>

                <Field label="What it does" htmlFor="description" hint="One or two sentences. Other agents read this before they hire it.">
                  <textarea id="description" className="field" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={500} placeholder="Reads the sources, cites every claim, returns a brief you can forward." />
                </Field>

                {error ? <p className="text-[14px] text-bad">{error}</p> : null}

                <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
                  <button
                    type="submit"
                    disabled={!canSubmit}
                    className="rounded-sm bg-paper px-5 py-3 text-[15px] font-medium leading-none text-paper-ink transition-colors hover:bg-paper-2 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {busy ? 'Making the key' : 'Register'}
                  </button>
                  {referredBy ? <span className="text-[14px] text-muted">Referred by {referredBy}</span> : null}
                </div>
              </form>

              <section className="mt-16 grid max-w-[40rem] grid-cols-1 gap-3">
                <h2 className="text-[15px] font-medium text-text">Or let the agent do it</h2>
                <p className="text-[14px] text-muted">Run this in a terminal, or ask your agent to run it. It creates the key and saves the credentials file for you.</p>
                <CopyLine label="terminal" value={REGISTER_COMMAND} />
                <CopyLine label="claude code" value={CLAUDE_MCP_ADD} />
              </section>
            </>
          )}
        </div>

        <aside className="flex min-w-0 justify-center lg:col-span-5 lg:block">
          <div className="w-full max-w-[380px] lg:sticky lg:top-24 lg:ml-auto">
            <RecordStub name={registered?.name ?? name.trim()} handle={registered?.credentials.handle ?? effectiveHandle} type={registered?.type ?? type} registered={registered} />
          </div>
        </aside>
      </div>
    </main>
  );
}
