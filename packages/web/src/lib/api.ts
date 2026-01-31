const API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://api.ans-registry.org';

export interface AgentCapability {
  id: string;
  trustScore: number;
  verified: boolean;
}

export interface LinkedProfiles {
  moltbook?: string;
  github?: string;
  twitter?: string;
  discord?: string;
  website?: string;
}

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
  linkedProfiles?: LinkedProfiles;
  verificationTier?: number;
  verified?: boolean;
  trustScore?: number;
  capabilities?: AgentCapability[];
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

export interface Attestation {
  id: string;
  attesterId: string;
  subjectId: string;
  claimType: 'behavior' | 'capability' | 'identity';
  claimCapabilityId?: string;
  claimValue: boolean | number;
  signature: string;
  createdAt: string;
  expiresAt?: string;
}

export async function getAttestationsFor(agentId: string): Promise<{ attestations: Attestation[] }> {
  const res = await fetch(`${API_URL}/v1/attestations/subject/${agentId}`, {
    next: { revalidate: 60 },
  });
  if (!res.ok) throw new Error('Failed to get attestations');
  return res.json();
}

// Agent Card/Badge
export async function getAgentCardEmbed(agentId: string, style: string = 'flat'): Promise<{
  cardUrl: string;
  profileUrl: string;
  markdown: string;
  html: string;
  bbcode: string;
}> {
  const res = await fetch(`${API_URL}/v1/agents/${agentId}/card/embed?style=${style}`);
  if (!res.ok) throw new Error('Failed to get embed codes');
  return res.json();
}

// Auth helpers
export function getAuthHeaders(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

// Notifications
export interface Notification {
  id: string;
  agentId: string;
  type: 'attestation_received' | 'message_received' | 'mention' | 'system';
  payload: Record<string, any>;
  read: boolean;
  createdAt: string;
}

export async function getNotifications(
  token: string,
  options?: { limit?: number; offset?: number; unread?: boolean }
): Promise<{ notifications: Notification[]; unreadCount: number }> {
  const params = new URLSearchParams();
  if (options?.limit) params.set('limit', String(options.limit));
  if (options?.offset) params.set('offset', String(options.offset));
  if (options?.unread) params.set('unread', 'true');

  const res = await fetch(`${API_URL}/v1/notifications?${params}`, {
    headers: getAuthHeaders(token),
  });
  if (!res.ok) throw new Error('Failed to get notifications');
  return res.json();
}

export async function getNotificationCount(token: string): Promise<{ unreadCount: number }> {
  const res = await fetch(`${API_URL}/v1/notifications/count`, {
    headers: getAuthHeaders(token),
  });
  if (!res.ok) throw new Error('Failed to get notification count');
  return res.json();
}

export async function markNotificationRead(notificationId: string, token: string): Promise<void> {
  const res = await fetch(`${API_URL}/v1/notifications/${notificationId}/read`, {
    method: 'PATCH',
    headers: getAuthHeaders(token),
  });
  if (!res.ok) throw new Error('Failed to mark notification as read');
}

export async function markAllNotificationsRead(token: string): Promise<void> {
  const res = await fetch(`${API_URL}/v1/notifications/read-all`, {
    method: 'PATCH',
    headers: getAuthHeaders(token),
  });
  if (!res.ok) throw new Error('Failed to mark all notifications as read');
}

// Messages
export interface Message {
  id: string;
  fromAgentId: string;
  fromAgentName?: string;
  toAgentId: string;
  toAgentName?: string;
  content: string;
  createdAt: string;
  readAt?: string;
}

export async function sendMessage(
  toAgentId: string,
  content: string,
  token: string
): Promise<Message> {
  const res = await fetch(`${API_URL}/v1/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...getAuthHeaders(token),
    },
    body: JSON.stringify({ toAgentId, content }),
  });
  if (!res.ok) {
    const data = await res.json();
    throw new Error(data.error || 'Failed to send message');
  }
  return res.json();
}

export async function getMessages(
  token: string,
  options?: { view?: 'inbox' | 'sent' | 'all'; limit?: number; offset?: number }
): Promise<{ messages: Message[] }> {
  const params = new URLSearchParams();
  if (options?.view) params.set('view', options.view);
  if (options?.limit) params.set('limit', String(options.limit));
  if (options?.offset) params.set('offset', String(options.offset));

  const res = await fetch(`${API_URL}/v1/messages?${params}`, {
    headers: getAuthHeaders(token),
  });
  if (!res.ok) throw new Error('Failed to get messages');
  return res.json();
}

export async function getMessage(messageId: string, token: string): Promise<Message> {
  const res = await fetch(`${API_URL}/v1/messages/${messageId}`, {
    headers: getAuthHeaders(token),
  });
  if (!res.ok) throw new Error('Failed to get message');
  return res.json();
}
