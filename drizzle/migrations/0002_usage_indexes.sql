-- Migration: 0002_usage_indexes
-- Adds indexes to the hottest query paths so trial-cap checks, per-user usage
-- lookups, the admin daily-volume rollup, and magic-link cleanup don't require
-- full table scans as data accumulates. All idempotent (IF NOT EXISTS).

-- message_usage is filtered by (user_id, key_type) on every chat request and
-- status poll (trial-cap check, per-user usage list).
CREATE INDEX IF NOT EXISTS idx_message_usage_user_key_type
    ON message_usage (user_id, key_type);

-- Admin stats roll up message volume by day over the last 30 days.
CREATE INDEX IF NOT EXISTS idx_message_usage_created_at
    ON message_usage (created_at);

-- Supports pruning of expired magic links (WHERE expires_at < NOW()).
CREATE INDEX IF NOT EXISTS idx_magic_links_expires_at
    ON magic_links (expires_at);
