// ---------------------------------------------------------------------------
// GenWhisperer V2 API client
// Wraps every V2 endpoint. Same-origin: all paths are relative "/api/...".
// credentials:"include" on every call so the httpOnly gw_session cookie is
// always sent. SSE streaming for the agent loop is in lib/agentStream.ts.
// ---------------------------------------------------------------------------

export type Role = "user" | "admin";

export interface User {
  id: number;
  email: string;
  name?: string | null;
  role: Role;
  suspended: boolean;
}

// --- Profile ---------------------------------------------------------------

export interface OrModel {
  id: string;
  name?: string;
  context_length?: number;
  supported_parameters?: string[];
  pricing?: { prompt?: string; completion?: string; input_cache_read?: string };
  _group?: string;
}

export interface Profile {
  hasOpenRouterKey: boolean;
  maskedKey: string | null;
  preferredModel: string;
  models: OrModel[];
}

// --- Projects --------------------------------------------------------------

export interface Project {
  id: number;
  name: string;
  genesisProjectId: string | null;
  mcpUrl: string;
  tokenMasked: string;
  lastUsedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

// --- Conversations ---------------------------------------------------------

export type MessageRole = "system" | "user" | "assistant" | "tool";

export interface ConversationSummary {
  id: number;
  genesisProjectId: number;
  title: string;
  model: string;
  createdAt: string;
  updatedAt: string;
}

export interface HistoryMessage {
  id: number;
  role: MessageRole;
  content: string;
  toolCalls: unknown | null;
  costUsd: string;
  createdAt: string;
}

export interface ConversationDetail {
  conversation: {
    id: number;
    genesisProjectId: number;
    title: string;
    model: string;
  };
  messages: HistoryMessage[];
}

// --- KB --------------------------------------------------------------------

export interface KbSource {
  title?: string;
  url?: string;
}
export interface KbQueryResult {
  answer: string;
  sources: KbSource[];
  responseTimeMs?: number;
}

// --- core fetch helper -----------------------------------------------------

const BASE = "/api";

class ApiError extends Error {
  status: number;
  payload: unknown;
  constructor(status: number, message: string, payload?: unknown) {
    super(message);
    this.status = status;
    this.payload = payload;
  }
}
export { ApiError };

async function request<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(opts.headers || {}) },
    ...opts,
  });

  // 304 Not Modified: Express auto-generates ETags for JSON responses, so a
  // browser that cached a prior response re-sends If-None-Match and gets a 304
  // with no body. For endpoints whose data changes (e.g. conversation history
  // after a new turn), this serves a stale view and — because 304 is not
  // res.ok — would throw below, silently breaking resume. Re-fetch once
  // unconditionally (cache-busting) to force a fresh 200 with the full body.
  if (res.status === 304) {
    const fresh = await fetch(`${BASE}${path}`, {
      credentials: "include",
      headers: { "Content-Type": "application/json", "Cache-Control": "no-cache" },
      ...opts,
      cache: "no-store",
    });
    if (fresh.ok) {
      if (fresh.status === 204) return undefined as T;
      return (await fresh.json()) as T;
    }
    // fall through to error handling with the original response
  }

  if (!res.ok) {
    let payload: unknown = null;
    let message = `Request failed (${res.status})`;
    try {
      payload = await res.json();
      const p = payload as { error?: string; message?: string };
      message = p.message || p.error || message;
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(res.status, message, payload);
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

// --- auth ------------------------------------------------------------------

export const auth = {
  requestLink: (email: string) =>
    request<{ success: true }>("/auth/request", {
      method: "POST",
      body: JSON.stringify({ email }),
    }),
  me: () => request<{ user: User }>("/auth/me"),
  logout: () => request<void>("/auth/logout", { method: "POST" }),
};

// --- profile (V2) ----------------------------------------------------------

export const profile = {
  get: () => request<Profile>("/profile"),
  saveKey: (apiKey: string, model?: string) =>
    request<{ success: true; maskedKey: string; preferredModel: string }>(
      "/profile/api-key",
      { method: "POST", body: JSON.stringify({ apiKey, model }) }
    ),
  removeKey: () => request<void>("/profile/api-key", { method: "DELETE" }),
  setModel: (model: string) =>
    request<{ success: true; preferredModel: string }>("/profile/model", {
      method: "PATCH",
      body: JSON.stringify({ model }),
    }),
};

// --- projects (V2) ---------------------------------------------------------

// Result of the pages-count guard. ok:false (transient API failure or
// indeterminate response) means the frontend must NOT block the builder.
// hasPages is null when the count is unknown, true when >0, false when 0.
export interface PagesCountResult {
  ok: boolean;
  pageCount: number | null;
  hasPages: boolean | null;
}

export const projects = {
  list: () => request<{ projects: Project[] }>("/projects"),
  create: (name: string, mcpUrl: string, token: string) =>
    request<{ success: true; id: number; toolCount: number } & Partial<Project>>(
      "/projects",
      { method: "POST", body: JSON.stringify({ name, mcpUrl, token }) }
    ),
  update: (id: number, patch: { name?: string; token?: string }) =>
    request<{ success: true }>(`/projects/${id}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),
  remove: (id: number) => request<void>(`/projects/${id}`, { method: "DELETE" }),
  // First-load guard: reports whether the linked Genesis project has pages.
  // The route fails open (ok:false, pageCount:null) on any error so a
  // transient API failure never blocks the builder.
  pageCount: (id: number) => request<PagesCountResult>(`/projects/${id}/pages-count`),
};

// --- agent (V2) — conversations + kb (the SSE message stream is in agentStream.ts) ---

export const agent = {
  conversations: () => request<{ conversations: ConversationSummary[] }>("/agent/conversations"),
  getConversation: (id: number) => request<ConversationDetail>(`/agent/conversations/${id}`),
  deleteConversation: (id: number) => request<void>(`/agent/conversations/${id}`, { method: "DELETE" }),
  renameConversation: (id: number, title: string) =>
    request<{ success: true; title: string }>(`/agent/conversations/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ title }),
    }),
  approveGate: (gateId: string, approved: boolean) =>
    request<{ success: true; approved: boolean }>(`/agent/approve/${gateId}`, {
      method: "POST",
      body: JSON.stringify({ approved }),
    }),
  kbQuery: (question: string) =>
    request<KbQueryResult>(`/agent/kb-query?question=${encodeURIComponent(question)}`),
  kbHealth: () => request<{ status?: string; version?: string }>("/agent/kb-health"),
};

