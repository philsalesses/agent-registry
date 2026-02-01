import { pgTable, text, timestamp, jsonb, integer, boolean, index, uniqueIndex } from 'drizzle-orm/pg-core';

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
}, (table) => ({
  nameIdx: index('agents_name_idx').on(table.name),
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
// Agent Capabilities (junction table with trust scores)
// =============================================================================

export const agentCapabilities = pgTable('agent_capabilities', {
  id: text('id').primaryKey(),
  agentId: text('agent_id').references(() => agents.id).notNull(),
  capabilityId: text('capability_id').references(() => capabilities.id).notNull(),
  endpoint: text('endpoint'),
  trustScore: integer('trust_score').default(0).notNull(),
  verified: boolean('verified').default(false).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  agentCapabilityIdx: uniqueIndex('agent_capability_idx').on(table.agentId, table.capabilityId),
  trustScoreIdx: index('trust_score_idx').on(table.trustScore),
}));

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
}, (table) => ({
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
