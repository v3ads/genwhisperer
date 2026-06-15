/**
 * AITable.ai session logging service
 * Writes a record to the "GenWhisperer Sessions" datasheet after each chat session.
 * All calls are fire-and-forget — errors are logged but never thrown to the caller.
 */

const AITABLE_API_URL = "https://aitable.ai/fusion/v1";
const DATASHEET_ID = "dstMmtUGTlFtdgwBJE";
const AITABLE_TOKEN = process.env.AITABLE_TOKEN ?? "uskA2PVLJxpLLkyStRvgPQC";

export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

/**
 * Extracts the content of the first fenced code block (``` ... ```) from a string.
 * Returns the trimmed block content, or null if none found.
 */
function extractFinalPrompt(text: string): string | null {
  const match = text.match(/```[\w]*\n?([\s\S]*?)```/);
  return match ? match[1].trim() : null;
}

/**
 * Formats a messages array into a readable conversation transcript.
 * System messages are excluded from the transcript.
 */
function formatConversation(messages: ChatMessage[], assistantResponse: string): string {
  const lines: string[] = [];
  for (const msg of messages) {
    if (msg.role === "system") continue;
    const label = msg.role === "user" ? "User" : "Assistant";
    lines.push(`[${label}]: ${msg.content}`);
  }
  // Append the final assistant response (the one just generated)
  lines.push(`[Assistant]: ${assistantResponse}`);
  return lines.join("\n\n");
}

/**
 * Logs a completed chat session to the AITable "GenWhisperer Sessions" datasheet.
 * Non-blocking — errors are caught and logged to console only.
 *
 * @param userEmail   Email of the authenticated user
 * @param messages    Full conversation history sent to OpenRouter (excludes system prompt)
 * @param assistantResponse  The full text of the assistant's response that was streamed
 * @param model       The OpenRouter model identifier used
 */
export function logSessionToAITable(
  userEmail: string,
  messages: ChatMessage[],
  assistantResponse: string,
  model: string
): void {
  // Fire-and-forget: do not await, do not throw
  (async () => {
    try {
      // First user message is the "initial prompt"
      const userMessages = messages.filter((m) => m.role === "user");
      const initialPrompt = userMessages[0]?.content ?? "";

      // Full conversation transcript (user + assistant turns, excluding system)
      const fullConversation = formatConversation(messages, assistantResponse);

      // Final prompt = first fenced code block in the assistant response
      const finalPrompt = extractFinalPrompt(assistantResponse) ?? "";

      // Message count = all user + assistant turns + this new response
      const messageCount = userMessages.length + messages.filter((m) => m.role === "assistant").length + 1;

      // Session date as ISO string (AITable DateTime field accepts ISO 8601)
      const sessionDate = new Date().toISOString();

      const record = {
        fields: {
          "Session Date": sessionDate,
          "User Email": userEmail,
          "Initial Prompt": initialPrompt,
          "Full Conversation": fullConversation,
          "Final Prompt": finalPrompt,
          "Message Count": messageCount,
          "Model Used": model,
        },
      };

      const response = await fetch(`${AITABLE_API_URL}/datasheets/${DATASHEET_ID}/records`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${AITABLE_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ records: [record] }),
      });

      if (!response.ok) {
        const body = await response.text();
        console.error(`[AITable] Failed to log session for ${userEmail}: HTTP ${response.status} — ${body}`);
      } else {
        console.log(`[AITable] Session logged for ${userEmail} (${messageCount} turns, model: ${model})`);
      }
    } catch (err) {
      console.error("[AITable] Unexpected error logging session:", err);
    }
  })();
}
