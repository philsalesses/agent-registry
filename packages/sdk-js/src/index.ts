export { ANSClient, ANSClient as AgentRegistryClient } from './client';
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
} from 'ans-core';
