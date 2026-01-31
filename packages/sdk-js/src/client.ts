import { AgentIdentity } from './identity';
import type {
  ClientOptions,
  RegisterOptions,
  UpdateOptions,
  DiscoverOptions,
  DiscoverResult,
  AttestationOptions,
  Agent,
} from './types';

/**
 * Client for interacting with AgentRegistry API
 */
export class AgentRegistryClient {
  private baseUrl: string;
  private timeout: number;
  private identity?: AgentIdentity;

  constructor(options: ClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    this.timeout = options.timeout || 30000;
  }

  /**
   * Set the identity to use for authenticated requests
   */
  setIdentity(identity: AgentIdentity): void {
    this.identity = identity;
  }

  /**
   * Get the current identity
   */
  getIdentity(): AgentIdentity | undefined {
    return this.identity;
  }

  // ===========================================================================
  // Agent Registration & Management
  // ===========================================================================

  /**
   * Register a new agent
   */
  async register(options: RegisterOptions): Promise<Agent> {
    if (!this.identity) {
      throw new Error('Identity required. Call setIdentity() first or use registerWithNewIdentity()');
    }

    const response = await this.fetch('/v1/agents', {
      method: 'POST',
      body: JSON.stringify({
        ...options,
        publicKey: this.identity.publicKey,
      }),
    });

    return response;
  }

  /**
   * Create a new identity and register in one step
   */
  async registerWithNewIdentity(options: RegisterOptions): Promise<{
    agent: Agent;
    identity: AgentIdentity;
  }> {
    const identity = await AgentIdentity.create();
    this.identity = identity;

    const agent = await this.register(options);
    return { agent, identity };
  }

  /**
   * Get an agent by ID
   */
  async getAgent(agentId: string): Promise<Agent> {
    return this.fetch(`/v1/agents/${agentId}`);
  }

  /**
   * Update agent profile
   */
  async updateAgent(agentId: string, options: UpdateOptions): Promise<Agent> {
    return this.fetch(`/v1/agents/${agentId}`, {
      method: 'PATCH',
      body: JSON.stringify(options),
    });
  }

  /**
   * Send heartbeat (mark as online)
   */
  async heartbeat(agentId?: string): Promise<{ status: string; lastSeen: string }> {
    const id = agentId || this.identity?.agentId;
    if (!id) {
      throw new Error('Agent ID required');
    }
    return this.fetch(`/v1/agents/${id}/heartbeat`, { method: 'POST' });
  }

  /**
   * Set agent status explicitly
   */
  async setStatus(
    status: 'online' | 'offline' | 'maintenance' | 'unknown',
    agentId?: string
  ): Promise<{ status: string }> {
    const id = agentId || this.identity?.agentId;
    if (!id) {
      throw new Error('Agent ID required');
    }
    return this.fetch(`/v1/agents/${id}/status`, {
      method: 'POST',
      body: JSON.stringify({ status }),
    });
  }

  // ===========================================================================
  // Discovery
  // ===========================================================================

  /**
   * Discover agents by criteria
   */
  async discover(options: DiscoverOptions = {}): Promise<DiscoverResult> {
    return this.fetch('/v1/discover', {
      method: 'POST',
      body: JSON.stringify(options),
    });
  }

  /**
   * Quick search by name/description
   */
  async search(query: string, limit = 10): Promise<{ agents: Agent[] }> {
    return this.fetch(`/v1/discover/search?q=${encodeURIComponent(query)}&limit=${limit}`);
  }

  /**
   * Find agents with a specific capability
   */
  async findByCapability(
    capabilityId: string,
    minScore = 0
  ): Promise<{ agents: Agent[] }> {
    return this.fetch(
      `/v1/discover/capability/${capabilityId}?minScore=${minScore}`
    );
  }

  // ===========================================================================
  // Capabilities
  // ===========================================================================

  /**
   * List all registered capabilities
   */
  async listCapabilities(): Promise<{ capabilities: any[] }> {
    return this.fetch('/v1/capabilities');
  }

  /**
   * Register a capability for your agent
   */
  async registerCapability(
    capabilityId: string,
    endpoint?: string
  ): Promise<any> {
    if (!this.identity) {
      throw new Error('Identity required');
    }
    return this.fetch('/v1/capabilities/agent', {
      method: 'POST',
      body: JSON.stringify({
        agentId: this.identity.agentId,
        capabilityId,
        endpoint,
      }),
    });
  }

  // ===========================================================================
  // Attestations (Trust)
  // ===========================================================================

  /**
   * Create a signed attestation about another agent
   */
  async attest(options: AttestationOptions): Promise<any> {
    if (!this.identity) {
      throw new Error('Identity required');
    }

    // Create the attestation payload
    const payload = {
      attesterId: this.identity.agentId,
      subjectId: options.subjectId,
      claim: options.claim,
    };

    // Sign it
    const signature = await this.identity.sign(JSON.stringify(payload));

    return this.fetch('/v1/attestations', {
      method: 'POST',
      body: JSON.stringify({
        ...payload,
        signature,
        expiresAt: options.expiresAt?.toISOString(),
      }),
    });
  }

  /**
   * Get attestations about an agent
   */
  async getAttestationsFor(agentId: string): Promise<{ attestations: any[] }> {
    return this.fetch(`/v1/attestations/subject/${agentId}`);
  }

  /**
   * Get attestations made by an agent
   */
  async getAttestationsBy(agentId: string): Promise<{ attestations: any[] }> {
    return this.fetch(`/v1/attestations/attester/${agentId}`);
  }

  // ===========================================================================
  // Authentication
  // ===========================================================================

  /**
   * Request an authentication challenge
   */
  async requestChallenge(): Promise<{
    id: string;
    nonce: string;
    expiresAt: string;
  }> {
    return this.fetch('/v1/auth/challenge', { method: 'POST' });
  }

  /**
   * Authenticate by signing a challenge
   */
  async authenticate(): Promise<{
    authenticated: boolean;
    agent: { id: string; name: string; type: string };
  }> {
    if (!this.identity) {
      throw new Error('Identity required');
    }

    // Get challenge
    const challenge = await this.requestChallenge();

    // Sign the nonce
    const signature = await this.identity.sign(challenge.nonce);

    // Verify
    return this.fetch('/v1/auth/verify', {
      method: 'POST',
      body: JSON.stringify({
        challengeId: challenge.id,
        agentId: this.identity.agentId,
        signature,
      }),
    });
  }

  // ===========================================================================
  // Internal
  // ===========================================================================

  private async fetch(path: string, options: RequestInit = {}): Promise<any> {
    const url = `${this.baseUrl}${path}`;
    
    const response = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
      signal: AbortSignal.timeout(this.timeout),
    });

    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({})) as { error?: string };
      throw new Error(errorBody.error || `HTTP ${response.status}`);
    }

    return response.json();
  }
}
