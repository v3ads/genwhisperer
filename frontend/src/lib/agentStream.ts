/**
 * Agent SSE stream client (V2).
 *
 * Streams the server-side agent loop from POST /api/agent/message. The server
 * emits one AgentEvent per `data:` line; this reader parses each and dispatches
 * it to the matching callback. Mirrors the v1 streamChat() reader pattern
 * (reader + decoder + buffer + line split) but for V2's structured events.
 *
 * A small retry is intentionally limited to failures before an SSE response
 * starts. This safely absorbs transient edge/proxy failures without replaying
 * a request after the server could have begun an agent action.
 */

/** Mirrors src/services/agentLoop.ts AgentEvent (the wire shape). */
export type AgentEvent =
  | { type: "status"; text: string }
  | { type: "narration"; text: string }
  | { type: "tool_approval_request"; gateId: string; tool: string; args: Record<string, unknown> }
  | { type: "tool_approval_resolved"; gateId: string; approved: boolean }
  | { type: "kb_answer"; question: string; answer: string; sources: Array<{ title?: string; url?: string }> }
  | { type: "final_answer"; text: string }
  | { type: "cost"; totalUsd: number }
  | { type: "conversation"; id: number }
  | { type: "error"; message: string }
  | { type: "done" };

/** Callbacks the Builder registers. Each is optional; unset ones are ignored. */
export interface AgentStreamHandlers {
  onStatus?: (text: string) => void;
  onNarration?: (text: string) => void;
  onToolApprovalRequest?: (gateId: string, tool: string, args: Record<string, unknown>) => void;
  onToolApprovalResolved?: (gateId: string, approved: boolean) => void;
  onKbAnswer?: (question: string, answer: string, sources: Array<{ title?: string; url?: string }>) => void;
  onFinalAnswer?: (text: string) => void;
  onCost?: (totalUsd: number) => void;
  onConversation?: (id: number) => void;
  onError?: (message: string) => void;
  onDone?: () => void;
}

export interface AgentStreamInput {
  genesisProjectId: number;
  conversationId?: number;
  message: string;
  model?: string;
}

const STREAM_START_MAX_ATTEMPTS = 3;
const RETRYABLE_START_STATUSES = new Set([502, 503, 504]);

function retryDelay(attempt: number): number {
  return 350 * 2 ** attempt + Math.floor(Math.random() * 150);
}

function waitForRetry(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(resolve, ms);
    const abort = () => {
      window.clearTimeout(timer);
      reject(Object.assign(new Error("Request aborted"), { name: "AbortError" }));
    };
    signal?.addEventListener("abort", abort, { once: true });
  });
}

/**
 * Start an agent turn. A 502/503/504 or network interruption before the SSE
 * body begins is retried twice. Once the stream starts, it is never replayed.
 */
export async function streamAgent(
  input: AgentStreamInput,
  handlers: AgentStreamHandlers,
  signal?: AbortSignal
): Promise<void> {
  for (let attempt = 0; attempt < STREAM_START_MAX_ATTEMPTS; attempt += 1) {
    let res: Response;
    try {
      res = await fetch("/api/agent/message", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
        signal,
      });
    } catch (error) {
      if (signal?.aborted || attempt === STREAM_START_MAX_ATTEMPTS - 1) throw error;
      handlers.onStatus?.("Connection interrupted. Reconnecting…");
      await waitForRetry(retryDelay(attempt), signal);
      continue;
    }

    if (!res.ok || !res.body) {
      let message = `Agent request failed (${res.status})`;
      try {
        const p = (await res.json()) as { error?: string; message?: string };
        message = p.message || p.error || message;
      } catch {
        /* non-JSON error body */
      }

      if (RETRYABLE_START_STATUSES.has(res.status) && attempt < STREAM_START_MAX_ATTEMPTS - 1) {
        handlers.onStatus?.("Connection interrupted. Reconnecting…");
        await waitForRetry(retryDelay(attempt), signal);
        continue;
      }
      throw new Error(message);
    }

    // From this point the server has accepted the request and may perform work.
    // Do not retry stream interruption errors, which could duplicate an agent turn.
    await consumeStream(res, handlers);
    return;
  }
}

async function consumeStream(res: Response, handlers: AgentStreamHandlers): Promise<void> {
  const reader = res.body!.getReader();
  try {
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // SSE frames are newline-separated; keep the last partial line buffered.
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const payload = line.slice(6).trim();
        if (!payload || payload === "[DONE]") continue;
        try {
          const ev = JSON.parse(payload) as AgentEvent;
          dispatch(ev, handlers);
        } catch {
          /* malformed chunk — skip */
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

function dispatch(ev: AgentEvent, h: AgentStreamHandlers): void {
  switch (ev.type) {
    case "status": h.onStatus?.(ev.text); break;
    case "narration": h.onNarration?.(ev.text); break;
    case "tool_approval_request": h.onToolApprovalRequest?.(ev.gateId, ev.tool, ev.args); break;
    case "tool_approval_resolved": h.onToolApprovalResolved?.(ev.gateId, ev.approved); break;
    case "kb_answer": h.onKbAnswer?.(ev.question, ev.answer, ev.sources); break;
    case "final_answer": h.onFinalAnswer?.(ev.text); break;
    case "cost": h.onCost?.(ev.totalUsd); break;
    case "conversation": h.onConversation?.(ev.id); break;
    case "error": h.onError?.(ev.message); break;
    case "done": h.onDone?.(); break;
  }
}
