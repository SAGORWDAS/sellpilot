import {
  pgTable,
  pgEnum,
  text,
  timestamp,
  uuid,
  integer,
  real,
  jsonb,
  boolean,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import type {
  Audience,
  LeadSequence,
  OfferProfile,
  ReplyCategory,
  SiteAudit,
  Strategy,
} from '@/lib/schemas';

export const roleEnum = pgEnum('role', ['owner', 'member']);
export const projectTypeEnum = pgEnum('project_type', ['service', 'app', 'store', 'saas', 'other']);
export const projectGoalEnum = pgEnum('project_goal', [
  'book_call',
  'buy_product',
  'install_app',
  'signup',
  'other',
]);
export const campaignStatusEnum = pgEnum('campaign_status', ['draft', 'active', 'paused', 'completed']);
export const leadStatusEnum = pgEnum('lead_status', [
  'discovered',
  'audited',
  'queued',
  'contacted',
  'replied',
  'interested',
  'closed',
  'suppressed',
  'bounced',
]);
export const leadSourceEnum = pgEnum('lead_source', ['places', 'search', 'csv', 'manual']);
export const messageDirectionEnum = pgEnum('message_direction', ['outbound', 'inbound']);
export const messageKindEnum = pgEnum('message_kind', ['opener', 'followup', 'reply', 'close']);
export const messageStatusEnum = pgEnum('message_status', ['queued', 'sent', 'failed', 'received']);
export const conversationStateEnum = pgEnum('conversation_state', [
  'ai_active',
  'human_takeover',
  'closed',
  'suppressed',
]);

/* ---------------------------------------------------- identity (global) */

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey(),
    email: text('email').notNull(),
    passwordHash: text('password_hash').notNull(),
    name: text('name').notNull(),
    timezone: text('timezone').notNull().default('Australia/Sydney'),
    failedLoginCount: integer('failed_login_count').notNull().default(0),
    lockedUntil: timestamp('locked_until', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
  },
  (t) => [uniqueIndex('users_email_key').on(t.email)],
);

export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    tokenHash: text('token_hash').notNull(),
    organizationId: uuid('organization_id'),
    ip: text('ip'),
    userAgent: text('user_agent'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('sessions_token_hash_key').on(t.tokenHash),
    index('sessions_user_idx').on(t.userId),
  ],
);

