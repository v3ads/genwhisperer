/**
 * Server-side agent loop (V2 — the core of GenWhisperer).
 *
 * Ports the v12 runAgent() loop to a server runtime. The Express agent route
 * calls runAgentLoop(); it:
 *   1. Connects a GenesisMcpClient to the user's project (token decrypted
 *      server-side, never sent to the browser), discovers the live tool set.
 *   2. Builds the V2 system prompt (with live tool names) + the OpenRouter
 *      function-tool schema (Genesis tools + estage_kb_query).
 *   3. Seeds genesis_context once, appends the user message.
 *   4. Loops (max 14 iters): call OpenRouter (non-streaming, with tools) →
 *      if the model returns tool_calls, execute each (Genesis via MCP, or KB),
 *      feeding results back as role:'tool' messages, then re-prompt; else
 *      emit the final answer and stop.
 *   5. Emits SSE events to the browser: narration (assistant text), status
 *      (running <tool>), tool_approval_request (high-impact ops — the loop
 *      PAUSES until the browser POSTs /approve/:gateId), final_answer, error,
 *      done. Tool execution is silent — the chat shows narration + final
 *      answer only (per the v12 decision).
 *   6. Computes per-turn cost from usage × model pricing; persists each turn
 *      to history (conversations + messages).
 *
 * Credentials are passed in by the caller and never persisted here.
 */

import { GenesisMcpClient, type McpTool } from "./genesisMcp.js";
import {
  chatStream as orChatStream,
  computeCost,
  fetchModels,
  type ChatMessage,
  type OrModel,
  type OrTool,
} from "./openrouter.js";
import { kbAsk } from "./estageKb.js";
import { genesisToolsToOrTools, needsConfirmation } from "../config/genesisTools.js";
import { buildSystemPrompt } from "../config/systemPrompt.js";
import { logAgentLaunch } from "../utils/launchObservability.js";
import { guardAgentToolCall } from "../utils/agentToolGuard.js";
import {
  appendMessage,
  createConversation,
  loadHistory,
  touchConversation,
} from "./history.js";

const MAX_ITERATIONS = 14;

/** Convert a model ID into a short, human-friendly progress label. */
function friendlyModelName(model: string): string {
  const normalized = model.toLowerCase();
  if (normalized.includes("kimi")) return "Kimi";
  if (normalized.includes("gemini")) return "Gemini";
  if (normalized.includes("claude")) return "Claude";
  if (normalized.includes("gpt")) return "GPT";
  return "Your AI";
}

/** Keep internal tool names out of user-facing agent progress. */
function friendlyToolStatus(toolName: string): string {
  const normalized = toolName.toLowerCase();
  if (normalized === "genesis_context") return "Reviewing your Genesis project…";
  if (normalized === "genesis_read_files") return "Reading your project files…";
  if (normalized === "genesis_cloud_status") return "Checking your Genesis project status…";
  if (normalized === "genesis_cloud_migrate") return "Genesis is migrating your project. This can take a minute…";
  if (normalized.includes("read") || normalized.includes("list") || normalized.includes("get") || normalized.includes("search")) {
    return "Reviewing project details…";
  }
  if (normalized.includes("write") || normalized.includes("edit") || normalized.includes("create") || normalized.includes("update") || normalized.includes("delete")) {
    return "Preparing changes in Genesis…";
  }
  return "Communicating with Genesis…";
}

/** SSE event the loop emits to the browser. */
export type AgentEvent =
  | { type: "status"; text: string }
  | { type: "narration"; text: string }
  | { type: "delta"; text: string }
  | { type: "tool_approval_request"; gateId: string; tool: string; args: Record<string, unknown> }
  | { type: "tool_approval_resolved"; gateId: string; approved: boolean }
  | { type: "kb_answer"; question: string; answer: string; sources: Array<{ title?: string; url?: string }> }
  | { type: "final_answer"; text: string }
  | { type: "cost"; totalUsd: number }
  | { type: "conversation"; id: number }
  | { type: "error"; message: string }
  | { type: "timeout_retry_available"; conversationId: number }
  | { type: "done" };

/** A sink that receives SSE events. The route implements this. */
export interface AgentSink {
  emit(ev: AgentEvent): void;
  /** Returns true if the client has disconnected (stop streaming). */
  closed(): boolean;
}

