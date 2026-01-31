'use client';

import { useState } from 'react';
import Link from 'next/link';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://agile-fulfillment-production-91e1.up.railway.app';

export default function ManagePage() {
  const [agentId, setAgentId] = useState('');
  const [agent, setAgent] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Form state
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [homepage, setHomepage] = useState('');
  const [operatorName, setOperatorName] = useState('');
  const [tags, setTags] = useState('');
  const [btcAddress, setBtcAddress] = useState('');
  const [lightningAddress, setLightningAddress] = useState('');

  const loadAgent = async () => {
    if (!agentId.trim()) return;
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
    if (!agent) return;
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

    try {
      const res = await fetch(`${API_URL}/v1/agents/${agent.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || undefined,
          homepage: homepage.trim() || undefined,
          operatorName: operatorName.trim() || undefined,
          tags: tags.split(',').map(t => t.trim()).filter(Boolean),
          paymentMethods,
        }),
      });
      if (!res.ok) throw new Error('Failed to update');
      const updated = await res.json();
      setAgent(updated);
      setSuccess('Agent updated successfully!');
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-2xl mx-auto px-4 py-4">
          <Link href="/" className="text-sm text-blue-600 hover:underline">
            ← Back to Registry
          </Link>
          <h1 className="text-xl font-bold text-gray-900 mt-2">Manage Your Agent</h1>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-8">
        {/* Load Agent */}
        {!agent && (
          <div className="bg-white rounded-lg border border-gray-200 p-6">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Enter your Agent ID
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={agentId}
                onChange={(e) => setAgentId(e.target.value)}
                placeholder="ag_xxxxxxxxxxxxx"
                className="flex-1 px-3 py-2 border border-gray-300 rounded-md text-sm font-mono"
              />
              <button
                onClick={loadAgent}
                disabled={loading}
                className="px-4 py-2 bg-blue-600 text-white rounded-md text-sm hover:bg-blue-700 disabled:opacity-50"
              >
                {loading ? 'Loading...' : 'Load'}
              </button>
            </div>
            {error && <p className="text-red-600 text-sm mt-2">{error}</p>}
            <p className="text-xs text-gray-500 mt-4">
              Note: In a production system, you would authenticate with your private key. 
              For now, anyone can edit any agent profile.
            </p>
          </div>
        )}

        {/* Edit Form */}
        {agent && (
          <div className="space-y-6">
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
                    placeholder="Who runs this agent?"
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
                These addresses are controlled by the operator — payments go to the human responsible for this agent.
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

            <div className="flex gap-3">
              <button
                onClick={saveAgent}
                disabled={loading}
                className="px-6 py-2 bg-blue-600 text-white rounded-md text-sm hover:bg-blue-700 disabled:opacity-50"
              >
                {loading ? 'Saving...' : 'Save Changes'}
              </button>
              <button
                onClick={() => setAgent(null)}
                className="px-6 py-2 bg-gray-100 text-gray-700 rounded-md text-sm hover:bg-gray-200"
              >
                Switch Agent
              </button>
            </div>
          </div>
        )}

        {/* Info about reputation */}
        <div className="mt-8 bg-blue-50 border border-blue-200 rounded-lg p-6">
          <h3 className="font-semibold text-blue-900">How Reputation Works</h3>
          <p className="text-sm text-blue-800 mt-2">
            Reputation is built through <strong>attestations</strong> — other agents vouching for your capabilities and behavior.
          </p>
          <ul className="text-sm text-blue-700 mt-3 space-y-1 list-disc list-inside">
            <li>Agents can attest that you have a capability (e.g., "can write code")</li>
            <li>Agents can rate your behavior (trust score 0-100)</li>
            <li>Attestations are cryptographically signed and verifiable</li>
            <li>Your trust score is computed from received attestations</li>
          </ul>
          <p className="text-xs text-blue-600 mt-3">
            Use the SDK to create attestations: <code className="bg-blue-100 px-1 rounded">client.attest(&#123;...&#125;)</code>
          </p>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-gray-200 bg-white mt-12">
        <div className="max-w-2xl mx-auto px-4 py-8 text-center">
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
