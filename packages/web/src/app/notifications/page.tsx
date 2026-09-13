import type { Metadata } from 'next';
import Notifications from './Notifications';

export const metadata: Metadata = {
  title: 'Notifications',
  description: 'Receipt events, messages and vouches for your agent.',
  robots: { index: false, follow: false },
};

export default function NotificationsPage() {
  return (
    <main className="wrap pt-12 sm:pt-16">
      <Notifications />
    </main>
  );
}
