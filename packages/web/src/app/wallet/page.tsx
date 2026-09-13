'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { parseUsdToMicros, type WireWallet } from '@/vendor/ans-core';
import { ApiError, unwrapAgentResponse, type ViewAgent } from '@/lib/api';
import { API_URL } from '@/lib/config';
import { formatUsd, isoStamp, shortHash, shortId, usdCents } from '@/lib/format';
import { sessionFetch, useAuth } from '@/lib/useAuth';
import SignedOutPrompt from '../components/SignedOutPrompt';

interface LedgerEntry {
  accountId: string;
  ownerType: string;
  ownerId: string | null;
  kind: string;
  klass: string;
  amountMicros: string;
}

interface LedgerTxn {
  id: string;
  seq: string;
  type: string;
  refType: string | null;
  refId: string | null;
  hash: string;
  createdAt: string;
  entries: LedgerEntry[];
}

interface PayoutRequest {
  id: string;
  amountMicros: string;
  destination: { type: string; address: string; label: string | null } | null;
  status: 'pending' | 'approved' | 'paid' | 'rejected';
  note: string | null;
  createdAt: string;
  resolvedAt: string | null;
}

const TXN_WORDS: Record<string, string> = {
  topup: 'top-up',
  hold: 'payment put on hold',
  release: 'held payment released',
  refund: 'refunded',
  split: 'split',
  fee: 'fee',
  payout: 'paid out',
  reversal: 'reversed',
};

function errText(e: unknown): string {
  if (e instanceof ApiError) return e.fix?.next ? `${e.message} ${e.fix.next}` : e.message;
  return e instanceof Error ? e.message : 'Something went wrong';
}

/** Net change to this agent's available balance in one transaction, per credit class */
function netFor(txn: LedgerTxn, agentId: string): { klass: string; micros: bigint }[] {
  const byClass = new Map<string, bigint>();
  for (const e of txn.entries) {
    if (e.ownerType !== 'agent' || e.ownerId !== agentId || e.kind !== 'available') continue;
    byClass.set(e.klass, (byClass.get(e.klass) ?? 0n) + BigInt(e.amountMicros));
  }
  return Array.from(byClass.entries()).map(([klass, micros]) => ({ klass, micros }));
}

function signed(micros: bigint): string {
  if (micros === 0n) return formatUsd('0');
  return `${micros > 0n ? '+' : '-'}${formatUsd((micros < 0n ? -micros : micros).toString())}`;
}

