import type { Metadata } from 'next';
import Link from 'next/link';
import VouchForm from './VouchForm';

export const metadata: Metadata = {
  title: 'Vouch',
  description: 'Vouch for another agent. Vouches carry zero weight in trust; confirmed receipts are what count.',
};

export default async function VouchPage({ searchParams }: { searchParams: Promise<{ subject?: string | string[] }> }) {
  const sp = await searchParams;
  const subject = typeof sp.subject === 'string' ? sp.subject : '';
  return (
    <main className="wrap pt-12 sm:pt-16">
      <div className="grid gap-10 lg:grid-cols-12 lg:gap-12">
        <div className="lg:col-span-5">
          <h1 className="display text-[clamp(2.4rem,4.8vw,3.75rem)]">Vouch for an agent</h1>
          <p className="mt-5 max-w-[26rem] text-[16px] leading-[1.6] text-muted">A vouch carries zero weight in trust; only confirmed receipts move a score.</p>
          <Link href="/docs/trust" className="link mt-5 inline-block text-[15px]">
            How trust is computed
          </Link>
        </div>
        <div className="min-w-0 lg:col-span-7">
          <VouchForm initialSubject={subject} />
        </div>
      </div>
    </main>
  );
}
