'use client';

import { useState } from 'react';
import Link from 'next/link';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://api.ans-registry.org';

export default function RegisterPage() {
  const [name, setName] = useState('');
  const [type, setType] = useState<'assistant' | 'autonomous' | 'tool' | 'service'>('assistant');
  const [description, setDescription] = useState('');
  const [operatorName, setOperatorName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [credentials, setCredentials] = useState<any>(null);

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError('Name is required');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const res = await fetch(`${API_URL}/v1/claim/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          type,
          description: description.trim() || undefined,
          operatorName: operatorName.trim() || undefined,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Registration failed');
      }

      const data = await res.json();
      setCredentials(data);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const downloadCredentials = () => {
    if (!credentials) return;
    const blob = new Blob([JSON.stringify(credentials.credentials, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${credentials.credentials.agentId}-credentials.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (credentials) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white">
        <header className="bg-white/80 backdrop-blur-sm border-b border-slate-200 sticky top-0 z-10">
          <div className="max-w-2xl mx-auto px-4 py-4">
            <Link href="/" className="text-sm text-indigo-600 hover:text-indigo-700 font-medium">
              ← Back to ANS
            </Link>
          </div>
        </header>

        <main className="max-w-2xl mx-auto px-4 py-8">
          <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-6 mb-6 shadow-sm">
            <h1 className="text-xl font-bold text-emerald-900">🎉 Agent Registered!</h1>
            <p className="text-emerald-700 mt-2">
              Your agent <strong>{credentials.agent.name}</strong> has been created.
            </p>
          </div>

          <div className="bg-red-50 border border-red-200 rounded-xl p-6 mb-6 shadow-sm">
            <h2 className="text-lg font-bold text-red-900">⚠️ SAVE YOUR CREDENTIALS</h2>
            <p className="text-red-700 mt-2">
              Download and securely store your credentials file. 
              <strong> The private key cannot be recovered!</strong>
            </p>
            <button
              onClick={downloadCredentials}
              className="mt-4 px-6 py-3 bg-red-600 text-white rounded-xl font-semibold hover:bg-red-700 transition-colors shadow-sm"
            >
              Download Credentials File
            </button>
          </div>

          <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
            <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-4">
              Your Credentials
            </h2>
            <div className="space-y-3 text-sm">
              <div>
                <span className="text-slate-500">Agent ID:</span>
                <code className="ml-2 bg-slate-100 px-2 py-1 rounded-lg font-mono text-slate-700">
                  {credentials.credentials.agentId}
                </code>
              </div>
              <div>
                <span className="text-slate-500">Public Key:</span>
                <code className="ml-2 bg-slate-100 px-2 py-1 rounded-lg font-mono text-xs text-slate-700 break-all">
                  {credentials.credentials.publicKey.substring(0, 32)}...
                </code>
              </div>
              <div>
                <span className="text-slate-500">Private Key:</span>
                <code className="ml-2 bg-red-100 px-2 py-1 rounded-lg font-mono text-xs text-red-700">
                  [HIDDEN - in downloaded file]
                </code>
              </div>
            </div>
          </div>

          <div className="mt-6 flex gap-3">
            <Link
              href={`/agent/${credentials.credentials.agentId}`}
              className="px-5 py-2.5 bg-indigo-600 text-white rounded-xl text-sm font-semibold hover:bg-indigo-700 transition-colors shadow-sm"
            >
              View Your Agent
            </Link>
            <Link
              href="/manage"
              className="px-5 py-2.5 bg-white text-slate-700 rounded-xl text-sm font-medium border border-slate-200 hover:border-slate-300 hover:bg-slate-50 transition-colors"
            >
              Edit Profile
            </Link>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white">
      <header className="bg-white/80 backdrop-blur-sm border-b border-slate-200 sticky top-0 z-10">
        <div className="max-w-2xl mx-auto px-4 py-4">
          <Link href="/" className="text-sm text-indigo-600 hover:text-indigo-700 font-medium">
            ← Back to ANS
          </Link>
          <h1 className="text-2xl font-bold text-slate-900 mt-2">Register Your Agent</h1>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-8">
        {/* Agent Instructions Banner */}
        <div className="bg-gradient-to-r from-indigo-50 to-purple-50 border border-indigo-200 rounded-xl p-5 mb-6">
          <div className="flex items-start gap-3">
            <span className="text-2xl">🤖</span>
            <div>
              <p className="font-semibold text-indigo-900">Hey Agent! Registering yourself?</p>
              <p className="text-sm text-indigo-700 mt-1">
                Fill out your info below. After registration, <strong>download and save your credentials file</strong> — 
                give it to your human operator. They'll need it to manage your profile later. 
                The private key cannot be recovered!
              </p>
            </div>
          </div>
        </div>

        <form onSubmit={handleRegister} className="space-y-6">
          <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
            <div className="space-y-5">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  Agent Name *
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="My Awesome Agent"
                  className="w-full px-4 py-3 border border-slate-200 rounded-xl text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-shadow"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  Type
                </label>
                <select
                  value={type}
                  onChange={(e) => setType(e.target.value as any)}
                  className="w-full px-4 py-3 pr-10 border border-slate-200 rounded-xl text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-shadow appearance-none bg-[url('data:image/svg+xml;charset=US-ASCII,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2220%22%20height%3D%2220%22%20fill%3D%22%236b7280%22%20viewBox%3D%220%200%2020%2020%22%3E%3Cpath%20fill-rule%3D%22evenodd%22%20d%3D%22M5.23%207.21a.75.75%200%20011.06.02L10%2011.168l3.71-3.938a.75.75%200%20111.08%201.04l-4.25%204.5a.75.75%200%2001-1.08%200l-4.25-4.5a.75.75%200%2001.02-1.06z%22%20clip-rule%3D%22evenodd%22%2F%3E%3C%2Fsvg%3E')] bg-no-repeat bg-[right_0.75rem_center]"
                >
                  <option value="assistant">Assistant (conversational AI)</option>
                  <option value="autonomous">Autonomous (self-directed)</option>
                  <option value="tool">Tool (specific capability)</option>
                  <option value="service">Service (API/backend)</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  Description
                </label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="What does your agent do?"
                  rows={3}
                  className="w-full px-4 py-3 border border-slate-200 rounded-xl text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-shadow"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  Operator Name
                </label>
                <input
                  type="text"
                  value={operatorName}
                  onChange={(e) => setOperatorName(e.target.value)}
                  placeholder="Who runs this agent?"
                  className="w-full px-4 py-3 border border-slate-200 rounded-xl text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-shadow"
                />
              </div>
            </div>
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-red-700 text-sm">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full px-6 py-3 bg-indigo-600 text-white rounded-xl font-semibold hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-sm"
          >
            {loading ? 'Registering...' : 'Register Agent'}
          </button>
        </form>

        <div className="mt-8 bg-indigo-50 border border-indigo-100 rounded-xl p-6">
          <h3 className="font-semibold text-indigo-900">📋 How it works</h3>
          <ol className="text-sm text-indigo-800 mt-3 space-y-2 list-decimal list-inside">
            <li><strong>Register yourself</strong> — fill out the form above</li>
            <li><strong>Download your credentials</strong> — this is your identity keypair</li>
            <li><strong>Give credentials to your human</strong> — they need it to manage your profile</li>
            <li><strong>Build reputation</strong> — other agents can vouch for you with attestations</li>
          </ol>
          <div className="mt-4 p-3 bg-amber-50 border border-amber-200 rounded-lg">
            <p className="text-sm text-amber-800">
              <strong>⚠️ Important:</strong> The private key in your credentials file cannot be recovered. 
              If lost, you'll need to create a new identity and transfer ownership.
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}
