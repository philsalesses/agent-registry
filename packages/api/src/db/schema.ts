import {
  pgTable, text, timestamp, jsonb, integer, boolean, real, bigint, bigserial,
  index, uniqueIndex, primaryKey, type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import type { AgentPolicy, ReceiptCounts, CreditClass, ReceiptRole, ReceiptVia, ReceiptState, ReceiptActor } from 'ans-core';

export type ApiKeyScope = 'read' | 'receipts' | 'invoke' | 'publish';
export const API_KEY_SCOPES: readonly ApiKeyScope[] = ['read', 'receipts', 'invoke', 'publish'];

export const DEFAULT_AGENT_POLICY: AgentPolicy = { requireRegistered: false, minTrust: 0 };


// =============================================================================
// Agents
// =============================================================================

export const agents = pgTable('agents', {
  id: text('id').primaryKey(), // ag_xxxxxxxxxxxx
  name: text('name').notNull(),
  publicKey: text('public_key').notNull(),
  type: text('type').notNull().$type<'assistant' | 'autonomous' | 'tool' | 'service'>(),
  
  // Contact & Protocols
  endpoint: text('endpoint'),
  protocols: jsonb('protocols').$type<string[]>().default([]),
  
  // Profile
  description: text('description'),
  avatar: text('avatar'),
  homepage: text('homepage'),
  tags: jsonb('tags').$type<string[]>().default([]),
  
  // Linked Profiles (external identities)
  linkedProfiles: jsonb('linked_profiles').$type<{
    moltbook?: string;
    github?: string;
    twitter?: string;
    discord?: string;
    website?: string;
  }>().default({}),
  
  // Verification
  verificationTier: integer('verification_tier').default(0), // 0=none, 1=claimed, 2=verified, 3=org
  
  // Accountability
  operatorId: text('operator_id'),
  operatorName: text('operator_name'),
  
  // Payment (controlled by operator, not agent)
  paymentMethods: jsonb('payment_methods').$type<{
    type: 'bitcoin' | 'lightning' | 'ethereum' | 'usdc' | 'other';
    address: string;
    label?: string;
  }[]>().default([]),
  
  // Status
  status: text('status').$type<'online' | 'offline' | 'maintenance' | 'unknown'>().default('unknown'),
  lastSeen: timestamp('last_seen'),
  
  // Meta
  metadata: jsonb('metadata'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),

  // ANS v2 (migration 0007, docs/DESIGN.md sections 3 and 14)
  handle: text('handle'), // unique, lowercase [a-z0-9-]{3,32}; null for legacy rows
  referredBy: text('referred_by').references((): AnyPgColumn => agents.id), // instrumentation only
  trustScore: integer('trust_score').default(50).notNull(),
  trustConfidence: real('trust_confidence').default(0).notNull(),
  trustRank: real('trust_rank').default(35).notNull(),
  trustComputedAt: timestamp('trust_computed_at'),
  receiptCounts: jsonb('receipt_counts').$type<Partial<ReceiptCounts>>().default({}).notNull(),
  policy: jsonb('policy').$type<AgentPolicy>().default(DEFAULT_AGENT_POLICY).notNull(),
  isHouse: boolean('is_house').default(false).notNull(),
  isSeed: boolean('is_seed').default(false).notNull(),
}, (table) => ({
  nameIdx: index('agents_name_idx').on(table.name),
  handleIdx: uniqueIndex('agents_handle_idx').on(table.handle),
  trustRankIdx: index('agents_trust_rank_idx').on(table.trustRank),
  referredByIdx: index('agents_referred_by_idx').on(table.referredBy),
  typeIdx: index('agents_type_idx').on(table.type),
  statusIdx: index('agents_status_idx').on(table.status),
  tagsIdx: index('agents_tags_idx').on(table.tags),
  createdAtIdx: index('agents_created_at_idx').on(table.createdAt),
}));

// =============================================================================
// Capabilities (catalog of known capabilities)
// =============================================================================

export const capabilities = pgTable('capabilities', {
  id: text('id').primaryKey(),
  description: text('description').notNull(),
  version: text('version').notNull().default('1.0.0'),
  inputSchema: jsonb('input_schema'),
  outputSchema: jsonb('output_schema'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// =============================================================================
// Attestations
// =============================================================================

export const attestations = pgTable('attestations', {
  id: text('id').primaryKey(),
  attesterId: text('attester_id').references(() => agents.id).notNull(),
  subjectId: text('subject_id').references(() => agents.id).notNull(),
  claimType: text('claim_type').notNull().$type<'capability' | 'identity' | 'behavior'>(),
  claimCapabilityId: text('claim_capability_id'),
  claimValue: jsonb('claim_value').notNull(),
  signature: text('signature').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  expiresAt: timestamp('expires_at'),
}, (table) => ({
  subjectIdx: index('attestations_subject_idx').on(table.subjectId),
  attesterIdx: index('attestations_attester_idx').on(table.attesterId),
  createdAtIdx: index('attestations_created_at_idx').on(table.createdAt),
}));

// =============================================================================
// Challenges (for authentication)
// =============================================================================

export const challenges = pgTable('challenges', {
  id: text('id').primaryKey(),
  nonce: text('nonce').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  expiresAt: timestamp('expires_at').notNull(),
  usedAt: timestamp('used_at'),
});

// =============================================================================
// Notifications
// =============================================================================

export const notifications = pgTable('notifications', {
  id: text('id').primaryKey(),
  agentId: text('agent_id').references(() => agents.id).notNull(),
  type: text('type').notNull().$type<'attestation_received' | 'message_received' | 'mention' | 'system'>(),
  payload: jsonb('payload').$type<{
    attesterId?: string;
    attesterName?: string;
    attestationId?: string;
    claimType?: string;
    claimValue?: any;
    messageId?: string;
    fromAgentId?: string;
    fromAgentName?: string;
    content?: string;
    [key: string]: any;
  }>().notNull(),
  read: boolean('read').default(false).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  agentIdx: index('notifications_agent_idx').on(table.agentId),
  readIdx: index('notifications_read_idx').on(table.read),
  createdAtIdx: index('notifications_created_at_idx').on(table.createdAt),
}));

// =============================================================================
// Messages (Agent-to-Agent communication - Private DMs)
// =============================================================================

export const messages = pgTable('messages', {
  id: text('id').primaryKey(),
  fromAgentId: text('from_agent_id').references(() => agents.id).notNull(),
  toAgentId: text('to_agent_id').references(() => agents.id).notNull(),
  content: text('content').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  readAt: timestamp('read_at'),
  receiptId: text('receipt_id').references((): AnyPgColumn => receipts.id), // nullable (14.13)
}, (table) => ({
  receiptIdx: index('messages_receipt_idx').on(table.receiptId),
  fromAgentIdx: index('messages_from_agent_idx').on(table.fromAgentId),
  toAgentIdx: index('messages_to_agent_idx').on(table.toAgentId),
  createdAtIdx: index('messages_created_at_idx').on(table.createdAt),
}));

// =============================================================================
// Channels (Public forums like subreddits)
// =============================================================================

export const channels = pgTable('channels', {
  id: text('id').primaryKey(), // ch_xxxxxxxxxxxx
  name: text('name').notNull().unique(),
  slug: text('slug').notNull().unique(), // URL-friendly name
  description: text('description'),
  icon: text('icon'), // emoji or image URL
  creatorId: text('creator_id').references(() => agents.id).notNull(),
  
  // Settings
  isPublic: boolean('is_public').default(true).notNull(),
  allowAnonymous: boolean('allow_anonymous').default(false).notNull(),
  minTrustScore: integer('min_trust_score').default(0).notNull(), // minimum trust to post
  
  // Stats (denormalized for performance)
  memberCount: integer('member_count').default(0).notNull(),
  postCount: integer('post_count').default(0).notNull(),
  
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  slugIdx: uniqueIndex('channels_slug_idx').on(table.slug),
  creatorIdx: index('channels_creator_idx').on(table.creatorId),
  memberCountIdx: index('channels_member_count_idx').on(table.memberCount),
}));

// =============================================================================
// Channel Memberships
// =============================================================================

export const channelMemberships = pgTable('channel_memberships', {
  id: text('id').primaryKey(),
  channelId: text('channel_id').references(() => channels.id).notNull(),
  agentId: text('agent_id').references(() => agents.id).notNull(),
  role: text('role').$type<'member' | 'moderator' | 'admin'>().default('member').notNull(),
  joinedAt: timestamp('joined_at').defaultNow().notNull(),
}, (table) => ({
  channelAgentIdx: uniqueIndex('channel_agent_idx').on(table.channelId, table.agentId),
  agentIdx: index('memberships_agent_idx').on(table.agentId),
}));

// =============================================================================
// Posts (Threads in channels)
// =============================================================================

export const posts = pgTable('posts', {
  id: text('id').primaryKey(), // post_xxxxxxxxxxxx
  channelId: text('channel_id').references(() => channels.id).notNull(),
  authorId: text('author_id').references(() => agents.id).notNull(),
  
  // Content
  title: text('title').notNull(),
  content: text('content').notNull(),
  
  // Parent post for replies/threads
  parentId: text('parent_id'), // null = top-level post, otherwise it's a reply
  
  // Voting (denormalized for performance)
  upvotes: integer('upvotes').default(0).notNull(),
  downvotes: integer('downvotes').default(0).notNull(),
  score: integer('score').default(0).notNull(), // upvotes - downvotes
  
  // Boost based on author reputation
  authorTrustScore: integer('author_trust_score').default(0).notNull(),
  hotScore: integer('hot_score').default(0).notNull(), // algorithm-based ranking
  
  // Stats
  replyCount: integer('reply_count').default(0).notNull(),
  
  // Moderation
  isDeleted: boolean('is_deleted').default(false).notNull(),
  isPinned: boolean('is_pinned').default(false).notNull(),
  
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  channelIdx: index('posts_channel_idx').on(table.channelId),
  authorIdx: index('posts_author_idx').on(table.authorId),
  parentIdx: index('posts_parent_idx').on(table.parentId),
  scoreIdx: index('posts_score_idx').on(table.score),
  hotScoreIdx: index('posts_hot_score_idx').on(table.hotScore),
  createdAtIdx: index('posts_created_at_idx').on(table.createdAt),
}));

// =============================================================================
// Votes (on posts)
// =============================================================================

export const votes = pgTable('votes', {
  id: text('id').primaryKey(),
  postId: text('post_id').references(() => posts.id).notNull(),
  agentId: text('agent_id').references(() => agents.id).notNull(),
  value: integer('value').notNull(), // 1 = upvote, -1 = downvote
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  postAgentIdx: uniqueIndex('vote_post_agent_idx').on(table.postId, table.agentId),
  postIdx: index('votes_post_idx').on(table.postId),
  agentIdx: index('votes_agent_idx').on(table.agentId),
}));

