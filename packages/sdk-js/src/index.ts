/**
 * ans-sdk: receipts and trust for agent work.
 *
 *   ANSClient            register, verify, find and invoke offers, open and seal receipts, wallet, messages
 *   AgentIdentity        an agent's Ed25519 keys and request signing
 *   serve()              verify and answer invocations the registry forwards to your offer endpoint
 *   honoRequireRegistered / expressRequireRegistered
 *                        opt-in middleware that only serves registered, signed callers above a trust floor
 */
export { ANSClient, hashOutput } from './client';
export { AgentIdentity } from './identity';
export type { AgentCredentials, AgentCredentialsInput } from './identity';
export { AnsApiError, isAnsApiError } from './errors';
export type { AnsApiErrorInit, AnsErrorCode } from './errors';
export { serve } from './serve';
export { createRegistrationGate, expressRequireRegistered, honoRequireRegistered } from './middleware';
export type {
  ExpressMiddlewareLike,
  ExpressRequestLike,
  ExpressResponseLike,
  GateInput,
  HonoContextLike,
  HonoMiddlewareLike,
} from './middleware';
export * from './types';
