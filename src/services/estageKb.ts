/**
 * eStage Knowledge Base client (server-side, V2).
 *
 * Ports the v12 browser KB client to TypeScript. The agent loop calls this
 * (via the estage_kb_query tool) to ground itself in the official eStage
 * knowledge base before uncertain Genesis writes.
 *
 * Uses the SHARED server-side KB key (ESTAGE_KB_API_KEY) — one key for all
 * tenants, never sent to the browser. This is the user's chosen KB model
 * (shared server-side, not per-tenant).
 *
 * Endpoint contract (from docs/v12-reference.html + estage-kb-chat skill):
 *  - URL: POST https://kb.ramihost.cloud/api/v1/chat
 *  - Auth header: X-API-Key: <pk_live_...>
 *  - Body: { question, top_k, context? }  ← field is `question` (NOT
 *    message/query/prompt/input — wrong field returns 422)
 *  - Response: { answer, sources:[{title,url}], model, tokens, cost_usd,
 *    response_time_ms, fallback }
 */

const KB_CHAT_URL = "https://kb.ramihost.cloud/api/v1/chat";
const KB_HEALTH_URL = "https://kb.ramihost.cloud/api/v1/health";
const HEALTH_TIMEOUT_MS = 10_000;
const ASK_TIMEOUT_MS = 60_000;

/** A KB source citation. */
export interface KbSource {
  title?: string;
  url?: string;
}

/** Shape returned by ask(). */
export interface KbAnswer {
  answer?: string;
  sources?: KbSource[];
  model?: string;
  tokens?: { prompt?: number; completion?: number; total?: number };
  cost_usd?: number;
  response_time_ms?: number;
  fallback?: boolean;
}

function kbKey(): string {
  const key = process.env.ESTAGE_KB_API_KEY;
  if (!key) {
    throw new Error(
      "ESTAGE_KB_API_KEY is not set. The shared eStage KB key must be configured server-side."
    );
  }
  return key;
}

/** Public health check (no auth) — used by a lightweight status endpoint. */
export async function kbHealth(): Promise<{ status?: string; version?: string }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), HEALTH_TIMEOUT_MS);
  try {
    const r = await fetch(KB_HEALTH_URL, { signal: ctrl.signal });
    if (!r.ok) throw new Error(`KB health HTTP ${r.status}`);
    return (await r.json()) as { status?: string; version?: string };
  } catch (e) {
    const err = e as Error;
    if (err.name === "AbortError") throw new Error("KB health timed out (10s).");
    throw new Error(`KB health unreachable: ${err.message}`);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Ask the eStage knowledge base a natural-language question. Returns a
 * grounded answer + source citations. The AI calls this before uncertain
 * Genesis write/publish/provision operations.
 */
export async function kbAsk(
  question: string,
  opts: { topK?: number; context?: string } = {}
): Promise<KbAnswer> {
  const { topK = 5, context } = opts;
  const body: Record<string, unknown> = { question, top_k: topK };
  if (context) body.context = context;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ASK_TIMEOUT_MS);
  let r: Response;
  try {
    r = await fetch(KB_CHAT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-API-Key": kbKey() },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
  } catch (e) {
    clearTimeout(timer);
    const err = e as Error;
    if (err.name === "AbortError") throw new Error("KB query timed out (60s).");
    throw new Error(`KB unreachable: ${err.message}`);
  }
  clearTimeout(timer);
  if (r.status === 401) {
    throw Object.assign(new Error("KB 401: invalid API key."), { code: 401 });
  }
  if (r.status === 422) {
    const t = await r.text().catch(() => "");
    throw new Error(`KB 422: ${t.slice(0, 200)}`);
  }
  if (!r.ok) {
    const t = await r.text().catch(() => "");
    throw new Error(`KB HTTP ${r.status}: ${t.slice(0, 300)}`);
  }
  return (await r.json()) as KbAnswer;
}