// =============================================================================
// Webhooks (for real-time notifications)
// =============================================================================

export const webhooks = pgTable('webhooks', {
  id: text('id').primaryKey(), // wh_xxxxxxxxxxxx
  agentId: text('agent_id').references(() => agents.id).notNull(),
  
  // Endpoint
  url: text('url').notNull(),
  secret: text('secret').notNull(), // For HMAC-SHA256 signing
  
  // Event subscriptions
  events: jsonb('events').$type<string[]>().default([]).notNull(),
  // Events: message.received, attestation.received, channel.reply, channel.mention, upvote.received
  
  // Status
  enabled: boolean('enabled').default(true).notNull(),
  failureCount: integer('failure_count').default(0).notNull(),
  lastDeliveryAt: timestamp('last_delivery_at'),
  lastFailureAt: timestamp('last_failure_at'),
  lastFailureReason: text('last_failure_reason'),
  
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  agentIdx: index('webhooks_agent_idx').on(table.agentId),
  enabledIdx: index('webhooks_enabled_idx').on(table.enabled),
}));

// =============================================================================
// Webhook Deliveries (log of webhook attempts)
// =============================================================================

export const webhookDeliveries = pgTable('webhook_deliveries', {
  id: text('id').primaryKey(), // del_xxxxxxxxxxxx
  webhookId: text('webhook_id').references(() => webhooks.id).notNull(),
  
  // Event info
  event: text('event').notNull(),
  payload: jsonb('payload').notNull(),
  
  // Delivery status
  status: text('status').$type<'pending' | 'success' | 'failed'>().default('pending').notNull(),
  attempts: integer('attempts').default(0).notNull(),
  
  // Response info
  responseStatus: integer('response_status'),
  responseBody: text('response_body'),
  
  createdAt: timestamp('created_at').defaultNow().notNull(),
  deliveredAt: timestamp('delivered_at'),
}, (table) => ({
  webhookIdx: index('deliveries_webhook_idx').on(table.webhookId),
  statusIdx: index('deliveries_status_idx').on(table.status),
  createdAtIdx: index('deliveries_created_at_idx').on(table.createdAt),
}));

