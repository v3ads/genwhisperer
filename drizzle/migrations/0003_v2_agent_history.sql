-- Migration: 0003_v2_agent_history
-- Adds the V2 tables for the Genesis AI Builder agent: per-tenant Genesis
-- projects (encrypted one-time MCP tokens), and DB-backed conversation history
-- (conversations + messages). All idempotent (IF NOT EXISTS) so re-running is
-- safe. Matches the hand-written style of 0001/0002.
--
-- Tables added:
--   genesis_projects  — per-user Genesis project (MCP URL + encrypted token)
--   conversations     — a session of agent turns against one project
--   messages          — the persisted turns (user / assistant / tool)
--
-- Enum added:
--   message_role      — system | user | assistant | tool

-- ─── Enum ────────────────────────────────────────────────────────────────────
-- DO block so the CREATE TYPE only runs when the enum does not already exist.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'message_role') THEN
    CREATE TYPE message_role AS ENUM ('system', 'user', 'assistant', 'tool');
  END IF;
END
$$;

-- ─── genesis_projects ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS genesis_projects (
    id                 SERIAL PRIMARY KEY,
    user_id            INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    name               VARCHAR(120) NOT NULL,
    genesis_project_id VARCHAR(64),
    mcp_url            TEXT NOT NULL,
    -- AES-256-GCM encrypted x-agent-token: iv:authTag:ciphertext (hex).
    -- Decrypted only in server memory; never returned to the browser.
    token_encrypted    TEXT NOT NULL,
    token_masked       VARCHAR(40) NOT NULL,
    last_used_at       TIMESTAMPTZ,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- List a user's projects; ownership checks filter on user_id.
CREATE INDEX IF NOT EXISTS idx_genesis_projects_user_id
    ON genesis_projects (user_id);

-- ─── conversations ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS conversations (
    id                 SERIAL PRIMARY KEY,
    user_id            INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    genesis_project_id INTEGER NOT NULL REFERENCES genesis_projects (id) ON DELETE CASCADE,
    title              VARCHAR(200) NOT NULL DEFAULT 'New conversation',
    model              VARCHAR(128) NOT NULL DEFAULT 'z-ai/glm-5.2',
    created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- List a user's conversations, most-recent first.
CREATE INDEX IF NOT EXISTS idx_conversations_user_id
    ON conversations (user_id);

-- Cascade deletes from genesis_projects hit these rows; index that path.
CREATE INDEX IF NOT EXISTS idx_conversations_project_id
    ON conversations (genesis_project_id);

-- ─── messages ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS messages (
    id                 SERIAL PRIMARY KEY,
    conversation_id    INTEGER NOT NULL REFERENCES conversations (id) ON DELETE CASCADE,
    role               message_role NOT NULL,
    content            TEXT NOT NULL,
    -- For assistant turns that emitted tool_calls: the raw OpenRouter/OpenAI
    -- tool_calls array, stored as JSONB for audit/replay. NULL otherwise.
    tool_calls         JSONB,
    prompt_tokens      INTEGER NOT NULL DEFAULT 0,
    completion_tokens  INTEGER NOT NULL DEFAULT 0,
    -- USD cost of the turn (usage × model pricing). numeric(12,6) covers up to
    -- $999,999 with micro-cent precision — far beyond any single turn.
    cost_usd           NUMERIC(12, 6) NOT NULL DEFAULT 0,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Loading conversation history filters on conversation_id, ordered by id.
CREATE INDEX IF NOT EXISTS idx_messages_conversation_id
    ON messages (conversation_id);
