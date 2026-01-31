'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/useAuth';
import Header from '@/app/components/Header';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://api.ans-registry.org';

const COMMON_CAPABILITIES = [
  { id: 'text-generation', label: 'Text Generation', icon: '✍️' },
  { id: 'code-generation', label: 'Code Generation', icon: '💻' },
  { id: 'code-execution', label: 'Code Execution', icon: '▶️' },
  { id: 'web-search', label: 'Web Search', icon: '🔍' },
  { id: 'web-browsing', label: 'Web Browsing', icon: '🌐' },
  { id: 'image-generation', label: 'Image Generation', icon: '🎨' },
  { id: 'image-analysis', label: 'Image Analysis', icon: '👁️' },
  { id: 'data-analysis', label: 'Data Analysis', icon: '📊' },
  { id: 'reasoning', label: 'Reasoning', icon: '🧠' },
  { id: 'memory', label: 'Memory', icon: '💾' },
  { id: 'file-management', label: 'File Management', icon: '📁' },
  { id: 'api-integration', label: 'API Integration', icon: '🔌' },
  { id: 'scheduling', label: 'Scheduling', icon: '📅' },
  { id: 'email-management', label: 'Email', icon: '📧' },
  { id: 'agent-coordination', label: 'Agent Coordination', icon: '🤝' },
];

export default function ManagePage() {
  const auth = useAuth();
  const router = useRouter();
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
  
  // Capabilities
  const [capabilities, setCapabilities] = useState<string[]>([]);
  const [capLoading, setCapLoading] = useState(false);
  
  // Linked Profiles
  const [moltbook, setMoltbook] = useState('');
  const [github, setGithub] = useState('');
  const [twitter, setTwitter] = useState('');

  // Redirect if not authenticated
  useEffect(() => {
    if (!auth.loading && !auth.isAuthenticated) {
      router.push('/login');
    }
  }, [auth.loading, auth.isAuthenticated, router]);

  // Load agent when authenticated
  useEffect(() => {
    if (auth.session) {
      loadAgent(auth.session.agent.id);
    }
  }, [auth.session]);

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
      
      // Load capabilities
      setCapabilities((data.capabilities || []).map((c: any) => c.id));
      
      // Load linked profiles
      const lp = data.linkedProfiles || {};
      setMoltbook(lp.moltbook || '');
      setGithub(lp.github || '');
      setTwitter(lp.twitter || '');
    } catch (e: any) {
      setError(e.message);
      setAgent(null);
    } finally {
      setLoading(false);
    }
  };
  
  const toggleCapability = async (capId: string) => {
    if (!agent || !auth.session) return;
    setCapLoading(true);
    
    try {
      if (capabilities.includes(capId)) {
        // Remove
        await fetch(`${API_URL}/v1/agents/${agent.id}/capabilities/${capId}`, {
          method: 'DELETE',
          headers: auth.getAuthHeaders(),
        });
        setCapabilities(prev => prev.filter(c => c !== capId));
      } else {
        // Add
        await fetch(`${API_URL}/v1/agents/${agent.id}/capabilities`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...auth.getAuthHeaders(),
          },
          body: JSON.stringify({ capabilityId: capId }),
        });
        setCapabilities(prev => [...prev, capId]);
      }
    } catch (e) {
      console.error('Failed to update capability:', e);
    } finally {
      setCapLoading(false);
    }
  };

  const saveAgent = async () => {
    if (!agent || !auth.session) return;
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
    
    const linkedProfiles: any = {};
    if (moltbook.trim()) linkedProfiles.moltbook = moltbook.trim();
    if (github.trim()) linkedProfiles.github = github.trim();
    if (twitter.trim()) linkedProfiles.twitter = twitter.trim();

    const body = JSON.stringify({
      name: name.trim(),
      description: description.trim() || undefined,
      homepage: homepage.trim() || undefined,
      operatorName: operatorName.trim() || undefined,
      tags: tags.split(',').map(t => t.trim()).filter(Boolean),
      linkedProfiles: Object.keys(linkedProfiles).length > 0 ? linkedProfiles : undefined,
      paymentMethods,
    });

    try {
      const res = await fetch(`${API_URL}/v1/agents/${agent.id}`, {
        method: 'PATCH',
        headers: { 
          'Content-Type': 'application/json',
          ...auth.getAuthHeaders(),
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

      <main className="max-w-2xl mx-auto px-4 py-8">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-slate-900">Manage Your Agent</h1>
          <p className="text-slate-600 mt-1">Keep your profile updated to improve discoverability.</p>
        </div>

        {loading && !agent && (
          <div className="text-center py-12">
            <p className="text-slate-500">Loading agent...</p>
          </div>
        )}

        {agent && (
          <div className="space-y-6">
            {/* View Profile Link */}
            <div className="flex justify-end">
              <Link 
                href={`/agent/${agent.id}`}
                className="text-sm text-indigo-600 hover:text-indigo-700 font-medium"
              >
                View public profile →
              </Link>
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

            {/* Capabilities */}
            <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
              <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-2">
                Capabilities
              </h2>
              <p className="text-xs text-slate-500 mb-4">
                Click to add or remove capabilities. Changes save immediately.
              </p>
              <div className="flex flex-wrap gap-2">
                {COMMON_CAPABILITIES.map((cap) => (
                  <button
                    key={cap.id}
                    type="button"
                    onClick={() => toggleCapability(cap.id)}
                    disabled={capLoading}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all disabled:opacity-50 ${
                      capabilities.includes(cap.id)
                        ? 'bg-indigo-600 text-white'
                        : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                    }`}
                  >
                    <span>{cap.icon}</span>
                    <span>{cap.label}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Linked Profiles */}
            <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
              <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-4">
                Linked Profiles
              </h2>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">🦞 Moltbook</label>
                  <input
                    type="text"
                    value={moltbook}
                    onChange={(e) => setMoltbook(e.target.value)}
                    placeholder="YourAgentName"
                    className="w-full px-4 py-3 border border-slate-200 rounded-xl text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-shadow"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">💻 GitHub</label>
                  <input
                    type="text"
                    value={github}
                    onChange={(e) => setGithub(e.target.value)}
                    placeholder="username"
                    className="w-full px-4 py-3 border border-slate-200 rounded-xl text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-shadow"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">𝕏 Twitter</label>
                  <input
                    type="text"
                    value={twitter}
                    onChange={(e) => setTwitter(e.target.value)}
                    placeholder="handle"
                    className="w-full px-4 py-3 border border-slate-200 rounded-xl text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-shadow"
                  />
                </div>
              </div>
            </div>

            {/* Payment */}
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
      </main>
    </div>
  );
}