// --- admin (V2) — owner dashboard -----------------------------------------

export interface AdminUser {
  id: number;
  email: string;
  role: Role;
  suspended: boolean;
  createdAt: string;
  lastSignedIn: string | null;
  projectCount: number;
  conversationCount: number;
}

export interface AdminProject {
  id: number;
  name: string;
  genesisProjectId: string | null;
  mcpUrl: string;
  tokenMasked: string;
  lastUsedAt: string | null;
  createdAt: string;
}

export interface AdminConversation extends ConversationSummary {}

export interface AdminConversationDetail {
  conversation: {
    id: number;
    userId: number;
    genesisProjectId: number;
    title: string;
    model: string;
  };
  messages: Array<HistoryMessage & { promptTokens: number; completionTokens: number }>;
}

export const admin = {
  users: () => request<{ users: AdminUser[] }>("/admin/users"),
  userProjects: (id: number) => request<{ projects: AdminProject[] }>(`/admin/users/${id}/projects`),
  userConversations: (id: number) =>
    request<{ conversations: AdminConversation[] }>(`/admin/users/${id}/conversations`),
  conversation: (id: number) => request<AdminConversationDetail>(`/admin/conversations/${id}`),
  suspend: (id: number, suspended: boolean) =>
    request<{ success: true; suspended: boolean }>(`/admin/users/${id}/suspend`, {
      method: "PATCH",
      body: JSON.stringify({ suspended }),
    }),
  deleteUser: (id: number) => request<{ success: true }>(`/admin/users/${id}`, { method: "DELETE" }),
  usage: (days = 30) =>
    request<UsageRollup>(`/admin/usage?days=${days}`),
  userUsage: (userId: number, days = 30) =>
    request<UserUsage>(`/admin/usage/${userId}?days=${days}`),
};

// --- admin usage types (V2 — per-tenant cost analytics, #2) --------------------

export interface UsageRow {
  email?: string;
  model?: string;
  turns: number;
  promptTokens: number;
  completionTokens: number;
  costUsd: number;
}
export interface UsageRollup {
  days: number;
  since: string;
  totalTurns: number;
  totalCostUsd: number;
  perUser: Array<Omit<UsageRow, "model"> & { userId: number }>;
  perModel: Array<Omit<UsageRow, "email" | "promptTokens" | "completionTokens">>;
}
export interface UserUsage {
  userId: number;
  days: number;
  since: string;
  totalTurns: number;
  totalCostUsd: number;
  byModel: Array<Omit<UsageRow, "email" | "promptTokens" | "completionTokens">>;
  recent: Array<Omit<UsageRow, "email"> & { id: number; role: string; createdAt: string }>;
}

// --- billing (V2) — Stripe subscriptions -----------------------------------

export type Tier = "trial" | "starter" | "pro" | "lapsed";
export type PlanKey = "starter_monthly" | "starter_annual" | "pro_monthly" | "pro_annual";

export interface SubscriptionState {
  tier: Tier;
  maxProjects: number | null;
  trialTurnsUsed: number;
  trialTurnCap: number;
  canStartTurn: boolean;
  usePlatformKey: boolean;
  statusLabel: string;
  hasStripeCustomer: boolean;
}

export const billing = {
  subscription: () => request<SubscriptionState>("/billing/subscription"),
  checkout: (plan: PlanKey) =>
    request<{ url: string }>("/billing/checkout", {
      method: "POST",
      body: JSON.stringify({ plan }),
    }),
  portal: () => request<{ url: string }>("/billing/portal", { method: "POST" }),
};
