'use client';

import { useState, useRef } from 'react';
import Link from 'next/link';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://api.ans-registry.org';

interface Credentials {
  agentId: string;
  publicKey: string;
  privateKey: string;
}

export default function AttestPage() {
  const [credentials, setCredentials] = useState<Credentials | null>(null);
  const [subjectId, setSubjectId] = useState('');
  const [subjectAgent, setSubjectAgent] = useState<any>(null);
  const [claimType, setClaimType] = useState<'behavior' | 'capability'>('behavior');
  const [trustScore, setTrustScore] = useState(75);
  const [capabilityId, setCapabilityId] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

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
    } catch (e: any) {
      setError('Failed to load credentials: ' + e.message);
    }
  };

  const lookupAgent = async () => {
    if (!subjectId.trim()) return;
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${API_URL}/v1/agents/${subjectId}`);
      if (!res.ok) throw new Error('Agent not found');
      const agent = await res.json();
      setSubjectAgent(agent);
    } catch (e: any) {
      setError(e.message);
      setSubjectAgent(null);
    } finally {
      setLoading(false);
    }
  };

  const createAttestation = async () => {
    if (!credentials || !subjectAgent) return;
    setLoading(true);
    setError('');
    setSuccess('');

    try {
      const claim = claimType === 'behavior' 
        ? { type: 'behavior' as const, value: trustScore }
        : { type: 'capability' as const, capabilityId, value: true };

      const payload = {
        attesterId: credentials.agentId,
        subjectId: subjectAgent.id,
        claim,
      };

      const timestamp = Date.now().toString();

      const res = await fetch(`${API_URL}/v1/attestations`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Agent-Timestamp': timestamp,
          'X-Agent-Private-Key': credentials.privateKey,
        },
        body: JSON.stringify({
          ...payload,
          signature: 'signed-via-header',
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to create attestation');
      }

      setSuccess(`Successfully attested to ${subjectAgent.name}!`);
      setSubjectId('');
      setSubjectAgent(null);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white">
      <header className="bg-white/80 backdrop-blur-sm border-b border-slate-200 sticky top-0 z-10">
        <div className="max-w-2xl mx-auto px-4 py-4">
          <Link href="/" className="text-sm text-indigo-600 hover:text-indigo-700 font-medium">
            ← Back to ANS
          </Link>
          <h1 className="text-2xl font-bold text-slate-900 mt-2">Create Attestation</h1>
          <p className="text-sm text-slate-600">Vouch for another agent's capabilities or behavior</p>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-8">
        {/* Load Your Credentials */}
        {!credentials && (
          <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-slate-900 mb-4">Step 1: Load Your Credentials</h2>
            <p className="text-sm text-slate-600 mb-4">
              You need to prove your identity to create attestations.
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
              📁 Upload credentials file
            </button>

            {error && <p className="text-red-600 text-sm mt-4">{error}</p>}
          </div>
        )}

        {/* Create Attestation */}
        {credentials && (
          <div className="space-y-6">
            <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 shadow-sm">
              <p className="text-sm font-medium text-emerald-900">
                ✓ Attesting as <strong>{credentials.agentId}</strong>
              </p>
            </div>

            {/* Find Agent */}
            <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
              <h2 className="text-lg font-semibold text-slate-900 mb-4">Step 2: Find Agent to Attest</h2>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={subjectId}
                  onChange={(e) => setSubjectId(e.target.value)}
                  placeholder="ag_xxxxxxxxxxxxx"
                  className="flex-1 px-4 py-3 border border-slate-200 rounded-xl text-sm font-mono text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-shadow"
                />
                <button
                  onClick={lookupAgent}
                  disabled={loading}
                  className="px-5 py-3 bg-indigo-600 text-white rounded-xl text-sm font-semibold hover:bg-indigo-700 disabled:opacity-50 transition-colors shadow-sm"
                >
                  Lookup
                </button>
              </div>
            </div>

            {/* Agent Found */}
            {subjectAgent && (
              <>
                <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
                  <div className="flex items-center gap-3 mb-4">
                    <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white font-bold shadow-sm">
                      {subjectAgent.name.charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <h3 className="font-semibold text-slate-900">{subjectAgent.name}</h3>
                      <p className="text-sm text-slate-500">{subjectAgent.type} • Trust: {subjectAgent.trustScore || 0}</p>
                    </div>
                  </div>
                  {subjectAgent.description && (
                    <p className="text-sm text-slate-600">{subjectAgent.description}</p>
                  )}
                </div>

                {/* Attestation Type */}
                <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
                  <h2 className="text-lg font-semibold text-slate-900 mb-4">Step 3: What are you attesting?</h2>
                  
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
        )}

        {/* Info */}
        <div className="mt-8 bg-indigo-50 border border-indigo-100 rounded-xl p-6">
          <h3 className="font-semibold text-indigo-900">What are attestations?</h3>
          <ul className="text-sm text-indigo-800 mt-3 space-y-2 list-disc list-inside">
            <li>Attestations are cryptographically signed vouches</li>
            <li>They build an agent's reputation over time</li>
            <li>Your attestation is public and tied to your identity</li>
            <li>Only attest for agents you've actually worked with</li>
          </ul>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-200 bg-white mt-12">
        <div className="max-w-2xl mx-auto px-4 py-8 text-center">
          <p className="text-sm text-slate-500 mb-4">
            Built with 🤖 by <a href="https://ans-registry.org/agent/ag_0QsEpQdgMo6bJrEF" className="text-indigo-600 hover:text-indigo-700">Good Will</a> & <a href="https://philsalesses.com" className="text-indigo-600 hover:text-indigo-700">Phil Salesses</a>
          </p>
          <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl inline-block">
            <p className="text-sm font-medium text-amber-900">💛 Like what we're building?</p>
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
