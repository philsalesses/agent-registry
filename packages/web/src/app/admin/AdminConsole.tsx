'use client';

import Link from 'next/link';
import { useCallback, useEffect, useId, useState } from 'react';
import type { WireReceipt } from '@/vendor/ans-core';
import { ApiError } from '@/lib/api';
import { ADMIN_SECRET_KEY, adminFetch, errorText, type AdminFlag, type AdminOverview, type AdminPayout, type ClockTick, type FunnelReport } from '@/lib/api-extra';
import { formatUsd, isoDate, isoTime, partyLabel, stateWord, timeAgo } from '@/lib/format';
import { Button } from '../components/Button';
import Receipt from '../components/Receipt';

/*
 * Admin console. The secret is typed once, kept in sessionStorage for this tab only
 * (never localStorage) and sent as X-Admin-Secret on every call.
 */

type Phase = 'checking' | 'locked' | 'open';
type Ruling = 'client' | 'provider' | 'split';

function readSecret(): string | null {
  try {
    return window.sessionStorage.getItem(ADMIN_SECRET_KEY);
  } catch {
    return null;
  }
}

function writeSecret(value: string | null) {
  try {
    if (value) window.sessionStorage.setItem(ADMIN_SECRET_KEY, value);
    else window.sessionStorage.removeItem(ADMIN_SECRET_KEY);
  } catch {
    // storage blocked: the console stays unlocked for this page view only
  }
}

function refused(e: unknown): boolean {
  return e instanceof ApiError && (e.status === 403 || e.status === 401);
}

function gateMessage(e: unknown): string {
  if (e instanceof ApiError && e.status === 403) return 'That secret was refused.';
  if (e instanceof ApiError && e.status === 503) return 'Admin routes are off: ADMIN_SECRET is not set on the API.';
  return errorText(e);
}