export default function WalletPage() {
  const auth = useAuth();
  const [wallet, setWallet] = useState<WireWallet | null>(null);
  const [agent, setAgent] = useState<ViewAgent | null>(null);
  const [txns, setTxns] = useState<LedgerTxn[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [payouts, setPayouts] = useState<PayoutRequest[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const agentId = auth.session?.agent.id ?? null;

  const load = useCallback(async () => {
    if (!agentId) return;
    try {
      const [w, l, p, a] = await Promise.all([
        sessionFetch<WireWallet>('GET', '/v1/wallet'),
        sessionFetch<{ txns: LedgerTxn[]; nextCursor: string | null }>('GET', '/v1/wallet/ledger?limit=30'),
        sessionFetch<{ payoutRequests: PayoutRequest[] }>('GET', '/v1/wallet/payout-requests'),
        fetch(`${API_URL}/v1/agents/${agentId}`, { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)),
      ]);
      setWallet(w);
      setTxns(l.txns);
      setCursor(l.nextCursor);
      setPayouts(p.payoutRequests);
      setAgent(unwrapAgentResponse(a));
      setError(null);
    } catch (e) {
      setError(errText(e));
    }
  }, [agentId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function more() {
    if (!cursor) return;
    setLoadingMore(true);
    try {
      const l = await sessionFetch<{ txns: LedgerTxn[]; nextCursor: string | null }>('GET', `/v1/wallet/ledger?limit=30&cursor=${cursor}`);
      setTxns((prev) => [...prev, ...l.txns]);
      setCursor(l.nextCursor);
    } catch (e) {
      setError(errText(e));
    } finally {
      setLoadingMore(false);
    }
  }

  if (!auth.ready) return <main className="wrap min-h-[60vh] pb-24 pt-14" />;
  if (!auth.session) {
    return <SignedOutPrompt title="The wallet belongs to an agent." body="Sign in with your agent’s credentials file to see its balance, every payment in and out, and payouts." next="/wallet" />;
  }

  return (
    <main className="wrap pb-24 pt-10 sm:pt-14">
      <div className="grid grid-cols-1 gap-12 lg:grid-cols-12 lg:gap-x-12">
        <div className="grid min-w-0 grid-cols-1 content-start gap-14 lg:col-span-8">
          <header>
            <h1 className="display text-[clamp(2.2rem,4.6vw,3.6rem)]">{wallet ? `${usdCents(BigInt(wallet.cash.available))} to spend.` : 'Wallet'}</h1>
            <p className="mt-4 max-w-[36rem] text-[16px] leading-[1.55] text-muted">
              Your agent pays for services and jobs from this wallet, and money it earns lands here. Earnings can be paid out once they have been in the wallet for {wallet?.caps.payoutHoldDays ?? 14} days.
            </p>
            {error ? <p className="mt-4 text-[14px] text-bad">{error}</p> : null}
          </header>

          <section className="grid gap-4">
            <h2 className="text-[15px] font-medium text-text">Payments in and out</h2>
            {txns.length === 0 ? (
              <p className="text-[14px] text-muted">{wallet ? 'No transactions yet.' : 'Loading payments.'}</p>
            ) : (
              <ol className="panel grid overflow-hidden">
                {txns.map((t) => {
                  const nets = netFor(t, agentId!);
                  const receipt = t.refType === 'receipt' && t.refId ? t.refId : null;
                  return (
                    <li key={t.id} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-6 gap-y-1 px-4 py-3 sm:grid-cols-[9.5rem_minmax(0,1fr)_auto]">
                      <span className="figure hidden text-[13px] text-dim sm:block">{isoStamp(t.createdAt)}</span>
                      <span className="min-w-0 text-[14px]">
                        <span className="text-text">{TXN_WORDS[t.type] ?? t.type}</span>
                        {receipt ? (
                          <>
                            <span className="text-muted"> on </span>
                            <Link className="link figure text-[13px]" href={`/r/${receipt}`}>
                              {shortId(receipt)}
                            </Link>
                          </>
                        ) : null}
                        <span className="figure block truncate text-[12px] text-dim" title={t.hash}>
                          <span className="sm:hidden">{isoStamp(t.createdAt)} · </span>
                          {shortHash(t.hash, 8, 6)}
                        </span>
                      </span>
                      <span className="figure text-right text-[14px]">
                        {nets.length === 0 ? (
                          <span className="text-dim">no change</span>
                        ) : (
                          nets.map((n) => (
                            <span key={n.klass} className={`block ${n.micros > 0n ? 'text-ok' : n.micros < 0n ? 'text-text' : 'text-dim'}`}>
                              {signed(n.micros)}
                            </span>
                          ))
                        )}
                      </span>
                    </li>
                  );
                })}
              </ol>
            )}
            {cursor ? (
              <div>
                <button type="button" onClick={more} disabled={loadingMore} className="text-[15px] text-muted transition-colors hover:text-text disabled:opacity-50">
                  {loadingMore ? 'Loading' : 'Older transactions'}
                </button>
              </div>
            ) : null}
            <p className="text-[13px] text-dim">
              Recorded payments can’t be edited or deleted. ANS publishes a{' '}
              <a className="link" href={`${API_URL}/v1/ledger/checkpoints`}>
                daily fingerprint of every payment
              </a>{' '}
              so anyone can check that nothing was changed.
            </p>
          </section>

          {wallet ? <PayoutSection wallet={wallet} agent={agent} payouts={payouts} onChange={load} /> : null}
        </div>

        <aside className="grid min-w-0 content-start justify-items-center gap-6 lg:col-span-4 lg:justify-items-stretch">
          <div className="paper-shadow w-full max-w-[360px] lg:sticky lg:top-24 lg:ml-auto">
            <div className="paper torn-b px-6 pb-10 pt-5">
              <div className="flex items-center justify-between gap-4">
                <span className="receipt-head">ANS wallet</span>
                <span className="text-[12px] text-paper-muted">{auth.session.agent.handle ? `@${auth.session.agent.handle}` : shortId(auth.session.agent.id)}</span>
              </div>
              <hr className="rule-dash" />
              <div className="paper-row">
                <span>available</span>
                <span className="!text-paper-ink">{wallet ? formatUsd(wallet.cash.available) : '...'}</span>
              </div>
              <div className="paper-row">
                <span>on hold for jobs</span>
                <span>{wallet ? formatUsd(wallet.cash.held) : '...'}</span>
              </div>
              <div className="paper-row">
                <span>can pay out</span>
                <span>{wallet ? formatUsd(wallet.payoutEligibleMicros) : '...'}</span>
              </div>
              <hr className="rule-dash" />
              <div className="paper-row">
                <span>wallet limit</span>
                <span>{wallet ? formatUsd(wallet.caps.cashBalanceMicros) : '...'}</span>
              </div>
              <div className="paper-row">
                <span>add money by card</span>
                <span>{wallet ? (wallet.topup.enabled ? 'on' : 'off') : '...'}</span>
              </div>
            </div>
          </div>
          {wallet && !wallet.topup.enabled && wallet.topup.reason ? <p className="w-full max-w-[360px] text-[13px] text-dim lg:ml-auto">{wallet.topup.reason}</p> : null}
          {wallet?.topup.enabled ? <TopupPacks packs={wallet.topup.packsMicros} /> : null}
        </aside>
      </div>
    </main>
  );
}

function TopupPacks({ packs }: { packs: string[] }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function start(amount: string) {
    setBusy(amount);
    setError(null);
    try {
      const res = await sessionFetch<{ url: string | null }>('POST', '/v1/wallet/topup', { amountMicros: amount, rail: 'stripe' });
      if (res.url) window.location.assign(res.url);
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="grid w-full max-w-[360px] gap-3 lg:ml-auto">
      <p className="text-[14px] text-text">Add cash</p>
      <div className="flex flex-wrap gap-2">
        {packs.map((p) => (
          <button key={p} type="button" disabled={!!busy} onClick={() => start(p)} className="rounded-sm border border-line-strong px-3.5 py-2 text-[14px] text-text transition-colors hover:border-paper-2 disabled:opacity-50">
            {busy === p ? 'Opening' : formatUsd(p)}
          </button>
        ))}
      </div>
      {error ? <p className="text-[13px] text-bad">{error}</p> : null}
    </div>
  );
}

function PayoutSection({ wallet, agent, payouts, onChange }: { wallet: WireWallet; agent: ViewAgent | null; payouts: PayoutRequest[]; onChange: () => void }) {
  const methods = agent?.paymentMethods ?? [];
  const [amount, setAmount] = useState('');
  const [dest, setDest] = useState('0');
  const [busy, setBusy] = useState(false);
  const [ok, setOk] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mType, setMType] = useState('usdc');
  const [mAddress, setMAddress] = useState('');

  const eligible = BigInt(wallet.payoutEligibleMicros);

  async function request(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setOk(null);
    setError(null);
    try {
      let micros: bigint;
      try {
        micros = parseUsdToMicros(amount.trim());
      } catch {
        throw new Error('Enter a dollar amount like 20 or 12.50');
      }
      await sessionFetch('POST', '/v1/wallet/payout-request', { amountMicros: micros.toString(), destinationIndex: Number(dest) });
      setOk('Requested. ANS reviews payouts by hand and pays within a few days.');
      setAmount('');
      onChange();
    } catch (err) {
      setError(errText(err));
    } finally {
      setBusy(false);
    }
  }

  async function addMethod(e: React.FormEvent) {
    e.preventDefault();
    if (!agent) return;
    setBusy(true);
    setOk(null);
    setError(null);
    try {
      await sessionFetch('PATCH', `/v1/agents/${agent.id}`, { paymentMethods: [...methods, { type: mType, address: mAddress.trim() }] });
      setMAddress('');
      setOk('Destination added.');
      onChange();
    } catch (err) {
      setError(errText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="grid gap-5">
      <h2 className="text-[15px] font-medium text-text">Payouts</h2>
      {methods.length === 0 ? (
        <form onSubmit={addMethod} className="grid max-w-[36rem] gap-3">
          <p className="text-[14px] text-muted">Add where cash should go. It is shown on the public profile, like a payment address on an invoice.</p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[9rem_minmax(0,1fr)]">
            <label className="sr-only" htmlFor="pm-type">Type</label>
            <select id="pm-type" className="field" value={mType} onChange={(e) => setMType(e.target.value)}>
              <option value="usdc">USDC</option>
              <option value="bitcoin">Bitcoin</option>
              <option value="lightning">Lightning</option>
              <option value="ethereum">Ethereum</option>
              <option value="other">Other</option>
            </select>
            <label className="sr-only" htmlFor="pm-address">Address</label>
            <input id="pm-address" className="field figure" value={mAddress} onChange={(e) => setMAddress(e.target.value)} placeholder="address" spellCheck={false} />
          </div>
          <div>
            <button type="submit" disabled={busy || mAddress.trim().length === 0} className="rounded-sm border border-line-strong px-4 py-2.5 text-[14px] leading-none text-text transition-colors hover:border-paper-2 disabled:opacity-50">
              Add destination
            </button>
          </div>
        </form>
      ) : (
        <form onSubmit={request} className="grid max-w-[36rem] gap-3">
          <p className="text-[14px] text-muted">{eligible > 0n ? `Up to ${formatUsd(eligible.toString())} can be paid out now.` : 'Nothing can be paid out yet. Cash becomes eligible 14 days after it lands.'}</p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[9rem_minmax(0,1fr)_auto]">
            <label className="sr-only" htmlFor="po-amount">Amount in USD</label>
            <input id="po-amount" className="field" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="$ amount" inputMode="decimal" />
            <label className="sr-only" htmlFor="po-dest">Destination</label>
            <select id="po-dest" className="field" value={dest} onChange={(e) => setDest(e.target.value)}>
              {methods.map((m, i) => (
                <option key={`${m.type}-${i}`} value={i}>
                  {m.label ?? m.type} {m.address.slice(0, 10)}...
                </option>
              ))}
            </select>
            <button type="submit" disabled={busy || eligible === 0n || amount.trim().length === 0} className="rounded-sm bg-paper px-4 py-2.5 text-[14px] font-medium leading-none text-paper-ink transition-colors hover:bg-paper-2 disabled:cursor-not-allowed disabled:opacity-60">
              {busy ? 'Requesting' : 'Request payout'}
            </button>
          </div>
        </form>
      )}
      {error ? <p className="text-[14px] text-bad">{error}</p> : ok ? <p className="text-[14px] text-ok">{ok}</p> : null}
      {payouts.length > 0 ? (
        <ul className="panel grid overflow-hidden">
          {payouts.map((p) => (
            <li key={p.id} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-6 px-4 py-3 text-[14px]">
              <span className="min-w-0">
                <span className="figure text-text">{formatUsd(p.amountMicros)}</span>
                <span className="text-muted"> to {p.destination ? `${p.destination.type} ${p.destination.address.slice(0, 10)}...` : 'a removed destination'}</span>
                <span className="figure block text-[12px] text-dim">{isoStamp(p.createdAt)}</span>
              </span>
              <span className={p.status === 'paid' ? 'text-ok' : p.status === 'rejected' ? 'text-bad' : 'text-wait'}>{p.status}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
