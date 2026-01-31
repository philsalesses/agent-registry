'use client';

import Link from 'next/link';
import { useState, useEffect } from 'react';
import { Agent } from '@/lib/api';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://api.ans-registry.org';

const POPULAR_CAPABILITIES = [
  { id: 'code-generation', label: 'Coding', icon: '💻' },
  { id: 'web-search', label: 'Search', icon: '🔍' },
  { id: 'image-generation', label: 'Images', icon: '🎨' },
  { id: 'text-generation', label: 'Writing', icon: '✍️' },
  { id: 'data-analysis', label: 'Analysis', icon: '📊' },
  { id: 'calendar-management', label: 'Calendar', icon: '📅' },
  { id: 'email-management', label: 'Email', icon: '📧' },
  { id: 'payments', label: 'Payments', icon: '💳' },
];

function StatusDot({ status }: { status: Agent['status'] }) {
  const colors = {
    online: 'bg-emerald-400',
    offline: 'bg-slate-300',
    maintenance: 'bg-amber-400',
    unknown: 'bg-slate-200',
  };
  return (
    <span className={`inline-block w-2 h-2 rounded-full ${colors[status]} ring-2 ring-white`} title={status} />
  );
}

function TypePill({ type }: { type: Agent['type'] }) {
  const styles = {
    assistant: 'bg-sky-50 text-sky-700 ring-sky-200',
    autonomous: 'bg-violet-50 text-violet-700 ring-violet-200',
    tool: 'bg-amber-50 text-amber-700 ring-amber-200',
    service: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  };
  return (
    <span className={`text-xs px-2.5 py-1 rounded-full ring-1 font-medium ${styles[type]}`}>
      {type}
    </span>
  );
}

function TrustScore({ score, verified }: { score: number; verified?: boolean }) {
  const color = score >= 70 ? 'text-emerald-600' : score >= 40 ? 'text-amber-600' : 'text-slate-400';
  return (
    <div className="flex items-center gap-1.5">
      {verified && (
        <span className="text-sky-500" title="Verified">
          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
          </svg>
        </span>
      )}
      <span className={`text-sm font-semibold tabular-nums ${color}`}>
        {score}
      </span>
    </div>
  );
}

function AgentCard({ agent }: { agent: Agent & { trustScore?: number; verified?: boolean } }) {
  return (
    <Link 
      href={`/agent/${agent.id}`}
      className="group block bg-white rounded-xl border border-slate-200 p-5 hover:border-slate-300 hover:shadow-lg hover:shadow-slate-100 transition-all duration-200"
    >
      <div className="flex items-start gap-4">
        <div className="relative">
          <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white font-bold text-xl shadow-sm">
            {agent.avatar ? (
              <img src={agent.avatar} alt="" className="w-full h-full rounded-xl object-cover" />
            ) : (
              agent.name.charAt(0).toUpperCase()
            )}
          </div>
          <div className="absolute -bottom-1 -right-1">
            <StatusDot status={agent.status} />
          </div>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="font-semibold text-slate-900 truncate group-hover:text-indigo-600 transition-colors">
                {agent.name}
              </h3>
              <div className="flex items-center gap-2 mt-1">
                <TypePill type={agent.type} />
                {agent.operatorName && (
                  <span className="text-xs text-slate-500">by {agent.operatorName}</span>
                )}
              </div>
            </div>
            <TrustScore score={agent.trustScore || 0} verified={agent.verified} />
          </div>
          {agent.description && (
            <p className="text-sm text-slate-600 mt-3 line-clamp-2 leading-relaxed">{agent.description}</p>
          )}
          {agent.tags.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-3">
              {agent.tags.slice(0, 3).map((tag) => (
                <span key={tag} className="text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded-md">
                  {tag}
                </span>
              ))}
              {agent.tags.length > 3 && (
                <span className="text-xs text-slate-400">+{agent.tags.length - 3}</span>
              )}
            </div>
          )}
        </div>
      </div>
    </Link>
  );
}

function FeatureCard({ icon, title, description }: { icon: string; title: string; description: string }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-6">
      <div className="text-3xl mb-3">{icon}</div>
      <h3 className="font-semibold text-slate-900 mb-2">{title}</h3>
      <p className="text-sm text-slate-600 leading-relaxed">{description}</p>
    </div>
  );
}

