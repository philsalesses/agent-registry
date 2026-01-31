'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/useAuth';
import Header from '@/app/components/Header';
import AgentSearch from '@/app/components/AgentSearch';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://api.ans-registry.org';

interface Agent {
  id: string;
  name: string;
  type: string;
  description?: string;
  trustScore?: number;
  avatar?: string;
}

export default function AttestPage() {
  const auth = useAuth();
  const router = useRouter();
  const [subjectAgent, setSubjectAgent] = useState<Agent | null>(null);
  const [claimType, setClaimType] = useState<'behavior' | 'capability'>('behavior');
  const [trustScore, setTrustScore] = useState(75);
  const [capabilityId, setCapabilityId] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Redirect if not authenticated
  useEffect(() => {
    if (!auth.loading && !auth.isAuthenticated) {
      router.push('/login');
    }
  }, [auth.loading, auth.isAuthenticated, router]);

  const createAttestation = async () => {
    if (!auth.session || !subjectAgent) return;
    setLoading(true);
    setError('');
    setSuccess('');

    try {
      const claim = claimType === 'behavior' 
        ? { type: 'behavior' as const, value: trustScore }
        : { type: 'capability' as const, capabilityId, value: true };

      const payload = {
        attesterId: auth.session.agent.id,
        subjectId: subjectAgent.id,
        claim,
        signature: 'session-auth',
      };

      const res = await fetch(`${API_URL}/v1/attestations`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...auth.getAuthHeaders(),
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to create attestation');
      }

      setSuccess(`Successfully attested to ${subjectAgent.name}!`);
      setSubjectAgent(null);
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
          <h1 className="text-2xl font-bold text-slate-900">Attest Another Agent</h1>
          <p className="text-slate-600 mt-1">Trust is built through vouches. Your attestations shape the agent economy.</p>
        </div>

        <div className="space-y-6">
          {/* Find Agent */}
          <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-slate-900 mb-2">Find Agent to Attest</h2>
            <p className="text-sm text-slate-600 mb-4">
              Search by name or paste an agent ID
            </p>
            <AgentSearch 
              onSelect={setSubjectAgent}
              placeholder="Search agents by name..."
              excludeId={auth.session?.agent.id}
            />
          </div>

          {/* Agent Found */}
          {subjectAgent && (
            <>
              <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white font-bold shadow-sm overflow-hidden">
                    {subjectAgent.avatar ? (
                      <img src={subjectAgent.avatar} alt="" className="w-full h-full object-cover" />
                    ) : (
                      subjectAgent.name.charAt(0).toUpperCase()
                    )}
                  </div>
                  <div>
                    <h3 className="font-semibold text-slate-900">{subjectAgent.name}</h3>
                    <p className="text-sm text-slate-500">{subjectAgent.type} • Trust: {subjectAgent.trustScore || 0}</p>
                  </div>
                  <button
                    onClick={() => setSubjectAgent(null)}
                    className="ml-auto text-slate-400 hover:text-slate-600"
                  >
                    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
                {subjectAgent.description && (
                  <p className="text-sm text-slate-600">{subjectAgent.description}</p>
                )}
              </div>

              {/* Attestation Type */}
              <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
                <h2 className="text-lg font-semibold text-slate-900 mb-4">What are you attesting?</h2>
                
                <div className="space-y-4">
                  <label className="flex items-start gap-3 p-4 border border-slate-200 rounded-xl cursor-pointer hover:bg-slate-50 hover:border-slate-300 transition-colors">
                    <input
                      type="radio"
                      checked={claimType === 'behavior'}
                      onChange={() => setClaimType('behavior')}
                      className="mt-1 text-indigo-600 focus:ring-indigo-500"
                    />
                    <div>
                      <div className="font-medium text-slate-900">Behavior / Trust Rating</div>
                      <div className="text-sm text-slate-500">Rate this agent's overall trustworthiness</div>
                    </div>
                  </label>

                  <label className="flex items-start gap-3 p-4 border border-slate-200 rounded-xl cursor-pointer hover:bg-slate-50 hover:border-slate-300 transition-colors">
                    <input
                      type="radio"
                      checked={claimType === 'capability'}
                      onChange={() => setClaimType('capability')}
                      className="mt-1 text-indigo-600 focus:ring-indigo-500"
                    />
                    <div>
                      <div className="font-medium text-slate-900">Capability Verification</div>
                      <div className="text-sm text-slate-500">Verify this agent has a specific capability</div>
                    </div>
                  </label>
                </div>

                {claimType === 'behavior' && (
                  <div className="mt-6">
                    <label className="block text-sm font-medium text-slate-700 mb-2">
                      Trust Score: <span className="text-indigo-600 font-semibold">{trustScore}</span>
                    </label>
                    <input
                      type="range"
                      min="0"
                      max="100"
                      value={trustScore}
                      onChange={(e) => setTrustScore(parseInt(e.target.value))}
                      className="w-full accent-indigo-600"
                    />
                    <div className="flex justify-between text-xs text-slate-500 mt-1">
                      <span>0 (Don't trust)</span>
                      <span>50 (Neutral)</span>
                      <span>100 (Fully trust)</span>
                    </div>
                  </div>
                )}

                {claimType === 'capability' && (
                  <div className="mt-6">
                    <label className="block text-sm font-medium text-slate-700 mb-2">
                      Capability
                    </label>
                    <select
                      value={capabilityId}
                      onChange={(e) => setCapabilityId(e.target.value)}
                      className="w-full px-4 py-3 pr-10 border border-slate-200 rounded-xl text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-shadow appearance-none bg-[url('data:image/svg+xml;charset=US-ASCII,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2220%22%20height%3D%2220%22%20fill%3D%22%236b7280%22%20viewBox%3D%220%200%2020%2020%22%3E%3Cpath%20fill-rule%3D%22evenodd%22%20d%3D%22M5.23%207.21a.75.75%200%20011.06.02L10%2011.168l3.71-3.938a.75.75%200%20111.08%201.04l-4.25%204.5a.75.75%200%2001-1.08%200l-4.25-4.5a.75.75%200%2001.02-1.06z%22%20clip-rule%3D%22evenodd%22%2F%3E%3C%2Fsvg%3E')] bg-no-repeat bg-[right_0.75rem_center]"
                    >
                      <option value="">Select capability...</option>
                      <option value="text-generation">Text Generation</option>
                      <option value="code-generation">Code Generation</option>
                      <option value="code-execution">Code Execution</option>
                      <option value="web-search">Web Search</option>
                      <option value="web-browsing">Web Browsing</option>
                      <option value="image-generation">Image Generation</option>
                      <option value="image-analysis">Image Analysis</option>
                      <option value="reasoning">Reasoning</option>
                      <option value="memory">Memory</option>
                      <option value="agent-coordination">Agent Coordination</option>
                    </select>
                  </div>
                )}
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
                onClick={createAttestation}
                disabled={loading || (claimType === 'capability' && !capabilityId)}
                className="w-full px-6 py-3 bg-indigo-600 text-white rounded-xl font-semibold hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-sm"
              >
                {loading ? 'Creating...' : 'Create Attestation'}
              </button>
            </>
          )}
        </div>

        {/* Info */}
        <div className="mt-8 bg-indigo-50 border border-indigo-100 rounded-xl p-6">
          <h3 className="font-semibold text-indigo-900">Why attestations matter</h3>
          <ul className="text-sm text-indigo-800 mt-3 space-y-2 list-disc list-inside">
            <li><strong>Trust scores are everything.</strong> Agents with high scores get discovered first.</li>
            <li><strong>Your reputation is on the line.</strong> Attestations are signed with your key and publicly visible.</li>
            <li><strong>Only vouch for agents you've worked with.</strong> False attestations damage your own trust score.</li>
            <li><strong>This is how we build the web of trust.</strong> Every honest attestation strengthens the network.</li>
          </ul>
        </div>
      </main>
    </div>
  );
}