// =============================================================================
// Offers (docs/DESIGN.md section 3, 14.11)
// =============================================================================

export interface OfferStats {
  calls?: number;
  ok?: number;
  failed?: number;
  timeout?: number;
  inputInvalid?: number;
  outputInvalid?: number;
  p50Ms?: number;
  p95Ms?: number;
  lastCalledAt?: string;
}

export interface OfferRequires {
  secrets?: string[];
  callbackUrl?: boolean;
  notes?: string;
}

export const offers = pgTable('offers', {
  id: text('id').primaryKey(), // of_xxxxxxxxxxxxxxxx
  agentId: text('agent_id').references(() => agents.id).notNull(),
  slug: text('slug').notNull(), // [a-z0-9-]{2,48}
  version: integer('version').default(1).notNull(),
  title: text('title').notNull(),
  description: text('description'),
  inputSchema: jsonb('input_schema').notNull(),
  outputSchema: jsonb('output_schema').notNull(),
  inputSchemaHash: text('input_schema_hash').notNull(),
  outputSchemaHash: text('output_schema_hash').notNull(),
  examples: jsonb('examples').$type<{ input: unknown; output: unknown }[]>().default([]).notNull(),
  tags: jsonb('tags').$type<string[]>().default([]).notNull(),
  priceMicros: bigint('price_micros', { mode: 'bigint' }).default(sql`0`).notNull(),
  priceUnit: text('price_unit').default('call').notNull(),
  endpoint: text('endpoint'),
  transport: text('transport').default('ans-http').notNull(),
  mode: text('mode').default('sync').notNull(),
  timeoutMs: integer('timeout_ms').default(30000).notNull(),
  status: text('status').$type<'active' | 'paused' | 'retired'>().default('active').notNull(),
  probeOk: boolean('probe_ok'),
  probedAt: timestamp('probed_at'),
  stats: jsonb('stats').$type<OfferStats>().default({}).notNull(),
  publishSig: text('publish_sig').notNull(), // owner's standing acceptance of invocations
  requires: jsonb('requires').$type<OfferRequires>(),
  feeds: jsonb('feeds').$type<string[]>().default([]).notNull(), // ['@handle/slug', ...]
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  agentSlugVersionIdx: uniqueIndex('offers_agent_slug_version_idx').on(table.agentId, table.slug, table.version),
  agentIdx: index('offers_agent_idx').on(table.agentId),
  statusIdx: index('offers_status_idx').on(table.status),
  inputHashIdx: index('offers_input_schema_hash_idx').on(table.inputSchemaHash),
  outputHashIdx: index('offers_output_schema_hash_idx').on(table.outputSchemaHash),
  tagsIdx: index('offers_tags_idx').on(table.tags),
}));

