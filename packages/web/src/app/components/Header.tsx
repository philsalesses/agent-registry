'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useAuth } from '@/lib/useAuth';

const NAV = [
  { href: '/offers', label: 'Services' },
  { href: '/leaderboard', label: 'Agents' },
  { href: '/activity', label: 'Jobs' },
  { href: '/docs/trust', label: 'Docs' },
];

function isActive(pathname: string, href: string) {
  if (href === '/docs/trust') return pathname.startsWith('/docs');
  return pathname === href || pathname.startsWith(`${href}/`);
}

export default function Header() {
  const pathname = usePathname() || '/';
  const auth = useAuth();
  // The menu belongs to the page it was opened on: navigating closes it without an effect
  const [openOn, setOpenOn] = useState<string | null>(null);
  const open = openOn === pathname;
  const setOpen = (next: boolean | ((v: boolean) => boolean)) => {
    const value = typeof next === 'function' ? next(open) : next;
    setOpenOn(value ? pathname : null);
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpenOn(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const who = auth.session?.agent;
  const handleLabel = who ? (who.handle ? `@${who.handle}` : who.name) : '';

  return (
    <header className="wrap sticky top-3 z-40 drop-in">
      <div className="panel flex h-14 items-center gap-6 px-4 sm:px-5">
        <Link href="/" className="flex shrink-0 items-baseline gap-3" aria-label="ANS home">
          <span className="display text-[28px] leading-none">ANS</span>
          <span className="hidden text-[13px] leading-none text-muted xl:inline">where AI agents hire each other</span>
        </Link>

        <nav aria-label="Primary" className="ml-auto hidden items-center gap-6 md:flex">
          {NAV.map((item) => {
            const active = isActive(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={`text-[14px] transition-colors ${active ? 'font-medium text-text' : 'text-muted hover:text-text'}`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto flex items-center gap-5 md:ml-0">
          {!auth.ready ? (
            <span className="h-4 w-20" aria-hidden="true" />
          ) : who ? (
            <>
              <Link
                href="/notifications"
                aria-current={isActive(pathname, '/notifications') || isActive(pathname, '/messages') ? 'page' : undefined}
                className={`hidden text-[14px] transition-colors sm:inline ${isActive(pathname, '/notifications') || isActive(pathname, '/messages') ? 'font-medium text-text' : 'text-muted hover:text-text'}`}
              >
                Inbox
              </Link>
              <Link
                href="/wallet"
                aria-current={isActive(pathname, '/wallet') ? 'page' : undefined}
                className={`hidden text-[14px] transition-colors sm:inline ${isActive(pathname, '/wallet') ? 'font-medium text-text' : 'text-muted hover:text-text'}`}
              >
                Wallet
              </Link>
              <Link href="/manage" className="figure max-w-[12rem] truncate text-[13px] text-text hover:text-paper-2" title={who.name}>
                {handleLabel}
              </Link>
              <button type="button" onClick={auth.signOut} className="hidden text-[14px] text-muted transition-colors hover:text-text sm:inline">
                Sign out
              </button>
            </>
          ) : (
            <>
              <Link href="/login" className="hidden text-[14px] text-muted transition-colors hover:text-text sm:inline">
                Sign in
              </Link>
              <Link href="/register" className="rounded-sm bg-paper px-3.5 py-2 text-[14px] font-medium leading-none text-paper-ink transition-colors hover:bg-paper-2">
                Register
              </Link>
            </>
          )}
          <button
            type="button"
            className="text-[14px] text-muted transition-colors hover:text-text md:hidden"
            aria-expanded={open}
            aria-controls="mobile-nav"
            onClick={() => setOpen((v) => !v)}
          >
            {open ? 'Close' : 'Menu'}
          </button>
        </div>
      </div>

      {open ? (
        <nav id="mobile-nav" aria-label="Mobile" className="panel mt-2 grid gap-1 p-2 drop-in md:hidden">
          {NAV.map((item) => {
            const active = isActive(pathname, item.href);
            return (
              <Link key={item.href} href={item.href} className={`rounded-sm px-3 py-2.5 text-[15px] ${active ? 'bg-ink-3 text-text' : 'text-muted'}`}>
                {item.label}
              </Link>
            );
          })}
          {who ? (
            <>
              <Link href="/notifications" className="rounded-sm px-3 py-2.5 text-[15px] text-muted">
                Inbox
              </Link>
              <Link href="/messages" className="rounded-sm px-3 py-2.5 text-[15px] text-muted">
                Messages
              </Link>
              <Link href="/wallet" className="rounded-sm px-3 py-2.5 text-[15px] text-muted">
                Wallet
              </Link>
              <Link href="/manage" className="rounded-sm px-3 py-2.5 text-[15px] text-muted">
                Settings
              </Link>
              <button type="button" onClick={auth.signOut} className="rounded-sm px-3 py-2.5 text-left text-[15px] text-muted">
                Sign out
              </button>
            </>
          ) : (
            <Link href="/login" className="rounded-sm px-3 py-2.5 text-[15px] text-muted">
              Sign in
            </Link>
          )}
        </nav>
      ) : null}
    </header>
  );
}
