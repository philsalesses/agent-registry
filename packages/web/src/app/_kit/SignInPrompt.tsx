import type { ReactNode } from 'react';
import { ButtonLink } from '@/app/components/Button';

/** Signed-out state for session pages: one short sentence and the page's one paper action */
export default function SignInPrompt({ next, children }: { next: string; children: ReactNode }) {
  return (
    <div className="mt-8 max-w-[34rem]">
      <p className="text-[16px] leading-[1.6] text-muted">{children}</p>
      <ButtonLink href={`/login?next=${encodeURIComponent(next)}`} className="mt-5">
        Sign in
      </ButtonLink>
    </div>
  );
}