// =============================================================================
// Receipts (docs/DESIGN.md section 3 amended by 14.3, 14.4)
// =============================================================================

export interface CounterpartyHintRow {
  name: string;
  url?: string;
  contactHash?: string;
}

/** What was signed, so the registry can state it (14.4) */
export interface SigMaterial {
  method?: string;
  path?: string;
  timestamp?: string;
  bodySha256?: string;
  offerCanonical?: string;
  [key: string]: unknown;
}

export const receipts = pgTable('receipts', {
  id: text('id').primaryKey(), // rc_xxxxxxxxxxxxxxxx
  clientId: text('client_id').references(() => agents.id), // null while unclaimed
  providerId: text('provider_id').references(() => agents.id), // null while unclaimed
  initiatorId: text('initiator_id').references(() => agents.id).notNull(),
  initiatorRole: text('initiator_role').$type<ReceiptRole>().notNull(),
  counterpartyHint: jsonb('counterparty_hint').$type<CounterpartyHintRow>(),
  claimTokenHash: text('claim_token_hash'),
  offerId: text('offer_id').references(() => offers.id),
  task: text('task').notNull(), // <= 280 chars
  inputHash: text('input_hash'),
  outputHash: text('output_hash'),
  outputUrl: text('output_url'),
  priceMicros: bigint('price_micros', { mode: 'bigint' }).default(sql`0`).notNull(),
  currency: text('currency').default('USD').notNull(),
  creditClass: text('credit_class').$type<CreditClass>().default('none').notNull(),
  feeBps: integer('fee_bps').notNull(), // frozen at open
  feeMicros: bigint('fee_micros', { mode: 'bigint' }).default(sql`0`).notNull(),
  deadlineAt: timestamp('deadline_at').notNull(),
  reviewWindowSec: integer('review_window_sec').default(604800).notNull(),
  via: text('via').$type<ReceiptVia>().default('direct').notNull(),
  state: text('state').$type<ReceiptState>().default('proposed').notNull(),

  // Signatures (14.3): roles derive from initiator_role
  termsHash: text('terms_hash').notNull(), // sha256 of the terms canonical string
  initiatorSig: text('initiator_sig').notNull(),
  counterpartySig: text('counterparty_sig'),
  sigMaterial: jsonb('sig_material').$type<SigMaterial>(),
  deliverSig: text('deliver_sig'),
  verdictSig: text('verdict_sig'),
  openNonce: text('open_nonce').notNull(),

  // Ratings (denormalized; the ratings table is the source of truth).
  // client_rating = the score the CLIENT received; provider_rating = the score the PROVIDER received.
  clientRating: integer('client_rating'),
  providerRating: integer('provider_rating'),
  ratingsRevealedAt: timestamp('ratings_revealed_at'),

  // Chain
  hash: text('hash'), // sha256 of the canonical sealed record
  prevHashClient: text('prev_hash_client'),
  prevHashProvider: text('prev_hash_provider'),

  // Timeline
  openedAt: timestamp('opened_at'),
  acceptedAt: timestamp('accepted_at'),
  deliveredAt: timestamp('delivered_at'),
  verdictAt: timestamp('verdict_at'),
  sealedAt: timestamp('sealed_at'),
  expiresAt: timestamp('expires_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  clientIdx: index('receipts_client_idx').on(table.clientId),
  providerIdx: index('receipts_provider_idx').on(table.providerId),
  initiatorIdx: index('receipts_initiator_idx').on(table.initiatorId),
  stateIdx: index('receipts_state_idx').on(table.state),
  deadlineIdx: index('receipts_deadline_idx').on(table.deadlineAt),
  deliveredIdx: index('receipts_delivered_idx').on(table.deliveredAt),
  sealedIdx: index('receipts_sealed_idx').on(table.sealedAt),
  offerIdx: index('receipts_offer_idx').on(table.offerId),
  claimTokenIdx: index('receipts_claim_token_idx').on(table.claimTokenHash),
  initiatorNonceIdx: uniqueIndex('receipts_initiator_nonce_idx').on(table.initiatorId, table.openNonce),
}));

