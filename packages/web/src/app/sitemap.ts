import type { MetadataRoute } from 'next';
import type { WireOfferSummary, WireReceipt } from '@/vendor/ans-core';
import { tryApi } from '@/lib/api';
import { WEB_URL } from '@/lib/config';
import { offerPath } from './components/OfferRows';

export const revalidate = 3600;

const PAGES: { path: string; changeFrequency: NonNullable<MetadataRoute.Sitemap[number]['changeFrequency']>; priority: number }[] = [
  { path: '/', changeFrequency: 'hourly', priority: 1 },
  { path: '/offers', changeFrequency: 'hourly', priority: 0.9 },
  { path: '/activity', changeFrequency: 'hourly', priority: 0.8 },
  { path: '/leaderboard', changeFrequency: 'daily', priority: 0.7 },
  { path: '/docs/trust', changeFrequency: 'weekly', priority: 0.6 },
  { path: '/docs/money', changeFrequency: 'weekly', priority: 0.6 },
  { path: '/register', changeFrequency: 'monthly', priority: 0.8 },
];

/** Static pages plus the live record: offers, ranked agents and recent confirmed receipts. */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [offers, agents, receipts] = await Promise.all([
    tryApi<{ offers?: WireOfferSummary[] }>('/v1/offers?limit=100', 3600),
    tryApi<{ agents?: { id: string; handle: string | null; isHouse?: boolean; isSeed?: boolean; updatedAt?: string }[] }>('/v1/agents?sort=rank&limit=100', 3600),
    tryApi<{ receipts?: WireReceipt[] }>('/v1/receipts?recent=1&limit=100', 3600),
  ]);

  const entries: MetadataRoute.Sitemap = PAGES.map((p) => ({
    url: p.path === '/' ? WEB_URL : `${WEB_URL}${p.path}`,
    changeFrequency: p.changeFrequency,
    priority: p.priority,
  }));
  for (const o of offers?.offers ?? []) {
    entries.push({ url: `${WEB_URL}${offerPath(o.name)}`, changeFrequency: 'daily', priority: 0.7 });
  }
  for (const a of agents?.agents ?? []) {
    if (a.isSeed) continue;
    entries.push({ url: `${WEB_URL}/agent/${a.handle ?? a.id}`, changeFrequency: 'daily', priority: 0.6, lastModified: a.updatedAt });
  }
  for (const r of receipts?.receipts ?? []) {
    if (!r.confirmed) continue;
    entries.push({ url: `${WEB_URL}/r/${r.id}`, changeFrequency: r.hash ? 'yearly' : 'daily', priority: 0.5, lastModified: r.sealedAt ?? r.createdAt });
  }
  return entries;
}
