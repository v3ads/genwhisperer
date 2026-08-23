-- Migration: 0005_tool_message_ids
-- Adds tool_call_id + tool_name columns to the messages table so that
-- tool-result (role:"tool") messages round-trip through the DB and replay
-- correctly on conversation resume.
--
-- Background: OpenRouter/OpenAI chat completions require every role:"tool"
-- message to carry the tool_call_id of the assistant call it answers (and the
-- function name). Previously the messages table only stored role/content/
-- tool_calls, so tool_call_id + name were dropped on save and the replayed
-- tool message was malformed — OpenRouter returned HTTP 500 Internal Server
-- Error on resume for ANY model, because the broken message lives in the
-- conversation history, not the per-request model selection.
--
-- These columns are nullable: existing rows (and non-tool roles) stay NULL.
-- The agent loop's replay defensively skips any tool row still missing a
-- tool_call_id so a single legacy bad row can't poison a whole conversation.
--
-- Idempotent (ADD COLUMN IF NOT EXISTS) so re-running is safe. Matches the
-- 0001–0004 hand-written style.

-- ─── messages: tool correlation columns ──────────────────────────────────────
ALTER TABLE messages
    ADD COLUMN IF NOT EXISTS tool_call_id TEXT;

ALTER TABLE messages
    ADD COLUMN IF NOT EXISTS tool_name TEXT;