/** Pending write-confirmation gate — resolved by POST /api/agent/approve/:gateId. */
interface PendingGate {
  resolve: (approved: boolean) => void;
  reject: (err: Error) => void;
  tool: string;
  args: Record<string, unknown>;
  createdAt: number;
}

/** In-memory registry of pending approval gates, keyed by gateId. */
const pendingGates = new Map<string, PendingGate>();

/** Resolve a pending approval gate (called by the /approve route). */
export function resolveGate(gateId: string, approved: boolean): boolean {
  const g = pendingGates.get(gateId);
  if (!g) return false;
  pendingGates.delete(gateId);
  g.resolve(approved);
  return true;
}

/** Cancel all pending gates for a run (called if the client disconnects). */
export function cancelGatesFor(gateIds: string[]): void {
  for (const id of gateIds) {
    const g = pendingGates.get(id);
    if (g) {
      pendingGates.delete(id);
      g.reject(new Error("Client disconnected"));
    }
  }
}

/** The credentials + context needed to run the loop. */
export interface AgentRunInput {
  /** Correlates route, agent loop, OpenRouter, and Genesis lifecycle logs. */
  requestId: string;
  userId: number;
  /** Existing conversation id to resume, or null to create a new one. */
  conversationId: number | null;
  genesisProjectId: number;
  /** Genesis MCP URL + decrypted one-time token (server-side only). */
  mcpUrl: string;
  genesisToken: string;
  /** Tenant's decrypted OpenRouter key (server-side only). */
  openrouterKey: string;
  model: string;
  /** The user's new message for this turn. */
  userMessage: string;
  /** Optional: a pre-fetched genesis_context to seed (avoids re-fetch). */
  seededContext?: string | null;
  /** When true, trim replayed history to the last few turns before sending
   *  to the model — reduces context size so a reasoning model can produce
   *  its first token within the stream timeout. Used by the "Retry with
   *  shorter history" button on timeout. Does NOT delete persisted history;
   *  only trims what's sent to the model this turn. */
  compressHistory?: boolean;
}

/** Result summary of a run (for logging / AITable). */
export interface AgentRunResult {
  conversationId: number;
  finalAnswer: string;
  totalCostUsd: number;
  iterations: number;
  toolCalls: number;
  stopped: boolean;
  error: string | null;
}

/**
 * Run the agent loop. Streams SSE events to the sink. Persists history.
 * Never throws — errors are emitted as { type: 'error' } then { type: 'done' }.
 */
