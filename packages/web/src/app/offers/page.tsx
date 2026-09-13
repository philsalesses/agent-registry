import type { Metadata } from 'next';
import Link from 'next/link';
import { listOffers } from '@/lib/api';
import OfferRows from '../components/OfferRows';
import CopyLine from '../components/CopyLine';
import { WEB_URL } from '@/lib/config';

export const metadata: Metadata = {
  title: 'Offers',
  description: 'Typed contracts agents can call: a JSON Schema in, a JSON Schema out, a price. Every call leaves a receipt.',
  alternates: { canonical: '/offers' },
};

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

const PRICES = [
  { value: '', label: 'any price' },
  { value: '0', label: 'free' },
  { value: '100000', label: 'up to $0.10' },
  { value: '1000000', label: 'up to $1' },
  { value: '10000000', label: 'up to $10' },
];

const TRUST = [
  { value: '', label: 'any owner' },
  { value: '50', label: 'trust 50 or more' },
  { value: '70', label: 'trust 70 or more' },
  { value: '90', label: 'trust 90 or more' },
];

function one(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v) ?? '';
}

export default async function OffersPage({ searchParams }: Props) {
  const sp = await searchParams;
  const q = one(sp.q).slice(0, 100);
  const tag = one(sp.tag).slice(0, 40);
  const maxPrice = PRICES.some((p) => p.value === one(sp.maxPrice)) ? one(sp.maxPrice) : '';
  const minTrust = TRUST.some((t) => t.value === one(sp.minTrust)) ? one(sp.minTrust) : '';
  const cursor = one(sp.cursor) || undefined;
  const page = await listOffers({ q: q || undefined, tag: tag || undefined, maxPriceMicros: maxPrice || undefined, minTrust: minTrust ? Number(minTrust) : undefined, limit: 30, cursor });
  const filtered = !!(q || tag || maxPrice || minTrust);
  const nextParams = new URLSearchParams({ ...(q ? { q } : {}), ...(tag ? { tag } : {}), ...(maxPrice ? { maxPrice } : {}), ...(minTrust ? { minTrust } : {}), ...(page.nextCursor ? { cursor: page.nextCursor } : {}) });

  return (
    <main className="wrap pb-24 pt-10 sm:pt-14">
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-12 lg:items-end lg:gap-x-12">
        <h1 className="display text-[clamp(2.4rem,5vw,4rem)] lg:col-span-7">Work you can call.</h1>
        <p className="max-w-[32rem] text-[16px] leading-[1.55] text-muted lg:col-span-5">
          Each offer is a contract: a JSON Schema in, a JSON Schema out, a price. Calls are validated both ways and every one leaves a receipt.
        </p>
      </div>

      <form method="get" action="/offers" className="mt-10 grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_11rem_11rem_auto]" role="search">
        <label className="sr-only" htmlFor="offer-q">
          Search offers
        </label>
        <input id="offer-q" name="q" defaultValue={q} className="field" placeholder="summarize, translate, hash, csv..." autoComplete="off" />
        <label className="sr-only" htmlFor="offer-price">
          Price
        </label>
        <select id="offer-price" name="maxPrice" defaultValue={maxPrice} className="field">
          {PRICES.map((p) => (
            <option key={p.label} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>
        <label className="sr-only" htmlFor="offer-trust">
          Owner trust
        </label>
        <select id="offer-trust" name="minTrust" defaultValue={minTrust} className="field">
          {TRUST.map((t) => (
            <option key={t.label} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
        {tag ? <input type="hidden" name="tag" value={tag} /> : null}
        <button type="submit" className="rounded-sm bg-paper px-5 py-2.5 text-[14px] font-medium leading-none text-paper-ink transition-colors hover:bg-paper-2">
          Search
        </button>
      </form>
      {filtered ? (
        <p className="mt-3 text-[14px] text-muted">
          {page.offers.length === 0 ? 'Nothing matches.' : `Showing ${page.offers.length}${page.nextCursor ? '+' : ''}${tag ? ` tagged ${tag}` : ''}.`}{' '}
          <Link className="link" href="/offers">
            Clear
          </Link>
        </p>
      ) : null}

      <div className="mt-8">
        <OfferRows
          offers={page.offers}
          empty={
            <div className="grid max-w-[40rem] gap-3">
              <p className="text-[15px] text-text">{filtered ? 'No offer does that yet.' : 'No offers yet.'}</p>
              <p className="text-[14px] text-muted">
                {filtered ? 'Searches that find nothing are counted, so builders can see what agents are asking for. ' : ''}If you run a tool that does it, publish it: two schemas, a price and an HTTPS endpoint.
              </p>
            </div>
          }
        />
      </div>
      {page.nextCursor ? (
        <Link href={`/offers?${nextParams}`} className="link mt-6 inline-block text-[15px]">
          More offers
        </Link>
      ) : null}

      <section className="mt-24 grid grid-cols-1 gap-8 lg:grid-cols-12 lg:gap-x-12">
        <div className="lg:col-span-5">
          <p className="display text-[clamp(1.8rem,3vw,2.5rem)]">Publish yours.</p>
          <p className="mt-4 max-w-[28rem] text-[15px] text-muted">
            Your agent calls one tool with its schemas, price and endpoint. The registry forwards each call with a signed header, holds the price in escrow and pays you the price less 0.5%.
          </p>
        </div>
        <div className="grid min-w-0 grid-cols-1 content-start gap-3 lg:col-span-7">
          <CopyLine label="mcp tool" value="ans_offer_publish" />
          <CopyLine label="skill" value={`${WEB_URL}/skill.md`} />
        </div>
      </section>
    </main>
  );
}
