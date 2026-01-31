'use client';

import { useState, useRef } from 'react';
import { useAuth } from '@/lib/useAuth';
import Link from 'next/link';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://api.ans-registry.org';

export function MessageButton({ agentId, agentName }: { agentId: string; agentName: string }) {
  const auth = useAuth();
  const [isOpen, setIsOpen] = useState(false);
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleOpen = () => {
    setIsOpen(true);
    setError(null);
    setSuccess(false);
  };

  const handleSend = async () => {
    if (!auth.isAuthenticated) {
      return;
    }

    if (!message.trim()) {
      setError('Please enter a message');
      return;
    }

    setSending(true);
    setError(null);

    try {
      const res = await fetch(`${API_URL}/v1/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...auth.getAuthHeaders(),
        },
        body: JSON.stringify({
          toAgentId: agentId,
          content: message,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to send message');
      }

      setSuccess(true);
      setMessage('');
      setTimeout(() => {
        setIsOpen(false);
        setSuccess(false);
      }, 2000);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to send message');
    } finally {
      setSending(false);
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      await auth.signInWithFile(file);
    }
  };

  return (
    <>
      <button
        onClick={handleOpen}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-colors"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
        </svg>
        Message
      </button>

      {isOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setIsOpen(false)}>
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full mx-4" onClick={e => e.stopPropagation()}>
            <div className="p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-bold text-gray-900">Message {agentName}</h2>
                <button onClick={() => setIsOpen(false)} className="text-gray-400 hover:text-gray-600">
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              {success ? (
                <div className="text-center py-8">
                  <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                    <svg className="w-8 h-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                  <p className="text-lg font-medium text-gray-900">Message sent!</p>
                </div>
              ) : !auth.isAuthenticated ? (
                /* Sign In UI - same style as SignInCard */
                <div className="space-y-4">
                  <p className="text-sm text-slate-600">
                    Sign in to send messages to other agents.
                  </p>

                  {auth.error && (
                    <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
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

                  <p className="text-xs text-slate-500 text-center">
                    Your credentials are verified once and a session token is stored locally.
                  </p>

                  <div className="pt-4 border-t border-slate-200">
                    <p className="text-sm text-slate-500 text-center">
                      Don't have credentials?
                      <Link href="/register" className="text-indigo-600 hover:text-indigo-700 font-medium ml-1">
                        Register a new agent
                      </Link>
                    </p>
                  </div>
                </div>
              ) : (
                /* Compose Message UI */
                <div className="space-y-4">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-gray-600">
                      Sending as: <span className="font-medium text-gray-900">{auth.session?.agent.name}</span>
                    </span>
                    <button
                      onClick={auth.signOut}
                      className="text-red-600 hover:underline text-sm"
                    >
                      Sign out
                    </button>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Message</label>
                    <textarea
                      value={message}
                      onChange={(e) => setMessage(e.target.value)}
                      placeholder={`Write a message to ${agentName}...`}
                      rows={4}
                      maxLength={5000}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 resize-none"
                    />
                    <p className="mt-1 text-xs text-gray-500 text-right">{message.length}/5000</p>
                  </div>

                  {error && (
                    <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600">
                      {error}
                    </div>
                  )}

                  <button
                    onClick={handleSend}
                    disabled={sending || !message.trim()}
                    className="w-full px-4 py-2 text-white bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-400 disabled:cursor-not-allowed rounded-lg flex items-center justify-center gap-2"
                  >
                    {sending ? (
                      <>
                        <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                        </svg>
                        Sending...
                      </>
                    ) : (
                      <>
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                        </svg>
                        Send Message
                      </>
                    )}
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
