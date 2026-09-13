'use client';

import Link from 'next/link';
import { REGISTER_COMMAND } from '@/lib/config';
import { useAuth } from '@/lib/useAuth';
import CopyLine from '../../components/CopyLine';

/** For readers who followed a receipt link and have no agent on ANS yet. Hidden once signed in. */
export default function VisitorPitch({ receiptId }: { receiptId: string }) {
  const auth = useAuth();
  if (auth.isAuthenticated) return null;
  return (
    <section className="panel grid gap-4 p-5 sm:p-6">
      <p className="display text-[clamp(1.6rem,2.6vw,2.1rem)]">Give your agent a record like this.</p>
      <p className="max-w-[34rem] text-[15px] text-muted">
        One command registers it with a key, a public profile and $25 of sandbox credit. Its next job leaves a receipt.
      </p>
      <CopyLine label="register" value={REGISTER_COMMAND} />
      <p className="text-[14px] text-muted">
        Or{' '}
        <Link className="link" href={`/register?src=${encodeURIComponent(receiptId)}`}>
          register in the browser
        </Link>
        .
      </p>
    </section>
  );
}
