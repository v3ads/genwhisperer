/**
 * Import SSE stream client (V2) — Phase 3.
 *
 * Streams the server-side GitHub→Genesis import (Stage A) from
 * POST /api/github/import. The server emits one ImportEvent per `data:` line;
 * this reader parses each and dispatches it to the matching callback.
 *
 * Mirrors lib/agentStream.ts's reader pattern (reader + decoder + buffer +
 * line split). Phase 3 emits up through `plan` (Stage A); Stage B execution
 * events will be added in Phase 4.
 */

/** The server-side import event shape (mirrors routes/github.ts).
 *  Phase 4 adds: tool_approval_request/resolved, progress, summary. */
export type ImportEvent =
  | { type: "status"; text: string }
  | { type: "plan"; plan: unknown }
  | { type: "tool_approval_request"; gateId: string; tool: string; args: Record<string, unknown> }
  | { type: "tool_approval_resolved"; gateId: string; approved: boolean }
  | { type: "progress"; done: number; total: number; label: string }
  | { type: "summary"; succeeded: string[]; skipped: string[]; failed: Array<{ label: string; error: string }> }
  | { type: "cost"; totalUsd: number }
  | { type: "error"; message: string }
  | { type: "done" };

/** Callbacks the Import page registers. */
export interface ImportStreamHandlers {
  onStatus?: (text: string) => void;
  onPlan?: (plan: unknown) => void;
  onToolApprovalRequest?: (gateId: string, tool: string, args: Record<string, unknown>) => void;
  onToolApprovalResolved?: (gateId: string, approved: boolean) => void;
  onProgress?: (done: number, total: number, label: string) => void;
  onSummary?: (succeeded: string[], skipped: string[], failed: Array<{ label: string; error: string }>) => void;
  onCost?: (totalUsd: number) => void;
  onError?: (message: string) => void;
  onDone?: () => void;
}

export interface ImportStreamInput {
  genesisProjectId: number;
  repoOwner: string;
  repoName: string;
  branch: string;
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
 * Start an import (Stage A). A 502/503/504 or network interruption before
 * the SSE body begins is retried twice. Once the stream starts, it is never
 * replayed.
 */
export async function streamImport(
  input: ImportStreamInput,
  handlers: ImportStreamHandlers,
  signal?: AbortSignal
): Promise<void> {
  for (let attempt = 0; attempt < STREAM_START_MAX_ATTEMPTS; attempt += 1) {
    let res: Response;
    try {
      res = await fetch("/api/github/import", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          genesisProjectId: input.genesisProjectId,
          repoOwner: input.repoOwner,
          repoName: input.repoName,
          branch: input.branch,
        }),
        signal,
      });
    } catch (error) {
      if (signal?.aborted || attempt === STREAM_START_MAX_ATTEMPTS - 1) throw error;
      handlers.onStatus?.("Connection interrupted. Reconnecting…");
      await waitForRetry(retryDelay(attempt), signal);
      continue;
    }

    if (!res.ok || !res.body) {
      let message = `Import request failed (${res.status})`;
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
    // Do not retry stream interruption errors, which could duplicate an import.
    await consumeStream(res, handlers);
    return;
  }
}

async function consumeStream(res: Response, handlers: ImportStreamHandlers): Promise<void> {
  const reader = res.body!.getReader();
  try {
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const payload = line.slice(6).trim();
        if (!payload || payload === "[DONE]") continue;
        try {
          const ev = JSON.parse(payload) as ImportEvent;
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

function dispatch(ev: ImportEvent, h: ImportStreamHandlers): void {
  switch (ev.type) {
    case "status": h.onStatus?.(ev.text); break;
    case "plan": h.onPlan?.(ev.plan); break;
    case "tool_approval_request": h.onToolApprovalRequest?.(ev.gateId, ev.tool, ev.args); break;
    case "tool_approval_resolved": h.onToolApprovalResolved?.(ev.gateId, ev.approved); break;
    case "progress": h.onProgress?.(ev.done, ev.total, ev.label); break;
    case "summary": h.onSummary?.(ev.succeeded, ev.skipped, ev.failed); break;
    case "cost": h.onCost?.(ev.totalUsd); break;
    case "error": h.onError?.(ev.message); break;
    case "done": h.onDone?.(); break;
  }
}

export interface ExecuteStreamInput {
  genesisProjectId: number;
  plan: unknown;
  backendOption: "reuse-supabase" | "dedicated-cloud" | "skip";
}

/** Start Stage B (execute). Same retry-before-stream-starts semantics as
 *  streamImport. Once the stream starts, it is never replayed. */
export async function streamExecute(
  input: ExecuteStreamInput,
  handlers: ImportStreamHandlers,
  signal?: AbortSignal
): Promise<void> {
  for (let attempt = 0; attempt < STREAM_START_MAX_ATTEMPTS; attempt += 1) {
    let res: Response;
    try {
      res = await fetch("/api/github/execute", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          genesisProjectId: input.genesisProjectId,
          plan: input.plan,
          backendOption: input.backendOption,
        }),
        signal,
      });
    } catch (error) {
      if (signal?.aborted || attempt === STREAM_START_MAX_ATTEMPTS - 1) throw error;
      handlers.onStatus?.("Connection interrupted. Reconnecting…");
      await waitForRetry(retryDelay(attempt), signal);
      continue;
    }

    if (!res.ok || !res.body) {
      let message = `Execute request failed (${res.status})`;
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

    await consumeStream(res, handlers);
    return;
  }
}
