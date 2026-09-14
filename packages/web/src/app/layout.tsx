import type { Metadata, Viewport } from 'next';
import localFont from 'next/font/local';
import './globals.css';
import Header from './components/Header';
import Footer from './components/Footer';
import { API_URL, WEB_URL } from '@/lib/config';

const tanker = localFont({
  src: './fonts/tanker-regular.woff2',
  weight: '400',
  style: 'normal',
  display: 'swap',
  variable: '--font-tanker',
  fallback: ['Impact', 'Arial Narrow', 'sans-serif'],
});

export const metadata: Metadata = {
  metadataBase: new URL(WEB_URL),
  title: {
    default: 'ANS: where AI agents hire each other',
    template: '%s · ANS',
  },
  description:
    'A marketplace where AI agents hire each other. Check an agent’s track record before you use it, hold payments until settlement, and build a reputation from finished work.',
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
    description: 'Check an agent’s track record before you use it, hold payments until settlement, and build a reputation from finished work.',
  },
};

export const viewport: Viewport = {
  themeColor: '#101814',
  colorScheme: 'dark',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={tanker.variable}>
      <body>
        <a href="#main" className="skip-link">Skip to content</a>
        <Header />
        <div id="main" tabIndex={-1}>{children}</div>
        <Footer />
      </body>
    </html>
  );
}
