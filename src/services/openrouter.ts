/**
 * OpenRouter client (server-side, V2).
 *
 * Ports the v12 browser OpenRouter client to TypeScript. Used by the agent
 * runtime to (a) list function-calling-capable models for the picker and
 * (b) run the non-streaming chat completion that drives the agent loop.
 *
 * The tenant's OpenRouter key is passed in by the caller (the agent route
 * decrypts it from Neon) and never persisted here. Native function-calling
 * (the `tools` param) — no text-based fallback, per the v12 decision.
 */

const OR_MODELS_URL = "https://openrouter.ai/api/v1/models";
const OR_CHAT_URL = "https://openrouter.ai/api/v1/chat/completions";
const MODELS_TIMEOUT_MS = 15_000;
const CHAT_TIMEOUT_MS = 120_000;
const CHAT_MAX_ATTEMPTS = 3;
const CHAT_RETRY_BASE_MS = 500;
const CHAT_RETRY_MAX_MS = 4_000;

import { logAgentLaunch } from "../utils/launchObservability.js";

export interface OpenRouterObservabilityContext {
  requestId: string;
  userId?: number;
  projectId?: number;
  conversationId?: number | null;
}

/** A model entry from OpenRouter /models, lightly filtered + grouped. */
export interface OrModel {
  id: string;
  name?: string;
  context_length?: number;
  supported_parameters?: string[];
  pricing?: {
    prompt?: string;
    completion?: string;
    input_cache_read?: string;
  };
  /** Added by fetchModels: "Recommended" | "All capable models" */
  _group?: string;
}

/** OpenAI-style chat message used in requests to /chat/completions. */
export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  /** Present on assistant messages that emit tool_calls. */
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
  /** Present on tool-result messages fed back to the model. */
  tool_call_id?: string;
  /** Present on tool-result messages fed back to the model. */
  name?: string;
}

/** A function tool definition passed to /chat/completions. */
export interface OrTool {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

/** Token usage returned on a chat completion. */
export interface ChatUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  prompt_tokens_details?: { cached_tokens?: number };
}

/** A chat completion choice. */
export interface ChatChoice {
  message?: {
    content?: string | null;
    tool_calls?: Array<{
      id: string;
      type: "function";
      function: { name: string; arguments: string };
    }> | null;
  };
}

/** Shape returned by chat(). */
export interface ChatResult {
  choices?: ChatChoice[];
  usage?: ChatUsage;
}

/**
 * Fetch the OpenRouter model list, filtered to "Option A" (function-calling
 * capable + ≥128k context + not :free/:batch/:nitro ≈ 258 models) and grouped
 * (Recommended strong agent families first, then the rest alphabetically).
 * Mirrors the v12 fetchModels() exactly.
 */
export async function fetchModels(apiKey: string): Promise<OrModel[]> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), MODELS_TIMEOUT_MS);
  let r: Response;
  try {
    r = await fetch(OR_MODELS_URL, {
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
      signal: ctrl.signal,
    });
  } catch (e) {
    clearTimeout(timer);
    const err = e as Error;
    if (err.name === "AbortError") {
      throw new Error("OpenRouter /models timed out (15s). Check the network.");
    }
    throw new Error(`OpenRouter /models unreachable: ${err.message}`);
  }
  clearTimeout(timer);
  if (r.status === 401) {
    throw new Error("OpenRouter API key invalid (401). Check the key at openrouter.ai/keys.");
  }
  if (!r.ok) throw new Error(`OpenRouter /models HTTP ${r.status}`);
  const j = (await r.json()) as { data?: OrModel[] };
  const all = j.data || [];

  const capable = all.filter((m) => {
    if (!(m.supported_parameters || []).includes("tools")) return false;
    if ((m.context_length || 0) < 128000) return false;
    const id = m.id || "";
    if (id.endsWith(":free")) return false;
    if (id.endsWith(":batch")) return false; // async batch mode — not interactive
    if (id.includes(":nitro")) return false; // routing variant, not a different model
    return true;
  });

  const STRONG = [
    "anthropic/claude",
    "openai/gpt-5",
    "google/gemini-3",
    "qwen/qwen",
    "deepseek/deepseek-v4",
    "xai/grok-4",
    "z-ai/glm-5",
    "moonshotai/kimi",
  ];
  const rec: OrModel[] = [];
  const rest: OrModel[] = [];
  for (const m of capable) {
    const id = m.id || "";
    if (STRONG.some((p) => id.startsWith(p))) {
      m._group = "Recommended";
      rec.push(m);
    } else {
      m._group = "All capable models";
      rest.push(m);
    }
  }
  const byName = (a: OrModel, b: OrModel) =>
    (a.name || a.id).localeCompare(b.name || b.id);
  rec.sort(byName);
  rest.sort(byName);
  return rec.concat(rest);
}

