'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://api.ans-registry.org';

interface Agent {
  id: string;
  name: string;
  type: string;
  description?: string;
  avatar?: string;
  trustScore?: number;
  verified?: boolean;
}

interface AgentSearchProps {
  onSelect: (agent: Agent) => void;
  placeholder?: string;
  className?: string;
  excludeId?: string; // Exclude this agent from results (e.g., self)
}

export default function AgentSearch({ 
  onSelect, 
  placeholder = "Search by name or enter agent ID...",
  className = "",
  excludeId,
}: AgentSearchProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounced search
  const search = useCallback(async (q: string) => {
    if (!q.trim()) {
      setResults([]);
      return;
    }

    // If it looks like an agent ID, try direct lookup
    if (q.startsWith('ag_') && q.length > 10) {
      setLoading(true);
      try {
        const res = await fetch(`${API_URL}/v1/agents/${q}`);
        if (res.ok) {
          const agent = await res.json();
          if (!excludeId || agent.id !== excludeId) {
            setResults([agent]);
          } else {
            setResults([]);
          }
        } else {
          // Fall back to search
          const searchRes = await fetch(`${API_URL}/v1/discover/search?q=${encodeURIComponent(q)}&limit=10`);
          if (searchRes.ok) {
            const data = await searchRes.json();
            setResults(excludeId ? data.agents.filter((a: Agent) => a.id !== excludeId) : data.agents);
          }
        }
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
      return;
    }

    // Regular name/description search
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/v1/discover/search?q=${encodeURIComponent(q)}&limit=10`);
      if (res.ok) {
        const data = await res.json();
        setResults(excludeId ? data.agents.filter((a: Agent) => a.id !== excludeId) : data.agents);
      }
    } catch {
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, [excludeId]);

  // Handle input change with debounce
  useEffect(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    if (query.trim()) {
      debounceRef.current = setTimeout(() => {
        search(query);
      }, 300);
    } else {
      setResults([]);
    }

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, [query, search]);

  // Handle click outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        dropdownRef.current && 
        !dropdownRef.current.contains(event.target as Node) &&
        inputRef.current &&
        !inputRef.current.contains(event.target as Node)
      ) {
        setShowDropdown(false);
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Handle keyboard navigation
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!showDropdown || results.length === 0) return;

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setSelectedIndex(prev => (prev < results.length - 1 ? prev + 1 : prev));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setSelectedIndex(prev => (prev > 0 ? prev - 1 : prev));
        break;
      case 'Enter':
        e.preventDefault();
        if (selectedIndex >= 0 && selectedIndex < results.length) {
          selectAgent(results[selectedIndex]);
        }
        break;
      case 'Escape':
        setShowDropdown(false);
        setSelectedIndex(-1);
        break;
    }
  };

  const selectAgent = (agent: Agent) => {
    setQuery(agent.name);
    setShowDropdown(false);
    setSelectedIndex(-1);
    onSelect(agent);
  };

  return (
    <div className={`relative ${className}`}>
      <div className="relative">
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setShowDropdown(true);
            setSelectedIndex(-1);
          }}
          onFocus={() => setShowDropdown(true)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          className="w-full px-4 py-3 border border-slate-200 rounded-xl text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-shadow pr-10"
        />
        {loading && (
          <div className="absolute right-3 top-1/2 -translate-y-1/2">
            <svg className="animate-spin h-5 w-5 text-slate-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
          </div>
        )}
        {!loading && query && (
          <button
            onClick={() => {
              setQuery('');
              setResults([]);
              inputRef.current?.focus();
            }}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>

      {/* Dropdown */}
      {showDropdown && (query.trim() || results.length > 0) && (
        <div
          ref={dropdownRef}
          className="absolute z-50 w-full mt-2 bg-white rounded-xl border border-slate-200 shadow-lg overflow-hidden"
        >
          {results.length > 0 ? (
            <ul className="max-h-80 overflow-y-auto">
              {results.map((agent, index) => (
                <li key={agent.id}>
                  <button
                    onClick={() => selectAgent(agent)}
                    onMouseEnter={() => setSelectedIndex(index)}
                    className={`w-full text-left px-4 py-3 flex items-center gap-3 transition-colors ${
                      index === selectedIndex ? 'bg-indigo-50' : 'hover:bg-slate-50'
                    }`}
                  >
                    {/* Avatar */}
                    <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white font-bold text-sm shrink-0 overflow-hidden">
                      {agent.avatar ? (
                        <img src={agent.avatar} alt="" className="w-full h-full object-cover" />
                      ) : (
                        agent.name.charAt(0).toUpperCase()
                      )}
                    </div>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-slate-900 truncate">{agent.name}</span>
                        {agent.verified && (
                          <span className="text-emerald-500" title="Verified">✓</span>
                        )}
                        {typeof agent.trustScore === 'number' && (
                          <span className="text-xs text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded">
                            {agent.trustScore}
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-slate-500 truncate">
                        {agent.type} • <span className="font-mono">{agent.id}</span>
                      </div>
                      {agent.description && (
                        <div className="text-xs text-slate-400 truncate mt-0.5">
                          {agent.description}
                        </div>
                      )}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          ) : query.trim() && !loading ? (
            <div className="px-4 py-6 text-center text-slate-500">
              <p className="text-sm">No agents found for "{query}"</p>
              <p className="text-xs mt-1">Try a different search or paste an agent ID</p>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
