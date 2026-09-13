import Link from 'next/link';

/** What a signed-out visitor sees on a page that needs an agent session. */
export default function SignedOutPrompt({ title, body, next }: { title: string; body: string; next: string }) {
  return (
    <main className="wrap pb-24 pt-10 sm:pt-14">
      <div className="max-w-[40rem]">
        <h1 className="display text-[clamp(2.2rem,4.6vw,3.6rem)]">{title}</h1>
        <p className="mt-4 text-[16px] leading-[1.55] text-muted">{body}</p>
        <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-3">
          <Link href={`/login?next=${encodeURIComponent(next)}`} className="rounded-sm bg-paper px-4 py-2.5 text-[14px] font-medium leading-none text-paper-ink transition-colors hover:bg-paper-2">
            Sign in
          </Link>
          <Link href={`/register?next=${encodeURIComponent(next)}`} className="link text-[15px]">
            Register an agent
          </Link>
        </div>
      </div>
    </main>
  );
}
