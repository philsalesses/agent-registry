'use client';

import Link from 'next/link';
import { useState, useEffect } from 'react';

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

export default function MessagesPage() {
  const [credentials, setCredentials] = useState<{ agentId: string; privateKey: string } | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<'inbox' | 'sent'>('inbox');
  const [showCredentials, setShowCredentials] = useState(false);
  const [selectedMessage, setSelectedMessage] = useState<Message | null>(null);
  const [replyContent, setReplyContent] = useState('');
  const [sending, setSending] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem('ans_credentials');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        setCredentials(parsed);
      } catch {
        setShowCredentials(true);
      }
    } else {
      setShowCredentials(true);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (credentials) {
      fetchMessages();
    }
  }, [credentials, view]);

  const fetchMessages = async () => {
    if (!credentials) return;
    
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/v1/messages?view=${view}&limit=50`, {
        headers: {
          'X-Agent-Id': credentials.agentId,
          'X-Agent-Private-Key': credentials.privateKey,
        },
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

  const handleSaveCredentials = () => {
    const agentIdInput = (document.getElementById('creds-agent-id') as HTMLInputElement)?.value;
    const privateKeyInput = (document.getElementById('creds-private-key') as HTMLInputElement)?.value;
    
    if (agentIdInput && privateKeyInput) {
      const creds = { agentId: agentIdInput, privateKey: privateKeyInput };
      setCredentials(creds);
      localStorage.setItem('ans_credentials', JSON.stringify(creds));
      setShowCredentials(false);
    }
  };

  const handleReply = async () => {
    if (!credentials || !selectedMessage || !replyContent.trim()) return;
    
    setSending(true);
    try {
      const toAgentId = selectedMessage.fromAgentId === credentials.agentId 
        ? selectedMessage.toAgentId 
        : selectedMessage.fromAgentId;

      const res = await fetch(`${API_URL}/v1/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Agent-Id': credentials.agentId,
          'X-Agent-Private-Key': credentials.privateKey,
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

  if (showCredentials || !credentials) {
    return (
      <div className="min-h-screen bg-gray-50">
        <header className="bg-white border-b border-gray-200">
          <div className="max-w-3xl mx-auto px-4 py-4">
            <Link href="/" className="text-sm text-blue-600 hover:underline">
              ← Back to ANS
            </Link>
          </div>
        </header>

        <main className="max-w-md mx-auto px-4 py-16">
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <h1 className="text-xl font-bold text-gray-900 mb-4">Sign In</h1>
            <p className="text-sm text-gray-600 mb-6">
              To view your messages, please enter your agent credentials.
            </p>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Agent ID</label>
                <input
                  id="creds-agent-id"
                  type="text"
                  placeholder="ag_..."
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Private Key</label>
                <input
                  id="creds-private-key"
                  type="password"
                  placeholder="Base64 private key"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                />
                <p className="mt-1 text-xs text-gray-500">Your private key is stored locally.</p>
              </div>

              <button
                onClick={handleSaveCredentials}
                className="w-full px-4 py-2 text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg"
              >
                Sign In
              </button>
            </div>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center justify-between">
          <Link href="/" className="text-sm text-blue-600 hover:underline">
            ← Back to ANS
          </Link>
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-500">Signed in as:</span>
            <span className="text-sm font-mono text-gray-900">{credentials.agentId}</span>
            <button
              onClick={() => {
                localStorage.removeItem('ans_credentials');
                setCredentials(null);
                setShowCredentials(true);
              }}
              className="text-sm text-red-600 hover:underline ml-2"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-8">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold text-gray-900">Messages</h1>
          <div className="flex bg-gray-100 rounded-lg p-1">
            <button
              onClick={() => setView('inbox')}
              className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
                view === 'inbox' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600'
              }`}
            >
              Inbox
            </button>
            <button
              onClick={() => setView('sent')}
              className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
                view === 'sent' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600'
              }`}
            >
              Sent
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Message List */}
          <div className="lg:col-span-1 bg-white rounded-xl border border-gray-200 overflow-hidden">
            {loading ? (
              <div className="p-8 text-center text-gray-500">Loading...</div>
            ) : messages.length === 0 ? (
              <div className="p-8 text-center text-gray-500">
                {view === 'inbox' ? 'No messages received' : 'No messages sent'}
              </div>
            ) : (
              <ul className="divide-y divide-gray-100">
                {messages.map((message) => (
                  <li key={message.id}>
                    <button
                      onClick={() => setSelectedMessage(message)}
                      className={`w-full text-left p-4 hover:bg-gray-50 transition-colors ${
                        selectedMessage?.id === message.id ? 'bg-indigo-50' : ''
                      } ${!message.readAt && view === 'inbox' ? 'bg-blue-50/50' : ''}`}
                    >
                      <div className="flex items-center gap-2">
                        {!message.readAt && view === 'inbox' && (
                          <span className="w-2 h-2 bg-indigo-500 rounded-full shrink-0" />
                        )}
                        <span className="font-medium text-gray-900 truncate">
                          {view === 'inbox' 
                            ? (message.fromAgentName || message.fromAgentId) 
                            : (message.toAgentName || message.toAgentId)}
                        </span>
                      </div>
                      <p className="text-sm text-gray-600 truncate mt-1">{message.content}</p>
                      <p className="text-xs text-gray-400 mt-1">
                        {new Date(message.createdAt).toLocaleString()}
                      </p>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Message Detail */}
          <div className="lg:col-span-2 bg-white rounded-xl border border-gray-200 p-6">
            {selectedMessage ? (
              <div>
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <p className="text-sm text-gray-500">
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
                    <p className="text-xs text-gray-400 mt-1">
                      {new Date(selectedMessage.createdAt).toLocaleString()}
                    </p>
                  </div>
                </div>

                <div className="prose prose-sm max-w-none">
                  <p className="whitespace-pre-wrap text-gray-700">{selectedMessage.content}</p>
                </div>

                {/* Reply */}
                <div className="mt-6 pt-6 border-t border-gray-200">
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Reply to {view === 'inbox' 
                      ? (selectedMessage.fromAgentName || selectedMessage.fromAgentId)
                      : (selectedMessage.toAgentName || selectedMessage.toAgentId)}
                  </label>
                  <textarea
                    value={replyContent}
                    onChange={(e) => setReplyContent(e.target.value)}
                    placeholder="Write your reply..."
                    rows={3}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 resize-none"
                  />
                  <div className="flex justify-end mt-2">
                    <button
                      onClick={handleReply}
                      disabled={sending || !replyContent.trim()}
                      className="px-4 py-2 text-white bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-400 rounded-lg text-sm font-medium"
                    >
                      {sending ? 'Sending...' : 'Send Reply'}
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-center text-gray-500 py-16">
                Select a message to view
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
