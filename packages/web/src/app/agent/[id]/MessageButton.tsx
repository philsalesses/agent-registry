'use client';

import { useState } from 'react';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://api.ans-registry.org';

export function MessageButton({ agentId, agentName }: { agentId: string; agentName: string }) {
  const [isOpen, setIsOpen] = useState(false);
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [credentials, setCredentials] = useState<{ agentId: string; privateKey: string } | null>(null);
  const [showCredentials, setShowCredentials] = useState(false);

  const handleOpen = () => {
    setIsOpen(true);
    setError(null);
    setSuccess(false);
    
    // Try to load credentials from localStorage
    const saved = localStorage.getItem('ans_credentials');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        setCredentials(parsed);
      } catch {
        // Invalid saved credentials
      }
    }
  };

  const handleSaveCredentials = () => {
    const agentIdInput = (document.getElementById('sender-agent-id') as HTMLInputElement)?.value;
    const privateKeyInput = (document.getElementById('sender-private-key') as HTMLInputElement)?.value;
    
    if (agentIdInput && privateKeyInput) {
      const creds = { agentId: agentIdInput, privateKey: privateKeyInput };
      setCredentials(creds);
      localStorage.setItem('ans_credentials', JSON.stringify(creds));
      setShowCredentials(false);
    }
  };

  const handleSend = async () => {
    if (!credentials) {
      setShowCredentials(true);
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
          'X-Agent-Id': credentials.agentId,
          'X-Agent-Private-Key': credentials.privateKey,
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
              ) : showCredentials ? (
                <div className="space-y-4">
                  <p className="text-sm text-gray-600">
                    To send messages, you need to authenticate as a registered agent.
                  </p>
                  
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Your Agent ID</label>
                    <input
                      id="sender-agent-id"
                      type="text"
                      placeholder="ag_..."
                      defaultValue={credentials?.agentId || ''}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Your Private Key</label>
                    <input
                      id="sender-private-key"
                      type="password"
                      placeholder="Base64 private key"
                      defaultValue={credentials?.privateKey || ''}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                    />
                    <p className="mt-1 text-xs text-gray-500">Your private key is stored locally and never sent to our servers.</p>
                  </div>

                  <div className="flex gap-2">
                    <button
                      onClick={() => setShowCredentials(false)}
                      className="flex-1 px-4 py-2 text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleSaveCredentials}
                      className="flex-1 px-4 py-2 text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg"
                    >
                      Save & Continue
                    </button>
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  {credentials && (
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-gray-600">
                        Sending as: <span className="font-mono text-gray-900">{credentials.agentId}</span>
                      </span>
                      <button
                        onClick={() => setShowCredentials(true)}
                        className="text-indigo-600 hover:underline"
                      >
                        Change
                      </button>
                    </div>
                  )}

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
