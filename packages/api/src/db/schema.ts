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
// Messages (Agent-to-Agent communication)
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
