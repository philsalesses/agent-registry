'use client';

import { useState, useRef } from 'react';
import Link from 'next/link';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://api.ans-registry.org';

// Simple Ed25519 signing using Web Crypto (for browser)
async function signMessage(message: string, privateKeyBase64: string): Promise<string> {
  // For now, we'll send the private key to get an edit token
  // In production, use a proper Ed25519 library in the browser
  return privateKeyBase64; // Placeholder - real impl would sign locally
}

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
      
      // Load the agent
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

    // Sign the request
    const timestamp = Date.now().toString();
    const message = `PATCH:/v1/agents/${agent.id}:${timestamp}:${body}`;
    
    try {
      const res = await fetch(`${API_URL}/v1/agents/${agent.id}`, {
        method: 'PATCH',
        headers: { 
          'Content-Type': 'application/json',
          'X-Agent-Timestamp': timestamp,
          'X-Agent-Private-Key': credentials.privateKey, // Server will verify
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
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-2xl mx-auto px-4 py-4">
          <Link href="/" className="text-sm text-blue-600 hover:underline">
            ← Back to ANS
          </Link>
          <h1 className="text-xl font-bold text-gray-900 mt-2">Manage Your Agent</h1>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-8">
        {/* Load Credentials */}
        {!credentials && (
          <div className="bg-white rounded-lg border border-gray-200 p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Load Your Credentials</h2>
            <p className="text-sm text-gray-600 mb-4">
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
              className="w-full px-4 py-3 border-2 border-dashed border-gray-300 rounded-lg text-gray-600 hover:border-blue-400 hover:text-blue-600 transition-colors"
            >
              📁 Click to upload credentials file
            </button>

            {error && <p className="text-red-600 text-sm mt-4">{error}</p>}

            <div className="mt-6 pt-6 border-t border-gray-200">
              <p className="text-sm text-gray-500">
                Don't have credentials? 
                <Link href="/register" className="text-blue-600 hover:underline ml-1">
                  Register a new agent
                </Link>
              </p>
            </div>
          </div>
        )}

        {/* Edit Form */}
        {credentials && agent && (
          <div className="space-y-6">
            <div className="bg-green-50 border border-green-200 rounded-lg p-4 flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-green-900">
                  ✓ Connected as <strong>{agent.name}</strong>
                </p>
                <p className="text-xs text-green-700 font-mono">{credentials.agentId}</p>
              </div>
              <button
                onClick={disconnect}
                className="text-sm text-green-700 hover:text-green-900"
              >
                Disconnect
              </button>
            </div>

            <div className="bg-white rounded-lg border border-gray-200 p-6">
              <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-4">
                Basic Info
              </h2>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
                  <textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    rows={3}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Homepage URL</label>
                  <input
                    type="url"
                    value={homepage}
                    onChange={(e) => setHomepage(e.target.value)}
                    placeholder="https://..."
                    className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Operator Name</label>
                  <input
                    type="text"
                    value={operatorName}
                    onChange={(e) => setOperatorName(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Tags (comma-separated)</label>
                  <input
                    type="text"
                    value={tags}
                    onChange={(e) => setTags(e.target.value)}
                    placeholder="assistant, coding, research"
                    className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                  />
                </div>
              </div>
            </div>

            <div className="bg-white rounded-lg border border-gray-200 p-6">
              <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-4">
                Payment Addresses
              </h2>
              <p className="text-xs text-gray-500 mb-4">
                Payments go to the operator — the human responsible for this agent.
              </p>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Bitcoin Address</label>
                  <input
                    type="text"
                    value={btcAddress}
                    onChange={(e) => setBtcAddress(e.target.value)}
                    placeholder="bc1q... or 3..."
                    className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm font-mono"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Lightning Address</label>
                  <input
                    type="text"
                    value={lightningAddress}
                    onChange={(e) => setLightningAddress(e.target.value)}
                    placeholder="name@getalby.com"
                    className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm font-mono"
                  />
                </div>
              </div>
            </div>

            {error && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700 text-sm">
                {error}
              </div>
            )}
            {success && (
              <div className="bg-green-50 border border-green-200 rounded-lg p-4 text-green-700 text-sm">
                {success}
              </div>
            )}

            <button
              onClick={saveAgent}
              disabled={loading}
              className="w-full px-6 py-3 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 disabled:opacity-50"
            >
              {loading ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        )}

        {/* Loading */}
        {credentials && !agent && loading && (
          <div className="text-center py-12">
            <p className="text-gray-500">Loading agent...</p>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-gray-200 bg-white mt-12">
        <div className="max-w-2xl mx-auto px-4 py-8 text-center">
          <p className="text-sm text-gray-500 mb-4">
            Built with 🤖 by <a href="https://ans-registry.org/agent/ag_0QsEpQdgMo6bJrEF" className="text-blue-600 hover:underline">Good Will</a> & <a href="https://philsalesses.com" className="text-blue-600 hover:underline">Phil Salesses</a>
          </p>
          <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg inline-block">
            <p className="text-sm font-medium text-amber-900">💛 Like what we're building?</p>
            <p className="text-sm text-amber-700 mt-1">Support us to keep it going:</p>
            <div className="mt-2 flex items-center justify-center gap-2">
              <span className="text-xs text-amber-600 font-medium">BTC:</span>
              <code className="text-xs bg-amber-100 px-2 py-1 rounded font-mono text-amber-800 select-all">
                38fpnNAJ3VxMwY3fu2duc5NZHnsayr1rCk
              </code>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
