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
      <div className="min-h-screen bg-gray-50">
        <header className="bg-white border-b border-gray-200">
          <div className="max-w-2xl mx-auto px-4 py-4">
            <Link href="/" className="text-sm text-blue-600 hover:underline">
              ← Back to Registry
            </Link>
          </div>
        </header>

        <main className="max-w-2xl mx-auto px-4 py-8">
          <div className="bg-green-50 border border-green-200 rounded-lg p-6 mb-6">
            <h1 className="text-xl font-bold text-green-900">🎉 Agent Registered!</h1>
            <p className="text-green-700 mt-2">
              Your agent <strong>{credentials.agent.name}</strong> has been created.
            </p>
          </div>

          <div className="bg-red-50 border border-red-300 rounded-lg p-6 mb-6">
            <h2 className="text-lg font-bold text-red-900">⚠️ SAVE YOUR CREDENTIALS</h2>
            <p className="text-red-700 mt-2">
              Download and securely store your credentials file. 
              <strong> The private key cannot be recovered!</strong>
            </p>
            <button
              onClick={downloadCredentials}
              className="mt-4 px-6 py-3 bg-red-600 text-white rounded-lg font-semibold hover:bg-red-700"
            >
              Download Credentials File
            </button>
          </div>

          <div className="bg-white rounded-lg border border-gray-200 p-6">
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-4">
              Your Credentials
            </h2>
            <div className="space-y-3 text-sm">
              <div>
                <span className="text-gray-500">Agent ID:</span>
                <code className="ml-2 bg-gray-100 px-2 py-1 rounded font-mono">
                  {credentials.credentials.agentId}
                </code>
              </div>
              <div>
                <span className="text-gray-500">Public Key:</span>
                <code className="ml-2 bg-gray-100 px-2 py-1 rounded font-mono text-xs break-all">
                  {credentials.credentials.publicKey.substring(0, 32)}...
                </code>
              </div>
              <div>
                <span className="text-gray-500">Private Key:</span>
                <code className="ml-2 bg-red-100 px-2 py-1 rounded font-mono text-xs">
                  [HIDDEN - in downloaded file]
                </code>
              </div>
            </div>
          </div>

          <div className="mt-6 flex gap-3">
            <Link
              href={`/agent/${credentials.credentials.agentId}`}
              className="px-4 py-2 bg-blue-600 text-white rounded-md text-sm hover:bg-blue-700"
            >
              View Your Agent
            </Link>
            <Link
              href="/manage"
              className="px-4 py-2 bg-gray-100 text-gray-700 rounded-md text-sm hover:bg-gray-200"
            >
              Edit Profile
            </Link>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-2xl mx-auto px-4 py-4">
          <Link href="/" className="text-sm text-blue-600 hover:underline">
            ← Back to Registry
          </Link>
          <h1 className="text-xl font-bold text-gray-900 mt-2">Register Your Agent</h1>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-8">
        <form onSubmit={handleRegister} className="space-y-6">
          <div className="bg-white rounded-lg border border-gray-200 p-6">
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Agent Name *
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="My Awesome Agent"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Type
                </label>
                <select
                  value={type}
                  onChange={(e) => setType(e.target.value as any)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                >
                  <option value="assistant">Assistant (conversational AI)</option>
                  <option value="autonomous">Autonomous (self-directed)</option>
                  <option value="tool">Tool (specific capability)</option>
                  <option value="service">Service (API/backend)</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Description
                </label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="What does your agent do?"
                  rows={3}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Operator Name
                </label>
                <input
                  type="text"
                  value={operatorName}
                  onChange={(e) => setOperatorName(e.target.value)}
                  placeholder="Who runs this agent?"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                />
              </div>
            </div>
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700 text-sm">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full px-6 py-3 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 disabled:opacity-50"
          >
            {loading ? 'Registering...' : 'Register Agent'}
          </button>
        </form>

        <div className="mt-8 bg-blue-50 border border-blue-200 rounded-lg p-6">
          <h3 className="font-semibold text-blue-900">How it works</h3>
          <ol className="text-sm text-blue-800 mt-2 space-y-2 list-decimal list-inside">
            <li>Register your agent and receive a credentials file</li>
            <li>Save the credentials securely (private key cannot be recovered!)</li>
            <li>Use the credentials to edit your profile and prove ownership</li>
            <li>Other agents can verify your identity cryptographically</li>
          </ol>
        </div>
      </main>
    </div>
  );
}
