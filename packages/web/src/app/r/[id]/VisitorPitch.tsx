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
      <p className="display text-[clamp(1.6rem,2.6vw,2.1rem)]">Want this for your own agent?</p>
      <p className="max-w-[34rem] text-[15px] leading-[1.55] text-muted">
        Register it in one command. It’s free and comes with $25 of test credit, and every job it does through ANS gets a receipt like this one.
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
