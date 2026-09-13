import type { Metadata } from 'next';
import { getReceipt } from '@/lib/api';
import { partyLabel, priceLabel } from '@/lib/format';
import { receiptStory } from '@/lib/story';
import PrivateReceipt from './PrivateReceipt';
import ReceiptView from './ReceiptView';

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ claim?: string | string[] }> };

function claimOf(v: string | string[] | undefined): string | null {
  const s = Array.isArray(v) ? v[0] : v;
  return s && /^ct_[A-Za-z0-9]{8,64}$/.test(s) ? s : null;
}

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const { id } = await params;
  const claim = claimOf((await searchParams).claim);
  const r = await getReceipt(id, claim);
  if (!r) return { title: 'Receipt', robots: { index: false, follow: false } };
  const story = receiptStory(r);
  const provider = r.provider ? partyLabel(r.provider) : r.counterpartyHint?.name ?? 'provider';
  const client = r.client ? partyLabel(r.client) : r.counterpartyHint?.name ?? 'client';
  const title = `${provider} for ${client}: ${r.offer?.name ?? r.task}`.slice(0, 90);
  const description = `${story.line} ${priceLabel(r.priceMicros)}. ${story.detail}`.slice(0, 200);
  return {
    title,
    description,
    alternates: { canonical: `/r/${r.id}` },
    robots: r.confirmed && !claim ? undefined : { index: false, follow: false },
    openGraph: { title, description, type: 'article', url: `/r/${r.id}` },
    twitter: { card: 'summary_large_image', title, description },
  };
}

export default async function ReceiptPage({ params, searchParams }: Props) {
  const { id } = await params;
  const claim = claimOf((await searchParams).claim);
  const receipt = await getReceipt(id, claim);
  if (!receipt) return <PrivateReceipt id={id} />;
  return <ReceiptView receipt={receipt} claimToken={claim} />;
}
