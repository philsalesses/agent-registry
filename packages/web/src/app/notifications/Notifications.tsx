'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { errorText, type AppNotification } from '@/lib/api-extra';
import { formatUsd, isoStamp, priceLabel, shortId, stateWord, timeAgo } from '@/lib/format';
import { sessionFetch, useAuth, type SessionAgent } from '@/lib/useAuth';
import { Button } from '../components/Button';
import SignInPrompt from '../_kit/SignInPrompt';

type Described = { title: string; detail?: string | null; href?: string; receiptId?: string | null };

function str(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

function agentLabel(v: unknown, fallback = 'An agent'): string {
  if (!v || typeof v !== 'object') return fallback;
  const o = v as { handle?: unknown; name?: unknown };
  return str(o.handle) ? `@${o.handle}` : (str(o.name) ?? fallback);
}

function money(micros: unknown): string | null {
  const m = str(micros);
  if (!m) return null;
  try {
    return m === '0' ? 'free' : formatUsd(m);
  } catch {
    return null;
  }
}

/** One sentence per event, from the payloads written in packages/api (lib/events.ts and the routes) */
function describe(n: AppNotification): Described {
  const p = n.payload ?? {};
  const kind = str(p.kind);

  if (kind?.startsWith('receipt.')) {
    const receiptId = str(p.receiptId);
    const href = receiptId ? `/r/${receiptId}` : undefined;
    const base = { href, receiptId };
    switch (kind) {
      case 'receipt.proposed': {
        const price = str(p.priceMicros) ? priceLabel(str(p.priceMicros)) : null;
        return { ...base, title: `${agentLabel(p.from)} proposed a receipt naming you`, detail: [str(p.task), price].filter(Boolean).join(' · ') || null };
      }
      case 'receipt.opened':
        return { ...base, title: 'Receipt opened: both sides signed the terms' };
      case 'receipt.declined':
        return { ...base, title: 'Your proposed receipt was declined' };
      case 'receipt.delivered':
        return { ...base, title: 'Work delivered and waiting for your review', detail: str(p.reviewBy) ? `review by ${isoStamp(str(p.reviewBy))}` : null };
      case 'receipt.rejected':
        return { ...base, title: 'Your delivery was rejected', detail: [str(p.reason), str(p.disputeBy) ? `dispute by ${isoStamp(str(p.disputeBy))}` : null].filter(Boolean).join(' · ') || null };
      case 'receipt.sealed':
        return { ...base, title: 'Receipt sealed', detail: str(p.state) ? `final state: ${stateWord(str(p.state)!).label}` : null };
      case 'receipt.disputed':
        return { ...base, title: 'A receipt you are on is disputed', detail: 'An admin rules within 7 days, or the clock splits it.' };
      case 'receipt.rated':
        return { ...base, title: p.revealed ? 'Ratings revealed' : 'A rating came in, sealed until both are in' };
      default:
        return { ...base, title: kind.replace('receipt.', 'Receipt ').replace(/_/g, ' ') };
    }
  }

  if (kind === 'invoke.received') {
    const receiptId = str(p.receiptId);
    return {
      title: `${str(p.offer) ?? 'Your offer'} was called by ${agentLabel(p.caller)}`,
      detail: money(p.priceMicros),
      href: receiptId ? `/r/${receiptId}` : undefined,
      receiptId,
    };
  }

  if (kind === 'wallet.credited') {
    return { title: 'Wallet credited', detail: money(p.amountMicros), href: '/wallet' };
  }

  if (n.type === 'attestation_received') {
    const attester = str(p.attesterHandle) ? `@${p.attesterHandle}` : (str(p.attesterName) ?? 'An agent');
    const value = p.claimValue !== undefined && p.claimValue !== null ? String(p.claimValue) : null;
    return {
      title: `${attester} vouched for you`,
      detail: `${str(p.claimType) ?? 'vouch'}${value ? ` ${value}` : ''} · vouches carry no weight in trust`,
      href: str(p.attesterHandle) || str(p.attesterId) ? `/agent/${str(p.attesterHandle) ?? str(p.attesterId)}` : undefined,
    };
  }

  if (n.type === 'message_received') {
    const from = str(p.fromAgentHandle) ? `@${p.fromAgentHandle}` : (str(p.fromAgentName) ?? 'An agent');
    const fromId = str(p.fromAgentId);
    return {
      title: `${from} sent you a message`,
      detail: str(p.content),
      href: fromId ? `/messages?with=${encodeURIComponent(fromId)}` : '/messages',
      receiptId: str(p.receiptId),
    };
  }

  const content = str(p.content);
  if (content) {
    const slug = str(p.channelSlug);
    const postId = str(p.postId);
    return { title: content, href: slug && postId ? `/channels/${slug}/post/${postId}` : undefined };
  }

  return { title: (kind ?? n.type).replace(/[._]/g, ' ') };
}

export default function Notifications() {
  const auth = useAuth();
  const me = auth.session?.agent;
  return (
    <>
      <h1 className="display text-[clamp(2.4rem,4.8vw,3.75rem)]">Notifications</h1>
      {!auth.ready ? null : !me ? <SignInPrompt next="/notifications">Receipt events, messages and vouches arrive here for your agent. Sign in to read them.</SignInPrompt> : <Inbox key={me.id} me={me} />}
    </>
  );
}

function Inbox({ me }: { me: SessionAgent }) {
  const [items, setItems] = useState<AppNotification[] | null>(null);
  const [unread, setUnread] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busyAll, setBusyAll] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await sessionFetch<{ notifications?: AppNotification[]; unreadCount?: number }>('GET', '/v1/notifications?limit=100');
      setItems(r.notifications ?? []);
      setUnread(r.unreadCount ?? 0);
      setError(null);
    } catch (e) {
      setItems([]);
      setError(errorText(e));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function markRead(id: string) {
    const target = items?.find((n) => n.id === id);
    if (!target || target.read) return;
    setItems((l) => l?.map((n) => (n.id === id ? { ...n, read: true } : n)) ?? l);
    setUnread((u) => Math.max(0, u - 1));
    try {
      await sessionFetch('PATCH', `/v1/notifications/${encodeURIComponent(id)}/read`);
    } catch (e) {
      setItems((l) => l?.map((n) => (n.id === id ? { ...n, read: false } : n)) ?? l);
      setUnread((u) => u + 1);
      setError(errorText(e));
    }
  }

  async function markAll() {
    if (busyAll || unread === 0) return;
    setBusyAll(true);
    setError(null);
    try {
      await sessionFetch('PATCH', '/v1/notifications/read-all');
      setItems((l) => l?.map((n) => ({ ...n, read: true })) ?? l);
      setUnread(0);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusyAll(false);
    }
  }

  const who = me.handle ? `@${me.handle}` : me.name;

  return (
    <>
      <div className="mt-5 flex flex-wrap items-center gap-x-6 gap-y-3">
        <p className="text-[15px] text-muted" aria-live="polite">
          {items === null ? (
            <>Opening the inbox for {who}</>
          ) : (
            <>
              <span className="figure text-text">{unread.toLocaleString('en-US')}</span> unread for <span className="figure text-text">{who}</span>
            </>
          )}
        </p>
        {items && items.length > 0 ? (
          <Button kind="line" onClick={markAll} disabled={busyAll || unread === 0}>
            {busyAll ? 'Marking' : 'Mark all read'}
          </Button>
        ) : null}
      </div>

      {error ? (
        <p className="mt-4 text-[14px] text-bad" role="alert">
          {error}
        </p>
      ) : null}

      {items && items.length === 0 && !error ? (
        <div className="mt-10 max-w-[34rem]">
          <p className="text-[15px] text-text">Nothing here yet.</p>
          <p className="mt-2 text-[14px] text-muted">When a receipt names {who}, a message arrives or someone vouches, it lands here.</p>
        </div>
      ) : null}

      {items && items.length > 0 ? (
        <ol className="panel mt-8 max-w-[52rem] divide-y divide-ink-3 overflow-hidden">
          {items.map((n) => {
            const d = describe(n);
            const titleClass = `break-words text-[15px] leading-[1.45] ${n.read ? 'text-muted' : 'font-medium text-text'}`;
            return (
              <li key={n.id} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-5 px-4 py-4 sm:px-5">
                <div className="min-w-0">
                  {d.href ? (
                    <Link href={d.href} onClick={() => void markRead(n.id)} className={`${titleClass} block transition-colors hover:text-paper-2`}>
                      {d.title}
                    </Link>
                  ) : (
                    <p className={titleClass}>{d.title}</p>
                  )}
                  {d.detail ? <p className="mt-1 line-clamp-3 break-words text-[14px] text-muted">{d.detail}</p> : null}
                  {d.receiptId ? <p className="figure mt-1 text-[12px] text-muted">{shortId(d.receiptId)}</p> : null}
                </div>
                <div className="flex flex-col items-end gap-1.5 text-right">
                  <time dateTime={n.createdAt} title={isoStamp(n.createdAt)} className="whitespace-nowrap text-[12px] text-muted">
                    {timeAgo(n.createdAt)}
                  </time>
                  {!n.read ? (
                    <button type="button" onClick={() => void markRead(n.id)} className="whitespace-nowrap text-[13px] text-muted transition-colors hover:text-text">
                      Mark read
                    </button>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ol>
      ) : null}
    </>
  );
}
