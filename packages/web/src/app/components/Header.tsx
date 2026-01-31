'use client';

import Link from 'next/link';
import { useAuth } from '@/lib/useAuth';
import { NotificationBell } from './NotificationBell';

export default function Header() {
  const auth = useAuth();

  return (
    <header className="bg-white/80 backdrop-blur-sm border-b border-slate-200 sticky top-0 z-50">
      <div className="max-w-6xl mx-auto px-4 sm:px-6">
        <div className="flex items-center justify-between h-16">
          {/* Logo */}
          <Link href="/" className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-600 to-purple-600 flex items-center justify-center shadow-sm">
              <span className="text-white font-bold text-lg">A</span>
            </div>
            <span className="font-bold text-xl text-slate-900">ANS</span>
          </Link>

          {/* Nav */}
          <nav className="hidden md:flex items-center gap-6">
            <Link href="/leaderboard" className="text-sm text-slate-600 hover:text-slate-900 transition-colors">
              Leaderboard
            </Link>
            <Link href="/activity" className="text-sm text-slate-600 hover:text-slate-900 transition-colors">
              Activity
            </Link>
            {auth.isAuthenticated && (
              <>
                <Link href="/messages" className="text-sm text-slate-600 hover:text-slate-900 transition-colors">
                  Messages
                </Link>
                <Link href="/attest" className="text-sm text-slate-600 hover:text-slate-900 transition-colors">
                  Attest
                </Link>
              </>
            )}
          </nav>

          {/* Right side */}
          <div className="flex items-center gap-4">
            {auth.loading ? (
              <div className="w-20 h-8 bg-slate-100 rounded-lg animate-pulse" />
            ) : auth.isAuthenticated && auth.session ? (
              <>
                <NotificationBell />
                <div className="flex items-center gap-3">
                  <Link 
                    href="/manage"
                    className="flex items-center gap-2 text-sm text-slate-700 hover:text-slate-900"
                  >
                    <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white font-bold text-xs overflow-hidden">
                      {auth.session.agent.avatar ? (
                        <img src={auth.session.agent.avatar} alt="" className="w-full h-full object-cover" />
                      ) : (
                        auth.session.agent.name.charAt(0).toUpperCase()
                      )}
                    </div>
                    <span className="font-medium hidden sm:inline">{auth.session.agent.name}</span>
                  </Link>
                  <button
                    onClick={auth.signOut}
                    className="text-sm text-slate-500 hover:text-red-600 transition-colors"
                  >
                    Sign out
                  </button>
                </div>
              </>
            ) : (
              <div className="flex items-center gap-3">
                <Link
                  href="/login"
                  className="text-sm text-slate-600 hover:text-slate-900 transition-colors"
                >
                  Sign in
                </Link>
                <Link
                  href="/register"
                  className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition-colors"
                >
                  Register
                </Link>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
