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
};

// --- agent (V2) — conversations + kb (the SSE message stream is in agentStream.ts) ---

export const agent = {
  conversations: () => request<{ conversations: ConversationSummary[] }>("/agent/conversations"),
  getConversation: (id: number) => request<ConversationDetail>(`/agent/conversations/${id}`),
  deleteConversation: (id: number) => request<void>(`/agent/conversations/${id}`, { method: "DELETE" }),
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
};