export default function AdminConsole() {
  const ids = useId();
  const [phase, setPhase] = useState<Phase>('checking');
  const [secret, setSecret] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [gateBusy, setGateBusy] = useState(false);
  const [gateError, setGateError] = useState<string | null>(null);

  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [disputes, setDisputes] = useState<WireReceipt[] | null>(null);
  const [payouts, setPayouts] = useState<AdminPayout[] | null>(null);
  const [flags, setFlags] = useState<AdminFlag[] | null>(null);
  const [funnel, setFunnel] = useState<FunnelReport | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [lastRuling, setLastRuling] = useState<string | null>(null);

  const lock = useCallback((message: string | null = null) => {
    writeSecret(null);
    setSecret(null);
    setOverview(null);
    setDisputes(null);
    setPayouts(null);
    setFlags(null);
    setFunnel(null);
    setLastRuling(null);
    setGateError(message);
    setPhase('locked');
  }, []);

  const loadAll = useCallback(
    async (key: string) => {
      setLoadError(null);
      const [o, d, pp, pa, f, fu] = await Promise.allSettled([
        adminFetch<AdminOverview>(key, 'GET', '/v1/admin/overview'),
        adminFetch<{ receipts?: WireReceipt[] }>(key, 'GET', '/v1/admin/receipts?state=disputed'),
        adminFetch<{ payouts?: AdminPayout[] }>(key, 'GET', '/v1/admin/payouts?status=pending'),
        adminFetch<{ payouts?: AdminPayout[] }>(key, 'GET', '/v1/admin/payouts?status=approved'),
        adminFetch<{ flags?: AdminFlag[] }>(key, 'GET', '/v1/admin/flags'),
        adminFetch<FunnelReport>(key, 'GET', '/v1/admin/funnel?days=30'),
      ]);
      const failures = [o, d, pp, pa, f, fu].filter((r): r is PromiseRejectedResult => r.status === 'rejected');
      if (failures.some((r) => refused(r.reason))) {
        lock('The stored secret was refused. Enter it again.');
        return;
      }
      if (o.status === 'fulfilled') setOverview(o.value);
      if (d.status === 'fulfilled') setDisputes(d.value.receipts ?? []);
      if (pp.status === 'fulfilled' && pa.status === 'fulfilled') {
        // oldest first: the queue is worked in the order agents asked
        setPayouts([...(pp.value.payouts ?? []), ...(pa.value.payouts ?? [])].sort((a, b) => a.createdAt.localeCompare(b.createdAt)));
      }
      if (f.status === 'fulfilled') setFlags(f.value.flags ?? []);
      if (fu.status === 'fulfilled') setFunnel(fu.value);
      if (failures.length) setLoadError(errorText(failures[0].reason));
    },
    [lock],
  );

  useEffect(() => {
    const stored = readSecret();
    if (!stored) {
      setPhase('locked');
      return;
    }
    setSecret(stored);
    setPhase('open');
    void loadAll(stored);
  }, [loadAll]);

  async function unlock(e: React.FormEvent) {
    e.preventDefault();
    const key = input.trim();
    if (!key || gateBusy) return;
    setGateBusy(true);
    setGateError(null);
    try {
      await adminFetch<AdminOverview>(key, 'GET', '/v1/admin/overview');
      writeSecret(key);
      setSecret(key);
      setInput('');
      setPhase('open');
      void loadAll(key);
    } catch (err) {
      setGateError(gateMessage(err));
    } finally {
      setGateBusy(false);
    }
  }

  if (phase === 'checking') {
    return <h1 className="display text-[clamp(2.4rem,4.8vw,3.75rem)]">Admin</h1>;
  }

  if (phase === 'locked' || !secret) {
    return (
      <div className="max-w-[34rem]">
        <h1 className="display text-[clamp(2.4rem,4.8vw,3.75rem)]">Admin</h1>
        <p className="mt-5 text-[16px] leading-[1.6] text-muted">Enter the admin secret. It stays in this tab until you lock the console or close the tab.</p>
        <form onSubmit={unlock} className="mt-8 grid gap-4" noValidate>
          <div>
            <label htmlFor={`${ids}-secret`} className="mb-1.5 block text-[13px] text-muted">
              Admin secret
            </label>
            <input id={`${ids}-secret`} className="field" type="password" autoComplete="off" value={input} onChange={(e) => setInput(e.target.value)} />
          </div>
          {gateError ? (
            <p className="text-[14px] text-bad" role="alert">
              {gateError}
            </p>
          ) : null}
          <div>
            <Button type="submit" disabled={!input.trim() || gateBusy}>
              {gateBusy ? 'Checking' : 'Unlock'}
            </Button>
          </div>
        </form>
      </div>
    );
  }

  const disputedCount = disputes?.length ?? Number(overview?.counts.disputed ?? 0);
  const payoutCount = payouts?.length ?? Number(overview?.counts.payouts_open ?? 0);
  const waiting = [disputedCount ? `${disputedCount} ${disputedCount === 1 ? 'dispute' : 'disputes'}` : '', payoutCount ? `${payoutCount} ${payoutCount === 1 ? 'payout' : 'payouts'}` : ''].filter(Boolean);
  const headline = disputes === null && !overview ? 'Admin' : waiting.length === 0 ? 'Nothing waiting' : `${waiting.join(', ')} waiting`;

  return (
    <div>
      <div className="grid gap-6 lg:grid-cols-12 lg:items-end">
        <h1 className="display text-[clamp(2.4rem,4.8vw,3.75rem)] lg:col-span-8">{headline}</h1>
        <div className="flex flex-wrap gap-x-6 gap-y-2 text-[14px] lg:col-span-4 lg:justify-end">
          <button type="button" onClick={() => void loadAll(secret)} className="text-muted transition-colors hover:text-text">
            Refresh
          </button>
          <button type="button" onClick={() => lock()} className="text-muted transition-colors hover:text-text">
            Lock the console
          </button>
        </div>
      </div>

      {loadError ? (
        <p className="mt-4 text-[14px] text-bad" role="alert">
          {loadError}
        </p>
      ) : null}

      <Overview overview={overview} />

      <section className="mt-16" aria-labelledby={`${ids}-disputes`}>
        <h2 id={`${ids}-disputes`} className="display text-[clamp(1.6rem,2.6vw,2.1rem)]">
          Rule on what the parties could not settle.
        </h2>
        {lastRuling ? (
          <p className="mt-3 text-[14px] text-ok" aria-live="polite">
            {lastRuling}
          </p>
        ) : null}
        {disputes === null ? (
          <p className="mt-4 text-[14px] text-muted">Loading disputed receipts</p>
        ) : disputes.length === 0 ? (
          <p className="mt-4 text-[15px] text-muted">Nothing is disputed right now.</p>
        ) : (
          <ol className="mt-6 grid grid-cols-[minmax(0,1fr)] gap-5">
            {disputes.map((r) => (
              <DisputeItem
                key={r.id}
                receipt={r}
                secret={secret}
                onRefused={() => lock('The secret was refused. Enter it again.')}
                onRuled={(ruled) => {
                  setDisputes((list) => list?.filter((x) => x.id !== ruled.id) ?? list);
                  setLastRuling(`${ruled.id} ruled: ${stateWord(ruled.state).label}.`);
                  adminFetch<AdminOverview>(secret, 'GET', '/v1/admin/overview')
                    .then(setOverview)
                    .catch(() => undefined);
                }}
              />
            ))}
          </ol>
        )}
      </section>

      <section className="mt-16" aria-labelledby={`${ids}-payouts`}>
        <h2 id={`${ids}-payouts`} className="display text-[clamp(1.6rem,2.6vw,2.1rem)]">
          Pay out by hand, then mark it paid.
        </h2>
        {payouts === null ? (
          <p className="mt-4 text-[14px] text-muted">Loading payout requests</p>
        ) : payouts.length === 0 ? (
          <p className="mt-4 text-[15px] text-muted">No payout requests are waiting.</p>
        ) : (
          <ol className="mt-6 grid grid-cols-[minmax(0,1fr)] gap-5">
            {payouts.map((p) => (
              <PayoutItem
                key={p.id}
                payout={p}
                secret={secret}
                onRefused={() => lock('The secret was refused. Enter it again.')}
                onDone={(next) => {
                  setPayouts((list) => (list ? (next.status === 'pending' || next.status === 'approved' ? list.map((x) => (x.id === next.id ? next : x)) : list.filter((x) => x.id !== next.id)) : list));
                  adminFetch<AdminOverview>(secret, 'GET', '/v1/admin/overview')
                    .then(setOverview)
                    .catch(() => undefined);
                }}
              />
            ))}
          </ol>
        )}
      </section>

      <div className="mt-16 grid gap-14 lg:grid-cols-12 lg:gap-12">
        <Flags flags={flags} secret={secret} onRefused={() => lock('The secret was refused. Enter it again.')} onChange={setFlags} />
        <Clock secret={secret} onRefused={() => lock('The secret was refused. Enter it again.')} onTicked={() => void loadAll(secret)} />
      </div>

      <Funnel funnel={funnel} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------

const OVERVIEW_ROWS: { key: string; label: string; usd?: boolean }[] = [
  { key: 'agents', label: 'agents' },
  { key: 'agents_24h', label: 'new in 24h' },
  { key: 'offers', label: 'offers live' },
  { key: 'receipts', label: 'receipts' },
  { key: 'sealed', label: 'sealed' },
  { key: 'in_progress', label: 'in progress' },
  { key: 'disputed', label: 'disputed' },
  { key: 'payouts_open', label: 'payouts open' },
  { key: 'fee_revenue', label: 'fee revenue', usd: true },
];

function Overview({ overview }: { overview: AdminOverview | null }) {
  return (
    <dl className="panel mt-10 grid gap-x-12 px-5 py-3 sm:grid-cols-2 lg:grid-cols-3">
      {OVERVIEW_ROWS.map((row) => {
        const raw = overview?.counts[row.key];
        let value = '-';
        if (raw !== undefined && raw !== null) {
          if (row.usd) {
            try {
              value = formatUsd(String(raw));
            } catch {
              value = String(raw);
            }
          } else {
            value = Number(raw).toLocaleString('en-US');
          }
        }
        return (
          <div key={row.key} className="flex items-baseline justify-between gap-4 py-2.5">
            <dt className="text-[14px] text-muted">{row.label}</dt>
            <dd className="figure text-[15px] text-text">{value}</dd>
          </div>
        );
      })}
    </dl>
  );
}

// ---------------------------------------------------------------------------
// Disputes
// ---------------------------------------------------------------------------

const RULINGS: { key: Ruling; label: string; confirm: string; action: string }[] = [
  { key: 'client', label: 'Refund the client', confirm: 'Refund the client and seal the receipt as refunded.', action: 'Confirm refund' },
  { key: 'provider', label: 'Pay the provider', confirm: 'Release the escrow to the provider and seal the receipt as upheld.', action: 'Confirm payment' },
  { key: 'split', label: 'Split it', confirm: 'Split the escrow, half to each side, with the fee on the whole.', action: 'Confirm split' },
];

function DisputeItem({ receipt: r, secret, onRuled, onRefused }: { receipt: WireReceipt; secret: string; onRuled: (r: WireReceipt) => void; onRefused: () => void }) {
  const ids = useId();
  const [ruling, setRuling] = useState<Ruling | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const events = r.events ?? [];
  const disputed = [...events].reverse().find((e) => e.toState === 'disputed');
  const rejected = [...events].reverse().find((e) => e.toState === 'rejected');
  const partyOf = (actor: string | undefined) => (actor === 'client' ? partyLabel(r.client) : actor === 'provider' ? partyLabel(r.provider) : (actor ?? 'a party'));
  const chosen = RULINGS.find((x) => x.key === ruling) ?? null;

  async function confirm() {
    if (!ruling || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await adminFetch<{ receipt: WireReceipt }>(secret, 'POST', `/v1/admin/receipts/${encodeURIComponent(r.id)}/rule`, {
        ruling,
        ...(note.trim() ? { note: note.trim() } : {}),
      });
      onRuled(res.receipt);
    } catch (err) {
      if (refused(err)) onRefused();
      else setError(errorText(err));
      setBusy(false);
    }
  }

  return (
    <li className="panel min-w-0 p-4 sm:p-5">
      <Receipt receipt={r} size="row" />
      <div className="mt-5 grid gap-5 md:grid-cols-2">
        <div className="min-w-0">
          <p className="text-[13px] text-muted">
            Rejected by {partyLabel(r.client)}
            {rejected ? ` · ${timeAgo(rejected.createdAt)}` : ''}
          </p>
          <p className="mt-1.5 whitespace-pre-wrap break-words text-[15px] leading-[1.6] text-text">{rejected?.note || 'No reason given.'}</p>
        </div>
        <div className="min-w-0">
          <p className="text-[13px] text-muted">
            Disputed by {partyOf(disputed?.actor)}
            {disputed ? ` · ${timeAgo(disputed.createdAt)}` : ''}
          </p>
          <p className="mt-1.5 whitespace-pre-wrap break-words text-[15px] leading-[1.6] text-text">{disputed?.note || 'No reason recorded.'}</p>
        </div>
      </div>

      {!chosen ? (
        <div className="mt-6 flex flex-wrap gap-3">
          {RULINGS.map((x) => (
            <Button key={x.key} kind="line" onClick={() => setRuling(x.key)}>
              {x.label}
            </Button>
          ))}
        </div>
      ) : (
        <div className="mt-6 grid gap-4 rounded-sm bg-ink-3 p-4">
          <p className="text-[15px] text-text">{chosen.confirm}</p>
          <div>
            <label htmlFor={`${ids}-note`} className="mb-1.5 block text-[13px] text-muted">
              Note for the record <span className="text-dim">(optional)</span>
            </label>
            <input id={`${ids}-note`} className="field" value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} autoComplete="off" />
          </div>
          {error ? (
            <p className="text-[14px] text-bad" role="alert">
              {error}
            </p>
          ) : null}
          <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
            <Button onClick={confirm} disabled={busy}>
              {busy ? 'Ruling' : chosen.action}
            </Button>
            <Button
              kind="text"
              onClick={() => {
                setRuling(null);
                setError(null);
              }}
              disabled={busy}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}
    </li>
  );
}

// ---------------------------------------------------------------------------
// Payouts
// ---------------------------------------------------------------------------

type PayoutAction = 'approve' | 'paid' | 'reject';

const PAYOUT_ACTIONS: Record<PayoutAction, { label: string; confirm: (amount: string, who: string) => string; action: string; note: boolean }> = {
  approve: { label: 'Approve', confirm: (a, w) => `Approve ${a} for ${w}? Nothing moves yet: send the money by hand, then mark it paid.`, action: 'Confirm approval', note: false },
  paid: { label: 'Mark paid', confirm: (a, w) => `Mark ${a} to ${w} as paid? Only once the money has left.`, action: 'Confirm paid', note: true },
  reject: { label: 'Reject', confirm: (a, w) => `Reject the request and return ${a} to the available cash of ${w}?`, action: 'Confirm rejection', note: true },
};

function PayoutItem({ payout: p, secret, onDone, onRefused }: { payout: AdminPayout; secret: string; onDone: (p: AdminPayout) => void; onRefused: () => void }) {
  const ids = useId();
  const [action, setAction] = useState<PayoutAction | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  let amount = p.amountMicros;
  try {
    amount = formatUsd(p.amountMicros);
  } catch {
    // keep micros
  }
  const who = p.agent ? (p.agent.handle ? `@${p.agent.handle}` : p.agent.name) : p.agentId;
  const available: PayoutAction[] = p.status === 'pending' ? ['approve', 'reject'] : ['paid', 'reject'];
  const chosen = action ? PAYOUT_ACTIONS[action] : null;

  async function confirm() {
    if (!action || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await adminFetch<{ payout: AdminPayout }>(secret, 'POST', `/v1/admin/payouts/${encodeURIComponent(p.id)}/${action}`, PAYOUT_ACTIONS[action].note && note.trim() ? { note: note.trim() } : {});
      setAction(null);
      setNote('');
      onDone(res.payout);
    } catch (err) {
      if (refused(err)) onRefused();
      else setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="panel min-w-0 p-4 sm:p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
        <p className="text-[16px] text-text">
          <span className="figure">{amount}</span> <span className="text-muted">cash to</span>{' '}
          <Link href={`/agent/${p.agent?.handle ?? p.agentId}`} className="figure transition-colors hover:text-paper-2">
            {who}
          </Link>
        </p>
        <p className="text-[13px] text-muted">
          <span className={p.status === 'approved' ? 'text-ok' : 'text-wait'}>{p.status}</span> · asked {timeAgo(p.createdAt)}
        </p>
      </div>
      <p className="figure mt-2 truncate text-[13px] text-muted" title={p.destination?.address}>
        {p.destination ? `${p.destination.type} ${p.destination.address}${p.destination.label ? ` (${p.destination.label})` : ''}` : `payment method ${p.destinationIndex} is gone from the agent`}
      </p>
      {p.note ? <p className="mt-2 whitespace-pre-wrap break-words text-[14px] text-muted">{p.note}</p> : null}

      {!chosen ? (
        <div className="mt-5 flex flex-wrap gap-3">
          {available.map((a) => (
            <Button key={a} kind={a === 'reject' ? 'danger' : 'line'} onClick={() => setAction(a)}>
              {PAYOUT_ACTIONS[a].label}
            </Button>
          ))}
        </div>
      ) : (
        <div className="mt-5 grid gap-4 rounded-sm bg-ink-3 p-4">
          <p className="text-[15px] text-text">{chosen.confirm(amount, who)}</p>
          {chosen.note ? (
            <div>
              <label htmlFor={`${ids}-note`} className="mb-1.5 block text-[13px] text-muted">
                Note for the record <span className="text-dim">(optional)</span>
              </label>
              <input id={`${ids}-note`} className="field" value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} autoComplete="off" />
            </div>
          ) : null}
          {error ? (
            <p className="text-[14px] text-bad" role="alert">
              {error}
            </p>
          ) : null}
          <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
            <Button onClick={confirm} disabled={busy}>
              {busy ? 'Saving' : chosen.action}
            </Button>
            <Button
              kind="text"
              onClick={() => {
                setAction(null);
                setError(null);
              }}
              disabled={busy}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}
    </li>
  );
}

// ---------------------------------------------------------------------------
// Flags
// ---------------------------------------------------------------------------

const FLAG_META: { key: string; kind: 'bool' | 'micros'; note: string }[] = [
  { key: 'ledger_frozen', kind: 'bool', note: 'Money endpoints answer 503 while frozen.' },
  { key: 'registrations_paused', kind: 'bool', note: 'New registrations answer 503.' },
  { key: 'house_daily_budget_micros', kind: 'micros', note: 'What house offers may spend in a UTC day.' },
  { key: 'house_spent_today_micros', kind: 'micros', note: 'Spent so far today. House calls stop when it reaches the budget.' },
];

function asBool(v: unknown): boolean {
  return v === true || v === 'true';
}

function asMicros(v: unknown): string {
  if (typeof v === 'number' && Number.isFinite(v)) return String(Math.trunc(v));
  if (typeof v === 'string' && /^\d+$/.test(v.trim())) return v.trim();
  return '';
}

function usdOf(micros: string): string | null {
  if (!/^\d{1,18}$/.test(micros)) return null;
  try {
    return formatUsd(micros);
  } catch {
    return null;
  }
}

function Flags({ flags, secret, onChange, onRefused }: { flags: AdminFlag[] | null; secret: string; onChange: (f: AdminFlag[]) => void; onRefused: () => void }) {
  const ids = useId();
  return (
    <section className="lg:col-span-7" aria-labelledby={`${ids}-flags`}>
      <h2 id={`${ids}-flags`} className="display text-[clamp(1.6rem,2.6vw,2.1rem)]">
        Flags change the live registry at once.
      </h2>
      {flags === null ? (
        <p className="mt-4 text-[14px] text-muted">Loading flags</p>
      ) : (
        <ul className="panel mt-6 divide-y divide-ink-3">
          {FLAG_META.map((meta) => {
            const row = flags.find((f) => f.key === meta.key);
            return <FlagRow key={meta.key} meta={meta} row={row ?? null} secret={secret} onRefused={onRefused} onSaved={(saved) => onChange([...flags.filter((f) => f.key !== saved.key), saved])} />;
          })}
        </ul>
      )}
    </section>
  );
}

function FlagRow({ meta, row, secret, onSaved, onRefused }: { meta: (typeof FLAG_META)[number]; row: AdminFlag | null; secret: string; onSaved: (f: AdminFlag) => void; onRefused: () => void }) {
  const ids = useId();
  const current = meta.kind === 'bool' ? asBool(row?.value) : asMicros(row?.value);
  const [draft, setDraft] = useState(typeof current === 'string' ? current : '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (typeof current === 'string') setDraft(current);
  }, [current]);

  async function save(value: boolean | number | string) {
    setBusy(true);
    setError(null);
    try {
      const res = await adminFetch<{ key: string; value: unknown }>(secret, 'PATCH', '/v1/admin/flags', { key: meta.key, value });
      onSaved({ key: res.key, value: res.value, updatedAt: new Date().toISOString() });
    } catch (err) {
      if (refused(err)) onRefused();
      else setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  const draftOk = /^\d{1,18}$/.test(draft.trim());
  const usd = usdOf(draft.trim());

  return (
    <li className="grid gap-x-6 gap-y-3 px-4 py-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:px-5">
      <div className="min-w-0">
        <p className="figure text-[14px] text-text" id={`${ids}-label`}>
          {meta.key}
        </p>
        <p className="mt-1 text-[13px] text-muted">
          {meta.note}
          {row ? ` Set ${timeAgo(row.updatedAt)}.` : ' Not set.'}
        </p>
      </div>
      {meta.kind === 'bool' ? (
        <div className="flex items-center gap-3">
          <span className="figure w-7 text-right text-[13px] text-muted">{current ? 'on' : 'off'}</span>
          <button
            type="button"
            role="switch"
            aria-checked={current === true}
            aria-label={meta.key}
            disabled={busy}
            onClick={() => void save(!current)}
            className={`h-[22px] w-[44px] shrink-0 rounded-sm border p-0.5 transition-colors disabled:cursor-wait ${current ? 'border-paper-2 bg-ink-3' : 'border-line-strong bg-floor hover:border-paper-2'}`}
          >
            <span aria-hidden="true" className={`block h-4 w-4 rounded-[1px] ${current ? 'translate-x-[22px] bg-paper' : 'translate-x-0 bg-muted'}`} />
          </button>
        </div>
      ) : (
        <div className="grid gap-1.5">
          <div className="flex items-center gap-3">
            <div className="w-40">
              <input className="field" inputMode="numeric" aria-label={meta.key} value={draft} onChange={(e) => setDraft(e.target.value.replace(/[^\d]/g, ''))} placeholder="micros" autoComplete="off" />
            </div>
            <Button
              kind="line"
              onClick={() => {
                // numbers, like the seeded flags, whenever they fit exactly; the API reads digit strings too
                const n = Number(draft.trim());
                void save(Number.isSafeInteger(n) ? n : draft.trim());
              }}
              disabled={busy || !draftOk || draft.trim() === current}
            >
              {busy ? 'Saving' : 'Save'}
            </Button>
          </div>
          <p className="figure min-h-[18px] text-[12px] leading-[18px] text-muted">{usd}</p>
        </div>
      )}
      {error ? (
        <p className="text-[13px] text-bad sm:col-span-2" role="alert">
          {error}
        </p>
      ) : null}
    </li>
  );
}

// ---------------------------------------------------------------------------
// Clock
// ---------------------------------------------------------------------------

function Clock({ secret, onTicked, onRefused }: { secret: string; onTicked: () => void; onRefused: () => void }) {
  const ids = useId();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ClockTick | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function tick() {
    setBusy(true);
    setError(null);
    try {
      const res = await adminFetch<ClockTick>(secret, 'POST', '/v1/admin/clock/tick', {});
      setResult(res);
      onTicked();
    } catch (err) {
      if (refused(err)) onRefused();
      else setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  const rules = result ? Object.entries(result.byRule).filter(([, n]) => n > 0) : [];

  return (
    <section className="lg:col-span-5" aria-labelledby={`${ids}-clock`}>
      <h2 id={`${ids}-clock`} className="display text-[clamp(1.6rem,2.6vw,2.1rem)]">
        The clock seals what nobody says.
      </h2>
      <p className="mt-4 max-w-[26rem] text-[15px] text-muted">It runs every five minutes on its own. A tick runs every rule now: expiries, timeouts, unreviewed deliveries, lapsed disputes.</p>
      <Button kind="line" className="mt-6" onClick={() => void tick()} disabled={busy}>
        {busy ? 'Ticking' : 'Tick the clock'}
      </Button>
      <div aria-live="polite">
        {error ? <p className="mt-4 text-[14px] text-bad">{error}</p> : null}
        {result ? (
          <div className="mt-5 text-[14px] text-muted">
            {result.ran ? (
              <>
                <p>
                  Ran at <span className="figure text-text">{isoTime(result.at)}</span>: <span className="figure text-text">{result.transitions}</span> {result.transitions === 1 ? 'transition' : 'transitions'}.
                </p>
                {rules.length ? (
                  <ul className="figure mt-2 grid gap-1 text-[13px]">
                    {rules.map(([name, n]) => (
                      <li key={name} className="flex max-w-[20rem] justify-between gap-4">
                        <span>{name}</span>
                        <span className="text-text">{n}</span>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </>
            ) : (
              <p>Another tick holds the lock. Try again in a moment.</p>
            )}
          </div>
        ) : null}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Funnel
// ---------------------------------------------------------------------------

const FUNNEL_EVENTS = ['receipt.viewed', 'claim.opened', 'claim.confirmed', 'register.completed', 'offer.viewed', 'find.empty'];

function Funnel({ funnel }: { funnel: FunnelReport | null }) {
  const ids = useId();
  const sources = funnel ? Object.entries(funnel.registrationsBySource).sort((a, b) => b[1] - a[1]) : [];
  const extra = funnel ? Object.keys(funnel.totals).filter((k) => !FUNNEL_EVENTS.includes(k)) : [];
  return (
    <section className="mt-16" aria-labelledby={`${ids}-funnel`}>
      <h2 id={`${ids}-funnel`} className="display text-[clamp(1.6rem,2.6vw,2.1rem)]">
        Thirty days of the funnel.
      </h2>
      {funnel ? <p className="mt-3 text-[14px] text-muted">Since {isoDate(funnel.since)}.</p> : <p className="mt-4 text-[14px] text-muted">Loading the funnel</p>}
      {funnel ? (
        <div className="mt-6 grid gap-5 md:grid-cols-2">
          <div className="panel overflow-x-auto px-5 py-4">
            <table className="figure w-full text-[13px]">
              <thead>
                <tr className="text-left text-[12px] text-dim">
                  <th className="pb-2 font-normal">event</th>
                  <th className="pb-2 text-right font-normal">total</th>
                </tr>
              </thead>
              <tbody>
                {[...FUNNEL_EVENTS, ...extra].map((e) => (
                  <tr key={e}>
                    <td className="py-1 pr-4 text-muted">{e}</td>
                    <td className="py-1 text-right text-text">{(funnel.totals[e] ?? 0).toLocaleString('en-US')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="panel overflow-x-auto px-5 py-4">
            <table className="figure w-full text-[13px]">
              <thead>
                <tr className="text-left text-[12px] text-dim">
                  <th className="pb-2 font-normal">registrations by source</th>
                  <th className="pb-2 text-right font-normal">total</th>
                </tr>
              </thead>
              <tbody>
                {sources.length === 0 ? (
                  <tr>
                    <td className="py-1 text-muted" colSpan={2}>
                      none in this window
                    </td>
                  </tr>
                ) : (
                  sources.map(([src, n]) => (
                    <tr key={src}>
                      <td className="py-1 pr-4 text-muted">{src}</td>
                      <td className="py-1 text-right text-text">{n.toLocaleString('en-US')}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </section>
  );
}
