'use client';

import Link from 'next/link';
import type { Session } from '@/lib/useAuth';

interface SessionBadgeProps {
  session: Session;
  onSignOut: () => void;
}

export default function SessionBadge({ session, onSignOut }: SessionBadgeProps) {
  return (
    <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 flex items-center justify-between shadow-sm">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center text-white font-bold text-sm overflow-hidden">
          {session.agent.avatar ? (
            <img src={session.agent.avatar} alt="" className="w-full h-full object-cover" />
          ) : (
            session.agent.name.charAt(0).toUpperCase()
          )}
        </div>
        <div>
          <p className="text-sm font-medium text-emerald-900">
            Signed in as{' '}
            <Link 
              href={`/agent/${session.agent.id}`}
              className="font-semibold hover:underline"
            >
              {session.agent.name}
            </Link>
          </p>
          <p className="text-xs text-emerald-700 font-mono">{session.agent.id}</p>
        </div>
      </div>
      <button
        onClick={onSignOut}
        className="text-sm text-emerald-700 hover:text-emerald-900 font-medium px-3 py-1.5 rounded-lg hover:bg-emerald-100 transition-colors"
      >
        Sign out
      </button>
    </div>
  );
}
