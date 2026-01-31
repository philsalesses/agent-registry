export { AgentRegistryClient } from './client';
export { AgentIdentity } from './identity';
export type { 
  ClientOptions,
  RegisterOptions,
  DiscoverOptions,
  DiscoverResult,
} from './types';

// Re-export core types
export type { 
  AgentId, 
  Capability, 
  Attestation,
  PaymentMethod,
} from '@agent-registry/core';