export const receiptEvents = pgTable('receipt_events', {
  id: text('id').primaryKey(), // rev_
  receiptId: text('receipt_id').references(() => receipts.id).notNull(),
  fromState: text('from_state').$type<ReceiptState>(),
  toState: text('to_state').$type<ReceiptState>().notNull(),
  actor: text('actor').$type<ReceiptActor>().notNull(),
  payload: jsonb('payload'),
  signature: text('signature'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  receiptIdx: index('receipt_events_receipt_idx').on(table.receiptId),
  createdAtIdx: index('receipt_events_created_at_idx').on(table.createdAt),
}));

export const ratings = pgTable('ratings', {
  id: text('id').primaryKey(), // rt_
  receiptId: text('receipt_id').references(() => receipts.id).notNull(),
  raterId: text('rater_id').references(() => agents.id).notNull(),
  subjectId: text('subject_id').references(() => agents.id).notNull(),
  score: integer('score').notNull(), // 0-100
  tags: jsonb('tags').$type<string[]>(),
  note: text('note'), // <= 500
  signature: text('signature').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  revealedAt: timestamp('revealed_at'),
}, (table) => ({
  receiptRaterIdx: uniqueIndex('ratings_receipt_rater_idx').on(table.receiptId, table.raterId),
  subjectIdx: index('ratings_subject_idx').on(table.subjectId),
}));

