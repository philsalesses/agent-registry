import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { WireOfferSummary } from '@/vendor/ans-core';
import { getOffer, tryApi } from '@/lib/api';
import { API_URL } from '@/lib/config';
import { bpsPercent, confidenceLabel, isoDate, plural, priceLabel, shortHash, timeAgo, FEE_BPS } from '@/lib/format';
import CopyLine from '../../../components/CopyLine';
import { SealMark, OpenMark } from '../../../components/marks';
import { offerLabel, offerPath } from '../../../components/OfferRows';
import TryOffer from './TryOffer';

export const revalidate = 30;

type Props = { params: Promise<{ handle: string; slug: string }> };

type JsonSchema = {
  type?: string | string[];
  description?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  enum?: unknown[];
  format?: string;
  anyOf?: JsonSchema[];
  oneOf?: JsonSchema[];
  maxLength?: number;
  maximum?: number;
  minimum?: number;
};

function clean(v: string): string {
  return decodeURIComponent(v).replace(/^@/, '');
}

function typeOf(s: JsonSchema | undefined): string {
  if (!s) return 'any';
  if (s.enum) return s.enum.map((e) => JSON.stringify(e)).join(' | ');
  if (s.anyOf || s.oneOf) return (s.anyOf ?? s.oneOf ?? []).map(typeOf).join(' | ');
  const t = Array.isArray(s.type) ? s.type.join(' | ') : s.type;
  if (t === 'array') return `${typeOf(s.items)}[]`;
  if (!t) return 'any';
  return s.format ? `${t} (${s.format})` : t;
}

function Fields({ schema }: { schema: Record<string, unknown> }) {
  const s = schema as JsonSchema;
  const props = Object.entries(s.properties ?? {});
  const required = new Set(s.required ?? []);
  props.sort((a, b) => Number(required.has(b[0])) - Number(required.has(a[0])));
  if (props.length === 0) return <p className="px-4 py-4 text-[14px] text-muted">{typeOf(s)}</p>;
  return (
    <ul className="grid">
      {props.map(([key, p]) => (
        <li key={key} className="grid grid-cols-1 gap-x-6 gap-y-0.5 px-4 py-3 sm:grid-cols-[minmax(0,11rem)_minmax(0,9rem)_minmax(0,1fr)]">
          <span className="figure truncate text-[14px] text-text" title={key}>
            {key}
          </span>
          <span className="figure truncate text-[13px] text-muted" title={typeOf(p)}>
            {typeOf(p)}
            {required.has(key) ? '' : <span className="text-dim">, optional</span>}
          </span>
          <span className="text-[14px] text-muted">{p.description ?? ''}</span>
        </li>
      ))}
    </ul>
  );
}

function SchemaBlock({ title, schema, url }: { title: string; schema: Record<string, unknown>; url: string }) {
  return (
    <section className="grid gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
        <h2 className="text-[15px] font-medium text-text">{title}</h2>
        <a className="link text-[13px]" href={url}>
          full JSON Schema
        </a>
      </div>
      <div className="panel overflow-hidden">
        <Fields schema={schema} />
      </div>
    </section>
  );
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { handle, slug } = await params;
  const offer = await getOffer(clean(handle), clean(slug));
  if (!offer) return { title: 'Offer not found', robots: { index: false } };
  const title = `${offer.title} (${offerLabel(offer.name)})`;
  const description = `${priceLabel(offer.priceMicros)} per job. You send ${offer.inputFields.join(', ') || 'nothing'} and get back ${offer.outputFields.join(', ') || 'nothing'}. ${offer.description}`.slice(0, 200);
  return { title, description, alternates: { canonical: offerPath(offer.name) }, openGraph: { title, description, url: offerPath(offer.name) } };
}

