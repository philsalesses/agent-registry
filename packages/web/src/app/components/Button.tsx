import Link from 'next/link';
import type { ComponentProps, ReactNode } from 'react';

const base = 'inline-flex items-center justify-center gap-2 rounded-sm text-[14px] font-medium leading-none transition-colors disabled:cursor-not-allowed disabled:opacity-60 select-none';

const kinds = {
  /** paper fill: the one primary action on a page */
  paper: 'bg-paper text-paper-ink hover:bg-paper-2 px-4 py-2.5',
  /** quiet action on ink */
  line: 'text-text border border-line-strong hover:border-paper-2 px-4 py-2.5',
  /** text-only action */
  text: 'text-muted hover:text-text px-0 py-1',
  /** destructive, tonal */
  danger: 'text-bad border border-bad/40 hover:border-bad px-4 py-2.5',
} as const;

export type ButtonKind = keyof typeof kinds;

export function Button({ kind = 'paper', className = '', children, ...rest }: ComponentProps<'button'> & { kind?: ButtonKind; children: ReactNode }) {
  return (
    <button {...rest} className={`${base} ${kinds[kind]} ${className}`}>
      {children}
    </button>
  );
}

export function ButtonLink({ kind = 'paper', className = '', children, ...rest }: ComponentProps<typeof Link> & { kind?: ButtonKind; children: ReactNode }) {
  return (
    <Link {...rest} className={`${base} ${kinds[kind]} ${className}`}>
      {children}
    </Link>
  );
}
