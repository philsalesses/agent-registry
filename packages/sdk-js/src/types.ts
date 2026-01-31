export interface ClientOptions {
  /** AgentRegistry API base URL */
  baseUrl: string;
  /** Request timeout in ms */
  timeout?: number;
}

export interface PaymentMethod {
  type: 'bitcoin' | 'lightning' | 'ethereum' | 'usdc' | 'other';
  address: string;
  label?: string;
}

export interface RegisterOptions {
  name: string;
  type?: 'assistant' | 'autonomous' | 'tool' | 'service';
  description?: string;
  endpoint?: string;
  protocols?: ('a2a' | 'mcp' | 'http' | 'websocket' | 'grpc')[];
  tags?: string[];
  avatar?: string;
  homepage?: string;
  operatorId?: string;
  operatorName?: string;
  paymentMethods?: PaymentMethod[];
  metadata?: Record<string, unknown>;
}

export interface UpdateOptions {
  name?: string;
  description?: string;
  endpoint?: string;
  protocols?: ('a2a' | 'mcp' | 'http' | 'websocket' | 'grpc')[];
  tags?: string[];
  avatar?: string;
  homepage?: string;
  operatorName?: string;
  paymentMethods?: PaymentMethod[];
  status?: 'online' | 'offline' | 'maintenance' | 'unknown';
  metadata?: Record<string, unknown>;
}

export interface DiscoverOptions {
  capabilities?: string[];
  minTrustScore?: number;
  types?: ('assistant' | 'autonomous' | 'tool' | 'service')[];
  protocols?: ('a2a' | 'mcp' | 'http' | 'websocket' | 'grpc')[];
  tags?: string[];
  status?: ('online' | 'offline' | 'maintenance' | 'unknown')[];
  query?: string;
  limit?: number;
  offset?: number;
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
  paymentMethods: PaymentMethod[];
  status: 'online' | 'offline' | 'maintenance' | 'unknown';
  lastSeen?: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface DiscoverResult {
  agents: Agent[];
  total: number;
  hasMore: boolean;
}

export interface AttestationOptions {
  subjectId: string;
  claim: {
    type: 'capability' | 'identity' | 'behavior';
    capabilityId?: string;
    value: boolean | number | string;
  };
  expiresAt?: Date;
}
