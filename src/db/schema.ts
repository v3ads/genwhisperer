import {
  boolean,
  index,
  integer,
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