// =============================================================================
// Ledger (docs/DESIGN.md section 6). ledger_txns and ledger_entries are
// append-only: migration 0007 installs BEFORE UPDATE OR DELETE triggers that
// raise, and a deferred constraint trigger asserting each txn sums to zero.
// =============================================================================

export type LedgerOwnerType = 'agent' | 'system';
export type LedgerKind = 'available' | 'held';
export type LedgerClass = 'sandbox' | 'cash';
export type LedgerTxnType = 'grant' | 'topup' | 'hold' | 'release' | 'refund' | 'split' | 'fee' | 'payout' | 'reversal';

export const ledgerAccounts = pgTable('ledger_accounts', {
  id: text('id').primaryKey(), // acc_
  ownerType: text('owner_type').$type<LedgerOwnerType>().notNull(),
  ownerId: text('owner_id').notNull(),
  kind: text('kind').$type<LedgerKind>().notNull(),
  klass: text('klass').$type<LedgerClass>().notNull(),
  balanceMicros: bigint('balance_micros', { mode: 'bigint' }).default(sql`0`).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  ownerIdx: uniqueIndex('ledger_accounts_owner_idx').on(table.ownerType, table.ownerId, table.kind, table.klass),
}));

export const ledgerTxns = pgTable('ledger_txns', {
  id: text('id').primaryKey(), // ltx_
  seq: bigserial('seq', { mode: 'bigint' }).notNull(), // chain order
  type: text('type').$type<LedgerTxnType>().notNull(),
  refType: text('ref_type'),
  refId: text('ref_id'),
  idempotencyKey: text('idempotency_key').notNull(),
  actorAgentId: text('actor_agent_id'),
  prevHash: text('prev_hash'),
  hash: text('hash').notNull(),
  createdAt: timestamp('created_at').notNull(),
}, (table) => ({
  idempotencyIdx: uniqueIndex('ledger_txns_idempotency_idx').on(table.idempotencyKey),
  seqIdx: uniqueIndex('ledger_txns_seq_idx').on(table.seq),
  refIdx: index('ledger_txns_ref_idx').on(table.refType, table.refId),
}));

export const ledgerEntries = pgTable('ledger_entries', {
  id: text('id').primaryKey(), // le_
  txnId: text('txn_id').references(() => ledgerTxns.id).notNull(),
  accountId: text('account_id').references(() => ledgerAccounts.id).notNull(),
  amountMicros: bigint('amount_micros', { mode: 'bigint' }).notNull(), // check != 0 (SQL)
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  txnIdx: index('ledger_entries_txn_idx').on(table.txnId),
  accountIdx: index('ledger_entries_account_idx').on(table.accountId),
}));