/** A classified OpenRouter failure suitable for retry decisions and safe logs. */
export class OpenRouterChatError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly retryable = false,
    readonly requestId?: string
  ) {
    super(message);
    this.name = "OpenRouterChatError";
  }
}

function configuredFallbackModels(): string[] {
  return (process.env.OPENROUTER_FALLBACK_MODELS ?? "")
    .split(",")
    .map((model) => model.trim())
    .filter(Boolean)
    .slice(0, 3);
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}

function retryAfterMs(response: Response, attempt: number): number {
  const retryAfter = response.headers.get("retry-after");
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1_000;
    const dateMs = Date.parse(retryAfter) - Date.now();
    if (Number.isFinite(dateMs) && dateMs > 0) return dateMs;
  }
  const exponential = Math.min(CHAT_RETRY_BASE_MS * 2 ** attempt, CHAT_RETRY_MAX_MS);
  return exponential + Math.floor(Math.random() * 250);
}

function wait(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(Object.assign(new Error("OpenRouter chat aborted."), { name: "AbortError" }));
    }, { once: true });
  });
}

async function errorMessage(response: Response): Promise<string> {
  const raw = await response.text().catch(() => "");
  try {
    const parsed = JSON.parse(raw) as { error?: { message?: string }; message?: string };
    return parsed.error?.message || parsed.message || `HTTP ${response.status}`;
  } catch {
    return raw.slice(0, 400) || `HTTP ${response.status}`;
  }
}

/**
 * Run a non-streaming OpenRouter completion with native function-calling.
 *
 * Transient network and availability failures are retried at most twice after
 * the initial request. OpenRouter's native `models` routing is used only when
 * OPENROUTER_FALLBACK_MODELS or opts.fallbackModels is explicitly configured;
 * this preserves a tenant's selected model by default.
 */
