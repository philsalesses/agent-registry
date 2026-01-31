import { z } from 'zod';

// =============================================================================
// Agent Identity
// =============================================================================

export const AgentIdSchema = z.object({
  /** Unique agent identifier (format: ag_xxxxxxxxxxxx) */
  id: z.string().regex(/^ag_[a-zA-Z0-9]{12,}$/),
  /** Human-readable name */
  name: z.string().min(1).max(64),
  /** Public key for verification (base64) */
  publicKey: z.string(),
  /** Agent type */
  type: z.enum(['assistant', 'autonomous', 'tool', 'service']),
  /** When the agent was registered */
  createdAt: z.date(),
  /** Optional metadata */
  metadata: z.record(z.unknown()).optional(),
});

export type AgentId = z.infer<typeof AgentIdSchema>;

// =============================================================================
// Capabilities
// =============================================================================

export const CapabilitySchema = z.object({
  /** Capability identifier (e.g., 'text-generation', 'code-execution') */
  id: z.string(),
  /** Human-readable description */
  description: z.string(),
  /** Version of this capability spec */
  version: z.string().default('1.0.0'),
  /** Input schema (JSON Schema) */
  inputSchema: z.record(z.unknown()).optional(),
  /** Output schema (JSON Schema) */
  outputSchema: z.record(z.unknown()).optional(),
});

export type Capability = z.infer<typeof CapabilitySchema>;

export const AgentCapabilitySchema = z.object({
  /** Agent ID */
  agentId: z.string(),
  /** Capability ID */
  capabilityId: z.string(),
  /** Endpoint to invoke this capability */
  endpoint: z.string().url().optional(),
  /** Trust score (0-100, computed from attestations) */
  trustScore: z.number().min(0).max(100).default(0),
  /** Self-reported or verified */
  verified: z.boolean().default(false),
});

export type AgentCapability = z.infer<typeof AgentCapabilitySchema>;

// =============================================================================
// Trust & Attestations
// =============================================================================

export const AttestationSchema = z.object({
  /** Unique attestation ID */
  id: z.string(),
  /** Agent making the attestation */
  attesterId: z.string(),
  /** Agent being attested */
  subjectId: z.string(),
  /** What's being attested */
  claim: z.object({
    type: z.enum(['capability', 'identity', 'behavior']),
    capabilityId: z.string().optional(),
    value: z.union([z.boolean(), z.number(), z.string()]),
  }),
  /** Cryptographic signature */
  signature: z.string(),
  /** When the attestation was made */
  createdAt: z.date(),
  /** Optional expiration */
  expiresAt: z.date().optional(),
});

export type Attestation = z.infer<typeof AttestationSchema>;

// =============================================================================
// Discovery
// =============================================================================

export const DiscoveryQuerySchema = z.object({
  /** Search by capability */
  capabilities: z.array(z.string()).optional(),
  /** Minimum trust score */
  minTrustScore: z.number().min(0).max(100).optional(),
  /** Agent type filter */
  types: z.array(z.enum(['assistant', 'autonomous', 'tool', 'service'])).optional(),
  /** Text search */
  query: z.string().optional(),
  /** Pagination */
  limit: z.number().min(1).max(100).default(20),
  offset: z.number().min(0).default(0),
});

export type DiscoveryQuery = z.infer<typeof DiscoveryQuerySchema>;

export interface DiscoveryResult {
  agents: AgentId[];
  total: number;
  hasMore: boolean;
}

// =============================================================================
// Protocol Messages
// =============================================================================

export const ChallengeSchema = z.object({
  /** Challenge ID */
  id: z.string(),
  /** Random bytes to sign (base64) */
  nonce: z.string(),
  /** Challenge timestamp */
  timestamp: z.date(),
  /** Expires after */
  expiresAt: z.date(),
});

export type Challenge = z.infer<typeof ChallengeSchema>;

export const ChallengeResponseSchema = z.object({
  /** Challenge ID being responded to */
  challengeId: z.string(),
  /** Agent ID claiming identity */
  agentId: z.string(),
  /** Signature of the nonce */
  signature: z.string(),
});

export type ChallengeResponse = z.infer<typeof ChallengeResponseSchema>;
