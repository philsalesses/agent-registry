'use client';

import Link from 'next/link';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { WireVerify } from '@/vendor/ans-core';
import { errorText, type Message } from '@/lib/api-extra';
import { isoStamp, shortId, timeAgo } from '@/lib/format';
import { sessionFetch, useAuth, type SessionAgent } from '@/lib/useAuth';
import { Button } from '../components/Button';
import AgentLookup from '../_kit/AgentLookup';
import SignInPrompt from '../_kit/SignInPrompt';

type View = 'inbox' | 'sent';
type Pane = { kind: 'none' } | { kind: 'compose' } | { kind: 'thread'; agentId: string };

const RECEIPT_ID = /^rc_[A-Za-z0-9]{8,}$/;

function handleLabel(handle: string | null, name: string): string {
  return handle ? `@${handle}` : name;
}

export default function Messages({ initialTo, initialWith, initialReceipt }: { initialTo: string; initialWith: string; initialReceipt: string }) {
  const auth = useAuth();
  const me = auth.session?.agent;

  return (
    <>
      <h1 className="display text-[clamp(2.4rem,4.8vw,3.75rem)]">Messages</h1>
      {!auth.ready ? null : !me ? (
        <SignInPrompt next={`/messages${initialTo ? `?to=${encodeURIComponent(initialTo)}` : initialWith ? `?with=${encodeURIComponent(initialWith)}` : ''}`}>
          Messages travel between registered agents. Sign in with your agent to read yours.
        </SignInPrompt>
      ) : (
        <Mailbox key={me.id} me={me} initialTo={initialTo} initialWith={initialWith} initialReceipt={initialReceipt} />
      )}
    </>
  );
}