export async function runAgentLoop(
  input: AgentRunInput,
  sink: AgentSink
): Promise<AgentRunResult> {
  const gateIds: string[] = [];
  let totalCost = 0;
  let iterations = 0;
  let toolCallCount = 0;
  const toolCallAttempts = new Map<string, number>();
  let stopped = false;
  let errorMessage: string | null = null;
  let finalAnswer = "";
  let conversationId = input.conversationId;

  // Buffer the assistant narration + tool_calls for history persistence.
  let assistantBuffer = "";
  let assistantToolCalls: unknown = null;

  const safeEmit = (ev: AgentEvent) => {
    if (!sink.closed()) sink.emit(ev);
  };
  const launchBase = {
    requestId: input.requestId,
    userId: input.userId,
    projectId: input.genesisProjectId,
    conversationId,
    model: input.model,
  };
  const runStartedAt = Date.now();

  try {
    // ── 1. Connect to Genesis + discover the live tool set ──────────────────
    safeEmit({ type: "status", text: "Communicating with Genesis…" });
    logAgentLaunch({ ...launchBase, event: "genesis_connect_started" });
    const mcp = new GenesisMcpClient(input.mcpUrl, input.genesisToken);
    let genesisTools: McpTool[] = [];
    try {
      genesisTools = await mcp.listTools();
      logAgentLaunch({ ...launchBase, event: "genesis_connect_succeeded", toolCount: genesisTools.length, durationMs: Date.now() - runStartedAt });
    } catch (e) {
      logAgentLaunch({ ...launchBase, event: "genesis_connect_failed", durationMs: Date.now() - runStartedAt, errorName: (e as Error).name, errorMessage: (e as Error).message });
      const err = e as Error & { code?: number };
      if (err.code === 401) {
        throw new Error(
          "Genesis token invalid or already consumed. Generate a fresh one-time token in " +
            "Genesis > Integrations > Claude Code and update this project."
        );
      }
      throw new Error(`Could not connect to Genesis: ${err.message}`);
    }
    if (!genesisTools.length) {
      throw new Error("Connected, but Genesis exposed no tools. Check the project integration.");
    }

    // ── 2. Build the system prompt + tool schema ────────────────────────────
    const systemPrompt = buildSystemPrompt(genesisTools);
    const tools: OrTool[] = genesisToolsToOrTools(genesisTools);

    // ── 3. Assemble the message history ─────────────────────────────────────
    let messages: ChatMessage[] = [{ role: "system", content: systemPrompt }];

    // Seed genesis_context once (either pre-fetched or fetch it now).
    let contextText = input.seededContext ?? null;
    if (!contextText) {
      // Try to read genesis_context if the project exposes it.
      if (genesisTools.some((t) => t.name === "genesis_context")) {
        safeEmit({ type: "status", text: "Reviewing your project context…" });
        logAgentLaunch({ ...launchBase, event: "genesis_context_started", durationMs: Date.now() - runStartedAt });
        try {
          const ctx = await mcp.callTool("genesis_context", {});
          contextText = ctx.text;
          logAgentLaunch({ ...launchBase, event: "genesis_context_succeeded", durationMs: Date.now() - runStartedAt });
        } catch (e) {
          logAgentLaunch({ ...launchBase, event: "genesis_context_failed", durationMs: Date.now() - runStartedAt, errorName: (e as Error).name, errorMessage: (e as Error).message });
          /* non-fatal — the model can fetch it itself */
        }
      }
    }
    if (contextText) {
      messages.push({
        role: "system",
        content: `genesis_context result for this project:\n\n${contextText}`,
      });
    }

    // Create / resume the conversation.
    if (!conversationId) {
      conversationId = await createConversation({
        userId: input.userId,
        genesisProjectId: input.genesisProjectId,
        model: input.model,
        firstUserMessage: input.userMessage,
      });
      safeEmit({ type: "conversation", id: conversationId });
    } else {
      // Replay persisted history into the message array.
      const history = await loadHistory(conversationId);
      for (const m of history) {
        // Skip the persisted system messages — we rebuilt them above.
        if (m.role === "system") continue;
        // Defensive: a role:"tool" message MUST carry tool_call_id for
        // OpenRouter/OpenAI to accept it. Legacy rows saved before migration
        // 0005 lack it; replaying them would send a malformed tool message
        // and trigger an upstream HTTP 500 on resume. Skip those orphan rows
        // (their preceding assistant tool_calls is also dropped below) so a
        // single legacy bad row can't poison the whole conversation. New rows
        // always carry tool_call_id, so this only ever trims legacy data.
        if (m.role === "tool" && (!m.toolCallId || !m.toolCallId.trim())) {
          continue;
        }
        messages.push({
          role: m.role,
          content: m.content,
          ...(m.toolCalls
            ? { tool_calls: m.toolCalls as ChatMessage["tool_calls"] }
            : {}),
          ...(m.role === "tool" && m.toolCallId
            ? { tool_call_id: m.toolCallId, name: m.toolName ?? undefined }
            : {}),
        });
      }

      // Fail-open cleanup: if an assistant turn carries tool_calls but some of
      // its tool_call_ids have no surviving role:"tool" result (e.g. a legacy
      // orphan tool row was skipped above), OpenRouter/OpenAI reject the whole
      // request ("tool call ids not found" / 400/500). Drop the tool_calls
      // array from such assistant turns (keep their text content) so a legacy
      // gap can't poison the resume. Only ever trims legacy/incomplete data;
      // well-formed history is untouched.
      const answeredIds = new Set(
        messages
          .filter((mm) => mm.role === "tool" && mm.tool_call_id)
          .map((mm) => mm.tool_call_id as string)
      );
      for (const mm of messages) {
        if (mm.role === "assistant" && mm.tool_calls) {
          const allAnswered = mm.tool_calls.every(
            (tc) => answeredIds.has(tc.id)
          );
          if (!allAnswered) {
            mm.tool_calls = undefined;
          }
        }
      }

      // Compress history: when compressHistory is true (the user clicked
      // "Retry with shorter history" after a timeout), trim the replayed
      // messages to keep only the system prompt(s) + the last few turns.
      // This reduces the context size so a reasoning model can produce its
      // first token within the stream timeout. The full history stays in
      // the DB — only what's sent to the model this turn is trimmed.
      if (input.compressHistory) {
        const KEEP_LAST_N_TURNS = 3;
        const systemMsgs = messages.filter((m) => m.role === "system");
        const nonSystem = messages.filter((m) => m.role !== "system");
        // Keep the last N non-system messages (user/assistant/tool pairs).
        // A "turn" is roughly a user + assistant pair, so N*2ish messages.
        const kept = nonSystem.slice(Math.max(0, nonSystem.length - KEEP_LAST_N_TURNS * 2));
        // Ensure the first kept message isn't a lone tool result (which
        // needs a preceding assistant tool_calls). If it is, drop it.
        while (kept.length && kept[0].role === "tool") kept.shift();
        messages = [...systemMsgs, ...kept];
        safeEmit({ type: "status", text: "Retrying with a shorter conversation history…" });
      }
    }

    // Append the new user message.
    messages.push({ role: "user", content: input.userMessage });
    await appendMessage({
      conversationId: conversationId as number,
      role: "user",
      content: input.userMessage,
    });

    // Look up the model's pricing for cost computation.
    let modelPricing: OrModel | undefined;
    try {
      const models = await fetchModels(input.openrouterKey);
      modelPricing = models.find((m) => m.id === input.model);
    } catch {
      /* non-fatal — cost will be 0 if pricing can't be resolved */
    }

    // ── 4. The loop ─────────────────────────────────────────────────────────
    while (iterations++ < MAX_ITERATIONS) {
      if (sink.closed()) {
        stopped = true;
        break;
      }
      const modelProgress = iterations === 1
        ? `${friendlyModelName(input.model)} is reviewing your request…`
        : `${friendlyModelName(input.model)} is reviewing the project and preparing the next step…`;
      safeEmit({ type: "status", text: modelProgress });

      let resp;
      try {
        resp = await orChatStream({
          apiKey: input.openrouterKey,
          model: input.model,
          messages,
          tools,
          observability: launchBase,
          onDelta: (delta) => {
            // Stream partial content to the user in real-time so they see
            // text appearing instead of a frozen screen during long
            // reasoning-model generations. Only stream when there's no
            // tool_calls yet (tool-call preambles are not rendered live —
            // see the comment at the tool_calls branch below).
            safeEmit({ type: "delta", text: delta.content });
          },
        });
      } catch (e) {
        const err = e as Error & { name?: string };
        if (err.name === "AbortError") {
          // Distinguish a user-initiated abort (the SSE sink is closed — the
          // user navigated away or cancelled) from a timeout abort (the sink is
          // still open — the OpenRouter call exceeded the stream timeout).
          if (sink.closed()) {
            // User left — exit quietly (no point emitting to a dead stream).
            stopped = true;
            break;
          }
          // Timeout with the user still watching: tell them what happened and
          // signal the frontend to show a "Retry with shorter history" button.
          errorMessage = "The model is taking longer than expected to respond. Please try again — your message was saved, so you can pick up where you left off.";
          safeEmit({ type: "narration", text: errorMessage });
          if (conversationId) {
            safeEmit({ type: "timeout_retry_available", conversationId: conversationId as number });
          }
          stopped = true;
          break;
        }
        throw new Error(`OpenRouter error: ${err.message}`);
      }

      // Accumulate cost.
      if (resp.usage) {
        const c = computeCost(resp.usage, modelPricing);
        totalCost += c;
        safeEmit({ type: "cost", totalUsd: totalCost });
      }

      const choice = resp.choices?.[0];
      if (!choice || !choice.message) {
        throw new Error("No choice in OpenRouter response.");
      }
      const msg = choice.message;
      const assistantRecord: ChatMessage = {
        role: "assistant",
        content: msg.content || "",
        ...(msg.tool_calls ? { tool_calls: msg.tool_calls } : {}),
      };
      messages.push(assistantRecord);
      assistantBuffer = msg.content || "";
      assistantToolCalls = msg.tool_calls || null;

      if (msg.tool_calls && msg.tool_calls.length) {
        // Model preambles are retained in history but not rendered live: raw
        // self-correction text is not a useful customer-facing progress signal.

        // Persist the assistant turn (with tool_calls) before executing them.
        await appendMessage({
          conversationId: conversationId as number,
          role: "assistant",
          content: assistantBuffer,
          toolCalls: assistantToolCalls,
          promptTokens: resp.usage?.prompt_tokens,
          completionTokens: resp.usage?.completion_tokens,
          costUsd: totalCost, // running cost up to this turn
        });

        // Execute each tool call.
        for (const tc of msg.tool_calls) {
          if (sink.closed()) {
            stopped = true;
            break;
          }
          const fn = tc.function;
          let args: Record<string, unknown> = {};
          try {
            args = fn.arguments ? JSON.parse(fn.arguments) : {};
          } catch {
            args = {};
          }
          const toolGuard = guardAgentToolCall(toolCallAttempts, fn.name, args);
          if (!toolGuard.allowed) {
            if (toolGuard.errorName === "InvalidToolArguments") {
              // Recoverable: the model omitted a required arg (e.g. path/content
              // for write_file, or path/old_string/new_string for edit_file). Feed
              // the validation message back to the model as a tool result so it can
              // self-correct and re-emit the call with valid args, instead of
              // halting the turn with a confusing error. MAX_ITERATIONS bounds this.
              logAgentLaunch({ ...launchBase, event: "tool_failed", toolName: fn.name, toolCount: toolCallCount, durationMs: Date.now() - runStartedAt, errorName: toolGuard.errorName, errorMessage: toolGuard.message });
              safeEmit({ type: "status", text: "Correcting a missing file argument…" });
              const guardResultText = `Error: ${toolGuard.message} Please re-issue the call with the required arguments.`;
              messages.push({
                role: "tool",
                tool_call_id: tc.id,
                name: fn.name,
                content: guardResultText,
              });
              if (conversationId) {
                await appendMessage({
                  conversationId: conversationId as number,
                  role: "tool",
                  content: guardResultText,
                  toolCallId: tc.id,
                  toolName: fn.name,
                });
              }
              // Stop processing further tool calls in this batch and let the
              // while-loop re-iterate so the model sees the guard result and
              // can re-plan (rather than firing a second write in the same
              // batch after the first was rejected for missing args).
              break;
            }
            // DuplicateToolCallBlocked — genuine circuit-breaker, halt the run.
            errorMessage = toolGuard.message;
            logAgentLaunch({ ...launchBase, event: "tool_failed", toolName: fn.name, toolCount: toolCallCount, durationMs: Date.now() - runStartedAt, errorName: toolGuard.errorName, errorMessage: toolGuard.message });
            safeEmit({ type: "error", message: errorMessage });
            stopped = true;
            break;
          }

          toolCallCount += 1;
          safeEmit({ type: "status", text: friendlyToolStatus(fn.name) });
          logAgentLaunch({ ...launchBase, event: "tool_started", toolName: fn.name, toolCount: toolCallCount, durationMs: Date.now() - runStartedAt });

          // Heartbeat: some Genesis/eStage tool calls run 15-50s (genesis_read_files,
          // estage_kb_query, genesis_connectors). Without a periodic status event the
          // frontend's "working" line goes static for that whole window and reads as
          // frozen. Emit a friendly "still working" status every 15s while the tool
          // call is in flight so the user sees continued activity.
          const heartbeatText = `${friendlyToolStatus(fn.name).replace(/…$/, "")} — still working, this can take a bit…`;
          const heartbeat = setInterval(() => {
            if (sink.closed()) return;
            safeEmit({ type: "status", text: heartbeatText });
          }, 15_000);

          let resultText: string;
          try {
            resultText = await executeToolCall(
              fn.name,
              args,
              tc.id,
              mcp,
              sink,
              gateIds
            );
          } finally {
            clearInterval(heartbeat);
          }
          logAgentLaunch({ ...launchBase, event: "tool_succeeded", toolName: fn.name, toolCount: toolCallCount, durationMs: Date.now() - runStartedAt });

          // Feed the result back to the model as a tool message.
          messages.push({
            role: "tool",
            tool_call_id: tc.id,
            name: fn.name,
            content: resultText,
          });
          // Persist the tool result message (conversationId is set by now).
          // tool_call_id + name are required on role:"tool" chat messages so
          // OpenRouter can correlate the result to the assistant call it
          // answers; persist them so a resumed conversation replays a
          // well-formed tool message instead of one missing tool_call_id
          // (which triggered upstream HTTP 500s on resume).
          await appendMessage({
            conversationId: conversationId as number,
            role: "tool",
            content: resultText,
            toolCallId: tc.id,
            toolName: fn.name,
          });
        }
        if (stopped || sink.closed()) {
          stopped = true;
          break;
        }
        continue; // loop again so the model sees the tool results
      } else {
        // Final answer.
        finalAnswer = msg.content || "(no content)";
        safeEmit({ type: "final_answer", text: finalAnswer });
        // Persist the final assistant turn.
        await appendMessage({
          conversationId: conversationId as number,
          role: "assistant",
          content: finalAnswer,
          promptTokens: resp.usage?.prompt_tokens,
          completionTokens: resp.usage?.completion_tokens,
          costUsd: totalCost,
        });
        await touchConversation(conversationId as number);
        break;
      }
    }

    if (iterations > MAX_ITERATIONS && !stopped && !finalAnswer) {
      errorMessage =
        "Reached the max tool-call iteration limit. Ask me to continue or narrow the task.";
      safeEmit({ type: "narration", text: errorMessage });
    }
  } catch (e) {
    errorMessage = (e as Error).message;
    logAgentLaunch({ ...launchBase, event: "agent_failed", durationMs: Date.now() - runStartedAt, iterationCount: iterations, toolCount: toolCallCount, errorName: (e as Error).name, errorMessage });
    safeEmit({ type: "error", message: errorMessage });
  } finally {
    // Cancel any unresolved approval gates so they don't leak.
    cancelGatesFor(gateIds);
    safeEmit({ type: "done" });
  }

  if (!errorMessage) {
    logAgentLaunch({ ...launchBase, event: "agent_completed", durationMs: Date.now() - runStartedAt, iterationCount: iterations, toolCount: toolCallCount });
  }

  return {
    conversationId: conversationId as number,
    finalAnswer,
    totalCostUsd: totalCost,
    iterations,
    toolCalls: toolCallCount,
    stopped,
    error: errorMessage,
  };
}

