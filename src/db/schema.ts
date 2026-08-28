import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  serial,
  text,
  timestamp,
  varchar,
} from "drizzle-orm/pg-core";

// ─── Enums ────────────────────────────────────────────────────────────────────
export const userRoleEnum = pgEnum("user_role", ["user", "admin"]);
export const keyTypeEnum = pgEnum("key_type", ["trial", "own"]);
/** Roles stored on a conversation message (OpenAI-style chat roles). */
export const messageRoleEnum = pgEnum("message_role", ["system", "user", "assistant", "tool"]);
/** Subscription tier (Phase 7a billing). */
export const tierEnum = pgEnum("tier", ["trial", "starter", "pro", "lapsed"]);

// ─── Users ────────────────────────────────────────────────────────────────────
export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  email: varchar("email", { length: 320 }).notNull().unique(),
  name: varchar("name", { length: 255 }),
  role: userRoleEnum("role").default("user").notNull(),
  /** Admin can suspend a user to block all AI access */
  suspended: boolean("suspended").default(false).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  lastSignedIn: timestamp("last_signed_in", { withTimezone: true }),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

// ─── Magic-link tokens ────────────────────────────────────────────────────────
export const magicLinks = pgTable(
  "magic_links",
  {
    id: serial("id").primaryKey(),
    email: varchar("email", { length: 320 }).notNull(),
    token: varchar("token", { length: 128 }).notNull().unique(),
    used: boolean("used").default(false).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    // Supports cleanup of expired links (WHERE expires_at < NOW()).
    expiresAtIdx: index("idx_magic_links_expires_at").on(t.expiresAt),
  })
);

export type MagicLink = typeof magicLinks.$inferSelect;
export type InsertMagicLink = typeof magicLinks.$inferInsert;

// ─── User OpenRouter keys (AES-256-GCM encrypted at rest) ─────────────────────
export const userApiKeys = pgTable("user_api_keys", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  /**
   * AES-256-GCM encrypted key stored as: iv:authTag:ciphertext (all hex-encoded)
   * Never returned to the client in plaintext.
   */
  encryptedKey: text("encrypted_key").notNull(),
  /** Masked display value shown to the user, e.g. sk-or-v1-****abcd */
  maskedKey: varchar("masked_key", { length: 32 }).notNull(),
  /** OpenRouter model the user has chosen for their own-key sessions */
  preferredModel: varchar("preferred_model", { length: 128 })
    .default("deepseek/deepseek-v4-pro")
    .notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export type UserApiKey = typeof userApiKeys.$inferSelect;
export type InsertUserApiKey = typeof userApiKeys.$inferInsert;

// ─── Message usage log ────────────────────────────────────────────────────────
export const messageUsage = pgTable(
  "message_usage",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    model: varchar("model", { length: 128 }).notNull(),
    /** "trial" = platform key consumed, "own" = user's own key */
    keyType: keyTypeEnum("key_type").notNull(),
    promptTokens: integer("prompt_tokens").default(0).notNull(),
    completionTokens: integer("completion_tokens").default(0).notNull(),
    totalTokens: integer("total_tokens").default(0).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    // Trial-cap checks and per-user lookups filter on (user_id, key_type).
    userKeyTypeIdx: index("idx_message_usage_user_key_type").on(t.userId, t.keyType),
    // Admin daily-volume rollup scans by created_at.
    createdAtIdx: index("idx_message_usage_created_at").on(t.createdAt),
  })
);

export type MessageUsage = typeof messageUsage.$inferSelect;
export type InsertMessageUsage = typeof messageUsage.$inferInsert;

