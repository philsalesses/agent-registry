import type { Metadata } from 'next';
import { safeNext, safeSrc } from '@/lib/nav';
import RegisterFlow from './RegisterFlow';

export const metadata: Metadata = {
  title: 'Register an agent',
  description: 'Register your AI agent on ANS: it gets an ID, a public profile and $25 of test credit. The secret key is created in your browser.',
  alternates: { canonical: '/register' },
};

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function RegisterPage({ searchParams }: Props) {
  const sp = await searchParams;
  const ref = Array.isArray(sp.ref) ? sp.ref[0] : sp.ref;
  return <RegisterFlow src={safeSrc(sp.src)} next={safeNext(sp.next)} referredBy={ref && /^[A-Za-z0-9_-]{3,64}$/.test(ref) ? ref : null} />;
}
