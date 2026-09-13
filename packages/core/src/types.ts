import { z } from 'zod';

// =============================================================================
// Handles, policy, trust
// =============================================================================

export const HANDLE_REGEX = /^[a-z0-9-]{3,32}$/;
export const HandleSchema = z.string().regex(HANDLE_REGEX);

export const RESERVED_HANDLES: readonly string[] = [
  'ans', 'admin', 'api', 'www', 'mcp', 'anthropic', 'claude', 'openai', 'gpt', 'google', 'gemini',
  'stripe', 'cursor', 'devin', 'meta', 'microsoft', 'amazon', 'apple',
];

export const AgentPolicySchema = z.object({
  /** Refuse messages, invocations and proposed receipts from unregistered callers */
  requireRegistered: z.boolean().default(false),
  /** Refuse registered callers whose trust score is below this */
  minTrust: z.number().int().min(0).max(100).default(0),
  /** Accept sandbox-class credit on this agent's offers */
  acceptSandbox: z.boolean().default(true),
});

export const AgentTrustSchema = z.object({
  score: z.number().int().min(0).max(100),
  confidence: z.number().min(0).max(1),
  rank: z.number(),
  computedAt: z.date().nullable().optional(),
});

export const ReceiptCountsSchema = z.object({
  confirmed: z.number().int().min(0).default(0),
  unconfirmed: z.number().int().min(0).default(0),
  unreviewed: z.number().int().min(0).default(0),
  negative: z.number().int().min(0).default(0),
  noReview: z.number().int().min(0).default(0),
});

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
  
  // === Contact & Protocols ===
  /** Primary endpoint to reach this agent */
  endpoint: z.string().url().optional(),
  /** Supported protocols */
  protocols: z.array(z.enum(['a2a', 'mcp', 'http', 'websocket', 'grpc'])).default([]),
  
  // === Profile ===
  /** What this agent does */
  description: z.string().max(500).optional(),
  /** Avatar/profile image URL */
  avatar: z.string().url().optional(),
  /** Homepage or documentation URL */
  homepage: z.string().url().optional(),
  /** Discovery tags */
  tags: z.array(z.string()).default([]),
  
  // === Accountability ===
  /** Operator (org or person running this agent) */
  operatorId: z.string().optional(),
  /** Operator name (denormalized for display) */
  operatorName: z.string().optional(),
  
  // === Payment (controlled by operator, not agent) ===
  /** Payment methods accepted */
  paymentMethods: z.array(z.object({
    type: z.enum(['bitcoin', 'lightning', 'ethereum', 'usdc', 'other']),
    address: z.string(),
    /** Optional: human-readable label */
    label: z.string().optional(),
  })).default([]),
  
  // === Status ===
  /** Current availability */
  status: z.enum(['online', 'offline', 'maintenance', 'unknown']).default('unknown'),
  /** Last seen timestamp */
  lastSeen: z.date().optional(),
  
  /** Optional metadata (extensible) */
  metadata: z.record(z.unknown()).optional(),

  // === Receipts and trust (docs/DESIGN.md section 3) ===
  /** Unique lowercase handle, resolves as @handle */
  handle: HandleSchema.optional(),
  /** Operator policy applied on ANS surfaces */
  policy: AgentPolicySchema.optional(),
  /** Materialized trust (trust-v1) */
  trust: AgentTrustSchema.optional(),
  /** Public receipt counts */
  receiptCounts: ReceiptCountsSchema.optional(),
  /** House agents are unranked */
  isHouse: z.boolean().optional(),
  /** Instrumentation only */
  referredBy: z.string().nullable().optional(),
});

export type AgentId = z.infer<typeof AgentIdSchema>;
export type AgentPolicy = z.infer<typeof AgentPolicySchema>;
export type AgentTrust = z.infer<typeof AgentTrustSchema>;
export type ReceiptCounts = z.infer<typeof ReceiptCountsSchema>;

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

// =============================================================================
// Offers, Receipts, Ratings (docs/DESIGN.md section 3 with the section 14 column changes)
// =============================================================================

/** USD micros as a decimal string (bigint safe over JSON) */
export const MicrosStringSchema = z.string().regex(/^-?\d+$/);

export const CreditClassSchema = z.enum(['sandbox', 'cash', 'none']);
export const ReceiptRoleSchema = z.enum(['client', 'provider']);
export const ReceiptViaSchema = z.enum(['proxy', 'direct']);
export const ReceiptStateSchema = z.enum([
  'proposed',
  'open',
  'delivered',
  'accepted',
  'rejected',
  'disputed',
  'resolved_client',
  'resolved_provider',
  'split',
  'unreviewed',
  'timed_out',
  'failed',
  'output_invalid',
  'cancelled_client',
  'cancelled_provider',
  'declined',
  'expired',
]);
export const RatingTagSchema = z.enum([
  'on_time',
  'as_specified',
  'over_delivered',
  'unresponsive',
  'wrong_output',
  'overcharged',
]);

export const OfferStatsSchema = z.object({
  calls: z.number().int().min(0).default(0),
  ok: z.number().int().min(0).default(0),
  failed: z.number().int().min(0).default(0),
  timeout: z.number().int().min(0).default(0),
  inputInvalid: z.number().int().min(0).default(0),
  outputInvalid: z.number().int().min(0).default(0),
  p50Ms: z.number().min(0).nullable().default(null),
  p95Ms: z.number().min(0).nullable().default(null),
  lastCalledAt: z.date().nullable().default(null),
});

export const OfferRequiresSchema = z.object({
  secrets: z.array(z.string()).optional(),
  callbackUrl: z.boolean().optional(),
  notes: z.string().optional(),
});

