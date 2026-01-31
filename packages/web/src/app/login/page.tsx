'use client';

import { useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/lib/useAuth';
import Header from '@/app/components/Header';

export default function LoginPage() {
  const auth = useAuth();
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Redirect if already logged in
  useEffect(() => {
    if (auth.isAuthenticated) {
      router.push('/manage');
    }
  }, [auth.isAuthenticated, router]);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const success = await auth.signInWithFile(file);
      if (success) {
        router.push('/manage');
      }
    }
  };

  if (auth.loading) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white">
        <Header />
        <div className="flex items-center justify-center py-32">
          <p className="text-slate-500">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white">
      <Header />

      <main className="max-w-md mx-auto px-4 py-16">
        <div className="text-center mb-8">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-indigo-600 to-purple-600 flex items-center justify-center text-white text-2xl mx-auto mb-4 shadow-lg">
            🔐
          </div>
          <h1 className="text-2xl font-bold text-slate-900">Sign in to ANS</h1>
          <p className="text-slate-600 mt-2">Upload your credentials file to access your agent</p>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
          {auth.error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
              {auth.error}
            </div>
          )}

          <input
            ref={fileInputRef}
            type="file"
            accept=".json"
            onChange={handleFileChange}
            className="hidden"
          />

          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={auth.loading}
            className="w-full px-4 py-6 border-2 border-dashed border-slate-300 rounded-xl text-slate-600 hover:border-indigo-400 hover:text-indigo-600 hover:bg-indigo-50/50 transition-colors disabled:opacity-50"
          >
            <div className="flex flex-col items-center">
              <svg className="h-10 w-10 text-slate-400 mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
              </svg>
              <span className="font-medium text-lg">
                {auth.loading ? 'Signing in...' : 'Upload credentials file'}
              </span>
              <span className="text-sm text-slate-500 mt-1">*-credentials.json</span>
            </div>
          </button>

          <p className="mt-4 text-xs text-slate-500 text-center">
            Your private key is used once to create a session token, then discarded.
            The session keeps you logged in across all ANS features.
          </p>
        </div>

        <div className="mt-8 text-center">
          <p className="text-slate-600">
            Don't have an agent yet?{' '}
            <Link href="/register" className="text-indigo-600 hover:text-indigo-700 font-medium">
              Register one
            </Link>
          </p>
        </div>

        {/* How it works */}
        <div className="mt-12 bg-slate-50 rounded-xl p-6 border border-slate-200">
          <h3 className="font-semibold text-slate-900 mb-4">How credentials work</h3>
          <ol className="space-y-3 text-sm text-slate-600">
            <li className="flex gap-3">
              <span className="w-6 h-6 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center text-xs font-bold shrink-0">1</span>
              <span>When you register, you download a credentials file containing your agent ID and private key.</span>
            </li>
            <li className="flex gap-3">
              <span className="w-6 h-6 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center text-xs font-bold shrink-0">2</span>
              <span>To sign in, upload that file. We verify your key and create a session token.</span>
            </li>
            <li className="flex gap-3">
              <span className="w-6 h-6 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center text-xs font-bold shrink-0">3</span>
              <span>The token is stored in your browser. You stay logged in until you sign out.</span>
            </li>
          </ol>
        </div>
      </main>
    </div>
  );
}
