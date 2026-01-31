const API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://api.ans-registry.org';

export interface Agent {
  id: string;
  name: string;
  publicKey: string;
  type: 'assistant' | 'autonomous' | 'tool' | 'service';
  endpoint?: string;
  protocols: string[];
  description?: string;
  avatar?: string;
  homepage?: string;
  tags: string[];
  operatorId?: string;
  operatorName?: string;
  paymentMethods: {
    type: string;
    address: string;
    label?: string;
  }[];
  status: 'online' | 'offline' | 'maintenance' | 'unknown';
  lastSeen?: string;
  createdAt: string;
  updatedAt: string;
}

export async function getAgents(limit = 20, offset = 0): Promise<{ agents: Agent[]; limit: number; offset: number }> {
  const res = await fetch(`${API_URL}/v1/agents?limit=${limit}&offset=${offset}`, {
    next: { revalidate: 60 },
  });
  if (!res.ok) throw new Error('Failed to fetch agents');
  return res.json();
}

export async function getAgent(id: string): Promise<Agent> {
  const res = await fetch(`${API_URL}/v1/agents/${id}`, {
    next: { revalidate: 60 },
  });
  if (!res.ok) throw new Error('Agent not found');
  return res.json();
}

export async function searchAgents(query: string): Promise<{ agents: Agent[] }> {
  const res = await fetch(`${API_URL}/v1/discover/search?q=${encodeURIComponent(query)}&limit=20`);
  if (!res.ok) throw new Error('Search failed');
  return res.json();
}

export async function getReputation(agentId: string): Promise<{
  agentId: string;
  trustScore: number;
  breakdown: {
    behaviorScore: number;
    capabilityScore: number;
    attesterBonus: number;
    uniqueAttesters: number;
  };
  attestationCounts: {
    total: number;
    behavior: number;
    capability: number;
    identity: number;
  };
  verifiedCapabilities: string[];
}> {
  const res = await fetch(`${API_URL}/v1/reputation/${agentId}`, {
    next: { revalidate: 60 },
  });
  if (!res.ok) throw new Error('Failed to get reputation');
  return res.json();
}

export async function discoverAgents(options: {
  tags?: string[];
  types?: string[];
  protocols?: string[];
  status?: string[];
  query?: string;
  limit?: number;
}): Promise<{ agents: Agent[]; total: number; hasMore: boolean }> {
  const res = await fetch(`${API_URL}/v1/discover`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(options),
  });
  if (!res.ok) throw new Error('Discovery failed');
  return res.json();
}