// ─── System settings (admin-configurable key-value store) ─────────────────────
export const systemSettings = pgTable("system_settings", {
  id: serial("id").primaryKey(),
  key: varchar("key", { length: 128 }).notNull().unique(),
  value: text("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export type SystemSetting = typeof systemSettings.$inferSelect;
export type InsertSystemSetting = typeof systemSettings.$inferInsert;

// ─── Revoked sessions (JWT blocklist) ─────────────────────────────────────────
// Stores jti (JWT ID) of logged-out tokens until they expire.
// A background cleanup removes rows where expires_at < NOW() to keep the table small.
export const revokedSessions = pgTable("revoked_sessions", {
  jti: varchar("jti", { length: 128 }).primaryKey(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }).defaultNow().notNull(),
});

export type RevokedSession = typeof revokedSessions.$inferSelect;
export type InsertRevokedSession = typeof revokedSessions.$inferInsert;

// ─── Genesis projects (per-tenant, V2) ───────────────────────────────────────
// Each user connects one or more of their Genesis projects. For every project
// they store the Genesis MCP gateway URL (https://genesis.estage.com/api/agent/
// <projectId>/mcp) and a fresh one-time x-agent-token. The token is AES-256-GCM
// encrypted at rest (same util as user_api_keys) and only ever decrypted in
// server memory to drive the server-side agent loop — never sent to the browser.
export const genesisProjects = pgTable(
  "genesis_projects",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    /** Human label the user gives the project, e.g. "Main marketing site". */
    name: varchar("name", { length: 120 }).notNull(),
    /** Genesis project id parsed from the MCP URL, kept for display/convenience. */
    genesisProjectId: varchar("genesis_project_id", { length: 64 }),
    /** Full MCP gateway URL the agent POSTs JSON-RPC to. */
    mcpUrl: text("mcp_url").notNull(),
    /**
     * AES-256-GCM encrypted x-agent-token: iv:authTag:ciphertext (hex).
     * One-time tokens — once Genesis reports it consumed the token, the row
     * should be updated with a fresh one. Decrypted only server-side.
     */
    tokenEncrypted: text("token_encrypted").notNull(),
    /** Masked display value, e.g. "tok_****abcd". */
    tokenMasked: varchar("token_masked", { length: 40 }).notNull(),
    /** Updated when the agent last successfully used this project. */
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    // List a user's projects; ownership checks filter on user_id.
    userIdx: index("idx_genesis_projects_user_id").on(t.userId),
  })
);

export type GenesisProject = typeof genesisProjects.$inferSelect;
export type InsertGenesisProject = typeof genesisProjects.$inferInsert;

// ─── Conversations (DB-backed history, V2) ───────────────────────────────────
// A conversation groups a sequence of agent turns against a single Genesis
// project. Created on the first turn of a session; resumable across logins.
export const conversations = pgTable(
  "conversations",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    genesisProjectId: integer("genesis_project_id")
      .notNull()
      .references(() => genesisProjects.id, { onDelete: "cascade" }),
    /** Auto-derived from the first user message (truncated) or user-renamed. */
    title: varchar("title", { length: 200 }).notNull().default("New conversation"),
    /** Model used for this conversation (per-tenant OpenRouter model id). */
    model: varchar("model", { length: 128 }).notNull().default("z-ai/glm-5.2"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    // List a user's conversations, most-recent first.
    userIdx: index("idx_conversations_user_id").on(t.userId),
    // Cascade deletes hit the project's conversations; index for that path.
    projectIdx: index("idx_conversations_project_id").on(t.genesisProjectId),
  })
);

export type Conversation = typeof conversations.$inferSelect;
export type InsertConversation = typeof conversations.$inferInsert;

// ─── Messages (the turns within a conversation, V2) ──────────────────────────
// Every turn is persisted: user input, the assistant's narration + final
// answer, and the tool_calls the model emitted (JSONB, for replay/audit).
// Token usage + cost are recorded per assistant turn for the running cost badge.
export const messages = pgTable(
  "messages",
  {
    id: serial("id").primaryKey(),
    conversationId: integer("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    role: messageRoleEnum("role").notNull(),
    /** The message content (user text, assistant narration/final answer, tool result). */
    content: text("content").notNull(),
    /**
     * For assistant turns that emitted tool_calls: the raw tool_calls array
     * (OpenRouter/OpenAI shape) stored as JSONB, for audit and replay.
     * Null for plain user/assistant-text turns.
     */
    toolCalls: jsonb("tool_calls"),
    /**
     * For tool-result messages only: the tool_call_id this result answers
     * (matches an entry in the preceding assistant turn's tool_calls[].id).
     * Required by OpenRouter/OpenAI chat completions for role:"tool" messages;
     * null for all other roles. Persisted so resumed conversations replay a
     * well-formed tool message instead of one missing tool_call_id (which
     * caused upstream HTTP 500s). See migration 0005.
     */
    toolCallId: text("tool_call_id"),
    /**
     * For tool-result messages only: the function name that produced this
     * result (the name field on a role:"tool" chat message). Null otherwise.
     */
    toolName: text("tool_name"),
    promptTokens: integer("prompt_tokens").default(0).notNull(),
    completionTokens: integer("completion_tokens").default(0).notNull(),
    /** USD cost of this turn computed from usage × model pricing. */
    costUsd: numeric("cost_usd", { precision: 12, scale: 6 }).default("0").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    // Loading a conversation's history filters on conversation_id, ordered by id.
    conversationIdx: index("idx_messages_conversation_id").on(t.conversationId),
  })
);

