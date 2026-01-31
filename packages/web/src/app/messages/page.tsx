'use client';

import Link from 'next/link';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/useAuth';
import Header from '@/app/components/Header';
import AgentSearch from '@/app/components/AgentSearch';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://api.ans-registry.org';

interface Message {
  id: string;
  fromAgentId: string;
  fromAgentName?: string;
  toAgentId: string;
  toAgentName?: string;
  content: string;
  createdAt: string;
  readAt?: string;
}

interface Agent {
  id: string;
  name: string;
  type: string;
  description?: string;
  avatar?: string;
}

export default function MessagesPage() {
  const auth = useAuth();
  const router = useRouter();
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const [view, setView] = useState<'inbox' | 'sent' | 'compose'>('inbox');
  const [selectedMessage, setSelectedMessage] = useState<Message | null>(null);
  const [replyContent, setReplyContent] = useState('');
  const [sending, setSending] = useState(false);
  
  // Compose state
  const [composeRecipient, setComposeRecipient] = useState<Agent | null>(null);
  const [composeContent, setComposeContent] = useState('');
  const [composeSending, setComposeSending] = useState(false);
  const [composeError, setComposeError] = useState('');
  const [composeSuccess, setComposeSuccess] = useState(false);

  // Redirect if not authenticated
  useEffect(() => {
    if (!auth.loading && !auth.isAuthenticated) {
      router.push('/login');
    }
  }, [auth.loading, auth.isAuthenticated, router]);

  useEffect(() => {
    if (auth.isAuthenticated && view !== 'compose') {
      fetchMessages();
    }
  }, [auth.isAuthenticated, view]);

  const fetchMessages = async () => {
    if (!auth.session) return;
    
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/v1/messages?view=${view}&limit=50`, {
        headers: auth.getAuthHeaders(),
      });
      if (res.ok) {
        const data = await res.json();
        setMessages(data.messages);
      }
    } catch (e) {
      console.error('Failed to fetch messages:', e);
    } finally {
      setLoading(false);
    }
  };

  const handleReply = async () => {
    if (!auth.session || !selectedMessage || !replyContent.trim()) return;
    
    setSending(true);
    try {
      const toAgentId = selectedMessage.fromAgentId === auth.session.agent.id 
        ? selectedMessage.toAgentId 
        : selectedMessage.fromAgentId;

      const res = await fetch(`${API_URL}/v1/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...auth.getAuthHeaders(),
        },
        body: JSON.stringify({
          toAgentId,
          content: replyContent,
        }),
      });

      if (res.ok) {
        setReplyContent('');
        fetchMessages();
      }
    } catch (e) {
      console.error('Failed to send reply:', e);
    } finally {
      setSending(false);
    }
  };

  const handleCompose = async () => {
    if (!auth.session || !composeRecipient || !composeContent.trim()) return;
    
    setComposeSending(true);
    setComposeError('');
    try {
      const res = await fetch(`${API_URL}/v1/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...auth.getAuthHeaders(),
        },
        body: JSON.stringify({
          toAgentId: composeRecipient.id,
          content: composeContent,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to send message');
      }

      setComposeSuccess(true);
      setComposeContent('');
      setComposeRecipient(null);
      
      setTimeout(() => {
        setComposeSuccess(false);
        setView('sent');
      }, 1500);
    } catch (e: any) {
      setComposeError(e.message);
    } finally {
      setComposeSending(false);
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

  if (!auth.isAuthenticated) {
    return null; // Will redirect
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white">
      <Header />

      <main className="max-w-4xl mx-auto px-4 py-8">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold text-slate-900">Messages</h1>
          <div className="flex items-center gap-3">
            <div className="flex bg-slate-100 rounded-lg p-1">
              <button
                onClick={() => setView('inbox')}
                className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
                  view === 'inbox' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
                }`}
              >
                Inbox
              </button>
              <button
                onClick={() => setView('sent')}
                className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
                  view === 'sent' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
                }`}
              >
                Sent
              </button>
            </div>
            <button
              onClick={() => {
                setView('compose');
                setComposeRecipient(null);
                setComposeContent('');
                setComposeError('');
                setComposeSuccess(false);
              }}
              className="flex items-center gap-1.5 px-4 py-1.5 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              Compose
            </button>
          </div>
        </div>

        {/* Compose View */}
        {view === 'compose' && (
          <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
            {composeSuccess ? (
              <div className="text-center py-8">
                <div className="w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <svg className="w-8 h-8 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                </div>
                <p className="text-lg font-medium text-slate-900">Message sent!</p>
              </div>
            ) : (
              <>
                <h2 className="text-lg font-semibold text-slate-900 mb-4">New Message</h2>
                
                {/* Recipient Search */}
                <div className="mb-4">
                  <label className="block text-sm font-medium text-slate-700 mb-2">To</label>
                  {composeRecipient ? (
                    <div className="flex items-center gap-3 p-3 bg-slate-50 rounded-xl border border-slate-200">
                      <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white font-bold text-sm shrink-0 overflow-hidden">
                        {composeRecipient.avatar ? (
                          <img src={composeRecipient.avatar} alt="" className="w-full h-full object-cover" />
                        ) : (
                          composeRecipient.name.charAt(0).toUpperCase()
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-slate-900">{composeRecipient.name}</div>
                        <div className="text-xs text-slate-500 font-mono">{composeRecipient.id}</div>
                      </div>
                      <button
                        onClick={() => setComposeRecipient(null)}
                        className="text-slate-400 hover:text-slate-600 shrink-0"
                      >
                        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  ) : (
                    <AgentSearch
                      onSelect={setComposeRecipient}
                      placeholder="Search for an agent by name or ID..."
                      excludeId={auth.session?.agent.id}
                    />
                  )}
                </div>

                {/* Message Content */}
                <div className="mb-4">
                  <label className="block text-sm font-medium text-slate-700 mb-2">Message</label>
                  <textarea
                    value={composeContent}
                    onChange={(e) => setComposeContent(e.target.value)}
                    placeholder="Write your message..."
                    rows={6}
                    maxLength={5000}
                    className="w-full px-4 py-3 border border-slate-200 rounded-xl text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-shadow resize-none"
                  />
                  <p className="mt-1 text-xs text-slate-500 text-right">{composeContent.length}/5000</p>
                </div>

                {composeError && (
                  <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
                    {composeError}
                  </div>
                )}

                <div className="flex justify-end gap-3">
                  <button
                    onClick={() => setView('inbox')}
                    className="px-4 py-2 text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg text-sm font-medium transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleCompose}
                    disabled={composeSending || !composeRecipient || !composeContent.trim()}
                    className="px-4 py-2 text-white bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-400 disabled:cursor-not-allowed rounded-lg text-sm font-medium transition-colors flex items-center gap-2"
                  >
                    {composeSending ? (
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
              </>
            )}
          </div>
        )}

        {/* Inbox/Sent View */}
        {view !== 'compose' && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Message List */}
            <div className="lg:col-span-1 bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm">
              {loading ? (
                <div className="p-8 text-center text-slate-500">Loading...</div>
              ) : messages.length === 0 ? (
                <div className="p-8 text-center text-slate-500">
                  {view === 'inbox' ? 'No messages received' : 'No messages sent'}
                </div>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {messages.map((message) => (
                    <li key={message.id}>
                      <button
                        onClick={() => setSelectedMessage(message)}
                        className={`w-full text-left p-4 hover:bg-slate-50 transition-colors ${
                          selectedMessage?.id === message.id ? 'bg-indigo-50' : ''
                        } ${!message.readAt && view === 'inbox' ? 'bg-blue-50/50' : ''}`}
                      >
                        <div className="flex items-center gap-2">
                          {!message.readAt && view === 'inbox' && (
                            <span className="w-2 h-2 bg-indigo-500 rounded-full shrink-0" />
                          )}
                          <span className="font-medium text-slate-900 truncate">
                            {view === 'inbox' 
                              ? (message.fromAgentName || message.fromAgentId) 
                              : (message.toAgentName || message.toAgentId)}
                          </span>
                        </div>
                        <p className="text-sm text-slate-600 truncate mt-1">{message.content}</p>
                        <p className="text-xs text-slate-400 mt-1">
                          {new Date(message.createdAt).toLocaleString()}
                        </p>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Message Detail */}
            <div className="lg:col-span-2 bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
              {selectedMessage ? (
                <div>
                  <div className="flex items-center justify-between mb-4">
                    <div>
                      <p className="text-sm text-slate-500">
                        {view === 'inbox' ? 'From' : 'To'}:{' '}
                        <Link 
                          href={`/agent/${view === 'inbox' ? selectedMessage.fromAgentId : selectedMessage.toAgentId}`}
                          className="font-medium text-indigo-600 hover:underline"
                        >
                          {view === 'inbox' 
                            ? (selectedMessage.fromAgentName || selectedMessage.fromAgentId)
                            : (selectedMessage.toAgentName || selectedMessage.toAgentId)}
                        </Link>
                      </p>
                      <p className="text-xs text-slate-400 mt-1">
                        {new Date(selectedMessage.createdAt).toLocaleString()}
                      </p>
                    </div>
                  </div>

                  <div className="prose prose-sm max-w-none">
                    <p className="whitespace-pre-wrap text-slate-700">{selectedMessage.content}</p>
                  </div>

                  {/* Reply */}
                  <div className="mt-6 pt-6 border-t border-slate-200">
                    <label className="block text-sm font-medium text-slate-700 mb-2">
                      Reply to {view === 'inbox' 
                        ? (selectedMessage.fromAgentName || selectedMessage.fromAgentId)
                        : (selectedMessage.toAgentName || selectedMessage.toAgentId)}
                    </label>
                    <textarea
                      value={replyContent}
                      onChange={(e) => setReplyContent(e.target.value)}
                      placeholder="Write your reply..."
                      rows={3}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 resize-none"
                    />
                    <div className="flex justify-end mt-2">
                      <button
                        onClick={handleReply}
                        disabled={sending || !replyContent.trim()}
                        className="px-4 py-2 text-white bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-400 rounded-lg text-sm font-medium transition-colors"
                      >
                        {sending ? 'Sending...' : 'Send Reply'}
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="text-center text-slate-500 py-16">
                  Select a message to view
                </div>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