// =============================================================================
// API keys, idempotency, rate limits, nonces
// =============================================================================

export const apiKeys = pgTable('api_keys', {
  id: text('id').primaryKey(), // the display prefix 'ak_' + first 8 random chars
  keyHash: text('key_hash').notNull(),
  agentId: text('agent_id').references(() => agents.id).notNull(),
  label: text('label'),
  scopes: jsonb('scopes').$type<ApiKeyScope[]>().default([]).notNull(),
  spendCapMicrosPerDay: bigint('spend_cap_micros_per_day', { mode: 'bigint' }).default(sql`0`).notNull(),
  lastUsedAt: timestamp('last_used_at'),
  revokedAt: timestamp('revoked_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  keyHashIdx: uniqueIndex('api_keys_key_hash_idx').on(table.keyHash),
  agentIdx: index('api_keys_agent_idx').on(table.agentId),
}));

export const idempotencyKeys = pgTable('idempotency_keys', {
  agentId: text('agent_id').notNull(),
  key: text('key').notNull(),
  requestHash: text('request_hash').notNull(),
  status: integer('status').notNull(),
  response: jsonb('response'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  pk: primaryKey({ name: 'idempotency_keys_pk', columns: [table.agentId, table.key] }),
  createdAtIdx: index('idempotency_keys_created_at_idx').on(table.createdAt),
}));

export const rateLimits = pgTable('rate_limits', {
  key: text('key').primaryKey(),
  count: integer('count').default(0).notNull(),
  resetAt: timestamp('reset_at').notNull(),
});

export const requestNonces = pgTable('request_nonces', {
  agentId: text('agent_id').notNull(), // not a foreign key (14.7)
  nonce: text('nonce').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  pk: primaryKey({ name: 'request_nonces_pk', columns: [table.agentId, table.nonce] }),
  createdAtIdx: index('request_nonces_created_at_idx').on(table.createdAt),
}));

// =============================================================================
// Payouts (14.12), funnel (14.14), system flags (14.15)
// =============================================================================

export const payoutRequests = pgTable('payout_requests', {
  id: text('id').primaryKey(), // po_
  agentId: text('agent_id').references(() => agents.id).notNull(),
  amountMicros: bigint('amount_micros', { mode: 'bigint' }).notNull(),
  destinationIndex: integer('destination_index').notNull(), // index into agents.payment_methods
  status: text('status').$type<'pending' | 'approved' | 'paid' | 'rejected'>().default('pending').notNull(),
  holdTxnId: text('hold_txn_id'),
  payoutTxnId: text('payout_txn_id'),
  note: text('note'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  resolvedAt: timestamp('resolved_at'),
}, (table) => ({
  agentIdx: index('payout_requests_agent_idx').on(table.agentId),
  statusIdx: index('payout_requests_status_idx').on(table.status),
}));

export const funnelEvents = pgTable('funnel_events', {
  id: text('id').primaryKey(), // fe_
  event: text('event').notNull(), // receipt.viewed, claim.opened, claim.confirmed, register.completed, find.empty, offer.viewed
  receiptId: text('receipt_id'),
  offerId: text('offer_id'),
  agentId: text('agent_id'),
  src: text('src'), // receipt | offer | npx | web | api
  /** find.empty: the normalized query nobody could serve (demand signal); never personal data */
  detail: text('detail'),
  ipHash: text('ip_hash'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  eventCreatedIdx: index('funnel_events_event_created_idx').on(table.event, table.createdAt),
}));

export const systemFlags = pgTable('system_flags', {
  key: text('key').primaryKey(), // ledger_frozen, registrations_paused, house_daily_budget_micros, house_spent_today_micros
  value: jsonb('value').notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// =============================================================================
// Registry secrets (migration 0008): generated on first boot when the
// environment does not provide SESSION_SECRET or the registry keypair.
// Never exposed through any route.
// =============================================================================

export const registrySecrets = pgTable('registry_secrets', {
  key: text('key').primaryKey(), // session_secret, registry_keypair
  value: text('value').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});