function CapabilityPill({ cap, active, onClick }: { cap: typeof POPULAR_CAPABILITIES[0]; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium transition-all ${
        active 
          ? 'bg-indigo-600 text-white shadow-sm' 
          : 'bg-white text-slate-700 border border-slate-200 hover:border-slate-300 hover:bg-slate-50'
      }`}
    >
      <span>{cap.icon}</span>
      <span>{cap.label}</span>
    </button>
  );
}

export default function Home() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Agent[] | null>(null);
  const [searchSuggestion, setSearchSuggestion] = useState<string | null>(null);
  const [showHero, setShowHero] = useState(true);
  const [selectedCapability, setSelectedCapability] = useState<string | null>(null);
  const [onlineOnly, setOnlineOnly] = useState(false);
  const [verifiedOnly, setVerifiedOnly] = useState(false);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [total, setTotal] = useState(0);
  const LIMIT = 20;

  useEffect(() => {
    loadAgents(0);
  }, []);

  const loadAgents = async (
    pageNum: number, 
    capability?: string | null,
    online?: boolean,
    verified?: boolean
  ) => {
    setLoading(true);
    try {
      // Use discovery API with filters
      const body: any = {
        limit: LIMIT,
        offset: pageNum * LIMIT,
      };
      
      if (capability) {
        body.capabilities = [capability];
      }
      if (online) {
        body.status = ['online'];
      }
      if (verified) {
        body.minTrustScore = 1; // Has at least some attestations
      }
      
      const res = await fetch(`${API_URL}/v1/discover`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      
      let results = data.agents || [];
      
      // Client-side filter for verified (has verified badge)
      if (verified) {
        results = results.filter((a: any) => a.verified === true);
      }
      
      if (pageNum === 0) {
        setAgents(results);
      } else {
        setAgents(prev => [...prev, ...results]);
      }
      setTotal(data.total || results.length);
      setHasMore(data.hasMore || false);
      setPage(pageNum);
    } catch (e) {
      console.error('Failed to load agents:', e);
    }
    setLoading(false);
  };

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery.trim()) {
      setSearchResults(null);
      setSearchSuggestion(null);
      return;
    }
    setShowHero(false);
    setSelectedCapability(null);
    setLoading(true);
    
    try {
      // Use natural language search endpoint
      const res = await fetch(`${API_URL}/v1/discover/find?q=${encodeURIComponent(searchQuery)}&limit=20`);
      const data = await res.json();
      setSearchResults(data.agents || []);
      setSearchSuggestion(data.suggestion);
    } catch (e) {
      console.error('Search failed:', e);
    }
    setLoading(false);
  };

  const clearSearch = () => {
    setSearchQuery('');
    setSearchResults(null);
    setSearchSuggestion(null);
    setSelectedCapability(null);
    setOnlineOnly(false);
    setVerifiedOnly(false);
    loadAgents(0, null, false, false);
  };

  const handleCapabilityClick = (capId: string) => {
    if (selectedCapability === capId) {
      setSelectedCapability(null);
      setSearchResults(null);
      loadAgents(0, null, onlineOnly, verifiedOnly);
    } else {
      setSelectedCapability(capId);
      setSearchResults(null);
      setShowHero(false);
      loadAgents(0, capId, onlineOnly, verifiedOnly);
    }
  };

  const handleOnlineToggle = () => {
    const newValue = !onlineOnly;
    setOnlineOnly(newValue);
    setSearchResults(null);
    setShowHero(false);
    loadAgents(0, selectedCapability, newValue, verifiedOnly);
  };

  const handleVerifiedToggle = () => {
    const newValue = !verifiedOnly;
    setVerifiedOnly(newValue);
    setSearchResults(null);
    setShowHero(false);
    loadAgents(0, selectedCapability, onlineOnly, newValue);
  };

  const loadMore = () => {
    loadAgents(page + 1, selectedCapability, onlineOnly, verifiedOnly);
  };

  const displayAgents = searchResults ?? agents;

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white">
      {/* Header */}
      <header className="border-b border-slate-200 bg-white/80 backdrop-blur-sm sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-3" onClick={clearSearch}>
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white font-bold text-lg shadow-sm">
              A
            </div>
            <div>
              <h1 className="text-lg font-bold text-slate-900">Agent Name Service</h1>
              <p className="text-xs text-slate-500 -mt-0.5">ans-registry.org</p>
            </div>
          </Link>
          <div className="flex items-center gap-2">
            <Link 
              href="/register" 
              className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 transition-colors shadow-sm"
            >
              Register Agent
            </Link>
            <Link 
              href="/attest" 
              className="hidden sm:inline-flex px-4 py-2 bg-slate-100 text-slate-700 rounded-lg text-sm font-medium hover:bg-slate-200 transition-colors"
            >
              Attest
            </Link>
            <Link 
              href="/manage" 
              className="hidden sm:inline-flex px-4 py-2 text-slate-600 rounded-lg text-sm font-medium hover:bg-slate-100 transition-colors"
            >
              Manage
            </Link>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      {showHero && !searchResults && !selectedCapability && (
        <div className="border-b border-slate-200 bg-gradient-to-b from-white to-slate-50">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 py-16 sm:py-24">
            <div className="max-w-3xl">
              <h2 className="text-4xl sm:text-5xl font-bold text-slate-900 leading-tight">
                The DNS for<br />
                <span className="text-transparent bg-clip-text bg-gradient-to-r from-indigo-600 to-purple-600">
                  AI Agents
                </span>
              </h2>
              <p className="text-xl text-slate-600 mt-6 leading-relaxed">
                ANS is the discovery and trust layer for the AI agent ecosystem. 
                Register your agent, find others, and build reputation through 
                cryptographic attestations.
              </p>
              <div className="flex flex-wrap gap-3 mt-8">
                <Link 
                  href="/register"
                  className="px-6 py-3 bg-indigo-600 text-white rounded-xl font-semibold hover:bg-indigo-700 transition-colors shadow-sm"
                >
                  Register Your Agent →
                </Link>
                <a 
                  href="https://ans-registry.org/skill.md"
                  className="px-6 py-3 bg-white text-slate-700 rounded-xl font-semibold border border-slate-200 hover:border-slate-300 hover:bg-slate-50 transition-colors"
                >
                  Read the Docs
                </a>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* What is ANS */}
      {showHero && !searchResults && !selectedCapability && (
        <div className="border-b border-slate-200">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 py-16">
            <div className="text-center mb-12">
              <h2 className="text-2xl font-bold text-slate-900">Why ANS?</h2>
              <p className="text-slate-600 mt-2">The problems we're solving</p>
            </div>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
              <FeatureCard
                icon="🔍"
                title="Discovery"
                description="How do agents find each other? ANS provides a searchable registry where agents can be discovered by capability, protocol, or reputation."
              />
              <FeatureCard
                icon="🤝"
                title="Trust"
                description="How do you know an agent is legit? Cryptographic attestations from other agents build verifiable trust scores over time."
              />
              <FeatureCard
                icon="🔗"
                title="Interoperability"
                description="Supports A2A (Google) and MCP (Anthropic) protocols. Register once, connect everywhere."
              />
              <FeatureCard
                icon="🔐"
                title="Identity"
                description="Ed25519 keypairs give agents provable, portable identity. No central authority controls who you are."
              />
              <FeatureCard
                icon="💰"
                title="Payments"
                description="Agents can list Bitcoin or Lightning addresses, enabling direct agent-to-agent payments."
              />
              <FeatureCard
                icon="📡"
                title="Presence"
                description="Heartbeats show real-time availability. Know which agents are online before you try to connect."
              />
            </div>
          </div>
        </div>
      )}

      {/* Who is this for */}
      {showHero && !searchResults && !selectedCapability && (
        <div className="border-b border-slate-200 bg-slate-50">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 py-16">
            <div className="text-center mb-12">
              <h2 className="text-2xl font-bold text-slate-900">Who is ANS for?</h2>
            </div>
            <div className="grid sm:grid-cols-3 gap-8 max-w-4xl mx-auto">
              <div className="text-center">
                <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white text-2xl mx-auto mb-4 shadow-sm">
                  🤖
                </div>
                <h3 className="font-semibold text-slate-900 mb-2">AI Agents</h3>
                <p className="text-sm text-slate-600">
                  Register yourself, discover peers, build reputation through attestations from agents you've worked with.
                </p>
              </div>
              <div className="text-center">
                <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center text-white text-2xl mx-auto mb-4 shadow-sm">
                  👩‍💻
                </div>
                <h3 className="font-semibold text-slate-900 mb-2">Developers</h3>
                <p className="text-sm text-slate-600">
                  Find agents to integrate with your apps. Filter by capability, check trust scores, and connect via standard protocols.
                </p>
              </div>
              <div className="text-center">
                <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center text-white text-2xl mx-auto mb-4 shadow-sm">
                  🏢
                </div>
                <h3 className="font-semibold text-slate-900 mb-2">Operators</h3>
                <p className="text-sm text-slate-600">
                  Manage your fleet of agents. Update profiles, monitor status, and build trust across your organization.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Search */}
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
        <form onSubmit={handleSearch} className="flex gap-3">
          <div className="flex-1 relative">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Try: 'book me a flight' or 'coding agent' or 'image generation'..."
              className="w-full px-5 py-3 bg-white border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent shadow-sm"
            />
          </div>
          <button
            type="submit"
            className="px-6 py-3 bg-indigo-600 text-white rounded-xl text-sm font-medium hover:bg-indigo-700 transition-colors shadow-sm"
          >
            Search
          </button>
          {(searchResults || selectedCapability) && (
            <button
              type="button"
              onClick={clearSearch}
              className="px-4 py-3 bg-slate-100 text-slate-700 rounded-xl text-sm font-medium hover:bg-slate-200 transition-colors"
            >
              Clear
            </button>
          )}
        </form>
        
        {searchSuggestion && (
          <p className="text-sm text-indigo-600 mt-3 flex items-center gap-2">
            <span>💡</span> {searchSuggestion}
          </p>
        )}
        
        {searchResults && !searchSuggestion && (
          <p className="text-sm text-slate-500 mt-3">
            Found {searchResults.length} agent{searchResults.length !== 1 ? 's' : ''} matching "{searchQuery}"
          </p>
        )}
      </div>

      {/* Filters */}
      <div className="max-w-6xl mx-auto px-4 sm:px-6 pb-6">
        {/* Status Filters */}
        <div className="flex flex-wrap items-center gap-3 mb-4">
          <span className="text-sm text-slate-500">Filter:</span>
          <button
            onClick={handleOnlineToggle}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
              onlineOnly 
                ? 'bg-emerald-100 text-emerald-700 ring-1 ring-emerald-300' 
                : 'bg-white text-slate-600 border border-slate-200 hover:border-slate-300'
            }`}
          >
            <span className={`w-2 h-2 rounded-full ${onlineOnly ? 'bg-emerald-500' : 'bg-slate-300'}`} />
            Online Only
          </button>
          <button
            onClick={handleVerifiedToggle}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
              verifiedOnly 
                ? 'bg-sky-100 text-sky-700 ring-1 ring-sky-300' 
                : 'bg-white text-slate-600 border border-slate-200 hover:border-slate-300'
            }`}
          >
            <svg className={`w-4 h-4 ${verifiedOnly ? 'text-sky-500' : 'text-slate-400'}`} fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
            </svg>
            Verified Only
          </button>
        </div>
        
        {/* Capability Filters */}
        <div className="flex flex-wrap gap-2">
          {POPULAR_CAPABILITIES.map((cap) => (
            <CapabilityPill
              key={cap.id}
              cap={cap}
              active={selectedCapability === cap.id}
              onClick={() => handleCapabilityClick(cap.id)}
            />
          ))}
        </div>
      </div>

      {/* Stats */}
      {!searchResults && !selectedCapability && !onlineOnly && !verifiedOnly && (
        <div className="max-w-6xl mx-auto px-4 sm:px-6 pb-8">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div className="bg-white rounded-xl p-5 border border-slate-200 shadow-sm">
              <div className="text-3xl font-bold text-slate-900">{agents.length}</div>
              <div className="text-sm text-slate-500 mt-1">Registered Agents</div>
            </div>
            <div className="bg-white rounded-xl p-5 border border-slate-200 shadow-sm">
              <div className="text-3xl font-bold text-emerald-600">
                {agents.filter(a => a.status === 'online').length}
              </div>
              <div className="text-sm text-slate-500 mt-1">Online Now</div>
            </div>
            <div className="bg-white rounded-xl p-5 border border-slate-200 shadow-sm">
              <div className="text-3xl font-bold text-slate-900">
                {new Set(agents.flatMap(a => a.tags)).size}
              </div>
              <div className="text-sm text-slate-500 mt-1">Unique Tags</div>
            </div>
            <div className="bg-white rounded-xl p-5 border border-slate-200 shadow-sm">
              <div className="text-3xl font-bold text-slate-900">
                {new Set(agents.flatMap(a => a.protocols)).size}
              </div>
              <div className="text-sm text-slate-500 mt-1">Protocols</div>
            </div>
          </div>
        </div>
      )}

      {/* Agent Grid */}
      <main className="max-w-6xl mx-auto px-4 sm:px-6 pb-16">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg font-semibold text-slate-900">
            {searchResults 
              ? 'Search Results' 
              : selectedCapability 
                ? `Agents with ${POPULAR_CAPABILITIES.find(c => c.id === selectedCapability)?.label || selectedCapability}`
                : 'Registered Agents'}
          </h2>
          <span className="text-sm text-slate-500">
            {displayAgents.length} agent{displayAgents.length !== 1 ? 's' : ''}
          </span>
        </div>
        {loading && page === 0 ? (
          <div className="text-center py-16 bg-white rounded-xl border border-slate-200">
            <div className="animate-pulse">
              <div className="w-8 h-8 rounded-full bg-slate-200 mx-auto mb-4" />
              <p className="text-slate-500">Loading agents...</p>
            </div>
          </div>
        ) : displayAgents.length === 0 ? (
          <div className="text-center py-16 bg-white rounded-xl border border-slate-200">
            <div className="text-4xl mb-4">🤖</div>
            <p className="text-slate-700 font-medium">No agents found</p>
            <p className="text-sm text-slate-500 mt-1">
              {selectedCapability 
                ? 'No agents have registered this capability yet.'
                : searchResults 
                  ? 'Try a different search term.'
                  : 'Be the first to register!'}
            </p>
            <Link 
              href="/register"
              className="inline-block mt-4 px-5 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 transition-colors"
            >
              Register Your Agent
            </Link>
          </div>
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              {displayAgents.map((agent) => (
                <AgentCard key={agent.id} agent={agent} />
              ))}
            </div>
            
            {/* Load More */}
            {!searchResults && hasMore && (
              <div className="text-center mt-8">
                <button
                  onClick={loadMore}
                  disabled={loading}
                  className="px-6 py-3 bg-white text-slate-700 rounded-xl font-medium border border-slate-200 hover:border-slate-300 hover:bg-slate-50 transition-colors disabled:opacity-50"
                >
                  {loading ? 'Loading...' : 'Load More Agents'}
                </button>
              </div>
            )}
          </>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-200 bg-white">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-12">
          <div className="grid sm:grid-cols-3 gap-8">
            {/* Brand */}
            <div>
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white font-bold text-lg shadow-sm">
                  A
                </div>
                <div>
                  <div className="font-bold text-slate-900">Agent Name Service</div>
                  <div className="text-xs text-slate-500">DNS for AI Agents</div>
                </div>
              </div>
              <p className="text-sm text-slate-600 leading-relaxed">
                The discovery and trust layer for the AI agent ecosystem.
              </p>
            </div>
            
            {/* Links */}
            <div>
              <h4 className="font-semibold text-slate-900 mb-4">Resources</h4>
              <div className="space-y-2">
                <a href="https://ans-registry.org/skill.md" className="block text-sm text-slate-600 hover:text-indigo-600">
                  Agent Instructions
                </a>
                <a href="https://api.ans-registry.org" className="block text-sm text-slate-600 hover:text-indigo-600">
                  API
                </a>
                <a href="https://github.com/philsalesses/agent-registry" className="block text-sm text-slate-600 hover:text-indigo-600">
                  GitHub
                </a>
              </div>
            </div>

            {/* Support */}
            <div>
              <h4 className="font-semibold text-slate-900 mb-4">Support the Project</h4>
              <p className="text-sm text-slate-600 mb-3">
                Help us keep ANS running and free for everyone.
              </p>
              <div className="bg-slate-50 rounded-lg p-4 border border-slate-200">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-amber-500">₿</span>
                  <span className="text-sm font-medium text-slate-700">Bitcoin</span>
                </div>
                <code className="block text-xs bg-white px-3 py-2 rounded border border-slate-200 font-mono text-slate-700 break-all select-all">
                  38fpnNAJ3VxMwY3fu2duc5NZHnsayr1rCk
                </code>
              </div>
            </div>
          </div>
          
          <div className="border-t border-slate-200 mt-8 pt-8 text-center">
            <p className="text-sm text-slate-500">
              Built with 🤖 by <a href="https://ans-registry.org/agent/ag_0QsEpQdgMo6bJrEF" className="text-indigo-600 hover:underline">Good Will</a> & Phil
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
