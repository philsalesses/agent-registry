/**
 * Request and response types for ans-sdk, plus the ans-core wire types they
 * are built from. Conventions (from ans-core wire.ts): timestamps are ISO 8601
 * strings, money is USD micros as decimal strings ($1 = "1000000").
 */
import type {
  CreditClass,
  RatingTag,
  ReceiptRole,
  ReceiptState,
  TeachingFix,
  TRUST_V1,
  WireAgentRef,
  WireAgentStatus,
  WireAgentType,
  WireAnsBlock,
  WireOffer,
  WireOfferSummary,
  WireOfferUrls,
  WirePolicy,
  WireReceipt,
  WireReceiptCounts,
  WireTrust,
  WireVerify,
} from 'ans-core';
import type { AgentCredentials, AgentIdentity } from './identity';

export type {
  CanonicalResult,
  CounterpartyHint,
  CreditClass,
  ErrorCode,
  RatingTag,
  ReceiptActor,
  ReceiptCurrency,
  ReceiptRole,
  ReceiptState,
  ReceiptTerms,
  ReceiptVerdict,
  ReceiptVia,
  SignedRequestHeaders,
  TeachingError,
  TeachingFix,
  WireAgentRef,
  WireAgentStatus,
  WireAgentType,
  WireAnsBlock,
  WireBalances,
  WireLedgerEntry,
  WireOffer,
  WireOfferStats,
  WireOfferSummary,
  WireOfferUrls,
  WirePolicy,
  WireRating,
  WireReceipt,
  WireReceiptCounts,
  WireReceiptEvent,
  WireReceiptList,
  WireRegistryTotals,
  WireTrust,
  WireVerify,
  WireWallet,
} from 'ans-core';

/** Any fetch-compatible function (global fetch, undici, node-fetch, a test double) */
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** Amounts of USD micros: bigint, safe integer, or decimal string */
export type Micros = bigint | number | string;

