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

/**
 * Run a (non-streaming) OpenRouter chat completion with native function-calling.
 * The agent loop calls this repeatedly: it returns either a final text answer
 * or tool_calls to execute. parallel_tool_calls is disabled — sequential
 * Genesis ops are safer for an agent editing a live project.
 *
 * `signal` (optional) lets the caller abort a long call (e.g. user Stop).
 */
export async function chat(opts: {
  apiKey: string;
  model: string;
  messages: ChatMessage[];
  tools?: OrTool[];
  signal?: AbortSignal;
}): Promise<ChatResult> {
  const { apiKey, model, messages, tools, signal } = opts;
  const body: Record<string, unknown> = { model, messages, temperature: 0.3 };
  if (tools && tools.length) {
    body.tools = tools;
    body.tool_choice = "auto";
    body.parallel_tool_calls = false;
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), CHAT_TIMEOUT_MS);
  if (signal) {
    try {
      signal.addEventListener("abort", () => ctrl.abort());
    } catch {
      /* no-op */
    }
  }

  let r: Response;
  try {
    r = await fetch(OR_CHAT_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        "X-Title": "GenWhisperer V2",
      },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
  } catch (e) {
    clearTimeout(timer);
    const err = e as Error;
    if (err.name === "AbortError") {
      throw Object.assign(new Error("OpenRouter chat aborted."), { name: "AbortError" });
    }
    throw new Error(`OpenRouter unreachable: ${err.message}`);
  }
  clearTimeout(timer);
  if (r.status === 401) {
    throw Object.assign(new Error("OpenRouter 401: invalid API key."), { code: 401 });
  }
  if (!r.ok) {
    const t = await r.text().catch(() => "");
    throw new Error(`OpenRouter HTTP ${r.status}: ${t.slice(0, 400)}`);
  }
  return (await r.json()) as ChatResult;
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