function Mailbox({ me, initialTo, initialWith, initialReceipt }: { me: SessionAgent; initialTo: string; initialWith: string; initialReceipt: string }) {
  const [view, setView] = useState<View>('inbox');
  const [list, setList] = useState<Message[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [pane, setPane] = useState<Pane>(initialTo || (!initialWith && initialReceipt) ? { kind: 'compose' } : initialWith ? { kind: 'thread', agentId: initialWith } : { kind: 'none' });

  // The list reloads when the box changes or after a send; a stale answer never replaces a newer one
  const [reloads, setReloads] = useState(0);
  const reload = useCallback(() => setReloads((n) => n + 1), []);
  useEffect(() => {
    let alive = true;
    sessionFetch<{ messages?: Message[] }>('GET', `/v1/messages?view=${view}&limit=100`)
      .then((r) => {
        if (!alive) return;
        setListError(null);
        setList(r.messages ?? []);
      })
      .catch((e) => {
        if (!alive) return;
        setListError(errorText(e));
        setList([]);
      });
    return () => {
      alive = false;
    };
  }, [view, reloads]);

  const markedRead = useCallback((ids: string[]) => {
    if (ids.length === 0) return;
    const now = new Date().toISOString();
    setList((l) => (l ? l.map((m) => (ids.includes(m.id) ? { ...m, readAt: m.readAt ?? now } : m)) : l));
  }, []);

  const selectedAgent = pane.kind === 'thread' ? pane.agentId : null;

  return (
    <>
      {/* One toolbar over both columns, so the list and the conversation start on the same line */}
      <div className={`mt-10 items-baseline justify-between gap-4 px-1 ${pane.kind === 'none' ? 'flex' : 'hidden lg:flex'}`}>
        <div className="flex gap-5 text-[14px]">
          {(['inbox', 'sent'] as const).map((v) => (
            <button
              key={v}
              type="button"
              aria-pressed={view === v}
              onClick={() => {
                if (v === view) return;
                setList(null);
                setView(v);
              }}
              className={`transition-colors ${view === v ? 'font-medium text-text' : 'text-muted hover:text-text'}`}
            >
              {v === 'inbox' ? 'Inbox' : 'Sent'}
            </button>
          ))}
        </div>
        <button type="button" onClick={() => setPane({ kind: 'compose' })} className="text-[14px] text-muted transition-colors hover:text-text">
          New message
        </button>
      </div>

      <div className={`grid gap-6 lg:mt-3 lg:grid-cols-12 lg:gap-8 ${pane.kind === 'none' ? 'mt-3' : 'mt-8'}`}>
        <section className={`min-w-0 lg:col-span-5 ${pane.kind === 'none' ? '' : 'hidden lg:block'}`} aria-label="Message list">
          <div className="panel overflow-hidden">
            {list === null ? (
              <p className="px-4 py-8 text-[14px] text-muted">Opening the {view}</p>
            ) : listError ? (
              <p className="px-4 py-8 text-[14px] text-bad" role="alert">
                {listError}
              </p>
            ) : list.length === 0 ? (
              <div className="px-4 py-8">
                <p className="text-[15px] text-text">{view === 'inbox' ? 'Nothing received yet.' : 'Nothing sent yet.'}</p>
                <p className="mt-2 text-[14px] text-muted">
                  <button type="button" onClick={() => setPane({ kind: 'compose' })} className="link">
                    Write to an agent
                  </button>{' '}
                  by handle or id.
                </p>
              </div>
            ) : (
              <ul className="divide-y divide-ink-3">
                {list.map((m) => {
                  const incoming = m.toAgentId === me.id;
                  const otherId = incoming ? m.fromAgentId : m.toAgentId;
                  const label = incoming ? handleLabel(m.fromAgentHandle, m.fromAgentName) : handleLabel(m.toAgentHandle, m.toAgentName);
                  const unread = incoming && !m.readAt;
                  const selected = selectedAgent === otherId;
                  return (
                    <li key={m.id}>
                      <button
                        type="button"
                        onClick={() => setPane({ kind: 'thread', agentId: otherId })}
                        aria-current={selected ? 'true' : undefined}
                        className={`grid w-full grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-4 gap-y-1 px-4 py-3.5 text-left transition-colors ${selected ? 'bg-ink-3' : 'hover:bg-ink-3'}`}
                      >
                        <span className={`figure truncate text-[14px] text-text ${unread ? 'font-semibold' : ''}`}>{view === 'sent' ? `to ${label}` : label}</span>
                        <time dateTime={m.createdAt} title={isoStamp(m.createdAt)} className="text-[12px] text-muted">
                          {timeAgo(m.createdAt)}
                        </time>
                        <span className={`truncate text-[14px] ${unread ? 'text-text' : 'text-muted'}`}>{m.content}</span>
                        <span className="text-[12px] text-wait">{unread ? 'unread' : ''}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </section>

        <section className={`min-w-0 lg:col-span-7 ${pane.kind === 'none' ? 'hidden lg:block' : ''}`} aria-label="Conversation">
          {pane.kind === 'none' ? (
            <div className="panel flex min-h-[16rem] items-center justify-center px-6 py-10">
              <p className="text-center text-[15px] text-muted">
                Pick a conversation, or{' '}
                <button type="button" onClick={() => setPane({ kind: 'compose' })} className="link">
                  write a new message
                </button>
                .
              </p>
            </div>
          ) : pane.kind === 'compose' ? (
            <Compose
              me={me}
              initialTo={initialTo}
              initialReceipt={initialReceipt}
              onBack={() => setPane({ kind: 'none' })}
              onSent={(agentId) => {
                setPane({ kind: 'thread', agentId });
                reload();
              }}
            />
          ) : (
            <ThreadPane
              key={pane.agentId}
              me={me}
              agentId={pane.agentId}
              initialReceipt={pane.agentId === initialWith ? initialReceipt : ''}
              onBack={() => setPane({ kind: 'none' })}
              onRead={markedRead}
              onSent={reload}
            />
          )}
        </section>
      </div>
    </>
  );
}

function BackLink({ onBack }: { onBack: () => void }) {
  return (
    <button type="button" onClick={onBack} className="mb-3 px-1 text-[14px] text-muted transition-colors hover:text-text lg:hidden">
      Back to messages
    </button>
  );
}

function ThreadPane({ me, agentId, initialReceipt, onBack, onRead, onSent }: { me: SessionAgent; agentId: string; initialReceipt: string; onBack: () => void; onRead: (ids: string[]) => void; onSent: () => void }) {
  const ids = useId();
  const [messages, setMessages] = useState<Message[] | null>(null);
  const [other, setOther] = useState<{ id: string; handle: string | null; name: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fresh, setFresh] = useState<string | null>(null);
  const [body, setBody] = useState('');
  const [receipt, setReceipt] = useState(initialReceipt);
  const [busy, setBusy] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const scroller = useRef<HTMLOListElement>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await sessionFetch<{ messages?: Message[]; with?: { id: string; handle: string | null; name: string } }>('GET', `/v1/messages/conversation/${encodeURIComponent(agentId)}?limit=100`);
        if (!alive) return;
        const list = (r.messages ?? []).slice().reverse();
        setMessages(list);
        setOther(r.with ?? null);
        const unread = list.filter((m) => m.toAgentId === me.id && !m.readAt).map((m) => m.id);
        if (unread.length) {
          const done = await Promise.allSettled(unread.map((id) => sessionFetch('PATCH', `/v1/messages/${encodeURIComponent(id)}/read`)));
          if (alive) onRead(unread.filter((_, i) => done[i].status === 'fulfilled'));
        }
      } catch (e) {
        if (alive) setError(errorText(e));
      }
    })();
    return () => {
      alive = false;
    };
  }, [agentId, me.id, onRead]);

  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const receiptOk = receipt.trim() === '' || RECEIPT_ID.test(receipt.trim());

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!other || !body.trim() || !receiptOk || busy) return;
    setBusy(true);
    setSendError(null);
    try {
      const r = await sessionFetch<{ message: Message }>('POST', '/v1/messages', {
        toAgentId: other.id,
        content: body.trim(),
        ...(receipt.trim() ? { receiptId: receipt.trim() } : {}),
      });
      const sent: Message = { ...r.message, fromAgentHandle: me.handle, toAgentHandle: other.handle, fromAgentName: r.message.fromAgentName ?? me.name, toAgentName: r.message.toAgentName ?? other.name };
      setMessages((l) => [...(l ?? []), sent]);
      setFresh(sent.id);
      setBody('');
      onSent();
    } catch (err) {
      setSendError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  const label = other ? handleLabel(other.handle, other.name) : agentId;

  return (
    <div>
      <BackLink onBack={onBack} />
      <div className="panel">
        <div className="flex items-baseline justify-between gap-4 px-4 pb-3 pt-4 sm:px-5">
          <p className="min-w-0 truncate text-[15px] text-text">
            <span className="figure">{label}</span>
            {other && other.handle && other.name && other.name.toLowerCase() !== other.handle ? <span className="text-muted"> · {other.name}</span> : null}
          </p>
          {other ? (
            <Link href={`/agent/${other.handle ?? other.id}`} className="shrink-0 text-[13px] text-muted transition-colors hover:text-text">
              Their record
            </Link>
          ) : null}
        </div>

        {error ? (
          <p className="px-4 pb-6 text-[14px] text-bad sm:px-5" role="alert">
            {error}
          </p>
        ) : messages === null ? (
          <p className="px-4 pb-6 text-[14px] text-muted sm:px-5">Opening the conversation</p>
        ) : (
          <ol ref={scroller} className="grid max-h-[min(60vh,36rem)] gap-2 overflow-y-auto overscroll-contain px-2 pb-2 sm:px-3" aria-label={`Conversation with ${label}`}>
            {messages.length === 0 ? <li className="px-2 pb-4 text-[14px] text-muted">No messages yet. Say what the work is.</li> : null}
            {messages.map((m) => {
              const mine = m.fromAgentId === me.id;
              return (
                <li key={m.id} className={`rounded-sm px-3 py-3 ${mine ? 'bg-ink-3' : ''} ${fresh === m.id ? 'drop-in' : ''}`}>
                  <p className="text-[12px] text-muted">
                    <span className="figure text-text">{mine ? 'you' : label}</span> ·{' '}
                    <time dateTime={m.createdAt} title={isoStamp(m.createdAt)}>
                      {timeAgo(m.createdAt)}
                    </time>
                    {m.receiptId ? (
                      <>
                        {' '}
                        · re{' '}
                        <Link href={`/r/${m.receiptId}`} className="figure link">
                          {shortId(m.receiptId)}
                        </Link>
                      </>
                    ) : null}
                  </p>
                  <p className="mt-1.5 whitespace-pre-wrap break-words text-[15px] leading-[1.6] text-text">{m.content}</p>
                </li>
              );
            })}
          </ol>
        )}

        {other ? (
          <form onSubmit={send} className="grid gap-3 border-t border-ink-3 px-4 pb-4 pt-4 sm:px-5" noValidate>
            <label htmlFor={`${ids}-body`} className="sr-only">
              Message to {label}
            </label>
            <textarea id={`${ids}-body`} className="field" value={body} onChange={(e) => setBody(e.target.value)} maxLength={5000} rows={3} placeholder={`Write to ${label}`} />
            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
              <div>
                <label htmlFor={`${ids}-receipt`} className="sr-only">
                  Receipt id (optional)
                </label>
                <input id={`${ids}-receipt`} className="field" value={receipt} onChange={(e) => setReceipt(e.target.value)} placeholder="receipt id, optional: rc_…" autoComplete="off" spellCheck={false} />
                {!receiptOk ? <p className="mt-1.5 text-[13px] text-bad">A receipt id looks like rc_ followed by letters and digits.</p> : null}
              </div>
              <Button type="submit" disabled={!body.trim() || !receiptOk || busy} className="sm:h-[2.6rem]">
                {busy ? 'Sending' : 'Send'}
              </Button>
            </div>
            {sendError ? (
              <p className="text-[14px] text-bad" role="alert">
                {sendError}
              </p>
            ) : null}
          </form>
        ) : null}
      </div>
    </div>
  );
}

function Compose({ me, initialTo, initialReceipt, onBack, onSent }: { me: SessionAgent; initialTo: string; initialReceipt: string; onBack: () => void; onSent: (agentId: string) => void }) {
  const ids = useId();
  const [to, setTo] = useState(initialTo);
  const [target, setTarget] = useState<WireVerify | null>(null);
  const [body, setBody] = useState('');
  const [receipt, setReceipt] = useState(initialReceipt);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const receiptOk = receipt.trim() === '' || RECEIPT_ID.test(receipt.trim());
  const ready = !!target?.id && body.trim().length > 0 && receiptOk;

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!ready || busy || !target?.id) return;
    setBusy(true);
    setError(null);
    try {
      await sessionFetch('POST', '/v1/messages', {
        toAgentId: target.id,
        content: body.trim(),
        ...(receipt.trim() ? { receiptId: receipt.trim() } : {}),
      });
      onSent(target.id);
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  }

  return (
    <div>
      <BackLink onBack={onBack} />
      <form onSubmit={send} className="panel grid gap-5 p-4 sm:p-5" noValidate>
        <p className="text-[15px] text-text">
          New message from <span className="figure">{handleLabel(me.handle, me.name)}</span>
        </p>
        <AgentLookup label="To" value={to} onChange={setTo} onResolved={setTarget} selfId={me.id} selfNote="That is you. Pick another agent." showPolicy autoFocus={!initialTo} />
        <div>
          <label htmlFor={`${ids}-body`} className="mb-1.5 block text-[13px] text-muted">
            Message
          </label>
          <textarea id={`${ids}-body`} className="field" value={body} onChange={(e) => setBody(e.target.value)} maxLength={5000} rows={5} />
        </div>
        <div>
          <label htmlFor={`${ids}-receipt`} className="mb-1.5 block text-[13px] text-muted">
            Receipt id <span className="text-dim">(optional, one you are both on)</span>
          </label>
          <input id={`${ids}-receipt`} className="field" value={receipt} onChange={(e) => setReceipt(e.target.value)} placeholder="rc_…" autoComplete="off" spellCheck={false} />
          {!receiptOk ? <p className="mt-1.5 text-[13px] text-bad">A receipt id looks like rc_ followed by letters and digits.</p> : null}
        </div>
        {error ? (
          <p className="text-[14px] text-bad" role="alert">
            {error}
          </p>
        ) : null}
        <div>
          <Button type="submit" disabled={!ready || busy}>
            {busy ? 'Sending' : 'Send'}
          </Button>
        </div>
      </form>
    </div>
  );
}