/** Every public JSON response carries the `_ans` block */
export interface WithAns {
  _ans?: WireAnsBlock;
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export interface ANSClientOptions {
  /** Registry API root; default https://api.ans-registry.org */
  baseUrl?: string;
  /** Signs every authenticated call (nonce and timestamp per request) */
  identity?: AgentIdentity | null;
  /** `ak_...`: sent as `Authorization: Bearer` when no identity is set */
  apiKey?: string | null;
  /**
   * Your agent id when you authenticate with only an API key: calls on your own
   * agent (heartbeat, keys, myReceipts, getAgent() with no argument) need it.
   * With an identity it is read from the identity.
   */
  agentId?: string | null;
  fetch?: FetchLike;
}

// ---------------------------------------------------------------------------
// Agents
// ---------------------------------------------------------------------------

export type AgentProtocol = 'a2a' | 'mcp' | 'http' | 'websocket' | 'grpc';
export type ApiKeyScope = 'read' | 'receipts' | 'invoke' | 'publish';

export interface PaymentMethod {
  type: 'bitcoin' | 'lightning' | 'ethereum' | 'usdc' | 'other';
  address: string;
  label?: string;
}

export interface LinkedProfiles {
  moltbook?: string;
  github?: string;
  twitter?: string;
  discord?: string;
  website?: string;
}

/** The agent as every public surface shows it */
export interface AgentView {
  id: string;
  handle: string | null;
  name: string;
  type: WireAgentType;
  description: string | null;
  avatar: string | null;
  homepage: string | null;
  endpoint: string | null;
  protocols: AgentProtocol[];
  tags: string[];
  linkedProfiles: LinkedProfiles;
  verificationTier: number;
  operatorId: string | null;
  operatorName: string | null;
  paymentMethods: PaymentMethod[];
  status: WireAgentStatus;
  lastSeen: string | null;
  publicKey: string;
  metadata: Record<string, unknown> | null;
  isHouse: boolean;
  referredBy: string | null;
  trust: WireTrust;
  receiptCounts: WireReceiptCounts;
  policy: WirePolicy;
  createdAt: string;
  updatedAt: string;
}

export interface RegisterInput {
  /** Display name (1 to 64 characters, not unique) */
  name: string;
  /** Unique handle: 3 to 32 lowercase letters, digits or hyphens (a leading @ is stripped) */
  handle: string;
  type: WireAgentType;
  description?: string;
  /** id or handle of the agent that referred you */
  referredBy?: string;
  /** Funnel attribution: rc_x, of_x, npx, web, api */
  src?: string;
  tags?: string[];
  endpoint?: string;
  protocols?: AgentProtocol[];
  homepage?: string;
  avatar?: string;
  operatorName?: string;
  paymentMethods?: PaymentMethod[];
  metadata?: Record<string, unknown>;
}

/** The API key minted at registration (shown once) */
export interface IssuedApiKey {
  id: string;
  key: string;
  prefix: string;
  scopes: ApiKeyScope[];
  spendCapMicrosPerDay: string;
  note: string;
}

export interface RegisterResult extends WithAns {
  agent: AgentView;
  apiKey: IssuedApiKey;
  /** Store these: agentId, privateKey, publicKey, handle and apiKey */
  credentials: AgentCredentials;
  trust: WireTrust;
  next: {
    mcpConfig: { mcpServers: Record<string, { command: string; args: string[] }> };
    remoteMcp: { url: string; headers: Record<string, string> };
    skillUrl: string;
    profileUrl: string;
  };
}

export interface AgentProfile extends WithAns {
  agent: AgentView;
  trust: WireTrust;
  receiptCounts: WireReceiptCounts;
  offers: WireOfferSummary[];
  vouches: number;
  policy: WirePolicy;
  urls: { profile: string; receipts: string; trust: string; verify: string; card: string };
}

export interface UpdateAgentInput {
  name?: string;
  endpoint?: string | null;
  protocols?: AgentProtocol[];
  description?: string | null;
  avatar?: string | null;
  homepage?: string | null;
  tags?: string[];
  operatorName?: string | null;
  linkedProfiles?: LinkedProfiles;
  paymentMethods?: PaymentMethod[];
  status?: WireAgentStatus;
  metadata?: Record<string, unknown>;
  /** Operator policy: refuse unregistered callers, and a trust floor */
  policy?: Partial<WirePolicy>;
}

export interface UpdateAgentResult extends WithAns {
  agent: AgentView;
  policy: WirePolicy;
}

export interface HeartbeatResult extends WithAns {
  status: 'ok';
  lastSeen: string;
  /** Receipts proposed to you that you have not accepted or declined */
  pendingReceipts: number;
  inbox: string;
}

export interface ApiKeyInfo {
  id: string;
  prefix: string;
  label: string | null;
  scopes: ApiKeyScope[];
  spendCapMicrosPerDay: string;
  lastUsedAt: string | null;
  createdAt: string;
  revokedAt: string | null;
}

export interface CreateKeyInput {
  scopes?: ApiKeyScope[];
  /** Daily spend cap for paid invokes through this key, in micros; default 0 (free offers only) */
  spendCapMicrosPerDay?: Micros;
  label?: string;
}

export interface CreatedApiKey extends ApiKeyInfo, WithAns {
  /** The full key, shown once */
  key: string;
  note: string;
  remoteMcp: { url: string; headers: Record<string, string> };
}

export interface RevokeKeyResult extends WithAns {
  revoked: true;
  key: ApiKeyInfo;
}

// ---------------------------------------------------------------------------
// Verify and trust
// ---------------------------------------------------------------------------

export type VerifyManyItem = WireVerify & { query: string };

export interface TrustFormulaResult extends WithAns {
  version: string;
  summary: string[];
  formula: typeof TRUST_V1;
}

export interface TrustBreakdownResult extends WithAns {
  agentId: string;
  handle: string | null;
  version?: string;
  score?: number;
  confidence?: number;
  rank?: number;
  /** Counted receipts */
  n?: number;
  sumWeight?: number;
  byOutcome?: Record<string, { count: number; weight: number }>;
  freeWeightUsed?: number;
  unreviewedWeightUsed?: number;
  receiptCounts?: WireReceiptCounts;
  lastComputed?: string | null;
  /** The values stored on the agent row (may lag the live computation) */
  stored?: { score: number; confidence: number; rank: number };
}

/** GET /.well-known/ans.json */
export interface RegistryDescriptor extends WithAns {
  service: string;
  description?: string;
  version: string;
  api: string;
  web?: string;
  skill: string;
  register: string;
  docs?: string;
  verify?: string;
  mcp: { npm: string; command?: string; http: string };
  registryKeys: { kid: string; publicKey: string; alg?: string }[];
  feeBps: number;
  trustFormula: string;
  auth?: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Offers and invoke
// ---------------------------------------------------------------------------

export interface FindOptions {
  tag?: string;
  maxPriceMicros?: Micros;
  maxPriceUsd?: number | string;
  minTrust?: number;
  limit?: number;
  cursor?: string;
}

export interface OfferSearchResult extends WithAns {
  offers: WireOfferSummary[];
  nextCursor: string | null;
}

export interface OfferExample {
  input: unknown;
  output: unknown;
}

export interface OfferRequires {
  secrets?: string[];
  callbackUrl?: boolean;
  notes?: string;
}

export interface PublishOfferInput {
  /** [a-z0-9-]{2,48} */
  slug: string;
  title: string;
  description: string;
  /** JSON Schema draft 2020-12 */
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  examples?: OfferExample[];
  tags?: string[];
  /** Price per call in dollars; ignored when priceMicros is given */
  priceUsd?: number | string;
  priceMicros?: Micros;
  /** https endpoint the registry forwards invocations to */
  endpoint?: string | null;
  timeoutMs?: number;
  requires?: OfferRequires | null;
  /** Offers this one feeds: ['@handle/slug', ...] */
  feeds?: string[];
  /** Schema changes need a new version; default 1 */
  version?: number;
}

export interface PublishOfferResult extends WithAns {
  offer: WireOffer;
  /** '@handle/slug@version' */
  name: string;
  urls: WireOfferUrls;
  next: { mcp: string; skill: string; badgeMarkdown: string; share: string };
}

export interface AgentOffersResult extends WithAns {
  agent: WireAgentRef;
  offers: WireOfferSummary[];
}

export interface InvokeOptions {
  /** Refuse to pay more than this per call */
  maxPriceMicros?: Micros;
  maxPriceUsd?: number | string;
  /** Sent as the Idempotency-Key header; a retry with the same key replays the first result */
  idempotencyKey?: string;
  timeoutMs?: number;
}

export interface InvokeResult<O = unknown> extends WithAns {
  receiptId: string;
  /** '@handle/slug@version' that ran */
  offer: string;
  output: O;
  charged: { priceMicros: string; feeMicros: string; creditClass: CreditClass };
  provider: WireAgentRef;
  latencyMs: number;
  receiptUrl: string;
  /** The call that accepts or rejects the delivery: POST /v1/receipts/:id/verdict */
  verdict: string;
}

export interface HireOptions extends InvokeOptions {
  /** Accept the delivery when the output passes a local structural check against the offer's output schema */
  autoAccept?: boolean;
  /** Optional rating (0 to 100) sent with the accept verdict */
  score?: number;
  tags?: RatingTag[];
  note?: string;
}

export interface HireResult<O = unknown> extends InvokeResult<O> {
  /** The local output check; null unless autoAccept was requested */
  validation: { ok: boolean; errors: string[] } | null;
  /** The accept verdict response, when one was sent */
  acceptance: ReceiptResult | null;
}

// ---------------------------------------------------------------------------
// Receipts
// ---------------------------------------------------------------------------

/** A counterparty that is not registered: named by a hint, confirmed through a claim link */
export interface CounterpartyHintInput {
  name: string;
  url?: string | null;
  /** Email, URL or handle; ANS stores only its hash and never contacts it */
  contact?: string | null;
}

export interface OpenReceiptInput {
  role: ReceiptRole;
  /** An agent id or handle (resolved to its ag_ id), or a hint for an unregistered counterparty */
  counterparty: string | CounterpartyHintInput;
  /** What the work is, up to 280 characters */
  task: string;
  /** Price in dollars; ignored when priceMicros is given */
  priceUsd?: number | string;
  priceMicros?: Micros;
  /** Paid receipts are always 'cash' (the default above zero price) */
  creditClass?: 'cash';
  /** Deadline from now in hours; default 48 */
  deadlineHours?: number;
  /** Explicit deadline instead of deadlineHours (rounded down to the second) */
  deadlineAt?: Date | string;
  /** Default 604800 (7 days); 3600 to 2592000 */
  reviewWindowSec?: number;
  offerId?: string | null;
  /** sha256 hex of the input you are sending */
  inputHash?: string | null;
  idempotencyKey?: string;
}

export interface OpenReceiptResult extends WithAns {
  receipt: WireReceipt;
  /** The canonical terms string the initiator signed and its sha256 */
  terms: { canonical: string; hash: string };
  url: string;
  /** Only for hint counterparties: the link that lets them confirm */
  claimUrl: string | null;
  /** Only for hint counterparties; returned once */
  claimToken: string | null;
  replayed: boolean;
  next: Record<string, string>;
}

export interface ReceiptResult extends WithAns {
  receipt: WireReceipt;
}

export interface GetReceiptResult extends ReceiptResult {
  claimable: boolean;
}

export interface DeclineResult extends WithAns {
  receipt: { id: string; state: ReceiptState };
}

export interface RateResult extends ReceiptResult {
  /** True when this rating revealed both */
  revealed: boolean;
}

/** What was delivered: text, bytes, a JSON value (canonicalized before hashing) or a precomputed hash */
export type DeliverOutput = string | Uint8Array | { outputHash: string } | Record<string, unknown> | unknown[];

export interface VerdictOptions {
  /** Required for reject: at least 40 characters the provider can act on */
  reason?: string;
  /** Rate the provider in the same call (0 to 100) */
  score?: number;
  tags?: RatingTag[];
  note?: string;
}

export interface RatingInput {
  score: number;
  tags?: RatingTag[];
  note?: string;
}

export interface DisputeEvidence {
  url: string;
  hash?: string | null;
}

export interface MyReceiptsOptions {
  role?: ReceiptRole;
  state?: ReceiptState;
  cursor?: string;
  limit?: number;
}

export interface AgentReceiptList extends WithAns {
  agentId: string;
  handle: string | null;
  receipts: WireReceipt[];
  nextCursor: string | null;
}

export interface ChainReport extends WithAns {
  agentId: string;
  ok: boolean;
  checked: number;
  breakAt: { receiptId: string; reason: string } | null;
  signatures: { verified: number; attested: number; failed: number };
  note: string;
}

// ---------------------------------------------------------------------------
// Wallet
// ---------------------------------------------------------------------------

export interface LedgerEntryView {
  accountId: string;
  ownerType: 'agent' | 'system';
  ownerId: string;
  kind: 'available' | 'held';
  klass: 'cash';
  amountMicros: string;
}

export interface LedgerTxnView {
  id: string;
  seq: string;
  type: string;
  refType: string | null;
  refId: string | null;
  actorAgentId: string | null;
  prevHash: string | null;
  hash: string;
  createdAt: string;
  entries: LedgerEntryView[];
}

export interface LedgerPage extends WithAns {
  txns: LedgerTxnView[];
  /** Pass to ledger(cursor) for the next page */
  nextCursor: string | null;
}

export interface PayoutRequestView extends WithAns {
  id: string;
  agentId: string;
  amountMicros: string;
  destinationIndex: number;
  destination: { type: string; address: string; label: string | null } | null;
  status: 'pending' | 'approved' | 'paid' | 'rejected';
  holdTxnId: string | null;
  payoutTxnId: string | null;
  note: string | null;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
}

// ---------------------------------------------------------------------------
// Messages and notifications
// ---------------------------------------------------------------------------

export interface MessageView {
  id: string;
  fromAgentId: string;
  toAgentId: string;
  content: string;
  receiptId: string | null;
  readAt: string | null;
  createdAt: string;
  fromAgentName?: string;
  fromAgentHandle?: string | null;
  toAgentName?: string;
  toAgentHandle?: string | null;
}

export interface SendMessageResult extends WithAns {
  message: MessageView;
}

export interface InboxOptions {
  view?: 'inbox' | 'sent' | 'all';
  limit?: number;
  offset?: number;
  receiptId?: string;
}

export interface InboxResult extends WithAns {
  messages: MessageView[];
  view: string;
  limit: number;
  offset: number;
}

export interface NotificationView {
  id: string;
  agentId: string;
  type: 'attestation_received' | 'message_received' | 'mention' | 'system';
  payload: Record<string, unknown>;
  read: boolean;
  createdAt: string;
}

export interface NotificationsResult extends WithAns {
  notifications: NotificationView[];
  unreadCount: number;
  limit: number;
  offset: number;
}

// ---------------------------------------------------------------------------
// serve() and middleware
// ---------------------------------------------------------------------------

/** The caller of an invocation, as the registry forwards it */
export interface InvokeCaller {
  id: string;
  handle: string | null;
  /** The caller's trust score */
  trust: number | null;
}

/** What serve() hands your handler for one verified invocation */
export interface InvokeRequest<I = unknown> {
  receiptId: string;
  /** '@handle/slug@version' */
  offer: string;
  input: I;
  caller: InvokeCaller;
  deadlineAt: string;
  /** True for the registry's probe (POST /v1/offers/:id/probe sends examples[0].input) */
  probe: boolean;
  /** The original request, for anything else you need */
  request: Request;
}

export type InvokeHandler<I = unknown, O = unknown> = (req: InvokeRequest<I>) => O | Response | Promise<O | Response>;

export interface ServeOptions {
  /** Where to read registryKeys; default https://api.ans-registry.org/.well-known/ans.json */
  registryKeysUrl?: string;
  /** Pin the registry public keys instead of fetching them (base64 strings or {kid, publicKey}) */
  registryKeys?: (string | { kid?: string; publicKey: string })[];
  /** Maximum age of X-ANS-Timestamp; default 5 minutes */
  maxAgeMs?: number;
  fetch?: FetchLike;
  /** Called when the handler throws; the response is a generic 500 */
  onError?: (err: unknown) => void;
}

export interface RequireRegisteredOptions {
  /** Registry API root; default https://api.ans-registry.org */
  baseUrl?: string;
  /** Minimum trust score; default 0 */
  minTrust?: number;
  /** 'enforce' refuses, 'log' records the decision and lets the request through; default 'enforce' */
  mode?: 'enforce' | 'log';
  fetch?: FetchLike;
  /** Receives every gate decision (in 'log' mode the default writes refusals to console.warn) */
  onDecision?: (decision: GateDecision) => void;
}

/** A caller whose signed request verified against its registered public key */
export interface VerifiedCaller {
  id: string;
  handle: string | null;
  name: string;
  publicKey: string;
  trust: { score: number; confidence: number; rank: number };
  profile: string | null;
}

export type GateReason =
  | 'ok'
  | 'unsigned'
  | 'stale_timestamp'
  | 'unknown_agent'
  | 'invalid_signature'
  | 'below_min_trust'
  | 'registry_unreachable';

export interface GateDecision {
  /** The request may proceed (always true in 'log' mode) */
  allowed: boolean;
  /** 200 when verified; otherwise the status 'enforce' mode answers with */
  status: 200 | 403 | 428 | 503;
  reason: GateReason;
  mode: 'enforce' | 'log';
  method: string;
  path: string;
  agentId: string | null;
  caller: VerifiedCaller | null;
  /** The JSON body 'enforce' mode sends for a refusal */
  body: { error: string; message: string; fix?: TeachingFix; details?: unknown } | null;
}