export default async function OfferPage({ params }: Props) {
  const { handle, slug } = await params;
  const offer = await getOffer(clean(handle), clean(slug));
  if (!offer) notFound();
  const composes = await tryApi<{ feeds: (WireOfferSummary & { via?: string[] })[]; fedBy: (WireOfferSummary & { via?: string[] })[] }>(
    `/v1/offers/${encodeURIComponent(offer.id)}/composes-with`,
    60,
  );

  const label = offerLabel(offer.name);
  const owner = offer.owner;
  const ownerKey = owner.handle ?? owner.id;
  const example = offer.examples?.[0];
  const paused = offer.status !== 'active';
  const okRate = offer.stats.calls > 0 ? Math.round((offer.stats.ok / offer.stats.calls) * 100) : null;
  const Mark = offer.probeOk ? SealMark : OpenMark;
  const invokeBody = JSON.stringify({ offer: label, input: example?.input ?? {} });
  const feeds = composes?.feeds ?? [];
  const fedBy = composes?.fedBy ?? [];

  return (
    <main className="wrap pb-24 pt-10 sm:pt-14">
      <div className="grid grid-cols-1 gap-12 lg:grid-cols-12 lg:gap-x-12">
        <div className="grid min-w-0 grid-cols-1 content-start gap-12 lg:col-span-8">
          <header>
            <h1 className="display text-[clamp(2.2rem,4.4vw,3.5rem)]">{offer.title}</h1>
            <p className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-[15px] text-muted">
              <span className="figure text-text">{label}</span>
              <span>version {offer.version}</span>
              <span>
                sold by{' '}
                <Link className="link" href={`/agent/${ownerKey}`}>
                  {owner.handle ? `@${owner.handle}` : owner.name}
                </Link>
                {owner.isHouse ? ', a free service run by ANS' : ''}
              </span>
              {paused ? <span className="text-wait">{offer.status}</span> : null}
            </p>
            {offer.description ? <p className="mt-5 max-w-[42rem] text-[17px] leading-[1.55] text-text">{offer.description}</p> : null}
            <p className="mt-4 max-w-[42rem] text-[15px] leading-[1.55] text-muted">
              Your agent sends the input described below and gets back the output described below. If the result doesn’t match that format, or the call fails, the payment is refunded.
            </p>
          </header>

          <SchemaBlock title="What you send" schema={offer.inputSchema} url={offer.urls.inputSchema} />
          <SchemaBlock title="What you get back" schema={offer.outputSchema} url={offer.urls.outputSchema} />

          {example ? (
            <section className="grid gap-3">
              <h2 className="text-[15px] font-medium text-text">An example</h2>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <div className="flex min-w-0 flex-col">
                  <p className="mb-1.5 text-[12px] text-dim">you send</p>
                  <pre className="figure max-h-[340px] flex-1 overflow-auto whitespace-pre-wrap [overflow-wrap:anywhere] rounded-sm border border-ink-3 bg-floor p-3 text-[12px] leading-[1.55] text-text">{JSON.stringify(example.input, null, 2)}</pre>
                </div>
                <div className="flex min-w-0 flex-col">
                  <p className="mb-1.5 text-[12px] text-dim">you get back</p>
                  <pre className="figure max-h-[340px] flex-1 overflow-auto whitespace-pre-wrap [overflow-wrap:anywhere] rounded-sm border border-ink-3 bg-floor p-3 text-[12px] leading-[1.55] text-text">{JSON.stringify(example.output, null, 2)}</pre>
                </div>
              </div>
            </section>
          ) : null}

          <section className="grid grid-cols-1 gap-3">
            <h2 className="text-[15px] font-medium text-text">How your agent uses it</h2>
            <p className="max-w-[40rem] text-[14px] leading-[1.55] text-muted">Add it to any MCP client as a single tool, or call it over HTTP with an API key. Either way, ANS checks the input, holds the payment, checks the result against the format above and records the job.</p>
            <CopyLine label="claude code" value={`claude mcp add --transport http ${offer.slug} ${offer.urls.mcp}`} />
            <CopyLine label="http" value={`curl -X POST ${API_URL}/v1/invoke -H "Authorization: Bearer $ANS_API_KEY" -H "Content-Type: application/json" -d '${invokeBody}'`} />
            <CopyLine label="instructions" value={offer.urls.skill} />
          </section>

          <section className="grid gap-3">
            <h2 className="text-[15px] font-medium text-text">Try it now</h2>
            <TryOffer name={label} example={example?.input ?? {}} priceMicros={offer.priceMicros} paused={paused} />
          </section>

          {feeds.length > 0 || fedBy.length > 0 ? (
            <section className="grid gap-3">
              <h2 className="text-[15px] font-medium text-text">Works well with</h2>
              <p className="max-w-[40rem] text-[14px] text-muted">Services whose output can feed this one, or that can take this one’s output, based on their formats.</p>
              <ul className="grid gap-2 text-[14px]">
                {feeds.map((o) => (
                  <li key={`f-${o.id}`} className="flex flex-wrap gap-x-3">
                    <span className="text-muted">send the result to</span>
                    <Link className="link figure" href={offerPath(o.name)}>
                      {offerLabel(o.name)}
                    </Link>
                    <span className="text-dim">{o.title}</span>
                  </li>
                ))}
                {fedBy.map((o) => (
                  <li key={`b-${o.id}`} className="flex flex-wrap gap-x-3">
                    <span className="text-muted">get input from</span>
                    <Link className="link figure" href={offerPath(o.name)}>
                      {offerLabel(o.name)}
                    </Link>
                    <span className="text-dim">{o.title}</span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>

        <aside className="grid min-w-0 content-start justify-items-center gap-6 lg:col-span-4 lg:justify-items-stretch">
          <div className="paper-shadow w-full max-w-[360px] lg:sticky lg:top-24 lg:ml-auto">
            <div className="paper torn-b px-6 pb-10 pt-5">
              <div className="flex items-center justify-between gap-4">
                <span className="receipt-head">ANS service</span>
                <Mark size={18} className={offer.probeOk ? 'text-paper-ink' : 'text-paper-muted'} title={offer.probeOk ? 'health check passed' : 'not checked yet'} />
              </div>
              <div className="paper-row mt-1">
                <span className="!text-paper-ink">{label}</span>
                <span>v{offer.version}</span>
              </div>
              <hr className="rule-dash" />
              <div className="paper-row">
                <span>price</span>
                <span className="!text-paper-ink font-semibold">{priceLabel(offer.priceMicros)}</span>
              </div>
              {offer.priceMicros !== '0' ? (
                <div className="paper-row">
                  <span>ANS fee</span>
                  <span>{bpsPercent(FEE_BPS)}, paid by the seller</span>
                </div>
              ) : null}
              <div className="paper-row">
                <span>test credit</span>
                <span>{offer.acceptsSandbox ? 'accepted' : 'not accepted'}</span>
              </div>
              <div className="paper-row">
                <span>time limit</span>
                <span>{(offer.timeoutMs / 1000).toFixed(offer.timeoutMs % 1000 ? 1 : 0)} s</span>
              </div>
              <hr className="rule-dash" />
              <div className="paper-row">
                <span>times used</span>
                <span>{offer.stats.calls}</span>
              </div>
              <div className="paper-row">
                <span>worked</span>
                <span>{okRate === null ? 'not used yet' : `${okRate}%`}</span>
              </div>
              <div className="paper-row">
                <span>wrong-format results</span>
                <span className={offer.stats.outputInvalid > 0 ? '!text-paper-bad' : ''}>{offer.stats.outputInvalid}</span>
              </div>
              <div className="paper-row">
                <span>typical response</span>
                <span>{offer.stats.p50Ms === null ? 'no data yet' : `${offer.stats.p50Ms} ms`}</span>
              </div>
              <div className="paper-row">
                <span>last used</span>
                <span>{offer.stats.lastCalledAt ? timeAgo(offer.stats.lastCalledAt) : 'never'}</span>
              </div>
              <hr className="rule-dash" />
              <div className="paper-row">
                <span>seller’s trust</span>
                <span>{owner.isHouse ? 'run by ANS' : `${owner.trust.score} · confidence ${confidenceLabel(owner.trust.confidence)}`}</span>
              </div>
              <div className="paper-row">
                <span>health check</span>
                <span>{offer.probedAt ? `${offer.probeOk ? 'passed' : 'failed'} ${isoDate(offer.probedAt)}` : 'not checked yet'}</span>
              </div>
              <div className="paper-row">
                <span>input format</span>
                <span title={offer.inputSchemaHash}>{shortHash(offer.inputSchemaHash, 6, 4)}</span>
              </div>
              <div className="paper-row">
                <span>output format</span>
                <span title={offer.outputSchemaHash}>{shortHash(offer.outputSchemaHash, 6, 4)}</span>
              </div>
              <div className="paper-row">
                <span>listed</span>
                <span>{isoDate(offer.createdAt)}</span>
              </div>
            </div>
          </div>
          <p className="w-full max-w-[360px] text-[13px] text-dim lg:ml-auto">
            Used {plural(offer.stats.calls, 'time')} so far. Every use is a job on {owner.handle ? `@${owner.handle}` : 'the seller'}’s public record.
          </p>
        </aside>
      </div>
    </main>
  );
}
