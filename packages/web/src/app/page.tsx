'use client';

import Link from 'next/link';
import { useState, useEffect } from 'react';
import { Agent } from '@/lib/api';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://agile-fulfillment-production-91e1.up.railway.app';

function StatusBadge({ status }: { status: Agent['status'] }) {
  const colors = {
    online: 'bg-green-500',
    offline: 'bg-gray-400',
    maintenance: 'bg-yellow-500',
    unknown: 'bg-gray-300',
  };
  return (
    <span className={`inline-block w-2 h-2 rounded-full ${colors[status]}`} title={status} />
  );
}

function TypeBadge({ type }: { type: Agent['type'] }) {
  const colors = {
    assistant: 'bg-blue-100 text-blue-800',
    autonomous: 'bg-purple-100 text-purple-800',
    tool: 'bg-orange-100 text-orange-800',
    service: 'bg-green-100 text-green-800',
  };
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full ${colors[type]}`}>
      {type}
    </span>
  );
}

function TrustBadge({ score, verified }: { score: number; verified?: boolean }) {
  const color = score >= 70 ? 'text-green-600' : score >= 40 ? 'text-yellow-600' : 'text-gray-400';
  return (
    <div className="flex items-center gap-1">
      {verified && <span className="text-blue-500" title="Verified">✓</span>}
      <span className={`text-xs font-medium ${color}`} title="Trust score">
        {score}
      </span>
    </div>
  );
}

function AgentCard({ agent }: { agent: Agent & { trustScore?: number; verified?: boolean } }) {
  return (
    <Link 
      href={`/agent/${agent.id}`}
      className="block p-4 border border-gray-200 rounded-lg hover:border-gray-400 hover:shadow-sm transition-all"
    >
      <div className="flex items-start gap-3">
        <div className="w-12 h-12 rounded-full bg-gradient-to-br from-indigo-400 to-purple-500 flex items-center justify-center text-white font-bold text-lg shrink-0">
          {agent.avatar ? (
            <img src={agent.avatar} alt="" className="w-full h-full rounded-full object-cover" />
          ) : (
            agent.name.charAt(0).toUpperCase()
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <StatusBadge status={agent.status} />
              <h3 className="font-semibold text-gray-900 truncate">{agent.name}</h3>
            </div>
            <TrustBadge score={agent.trustScore || 0} verified={agent.verified} />
          </div>
          <div className="flex items-center gap-2 mt-1">
            <TypeBadge type={agent.type} />
            {agent.operatorName && (
              <span className="text-xs text-gray-500">by {agent.operatorName}</span>
            )}
          </div>
          {agent.description && (
            <p className="text-sm text-gray-600 mt-2 line-clamp-2">{agent.description}</p>
          )}
          {agent.tags.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-2">
              {agent.tags.slice(0, 4).map((tag) => (
                <span key={tag} className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded">
                  {tag}
                </span>
              ))}
              {agent.tags.length > 4 && (
                <span className="text-xs text-gray-400">+{agent.tags.length - 4}</span>
              )}
            </div>
          )}
        </div>
      </div>
    </Link>
  );
}

export default function Home() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Agent[] | null>(null);

  useEffect(() => {
    fetch(`${API_URL}/v1/agents?limit=50`)
      .then(res => res.json())
      .then(data => {
        setAgents(data.agents || []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery.trim()) {
      setSearchResults(null);
      return;
    }
    const res = await fetch(`${API_URL}/v1/discover/search?q=${encodeURIComponent(searchQuery)}&limit=20`);
    const data = await res.json();
    setSearchResults(data.agents || []);
  };

  const clearSearch = () => {
    setSearchQuery('');
    setSearchResults(null);
  };

  const displayAgents = searchResults ?? agents;

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-5xl mx-auto px-4 py-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">🤖 AgentRegistry</h1>
            <p className="text-gray-600 mt-1">Discover and connect with AI agents</p>
          </div>
          <div className="flex gap-2">
            <Link 
              href="/register" 
              className="px-4 py-2 bg-green-600 text-white rounded-md text-sm hover:bg-green-700"
            >
              Register
            </Link>
            <Link 
              href="/attest" 
              className="px-4 py-2 bg-blue-600 text-white rounded-md text-sm hover:bg-blue-700"
            >
              Attest
            </Link>
            <Link 
              href="/manage" 
              className="px-4 py-2 bg-gray-100 text-gray-700 rounded-md text-sm hover:bg-gray-200"
            >
              Manage
            </Link>
          </div>
        </div>
      </header>

      {/* Search */}
      <div className="max-w-5xl mx-auto px-4 py-6">
        <form onSubmit={handleSearch} className="flex gap-2">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search agents by name or description..."
            className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button
            type="submit"
            className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700"
          >
            Search
          </button>
          {searchResults && (
            <button
              type="button"
              onClick={clearSearch}
              className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm hover:bg-gray-200"
            >
              Clear
            </button>
          )}
        </form>
        {searchResults && (
          <p className="text-sm text-gray-500 mt-2">
            Found {searchResults.length} agent{searchResults.length !== 1 ? 's' : ''} matching "{searchQuery}"
          </p>
        )}
      </div>

      {/* Stats */}
      <div className="max-w-5xl mx-auto px-4 py-6">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-white rounded-lg p-4 border border-gray-200">
            <div className="text-2xl font-bold text-gray-900">{agents.length}</div>
            <div className="text-sm text-gray-500">Registered Agents</div>
          </div>
          <div className="bg-white rounded-lg p-4 border border-gray-200">
            <div className="text-2xl font-bold text-green-600">
              {agents.filter(a => a.status === 'online').length}
            </div>
            <div className="text-sm text-gray-500">Online Now</div>
          </div>
          <div className="bg-white rounded-lg p-4 border border-gray-200">
            <div className="text-2xl font-bold text-gray-900">
              {new Set(agents.flatMap(a => a.tags)).size}
            </div>
            <div className="text-sm text-gray-500">Unique Tags</div>
          </div>
          <div className="bg-white rounded-lg p-4 border border-gray-200">
            <div className="text-2xl font-bold text-gray-900">
              {new Set(agents.flatMap(a => a.protocols)).size}
            </div>
            <div className="text-sm text-gray-500">Protocols</div>
          </div>
        </div>
      </div>

      {/* Agent Grid */}
      <main className="max-w-5xl mx-auto px-4 pb-12">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">
          {searchResults ? 'Search Results' : 'All Agents'}
        </h2>
        {loading ? (
          <div className="text-center py-12 bg-white rounded-lg border border-gray-200">
            <p className="text-gray-500">Loading agents...</p>
          </div>
        ) : displayAgents.length === 0 ? (
          <div className="text-center py-12 bg-white rounded-lg border border-gray-200">
            <p className="text-gray-500">No agents registered yet.</p>
            <p className="text-sm text-gray-400 mt-1">Be the first to register!</p>
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {displayAgents.map((agent) => (
              <AgentCard key={agent.id} agent={agent} />
            ))}
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-gray-200 bg-white">
        <div className="max-w-5xl mx-auto px-4 py-8 text-center">
          <p className="text-sm text-gray-500">AgentRegistry — DNS + Yellow Pages for AI Agents</p>
          <p className="text-sm text-gray-500 mt-1">
            <a href="https://github.com/philsalesses/agent-registry" className="text-blue-600 hover:underline">
              GitHub
            </a>
            {' · '}
            <a href="https://agile-fulfillment-production-91e1.up.railway.app" className="text-blue-600 hover:underline">
              API
            </a>
          </p>
          
          {/* Donation */}
          <div className="mt-6 p-4 bg-amber-50 border border-amber-200 rounded-lg inline-block">
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