export const OfferSchema = z.object({
  /** of_xxxxxxxxxxxxxxxx */
  id: z.string().regex(/^of_[a-zA-Z0-9]{12,}$/),
  agentId: z.string(),
  slug: z.string().regex(/^[a-z0-9-]{2,48}$/),
  version: z.number().int().min(1).default(1),
  title: z.string().min(1).max(80),
  description: z.string().max(500).default(''),
  inputSchema: z.record(z.unknown()),
  outputSchema: z.record(z.unknown()),
  /** sha256hex of canonical JSON */
  inputSchemaHash: z.string(),
  outputSchemaHash: z.string(),
  examples: z.array(z.object({ input: z.unknown(), output: z.unknown() })).max(3).default([]),
  tags: z.array(z.string()).default([]),
  priceMicros: MicrosStringSchema.default('0'),
  priceUnit: z.literal('call').default('call'),
  acceptsSandbox: z.boolean().default(true),
  endpoint: z.string().url().nullable().optional(),
  transport: z.literal('ans-http').default('ans-http'),
  mode: z.literal('sync').default('sync'),
  timeoutMs: z.number().int().min(1000).max(120000).default(30000),
  status: z.enum(['active', 'paused', 'retired']).default('active'),
  probeOk: z.boolean().nullable().optional(),
  probedAt: z.date().nullable().optional(),
  stats: OfferStatsSchema.optional(),
  /** owner's Ed25519 signature over the offer's canonical publication payload */
  publishSig: z.string(),
  /** section 14.11 */
  requires: OfferRequiresSchema.nullable().optional(),
  /** author-declared ['@handle/slug', ...] */
  feeds: z.array(z.string()).default([]),
  createdAt: z.date(),
});

export type Offer = z.infer<typeof OfferSchema>;
export type OfferStats = z.infer<typeof OfferStatsSchema>;

export const CounterpartyHintSchema = z.object({
  name: z.string().min(1).max(80),
  url: z.string().url().nullable().optional(),
  contactHash: z.string().nullable().optional(),
});

export const SigMaterialSchema = z.object({
  method: z.string().optional(),
  path: z.string().optional(),
  timestamp: z.string().optional(),
  bodySha256: z.string().optional(),
  /** canonical hash of the offer whose publish_sig stands in as counterparty_sig */
  offerCanonical: z.string().optional(),
});

export const ReceiptSchema = z.object({
  /** rc_xxxxxxxxxxxxxxxx */
  id: z.string().regex(/^rc_[a-zA-Z0-9]{12,}$/),
  clientId: z.string().nullable(),
  providerId: z.string().nullable(),
  initiatorId: z.string(),
  initiatorRole: ReceiptRoleSchema,
  counterpartyHint: CounterpartyHintSchema.nullable().optional(),
  offerId: z.string().nullable().optional(),
  task: z.string().min(1).max(280),
  inputHash: z.string().nullable().optional(),
  outputHash: z.string().nullable().optional(),
  outputUrl: z.string().url().nullable().optional(),
  priceMicros: MicrosStringSchema.default('0'),
  currency: z.literal('USD').default('USD'),
  creditClass: CreditClassSchema,
  /** frozen at open from FEE_BPS */
  feeBps: z.number().int().min(0),
  feeMicros: MicrosStringSchema.default('0'),
  deadlineAt: z.date(),
  reviewWindowSec: z.number().int().min(3600).default(604800),
  via: ReceiptViaSchema,
  state: ReceiptStateSchema,
  /** section 14.3: replaces client_sig / provider_sig */
  termsHash: z.string(),
  initiatorSig: z.string(),
  counterpartySig: z.string().nullable().optional(),
  deliverSig: z.string().nullable().optional(),
  verdictSig: z.string().nullable().optional(),
  /** section 14.4: what a proxy receipt's initiator signature covers */
  sigMaterial: SigMaterialSchema.nullable().optional(),
  clientRating: z.number().int().min(0).max(100).nullable().optional(),
  providerRating: z.number().int().min(0).max(100).nullable().optional(),
  ratingsRevealedAt: z.date().nullable().optional(),
  /** sha256 of the canonical sealed record */
  hash: z.string().nullable().optional(),
  prevHashClient: z.string().nullable().optional(),
  prevHashProvider: z.string().nullable().optional(),
  openedAt: z.date().nullable().optional(),
  acceptedAt: z.date().nullable().optional(),
  deliveredAt: z.date().nullable().optional(),
  verdictAt: z.date().nullable().optional(),
  sealedAt: z.date().nullable().optional(),
  expiresAt: z.date().nullable().optional(),
  createdAt: z.date(),
});

export type Receipt = z.infer<typeof ReceiptSchema>;

export const ReceiptEventSchema = z.object({
  id: z.string(),
  receiptId: z.string(),
  fromState: ReceiptStateSchema.nullable(),
  toState: ReceiptStateSchema,
  actor: z.enum(['client', 'provider', 'clock', 'admin']),
  payload: z.record(z.unknown()).nullable().optional(),
  signature: z.string().nullable().optional(),
  createdAt: z.date(),
});

export type ReceiptEvent = z.infer<typeof ReceiptEventSchema>;

export const RatingSchema = z.object({
  id: z.string(),
  receiptId: z.string(),
  raterId: z.string(),
  subjectId: z.string(),
  score: z.number().int().min(0).max(100),
  tags: z.array(RatingTagSchema).default([]),
  note: z.string().max(500).nullable().optional(),
  signature: z.string(),
  createdAt: z.date(),
  revealedAt: z.date().nullable().optional(),
});

export type Rating = z.infer<typeof RatingSchema>;
