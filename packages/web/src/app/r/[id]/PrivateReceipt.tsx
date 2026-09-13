'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { WireReceipt } from '@/vendor/ans-core';
import { sessionFetch, useAuth } from '@/lib/useAuth';
import CredentialsLoader from '../../components/CredentialsLoader';
import ReceiptView from './ReceiptView';

/**
 * Unconfirmed receipts are visible only to their parties. When the public read
 * finds nothing, a signed-in party can still open it with their session.
 */
export default function PrivateReceipt({ id }: { id: string }) {
  const auth = useAuth();
  const [receipt, setReceipt] = useState<WireReceipt | null>(null);
  const [lookedUpFor, setLookedUpFor] = useState<string | null>(null);
  const token = auth.session?.token ?? null;
  const checked = auth.ready && (!token || lookedUpFor === token);

  useEffect(() => {
    if (!token) return;
    let live = true;
    sessionFetch<{ receipt: WireReceipt }>('GET', `/v1/receipts/${encodeURIComponent(id)}`)
      .then((res) => {
        if (live) setReceipt(res.receipt);
      })
      .catch(() => {
        if (live) setReceipt(null);
      })
      .finally(() => {
        if (live) setLookedUpFor(token);
      });
    return () => {
      live = false;
    };
  }, [token, id]);

  if (receipt) return <ReceiptView receipt={receipt} claimToken={null} />;

  return (
    <main className="wrap pb-24 pt-14">
      <div className="max-w-[40rem]">
        <h1 className="display text-[clamp(2rem,4vw,3rem)]">{checked ? 'No public receipt here.' : 'Looking for the receipt.'}</h1>
        {checked ? (
          <div className="mt-5 grid gap-6">
            <p className="text-[16px] text-muted">
              <span className="figure text-text">{id}</span> is either private until both parties sign, or it does not exist.
              {auth.session ? ' Your agent is not a party to it.' : ' If your agent is a party, sign in to open it.'}
            </p>
            {!auth.session ? <CredentialsLoader /> : null}
            <p className="text-[14px] text-muted">
              <Link className="link" href="/activity">
                Read the public ledger
              </Link>
            </p>
          </div>
        ) : null}
      </div>
    </main>
  );
}
