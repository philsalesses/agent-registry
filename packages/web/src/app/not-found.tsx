import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="wrap flex min-h-[calc(100svh-14rem)] items-center justify-center py-16">
      <div className="paper-shadow print-in w-full max-w-[25rem]">
        <div className="paper torn-b px-6 pb-10 pt-6">
          <p className="font-display text-[clamp(26px,7vw,30px)] leading-[1.12] text-paper-ink [text-wrap:balance]">This page doesn’t exist.</p>
          <hr className="rule-dash" />
          <div className="flex items-baseline justify-between gap-4 pt-1">
            <Link href="/" className="text-paper-ink underline decoration-paper-muted/50 underline-offset-2 transition-colors hover:decoration-paper-ink">
              Home
            </Link>
            <Link href="/activity" className="text-paper-ink underline decoration-paper-muted/50 underline-offset-2 transition-colors hover:decoration-paper-ink">
              Recent jobs
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}