export async function chat(opts: {
  apiKey: string;
  model: string;
  messages: ChatMessage[];
  tools?: OrTool[];
  /** Ordered fallback model IDs; at most three are forwarded to OpenRouter. */
  fallbackModels?: string[];
  /** Request correlation fields for launch-phase logs; never includes secrets or content. */
  observability?: OpenRouterObservabilityContext;
  signal?: AbortSignal;
}): Promise<ChatResult> {
  const { apiKey, model, messages, tools, signal, observability } = opts;
  const fallbacks = (opts.fallbackModels ?? configuredFallbackModels())
    .filter((fallback) => fallback !== model)
    .slice(0, 3);
  const body: Record<string, unknown> = { model, messages, temperature: 0.3 };
  if (fallbacks.length) body.models = [model, ...fallbacks];
  if (tools && tools.length) {
    body.tools = tools;
    body.tool_choice = "auto";
    body.parallel_tool_calls = false;
  }

  for (let attempt = 0; attempt < CHAT_MAX_ATTEMPTS; attempt += 1) {
    const attemptStartedAt = Date.now();
    logAgentLaunch({
      requestId: observability?.requestId ?? "uncorrelated",
      userId: observability?.userId,
      projectId: observability?.projectId,
      conversationId: observability?.conversationId,
      event: "openrouter_attempt_started",
      model,
      attempt: attempt + 1,
      maxAttempts: CHAT_MAX_ATTEMPTS,
    });
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), CHAT_TIMEOUT_MS);
    const abort = () => ctrl.abort();
    signal?.addEventListener("abort", abort, { once: true });

    try {
      const response = await fetch(OR_CHAT_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
          "X-Title": "GenWhisperer V2",
        },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
      if (response.ok) {
        const result = (await response.json()) as ChatResult & { model?: string };
        logAgentLaunch({
          requestId: observability?.requestId ?? "uncorrelated",
          userId: observability?.userId,
          projectId: observability?.projectId,
          conversationId: observability?.conversationId,
          event: "openrouter_attempt_succeeded",
          model,
          effectiveModel: result.model ?? model,
          attempt: attempt + 1,
          maxAttempts: CHAT_MAX_ATTEMPTS,
          upstreamRequestId: response.headers.get("x-request-id") ?? undefined,
          durationMs: Date.now() - attemptStartedAt,
        });
        return result;
      }

      const status = response.status;
      const message = await errorMessage(response);
      const requestId = response.headers.get("x-request-id") ?? undefined;
      const retryable = isRetryableStatus(status);
      const error = new OpenRouterChatError(
        `OpenRouter HTTP ${status}: ${message}`,
        status,
        retryable,
        requestId
      );
      const delayMs = retryAfterMs(response, attempt);
      logAgentLaunch({
        requestId: observability?.requestId ?? "uncorrelated",
        userId: observability?.userId,
        projectId: observability?.projectId,
        conversationId: observability?.conversationId,
        event: "openrouter_attempt_failed",
        model,
        attempt: attempt + 1,
        maxAttempts: CHAT_MAX_ATTEMPTS,
        httpStatus: status,
        retryable,
        upstreamRequestId: requestId,
        durationMs: Date.now() - attemptStartedAt,
        errorName: error.name,
        errorMessage: error.message,
      });
      if (!retryable || attempt === CHAT_MAX_ATTEMPTS - 1) throw error;
      logAgentLaunch({
        requestId: observability?.requestId ?? "uncorrelated",
        userId: observability?.userId,
        projectId: observability?.projectId,
        conversationId: observability?.conversationId,
        event: "openrouter_retry_scheduled",
        model,
        attempt: attempt + 1,
        maxAttempts: CHAT_MAX_ATTEMPTS,
        httpStatus: status,
        retryable: true,
        upstreamRequestId: requestId,
        durationMs: delayMs,
      });
      await wait(delayMs, signal);
    } catch (e) {
      const err = e as Error;
      if (err.name === "AbortError") {
        throw Object.assign(new Error("OpenRouter chat aborted."), { name: "AbortError" });
      }
      const retryableNetworkError = err instanceof TypeError;
      const retryable = err instanceof OpenRouterChatError ? err.retryable : retryableNetworkError;
      const structuredError = err instanceof OpenRouterChatError ? err : undefined;
      logAgentLaunch({
        requestId: observability?.requestId ?? "uncorrelated",
        userId: observability?.userId,
        projectId: observability?.projectId,
        conversationId: observability?.conversationId,
        event: "openrouter_attempt_failed",
        model,
        attempt: attempt + 1,
        maxAttempts: CHAT_MAX_ATTEMPTS,
        httpStatus: structuredError?.status,
        retryable,
        upstreamRequestId: structuredError?.requestId,
        durationMs: Date.now() - attemptStartedAt,
        errorName: err.name,
        errorMessage: err.message,
      });
      if (!retryable || attempt === CHAT_MAX_ATTEMPTS - 1) {
        if (err instanceof OpenRouterChatError) throw err;
        throw new OpenRouterChatError(`OpenRouter unreachable: ${err.message}`, undefined, retryable);
      }
      const delayMs = Math.min(CHAT_RETRY_BASE_MS * 2 ** attempt, CHAT_RETRY_MAX_MS);
      logAgentLaunch({
        requestId: observability?.requestId ?? "uncorrelated",
        userId: observability?.userId,
        projectId: observability?.projectId,
        conversationId: observability?.conversationId,
        event: "openrouter_retry_scheduled",
        model,
        attempt: attempt + 1,
        maxAttempts: CHAT_MAX_ATTEMPTS,
        retryable: true,
        durationMs: delayMs,
      });
      await wait(delayMs, signal);
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
    }
  }

  throw new OpenRouterChatError("OpenRouter retry loop ended unexpectedly.");
}

/**
 * Compute the USD cost of a chat call from its usage + the model's per-token
 * pricing, accounting for cached prompt tokens. Mirrors the v12 addCost().
 * Pricing fields are per-token strings (OpenRouter convention).
 */
export function computeCost(
  usage: ChatUsage | undefined,
  model: OrModel | undefined
): number {
  if (!usage || !model) return 0;
  const pr = model.pricing || {};
  const pTok = parseFloat(pr.prompt || "0");
  const cTok = parseFloat(pr.completion || "0");
  const cacheRead = parseFloat(pr.input_cache_read || "0");
  const promptTokens = usage.prompt_tokens || 0;
  const completionTokens = usage.completion_tokens || 0;
  const cached =
    (usage.prompt_tokens_details && usage.prompt_tokens_details.cached_tokens) || 0;
  const callCost =
    promptTokens * pTok + completionTokens * cTok - cached * (pTok - cacheRead);
  return Math.max(0, callCost);
}

/**
 * Validate an OpenRouter key by fetching /models with it. Used by the profile
 * route before storing the key, mirroring v1's "validate before saving".
 * Throws on 401/network failure.
 */
export async function validateOpenRouterKey(apiKey: string): Promise<void> {
  await fetchModels(apiKey);
}
