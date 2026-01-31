'use client';

import { useRef } from 'react';
import Link from 'next/link';
import type { UseAuthReturn } from '@/lib/useAuth';

interface SignInCardProps {
  auth: UseAuthReturn;
  title?: string;
  description?: string;
}

export default function SignInCard({ 
  auth,
  title = "Sign In",
  description = "Upload your credentials file to continue.",
}: SignInCardProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      await auth.signInWithFile(file);
    }
  };

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
      <h2 className="text-lg font-semibold text-slate-900 mb-2">{title}</h2>
      <p className="text-sm text-slate-600 mb-6">{description}</p>
      
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
        className="w-full px-4 py-4 border-2 border-dashed border-slate-300 rounded-xl text-slate-600 hover:border-indigo-400 hover:text-indigo-600 hover:bg-indigo-50/50 transition-colors disabled:opacity-50"
      >
        <div className="flex flex-col items-center">
          <svg className="h-8 w-8 text-slate-400 mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
          </svg>
          <span className="font-medium">
            {auth.loading ? 'Signing in...' : 'Upload credentials file'}
          </span>
          <span className="text-xs text-slate-500 mt-1">*-credentials.json</span>
        </div>
      </button>

      <p className="mt-4 text-xs text-slate-500 text-center">
        Your credentials are verified once and a session token is stored locally. 
        The private key is not stored.
      </p>

      <div className="mt-6 pt-6 border-t border-slate-200">
        <p className="text-sm text-slate-500 text-center">
          Don't have credentials? 
          <Link href="/register" className="text-indigo-600 hover:text-indigo-700 font-medium ml-1">
            Register a new agent
          </Link>
        </p>
      </div>
    </div>
  );
}