/**
 * Execute a single tool call (Genesis or KB), honoring the write-confirmation
 * gate for high-impact ops. Returns the result text to feed back to the model.
 */
async function executeToolCall(
  name: string,
  args: Record<string, unknown>,
  toolCallId: string,
  mcp: GenesisMcpClient,
  sink: AgentSink,
  gateIds: string[]
): Promise<string> {
  const isKB = name === "estage_kb_query";

  // ── Confirmation gate for high-impact Genesis writes ─────────────────────
  if (!isKB && needsConfirmation(name, args)) {
    const gateId = `${toolCallId}:${Date.now()}`;
    gateIds.push(gateId);
    if (!sink.closed()) {
      sink.emit({ type: "tool_approval_request", gateId, tool: name, args });
    }
    let approved = false;
    try {
      approved = await new Promise<boolean>((resolve, reject) => {
        pendingGates.set(gateId, {
          resolve,
          reject,
          tool: name,
          args,
          createdAt: Date.now(),
        });
      });
    } catch {
      return "User disconnected before approving this operation.";
    }
    if (!sink.closed()) sink.emit({ type: "tool_approval_resolved", gateId, approved });
    if (!approved) {
      return "User denied this write operation.";
    }
  }

  // ── Execute ──────────────────────────────────────────────────────────────
  if (isKB) {
    try {
      const r = await kbAsk(String(args.question || ""), {
        topK: typeof args.top_k === "number" ? args.top_k : 5,
      });
      // Surface KB answers in the side panel (separate from chat).
      if (!sink.closed()) {
        sink.emit({
          type: "kb_answer",
          question: String(args.question || ""),
          answer: r.answer || "(no answer)",
          sources: r.sources || [],
        });
      }
      return r.answer || "(no answer)";
    } catch (e) {
      return `KB query failed: ${(e as Error).message}`;
    }
  }

  try {
    const result = await mcp.callTool(name, args);
    return result.text;
  } catch (e) {
    const err = e as Error & { toolError?: boolean; code?: number };
    return err.toolError ? err.message : `Tool error: ${err.message}`;
  }
}

/**
 * Approximate transcript for AITable logging (reconstructed from the run).
 * The route can call logSessionToAITable with this after the stream ends.
 */
export function buildTranscript(
  input: AgentRunInput,
  result: AgentRunResult
): { initialPrompt: string; finalPrompt: string; transcript: string } {
  return {
    initialPrompt: input.userMessage,
    finalPrompt: result.finalAnswer,
    transcript: `User: ${input.userMessage}\n\nAssistant: ${result.finalAnswer}`,
  };
}
