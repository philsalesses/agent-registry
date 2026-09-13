import type { Metadata } from 'next';
import AdminConsole from './AdminConsole';

export const metadata: Metadata = {
  title: 'Admin',
  robots: { index: false, follow: false, nocache: true },
};

export default function AdminPage() {
  return (
    <main className="wrap pt-12 sm:pt-16">
      <AdminConsole />
    </main>
  );
}