export type Message = typeof messages.$inferSelect;
export type InsertMessage = typeof messages.$inferInsert;

// ─── Stripe customers (Phase 7a billing) ─────────────────────────────────────
// One row per user who has ever interacted with Stripe (created on first
// checkout). The stripe_customer_id is reused across subscription changes.
export const stripeCustomers = pgTable(
  "stripe_customers",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }).unique(),
    stripeCustomerId: varchar("stripe_customer_id", { length: 64 }).notNull().unique(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    // Lookups by Stripe customer id (webhooks).
    customerIdx: index("idx_stripe_customers_stripe_id").on(t.stripeCustomerId),
  })
);

export type StripeCustomer = typeof stripeCustomers.$inferSelect;
export type InsertStripeCustomer = typeof stripeCustomers.$inferInsert;

// ─── Subscriptions (Phase 7a billing) ────────────────────────────────────────
// The source of truth for a user's current tier + Stripe subscription state.
// Updated by webhook handlers. tier drives gating (project limits, trial turn
// cap, lapsed=read-only). trial_turns_used counts agent turns on the platform
// key during the free trial (cap from system_settings, default 2).
export const subscriptions = pgTable(
  "subscriptions",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }).unique(),
    tier: tierEnum("tier").default("trial").notNull(),
    stripeSubscriptionId: varchar("stripe_subscription_id", { length: 64 }),
    stripePriceId: varchar("stripe_price_id", { length: 64 }),
    /** Stripe subscription status: active, past_due, canceled, etc. */
    status: varchar("status", { length: 24 }),
    /** End of the current billing period (for end-of-period downgrades + lapsed detection). */
    currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
    /** Trial: agent turns consumed on the platform key (cap from system_settings, default 2). */
    trialTurnsUsed: integer("trial_turns_used").default(0).notNull(),
    /** Plan interval the user is on (monthly/annual) — for display + proration. */
    interval: varchar("interval", { length: 8 }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    userIdx: index("idx_subscriptions_user_id").on(t.userId),
  })
);

export type Subscription = typeof subscriptions.$inferSelect;
export type InsertSubscription = typeof subscriptions.$inferInsert;

// ─── GitHub tokens (per-tenant, for the GitHub→Genesis import feature) ────────
// Each user stores one GitHub personal access token (PAT) used to read their
// repos during import. The token is AES-256-GCM encrypted at rest (same crypto
// util as user_api_keys / genesis_projects) and only ever decrypted in server
// memory by the github route — never sent to the browser. A masked display
// value is returned to the UI. The import feature is Pro-only; the token itself
// is stored regardless of tier, but the state-changing routes (connect/repos/
// import) gate on tier === 'pro'.
export const githubTokens = pgTable(
  "github_tokens",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }).unique(),
    /**
     * AES-256-GCM encrypted GitHub PAT: iv:authTag:ciphertext (hex).
     * Decrypted only server-side. Never returned to the client in plaintext.
     */
    encryptedToken: text("encrypted_token").notNull(),
    /** Masked display value, e.g. "ghp_****abcd". */
    maskedToken: varchar("masked_token", { length: 48 }).notNull(),
    /** Comma-separated GitHub scopes granted by the token, e.g. "repo,read:user". */
    scopes: varchar("scopes", { length: 128 }),
    /** GitHub login of the token owner (from /user), for display. */
    login: varchar("login", { length: 80 }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    userIdx: index("idx_github_tokens_user_id").on(t.userId),
  })
);

export type GithubToken = typeof githubTokens.$inferSelect;
export type InsertGithubToken = typeof githubTokens.$inferInsert;
