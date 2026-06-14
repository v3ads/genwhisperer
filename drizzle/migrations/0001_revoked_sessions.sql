-- Migration: 0001_revoked_sessions
-- Adds a JWT revocation blocklist table to support proper server-side logout.
-- Each row stores the jti (JWT ID) of a logged-out token until it would naturally expire.
-- A cleanup index allows efficient deletion of expired entries.

CREATE TABLE IF NOT EXISTS revoked_sessions (
    jti VARCHAR(128) PRIMARY KEY,
    expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for cleanup queries (WHERE expires_at < NOW())
CREATE INDEX IF NOT EXISTS idx_revoked_sessions_expires_at 
    ON revoked_sessions (expires_at);
