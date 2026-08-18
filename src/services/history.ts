/**
 * Conversation + message persistence (V2 history layer).
 *
 * DB-backed history: every agent turn is persisted. A conversation is created
 * on the first turn of a session (title derived from the first user message)
 * and is resumable across logins. Per-turn token usage + cost are recorded
 * for the running-cost badge and future analytics.
 */

import { and, desc, eq } from "drizzle-orm";
import {
  db,
  conversations,
  messages,
  type Conversation,
  type Message,
} from "../db/index.js";

/** A conversation row for the list view. */
export type ConversationSummary = Conversation;

/** A message row with its role/content for replay. */
export type HistoryMessage = Message;

/**
 * Create a conversation for a user + Genesis project. Title is derived from
 * the first user message (truncated). Returns the new conversation id.
 */
export async function createConversation(opts: {
  userId: number;
  genesisProjectId: number;
  model: string;
  firstUserMessage: string;
}): Promise<number> {
  const title = deriveTitle(opts.firstUserMessage);
  const [row] = await db
    .insert(conversations)
    .values({
      userId: opts.userId,
      genesisProjectId: opts.genesisProjectId,
      model: opts.model,
      title,
    })
    .returning({ id: conversations.id });
  return row!.id;
}

/** Touch updated_at when a turn is appended. */
export async function touchConversation(conversationId: number): Promise<void> {
  await db
    .update(conversations)
    .set({ updatedAt: new Date() })
    .where(eq(conversations.id, conversationId));
}

/** Rename a conversation (optional future UI). */
export async function renameConversation(
  conversationId: number,
  userId: number,
  title: string
): Promise<void> {
  await db
    .update(conversations)
    .set({ title: title.slice(0, 200) })
    .where(and(eq(conversations.id, conversationId), eq(conversations.userId, userId)));
}

/**
 * Append a message to a conversation. role is system/user/assistant/tool.
 * toolCalls is the raw OpenRouter tool_calls array (for assistant turns that
 * emitted them); null otherwise. Tokens + cost are recorded per turn.
 */
export async function appendMessage(opts: {
  conversationId: number;
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  toolCalls?: unknown | null;
  promptTokens?: number;
  completionTokens?: number;
  costUsd?: number;
}): Promise<void> {
  await db.insert(messages).values({
    conversationId: opts.conversationId,
    role: opts.role,
    content: opts.content,
    toolCalls: opts.toolCalls ?? null,
    promptTokens: opts.promptTokens ?? 0,
    completionTokens: opts.completionTokens ?? 0,
    costUsd: (opts.costUsd ?? 0).toString(),
  });
  await touchConversation(opts.conversationId);
}

/**
 * Load a conversation's message history, ordered by id (oldest first) so the
 * agent loop can replay it into the OpenRouter request. Only loads messages
 * for a conversation owned by the given user (ownership check at the route).
 */
export async function loadHistory(
  conversationId: number
): Promise<HistoryMessage[]> {
  return db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, conversationId))
    .orderBy(messages.id);
}

/**
 * List a user's conversations, most-recent first. Each row carries title,
 * model, project, and timestamps for the conversations list UI.
 */
export async function listConversations(
  userId: number
): Promise<ConversationSummary[]> {
  return db
    .select()
    .from(conversations)
    .where(eq(conversations.userId, userId))
    .orderBy(desc(conversations.updatedAt));
}

/**
 * Get a conversation (for ownership verification). Returns null if not found.
 */
export async function getConversation(
  conversationId: number,
  userId: number
): Promise<Conversation | null> {
  const rows = await db
    .select()
    .from(conversations)
    .where(and(eq(conversations.id, conversationId), eq(conversations.userId, userId)))
    .limit(1);
  return rows[0] ?? null;
}

/** Delete a conversation (cascades to its messages). */
export async function deleteConversation(
  conversationId: number,
  userId: number
): Promise<void> {
  await db
    .delete(conversations)
    .where(and(eq(conversations.id, conversationId), eq(conversations.userId, userId)));
}

/** Derive a conversation title from the first user message. */
function deriveTitle(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return "New conversation";
  return clean.length > 80 ? clean.slice(0, 77) + "…" : clean;
}
