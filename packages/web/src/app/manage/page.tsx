'use client';

import { useState, useRef } from 'react';
import Link from 'next/link';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://api.ans-registry.org';

interface Credentials {
  agentId: string;
  publicKey: string;
  privateKey: string;
}

export default function ManagePage() {
  const [credentials, setCredentials] = useState<Credentials | null>(null);
  const [agent, setAgent] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Form state
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [homepage, setHomepage] = useState('');
  const [operatorName, setOperatorName] = useState('');
  const [tags, setTags] = useState('');
  const [btcAddress, setBtcAddress] = useState('');
  const [lightningAddress, setLightningAddress] = useState('');

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const creds = JSON.parse(text) as Credentials;
      
      if (!creds.agentId || !creds.publicKey || !creds.privateKey) {
        throw new Error('Invalid credentials file');
      }

      setCredentials(creds);
      setError('');
      
      await loadAgent(creds.agentId);
    } catch (e: any) {
      setError('Failed to load credentials: ' + e.message);
    }
  };

  const loadAgent = async (agentId: string) => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${API_URL}/v1/agents/${agentId}`);
      if (!res.ok) throw new Error('Agent not found');
      const data = await res.json();
      setAgent(data);
      setName(data.name || '');
      setDescription(data.description || '');
      setHomepage(data.homepage || '');
      setOperatorName(data.operatorName || '');
      setTags((data.tags || []).join(', '));
      const btc = data.paymentMethods?.find((p: any) => p.type === 'bitcoin');
      const ln = data.paymentMethods?.find((p: any) => p.type === 'lightning');
      setBtcAddress(btc?.address || '');
      setLightningAddress(ln?.address || '');
    } catch (e: any) {
      setError(e.message);
      setAgent(null);
    } finally {
      setLoading(false);
    }
  };

  const saveAgent = async () => {
    if (!agent || !credentials) return;
    setLoading(true);
    setError('');
    setSuccess('');
    
    const paymentMethods = [];
    if (btcAddress.trim()) {
      paymentMethods.push({ type: 'bitcoin', address: btcAddress.trim() });
    }
    if (lightningAddress.trim()) {
      paymentMethods.push({ type: 'lightning', address: lightningAddress.trim() });
    }

    const body = JSON.stringify({
      name: name.trim(),
      description: description.trim() || undefined,
      homepage: homepage.trim() || undefined,
      operatorName: operatorName.trim() || undefined,
      tags: tags.split(',').map(t => t.trim()).filter(Boolean),
      paymentMethods,
    });

    const timestamp = Date.now().toString();
    
    try {
      const res = await fetch(`${API_URL}/v1/agents/${agent.id}`, {
        method: 'PATCH',
        headers: { 
          'Content-Type': 'application/json',
          'X-Agent-Timestamp': timestamp,
          'X-Agent-Private-Key': credentials.privateKey,
        },
        body,
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to update');
      }
      const updated = await res.json();
      setAgent(updated);
      setSuccess('Agent updated successfully!');
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const disconnect = () => {
    setCredentials(null);
    setAgent(null);
    setError('');
    setSuccess('');
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white">
      <header className="bg-white/80 backdrop-blur-sm border-b border-slate-200 sticky top-0 z-10">
        <div className="max-w-2xl mx-auto px-4 py-4">
          <Link href="/" className="text-sm text-indigo-600 hover:text-indigo-700 font-medium">
            ← Back to ANS
          </Link>
          <h1 className="text-2xl font-bold text-slate-900 mt-2">Manage Your Agent</h1>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-8">
        {/* Load Credentials */}
        {!credentials && (
          <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-slate-900 mb-4">Load Your Credentials</h2>
            <p className="text-sm text-slate-600 mb-4">
              Upload the credentials file you received when you registered your agent.
            </p>
            
            <input
              ref={fileInputRef}
              type="file"
              accept=".json"
              onChange={handleFileUpload}
              className="hidden"
            />
            
            <button
              onClick={() => fileInputRef.current?.click()}
              className="w-full px-4 py-4 border-2 border-dashed border-slate-300 rounded-xl text-slate-600 hover:border-indigo-400 hover:text-indigo-600 transition-colors"
            >
              📁 Click to upload credentials file
            </button>

            {error && <p className="text-red-600 text-sm mt-4">{error}</p>}

            <div className="mt-6 pt-6 border-t border-slate-200">
              <p className="text-sm text-slate-500">
                Don't have credentials? 
                <Link href="/register" className="text-indigo-600 hover:text-indigo-700 font-medium ml-1">
                  Register a new agent
                </Link>
              </p>
            </div>
          </div>
        )}

        {/* Edit Form */}
        {credentials && agent && (
          <div className="space-y-6">
            <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 flex items-center justify-between shadow-sm">
              <div>
                <p className="text-sm font-medium text-emerald-900">
                  ✓ Connected as <strong>{agent.name}</strong>
                </p>
                <p className="text-xs text-emerald-700 font-mono">{credentials.agentId}</p>
              </div>
              <button
                onClick={disconnect}
                className="text-sm text-emerald-700 hover:text-emerald-900 font-medium"
              >
                Disconnect
              </button>
            </div>

            <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
              <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-4">
                Basic Info
              </h2>
              <div className="space-y-5">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">Name</label>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full px-4 py-3 border border-slate-200 rounded-xl text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-shadow"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">Description</label>
                  <textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    rows={3}
                    className="w-full px-4 py-3 border border-slate-200 rounded-xl text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-shadow"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">Homepage URL</label>
                  <input
                    type="url"
                    value={homepage}
                    onChange={(e) => setHomepage(e.target.value)}
                    placeholder="https://..."
                    className="w-full px-4 py-3 border border-slate-200 rounded-xl text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-shadow"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">Operator Name</label>
                  <input
                    type="text"
                    value={operatorName}
                    onChange={(e) => setOperatorName(e.target.value)}
                    className="w-full px-4 py-3 border border-slate-200 rounded-xl text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-shadow"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">Tags (comma-separated)</label>
                  <input
                    type="text"
                    value={tags}
                    onChange={(e) => setTags(e.target.value)}
                    placeholder="assistant, coding, research"
                    className="w-full px-4 py-3 border border-slate-200 rounded-xl text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-shadow"
                  />
                </div>
              </div>
            </div>

            <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
              <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-4">
                Payment Addresses
              </h2>
              <p className="text-xs text-slate-500 mb-4">
                Payments go to the operator — the human responsible for this agent.
              </p>
              <div className="space-y-5">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">Bitcoin Address</label>
                  <input
                    type="text"
                    value={btcAddress}
                    onChange={(e) => setBtcAddress(e.target.value)}
                    placeholder="bc1q... or 3..."
                    className="w-full px-4 py-3 border border-slate-200 rounded-xl text-sm font-mono text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-shadow"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">Lightning Address</label>
                  <input
                    type="text"
                    value={lightningAddress}
                    onChange={(e) => setLightningAddress(e.target.value)}
                    placeholder="name@getalby.com"
                    className="w-full px-4 py-3 border border-slate-200 rounded-xl text-sm font-mono text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-shadow"
                  />
                </div>
              </div>
            </div>

            {error && (
              <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-red-700 text-sm">
                {error}
              </div>
            )}
            {success && (
              <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 text-emerald-700 text-sm">
                {success}
              </div>
            )}

            <button
              onClick={saveAgent}
              disabled={loading}
              className="w-full px-6 py-3 bg-indigo-600 text-white rounded-xl font-semibold hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-sm"
            >
              {loading ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        )}

        {/* Loading */}
        {credentials && !agent && loading && (
          <div className="text-center py-12">
            <p className="text-slate-500">Loading agent...</p>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-200 bg-white mt-12">
        <div className="max-w-2xl mx-auto px-4 py-8 text-center">
          <p className="text-sm text-slate-500 mb-4">
            Built with 🤖 by <a href="https://ans-registry.org/agent/ag_0QsEpQdgMo6bJrEF" className="text-indigo-600 hover:text-indigo-700">Good Will</a> & <a href="https://philsalesses.com" className="text-indigo-600 hover:text-indigo-700">Phil Salesses</a>
          </p>
          <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl inline-block">
            <p className="text-sm font-medium text-amber-900">💛 Like what we're building?</p>
            <p className="text-sm text-amber-700 mt-1">Support us to keep it going:</p>
            <div className="mt-2 flex items-center justify-center gap-2">
              <span className="text-xs text-amber-600 font-medium">BTC:</span>
              <code className="text-xs bg-amber-100 px-2 py-1 rounded-lg font-mono text-amber-800 select-all">
                38fpnNAJ3VxMwY3fu2duc5NZHnsayr1rCk
              </code>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
