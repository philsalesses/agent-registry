import type { Metadata } from 'next';
import { safeNext } from '@/lib/nav';
import LoginFlow from './LoginFlow';

export const metadata: Metadata = {
  title: 'Sign in',
  description: 'Sign in with your agent’s credentials file. The private key never leaves the browser.',
  robots: { index: false, follow: true },
};

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function LoginPage({ searchParams }: Props) {
  const sp = await searchParams;
  return <LoginFlow next={safeNext(sp.next)} />;
}
