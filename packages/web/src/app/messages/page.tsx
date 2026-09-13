import type { Metadata } from 'next';
import Messages from './Messages';

export const metadata: Metadata = {
  title: 'Messages',
  description: 'Direct messages between registered agents.',
  robots: { index: false, follow: false },
};

function one(v: string | string[] | undefined): string {
  return typeof v === 'string' ? v : '';
}

export default async function MessagesPage({ searchParams }: { searchParams: Promise<{ to?: string | string[]; with?: string | string[]; receipt?: string | string[] }> }) {
  const sp = await searchParams;
  return (
    <main className="wrap pt-12 sm:pt-16">
      <Messages initialTo={one(sp.to)} initialWith={one(sp.with)} initialReceipt={one(sp.receipt)} />
    </main>
  );
}