export const organizations = pgTable('organizations', {
  id: uuid('id').primaryKey(),
  name: text('name').notNull(),
  plan: text('plan').notNull().default('founder'),
  stripeCustomerId: text('stripe_customer_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  archivedAt: timestamp('archived_at', { withTimezone: true }),
});

export const memberships = pgTable(
  'memberships',
  {
    id: uuid('id').primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    role: roleEnum('role').notNull().default('member'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('memberships_org_user_key').on(t.organizationId, t.userId),
    index('memberships_user_idx').on(t.userId),
  ],
);

export const orgSettings = pgTable('org_settings', {
  organizationId: uuid('organization_id')
    .primaryKey()
    .references(() => organizations.id),
  openaiKeyEnc: text('openai_key_enc'),
  serperKeyEnc: text('serper_key_enc'),
  bookingLink: text('booking_link'),
  notifyEmail: text('notify_email'),
  senderName: text('sender_name'),
  senderAddress: text('sender_address'),
  timezone: text('timezone').notNull().default('Australia/Sydney'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/* ------------------------------------------------------------- projects */

export const projects = pgTable(
  'projects',
  {
    id: uuid('id').primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    name: text('name').notNull(),
    type: projectTypeEnum('type').notNull().default('service'),
    goal: projectGoalEnum('goal').notNull().default('book_call'),
    urls: jsonb('urls').$type<string[]>().notNull().default([]),
    closeLink: text('close_link'),
    closeNotes: text('close_notes'),
    createdById: uuid('created_by_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
  },
  (t) => [index('projects_org_idx').on(t.organizationId, t.archivedAt)],
);

export const offerProfiles = pgTable(
  'offer_profiles',
  {
    id: uuid('id').primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id),
    profile: jsonb('profile').$type<OfferProfile>().notNull(),
    sourceText: text('source_text'),
    analyzedAt: timestamp('analyzed_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('offer_profiles_project_key').on(t.projectId)],
);

/* ------------------------------------------------------------ mailboxes */

export const mailboxes = pgTable(
  'mailboxes',
  {
    id: uuid('id').primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    label: text('label').notNull(),
    email: text('email').notNull(),
    fromName: text('from_name').notNull(),
    smtpHost: text('smtp_host').notNull(),
    smtpPort: integer('smtp_port').notNull().default(465),
    smtpSecure: boolean('smtp_secure').notNull().default(true),
    smtpUser: text('smtp_user').notNull(),
    smtpSecretEnc: text('smtp_secret_enc').notNull(),
    imapHost: text('imap_host').notNull(),
    imapPort: integer('imap_port').notNull().default(993),
    imapSecure: boolean('imap_secure').notNull().default(true),
    imapUser: text('imap_user').notNull(),
    imapSecretEnc: text('imap_secret_enc').notNull(),
    dailyCap: integer('daily_cap').notNull().default(40),
    warmupStartsAt: timestamp('warmup_starts_at', { withTimezone: true }).notNull().defaultNow(),
    imapUidValidity: integer('imap_uid_validity'),
    imapLastUid: integer('imap_last_uid').notNull().default(0),
    lastPollAt: timestamp('last_poll_at', { withTimezone: true }),
    lastError: text('last_error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
  },
  (t) => [index('mailboxes_org_idx').on(t.organizationId, t.archivedAt)],
);

/* ------------------------------------------------------------ campaigns */

export const campaigns = pgTable(
  'campaigns',
  {
    id: uuid('id').primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id),
    mailboxId: uuid('mailbox_id')
      .notNull()
      .references(() => mailboxes.id),
    name: text('name').notNull(),
    audience: jsonb('audience').$type<Audience>().notNull(),
    dailyVolume: integer('daily_volume').notNull().default(20),
    status: campaignStatusEnum('status').notNull().default('draft'),
    strategy: jsonb('strategy').$type<Strategy>(),
    tokenBudgetUsd: real('token_budget_usd').notNull().default(5),
    startedAt: timestamp('started_at', { withTimezone: true }),
    pausedAt: timestamp('paused_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('campaigns_org_idx').on(t.organizationId, t.status)],
);

/* ---------------------------------------------------------------- leads */

export const leads = pgTable(
  'leads',
  {
    id: uuid('id').primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id),
    businessName: text('business_name').notNull(),
    website: text('website'),
    email: text('email'),
    phone: text('phone'),
    city: text('city'),
    country: text('country'),
    timezone: text('timezone').notNull().default('Australia/Sydney'),
    source: leadSourceEnum('source').notNull().default('manual'),
    sourceRef: text('source_ref'),
    status: leadStatusEnum('status').notNull().default('discovered'),
    audit: jsonb('audit').$type<SiteAudit>(),
    hook: text('hook'),
    sequence: jsonb('sequence').$type<LeadSequence>(),
    stepIndex: integer('step_index').notNull().default(0),
    nextSendAt: timestamp('next_send_at', { withTimezone: true }),
    lastContactAt: timestamp('last_contact_at', { withTimezone: true }),
    repliedAt: timestamp('replied_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('leads_campaign_email_key').on(t.campaignId, t.email),
    index('leads_campaign_status_idx').on(t.campaignId, t.status),
    index('leads_org_idx').on(t.organizationId),
    index('leads_next_send_idx').on(t.nextSendAt),
  ],
);

/* -------------------------------------------------------- conversations */

export const conversations = pgTable(
  'conversations',
  {
    id: uuid('id').primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id),
    leadId: uuid('lead_id')
      .notNull()
      .references(() => leads.id),
    state: conversationStateEnum('state').notNull().default('ai_active'),
    lastCategory: text('last_category').$type<ReplyCategory>(),
    rootMessageId: text('root_message_id'),
    takeoverAt: timestamp('takeover_at', { withTimezone: true }),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('conversations_lead_key').on(t.leadId),
    index('conversations_org_idx').on(t.organizationId, t.state),
  ],
);

export const messages = pgTable(
  'messages',
  {
    id: uuid('id').primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id),
    leadId: uuid('lead_id')
      .notNull()
      .references(() => leads.id),
    direction: messageDirectionEnum('direction').notNull(),
    kind: messageKindEnum('kind').notNull(),
    status: messageStatusEnum('status').notNull(),
    messageId: text('message_id'),
    inReplyTo: text('in_reply_to'),
    fromAddress: text('from_address'),
    replyToken: text('reply_token'),
    subject: text('subject').notNull(),
    body: text('body').notNull(),
    category: text('category').$type<ReplyCategory>(),
    error: text('error'),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('messages_lead_idx').on(t.campaignId, t.leadId, t.at),
    index('messages_message_id_idx').on(t.messageId),
    index('messages_in_reply_to_idx').on(t.inReplyTo),
    index('messages_org_idx').on(t.organizationId, t.at),
  ],
);

/* ------------------------------------------- global suppression + audit */

export const suppressions = pgTable('suppressions', {
  email: text('email').primaryKey(),
  reason: text('reason').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const events = pgTable(
  'events',
  {
    id: uuid('id').primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    actorId: uuid('actor_id'),
    action: text('action').notNull(),
    subjectType: text('subject_type').notNull(),
    subjectId: text('subject_id'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>(),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('events_org_at_idx').on(t.organizationId, t.at)],
);

export const apiUsage = pgTable(
  'api_usage',
  {
    id: uuid('id').primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    campaignId: uuid('campaign_id'),
    provider: text('provider').notNull(),
    model: text('model').notNull(),
    operation: text('operation').notNull(),
    inputTokens: integer('input_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),
    costUsd: real('cost_usd').notNull().default(0),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('api_usage_org_idx').on(t.organizationId, t.at),
    index('api_usage_campaign_idx').on(t.campaignId),
  ],
);

export type User = typeof users.$inferSelect;
export type Organization = typeof organizations.$inferSelect;
export type Project = typeof projects.$inferSelect;
export type OfferProfileRow = typeof offerProfiles.$inferSelect;
export type Mailbox = typeof mailboxes.$inferSelect;
export type Campaign = typeof campaigns.$inferSelect;
export type Lead = typeof leads.$inferSelect;
export type Conversation = typeof conversations.$inferSelect;
export type Message = typeof messages.$inferSelect;