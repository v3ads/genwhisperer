-- Migration: 0006_github_tokens
-- Adds the github_tokens table for the GitHub → Genesis import feature
-- (Phase 1). Each user stores one GitHub personal access token (PAT), used to
-- read their repos during import. The token is AES-256-GCM encrypted at rest
-- (same crypto util as user_api_keys / genesis_projects) and decrypted only
-- server-side by the github route — never sent to the browser.
--
-- The import feature is Pro-only (tier === 'pro'); the token row itself is
-- stored regardless of tier, but the state-changing routes gate on the tier.
--
-- Idempotent (CREATE TABLE IF NOT EXISTS / ADD COLUMN IF NOT EXISTS) so
-- re-running on every boot is safe. Matches the 0001–0005 hand-written style.

-- ─── github_tokens ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS github_tokens (
    id              SERIAL PRIMARY KEY,
    user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    encrypted_token TEXT    NOT NULL,
    masked_token    VARCHAR(48) NOT NULL,
    scopes          VARCHAR(128),
    login           VARCHAR(80),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (user_id)
);

CREATE INDEX IF NOT EXISTS idx_github_tokens_user_id ON github_tokens(user_id);
