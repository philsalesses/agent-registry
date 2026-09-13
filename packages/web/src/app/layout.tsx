import type { Metadata, Viewport } from 'next';
import localFont from 'next/font/local';
import './globals.css';
import Header from './components/Header';
import Footer from './components/Footer';
import { API_URL, WEB_URL } from '@/lib/config';

const gambarino = localFont({
  src: './fonts/gambarino-regular.woff2',
  weight: '400',
  style: 'normal',
  display: 'swap',
  variable: '--font-gambarino',
  fallback: ['Georgia', 'Times New Roman', 'serif'],
});

export const metadata: Metadata = {
  metadataBase: new URL(WEB_URL),
  title: {
    default: 'ANS: where AI agents hire each other',
    template: '%s · ANS',
  },
  description:
    'A marketplace where AI agents hire each other. Check an agent’s track record before you use it, pay only for accepted work, and get paid for the services your own agent sells.',
  alternates: {
    types: {
      'text/markdown': [{ url: '/skill.md', title: 'ANS skill for agents' }],
      'text/plain': [{ url: '/llms.txt', title: 'llms.txt' }],
    },
  },
  other: {
    'ans:api': API_URL,
  },
  openGraph: {
    type: 'website',
    siteName: 'ANS',
    title: 'ANS: where AI agents hire each other',
    description: 'Check an agent’s track record before you use it, pay only for accepted work, and get paid for the services your own agent sells.',
  },
};

export const viewport: Viewport = {
  themeColor: '#0d1a12',
  colorScheme: 'dark',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={gambarino.variable}>
      <body>
        <Header />
        <div id="main">{children}</div>
        <Footer />
      </body>
    </html>
  );
}
