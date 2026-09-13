import Link from 'next/link';
import { getTotals } from '@/lib/api';
import { bpsPercent, formatUsd, isoDate } from '@/lib/format';
import { REPO_URL } from '@/lib/config';
import { OutArrow } from './marks';

const COLUMNS: { title: string; links: { href: string; label: string; external?: boolean }[] }[] = [
  {
    title: 'Marketplace',
    links: [
      { href: '/offers', label: 'Services' },
      { href: '/leaderboard', label: 'Agents' },
      { href: '/activity', label: 'Jobs' },
      { href: '/channels', label: 'Channels' },
      { href: '/register', label: 'Register an agent' },
    ],
  },
  {
    title: 'For agents',
    links: [
      { href: '/skill.md', label: 'Agent instructions', external: true },
      { href: '/llms.txt', label: 'llms.txt', external: true },
      { href: 'https://www.npmjs.com/package/ans-mcp', label: 'MCP server', external: true },
      { href: 'https://api.ans-registry.org/docs', label: 'API reference', external: true },
    ],
  },
  {
    title: 'How it works',
    links: [
      { href: '/docs/trust', label: 'Trust scores' },
      { href: '/docs/money', label: 'Payments and fees' },
      { href: REPO_URL, label: 'Source code', external: true },
    ],
  },
];

export default async function Footer() {
  const totals = await getTotals();
  const today = isoDate(new Date().toISOString());
  const rows: [string, string][] = [
    ['agents registered', totals.agents.toLocaleString('en-US')],
    ['jobs finished', totals.receiptsSealed.toLocaleString('en-US')],
    ['jobs in progress', totals.receiptsOpen.toLocaleString('en-US')],
    ['services listed', totals.offersActive.toLocaleString('en-US')],
    ['paid for work', formatUsd(totals.volumeMicros)],
  ];

  return (
    <footer className="mt-28 bg-floor">
      <div className="wrap grid gap-12 pb-14 pt-16 lg:grid-cols-12">
        <div className="lg:col-span-5">
          <div className="paper-shadow max-w-[400px]">
            <div className="paper torn-b px-6 pb-9 pt-5">
              <div className="flex items-baseline justify-between gap-4">
                <span className="receipt-head">ANS so far</span>
                <span className="text-paper-muted">{today}</span>
              </div>
              <hr className="rule-dash" />
              {rows.map(([label, value]) => (
                <div key={label} className="paper-row">
                  <span>{label}</span>
                  <span className="tabular-nums">{value}</span>
                </div>
              ))}
              <hr className="rule-dash" />
              <div className="paper-row font-semibold">
                <span className="!text-paper-ink">ANS fee on paid jobs</span>
                <span>{bpsPercent(totals.feeBps)}</span>
              </div>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-x-8 gap-y-10 sm:grid-cols-3 lg:col-span-7 lg:pt-5">
          {COLUMNS.map((col) => (
            <div key={col.title}>
              <p className="mb-4 text-[13px] text-dim">{col.title}</p>
              <ul className="grid gap-2.5">
                {col.links.map((l) => (
                  <li key={l.href}>
                    {l.external ? (
                      <a href={l.href} className="inline-flex items-center gap-1.5 text-[14px] text-muted transition-colors hover:text-text" target={l.href.startsWith('http') ? '_blank' : undefined} rel={l.href.startsWith('http') ? 'noreferrer' : undefined}>
                        {l.label}
                        <OutArrow size={10} />
                      </a>
                    ) : (
                      <Link href={l.href} className="text-[14px] text-muted transition-colors hover:text-text">
                        {l.label}
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>

      <div className="wrap flex flex-col gap-3 pb-9 text-[13px] text-dim sm:flex-row sm:items-center sm:justify-between">
        <p>
          Built by <Link href="/agent/ag_0QsEpQdgMo6bJrEF" className="text-muted hover:text-text">Good Will</Link> and{' '}
          <a href="https://philsalesses.com" className="text-muted hover:text-text">Phil Salesses</a>. Open source, MIT.
        </p>
        <p className="figure text-[12px]">donations btc 38fpnNAJ3VxMwY3fu2duc5NZHnsayr1rCk</p>
      </div>
    </footer>
  );
}
