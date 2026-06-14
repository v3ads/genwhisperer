// ---------------------------------------------------------------------------
// GenWhisperer API client
// Wraps every endpoint from API_CONTRACT.md / CLAUDE_HANDOFF.md.
// Same-origin: all paths are relative "/api/...". credentials:"include" on every
// call so the httpOnly gw_session cookie is always sent.
// ---------------------------------------------------------------------------

export type Role = "user" | "admin";

export interface User {
  id: number;
  email: string;
  name?: string | null;
  role: Role;
  suspended: boolean;
}

export interface ChatStatus {
  trialMessagesUsed: number;
  trialMessageCap: number;
  trialExhausted: boolean;
  hasOwnKey: boolean;
  maskedKey: string | null;
  preferredModel: string;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface AdminUser {
  id: number;
  email: string;
  name?: string | null;
  role: Role;
  suspended: boolean;
  createdAt: string;
  lastSignedIn: string | null;
  trialMessagesUsed: number;
  hasOwnKey: boolean;
  preferredModel: string | null;
}

export interface AdminStats {
  totalUsers: number;
  totalMessages: number;
  totalTokens: number;
  trialUsers: number;
  ownKeyUsers: number;
  dailyVolume: { date: string; count: number }[];
  modelUsage?: { model: string; count: number }[];
}

export type SettingsMap = Record<string, string>;

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
  /** Request a magic-link email. */
  requestLink: (email: string) =>
    request<{ success: true }>("/auth/request", {
      method: "POST",
      body: JSON.stringify({ email }),
    }),

  /** Current session, or 401 if signed out. */
  me: () => request<{ user: User }>("/auth/me"),

  logout: () => request<void>("/auth/logout", { method: "POST" }),
};

// --- chat ------------------------------------------------------------------

export const chat = {
  status: () => request<ChatStatus>("/chat/status"),
};

/**
 * Stream a chat completion. Handles the 402 trial wall and the SSE stream.
 * onDelta is called with each incremental token; resolves when [DONE].
 * Throws { trialExhausted: true, ... } on 402 so the caller shows the upgrade UI.
 */
export interface TrialExhausted {
  trialExhausted: true;
  message: string;
  trialMessagesUsed: number;
  trialMessageCap: number;
}

export async function streamChat(
  messages: ChatMessage[],
  onDelta: (full: string, delta: string) => void,
  signal?: AbortSignal
): Promise<string> {
  const res = await fetch(`${BASE}/chat/message`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages }),
    signal,
  });

  if (res.status === 402) {
    const data = (await res.json()) as Omit<TrialExhausted, "trialExhausted">;
    throw { trialExhausted: true, ...data } as TrialExhausted;
  }
  if (!res.ok || !res.body) {
    throw new ApiError(res.status, "Chat request failed");
  }

  const reader = res.body.getReader();
  try {
    const decoder = new TextDecoder();
    let full = "";
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // SSE frames are separated by newlines; keep the last partial line buffered
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const payload = line.slice(6).trim();
        if (payload === "[DONE]") return full;
        try {
          const json = JSON.parse(payload);
          const delta = json.choices?.[0]?.delta?.content;
          if (delta) {
            full += delta;
            onDelta(full, delta);
          }
        } catch {
          /* malformed chunk — skip */
        }
      }
    }
    return full;
  } finally {
    reader.releaseLock();
  }
}

// --- account ---------------------------------------------------------------

export const account = {
  saveKey: (apiKey: string, preferredModel?: string) =>
    request<{ success: true; maskedKey: string; preferredModel: string }>(
      "/account/api-key",
      { method: "POST", body: JSON.stringify({ apiKey, preferredModel }) }
    ),

  removeKey: () => request<void>("/account/api-key", { method: "DELETE" }),

  setModel: (preferredModel: string) =>
    request<{ success: true; preferredModel: string }>("/account/model", {
      method: "PATCH",
      body: JSON.stringify({ preferredModel }),
    }),
};

// --- admin -----------------------------------------------------------------

export const admin = {
  users: () => request<{ users: AdminUser[] }>("/admin/users"),
  stats: () => request<AdminStats>("/admin/stats"),
  settings: () => request<{ settings: SettingsMap }>("/admin/settings"),
  updateSetting: (key: string, value: string) =>
    request<{ success: true }>("/admin/settings", {
      method: "PATCH",
      body: JSON.stringify({ key, value }),
    }),
  suspendUser: (id: number, suspended: boolean) =>
    request<{ success: true }>(`/admin/users/${id}/suspend`, {
      method: "PATCH",
      body: JSON.stringify({ suspended }),
    }),
  deleteUser: (id: number) =>
    request<void>(`/admin/users/${id}`, { method: "DELETE" }),
  userUsage: (id: number) =>
    request<{ usage: unknown[] }>(`/admin/users/${id}/usage`),
};
