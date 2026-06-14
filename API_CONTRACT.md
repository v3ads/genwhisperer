# GenWhisperer — API Contract

**For the frontend architect.** This document describes every endpoint the backend exposes, the exact shape of every request and response, authentication mechanics, error conventions, and the streaming protocol for the chat endpoint.

---

## Base URL

| Environment | Base URL |
|---|---|
| Production | `https://api.genwhisperer.com` (or same origin if co-hosted) |
| Development | `http://localhost:3001` |

All endpoints are prefixed with `/api`.

---

## Authentication

The backend uses **`httpOnly` session cookies**. There is no `Authorization` header scheme.

### Cookie details

| Property | Value |
|---|---|
| Name | `gw_session` |
| Type | JWT (signed with `JWT_SECRET`) |
| `httpOnly` | `true` |
| `secure` | `true` in production |
| `sameSite` | `lax` |
| `domain` | `.genwhisperer.com` in production |
| `maxAge` | 1 year |

The cookie is set automatically by `GET /api/auth/verify` after a successful magic-link click. The frontend never needs to read or write it — the browser handles it transparently on every request.

### Making authenticated requests

Every fetch/axios call must include `credentials: "include"` (or `withCredentials: true` in axios). Without this, the browser will not send the cookie.

```ts
// Fetch example
const res = await fetch("https://api.genwhisperer.com/api/chat/status", {
  credentials: "include",
});

// Axios example
const res = await axios.get("/api/chat/status", { withCredentials: true });
```

### 401 Unauthenticated

Any protected endpoint returns `401` when the session is missing or expired:

```json
{ "error": "Unauthorized" }
```

### 403 Suspended

If the user's account has been suspended by an admin:

```json
{ "error": "Account suspended" }
```

---

## Error conventions

All errors follow this shape:

```json
{ "error": "Human-readable error message" }
```

Standard HTTP status codes are used throughout:

| Code | Meaning |
|---|---|
| `400` | Bad request / validation failure |
| `401` | Not authenticated |
| `402` | Payment required (trial exhausted, no own key) |
| `403` | Forbidden (suspended, wrong role) |
| `404` | Not found |
| `429` | Rate limited |
| `500` | Internal server error |

---

## Rate limits

| Endpoint group | Limit |
|---|---|
| `/api/auth/*` | 10 requests per 15 minutes per IP |
| `/api/chat/*` | 30 requests per minute per IP |

When rate-limited, the response is `429` with:

```json
{ "error": "Too many requests. Please wait before trying again." }
```

---

## Auth endpoints

### `POST /api/auth/request`

Request a magic-link sign-in email. **Public.**

**Request body:**

```json
{ "email": "user@example.com" }
```

**Success `200`:**

```json
{ "success": true, "message": "Check your email for a sign-in link." }
```

**Errors:**

| Status | Condition |
|---|---|
| `400` | Invalid or missing email |
| `500` | Brevo email send failed |

---

### `GET /api/auth/verify?token=<token>`

Verify the magic-link token. **Public.** Called by the browser when the user clicks the email link.

On success, the server:
1. Sets the `gw_session` cookie.
2. **Redirects** (`302`) to `https://genwhisperer.com/chat`.

On failure, returns `400`:

```json
{ "error": "Invalid or expired sign-in link." }
```

> **Frontend note:** The frontend does not need to call this endpoint directly. The magic-link URL in the email points to `https://genwhisperer.com/auth/verify?token=<token>`. The frontend's `/auth/verify` page should immediately forward the browser to `/api/auth/verify?token=<token>` (a full page navigation, not a fetch), so the server can set the cookie and redirect.

---

### `POST /api/auth/logout`

Clear the session cookie. **Public** (safe to call even when unauthenticated).

**No request body required.**

**Success `200`:**

```json
{ "success": true }
```

---

### `GET /api/auth/me`

Get the currently authenticated user. **Requires auth.**

**Success `200`:**

```json
{
  "user": {
    "id": 1,
    "email": "user@example.com",
    "role": "user",
    "suspended": false
  }
}
```

`role` is either `"user"` or `"admin"`.

---

## Chat endpoints

### `GET /api/chat/status`

Get the current user's trial and key status. **Requires auth.**

**Success `200`:**

```json
{
  "trialMessagesUsed": 3,
  "trialMessageCap": 5,
  "trialExhausted": false,
  "hasOwnKey": false,
  "maskedKey": null,
  "preferredModel": "deepseek/deepseek-v4-pro"
}
```

| Field | Type | Description |
|---|---|---|
| `trialMessagesUsed` | `number` | Messages sent using the platform key |
| `trialMessageCap` | `number` | Admin-configured cap (default: 5) |
| `trialExhausted` | `boolean` | `true` when `used >= cap` and no own key |
| `hasOwnKey` | `boolean` | Whether the user has stored their own key |
| `maskedKey` | `string \| null` | Masked display of stored key (e.g. `sk-or-v1****abcd`) |
| `preferredModel` | `string` | OpenRouter model ID the user prefers |

---

### `POST /api/chat/message`

Send a message and receive a **streaming SSE response**. **Requires auth.**

**Request body:**

```json
{
  "messages": [
    { "role": "user", "content": "Build me a landing page for a SaaS product" }
  ]
}
```

The `messages` array follows the OpenAI chat format. Include the full conversation history on each request (the backend is stateless — it does not persist conversation history).

| Field | Type | Required | Notes |
|---|---|---|---|
| `messages` | `Message[]` | Yes | Array of `{ role, content }` objects |
| `model` | `string` | No | Override model for this request (defaults to user's `preferredModel`) |

**Response: `text/event-stream` (SSE)**

The response streams OpenAI-compatible SSE chunks:

```
data: {"id":"chatcmpl-xxx","choices":[{"delta":{"content":"Here"},"index":0}]}

data: {"id":"chatcmpl-xxx","choices":[{"delta":{"content":" is"},"index":0}]}

data: [DONE]
```

Parse each `data:` line as JSON and extract `choices[0].delta.content` to build the streamed text.

**Errors (non-streaming, JSON):**

| Status | Body | Condition |
|---|---|---|
| `402` | `{ "error": "Trial limit reached. Add your own OpenRouter API key to continue.", "trialExhausted": true }` | Trial exhausted, no own key |
| `403` | `{ "error": "Account suspended" }` | User suspended |
| `400` | `{ "error": "messages array is required" }` | Missing body |
| `500` | `{ "error": "AI request failed" }` | OpenRouter error |

> **Detecting the 402 before streaming starts:** Check `response.status` before reading the body. If `402`, parse the JSON body and show the upgrade prompt. If `200`, begin reading the SSE stream.

**Example (fetch + ReadableStream):**

```ts
const response = await fetch("/api/chat/message", {
  method: "POST",
  credentials: "include",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ messages }),
});

if (response.status === 402) {
  const data = await response.json();
  // show upgrade UI
  return;
}

const reader = response.body!.getReader();
const decoder = new TextDecoder();

while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  const chunk = decoder.decode(value, { stream: true });
  for (const line of chunk.split("\n")) {
    if (!line.startsWith("data: ")) continue;
    const payload = line.slice(6).trim();
    if (payload === "[DONE]") break;
    const json = JSON.parse(payload);
    const delta = json.choices?.[0]?.delta?.content;
    if (delta) appendToMessage(delta);
  }
}
```

---

### `GET /api/chat/models`

List available OpenRouter models. **Requires auth.**

**Success `200`:**

```json
{
  "models": [
    { "id": "deepseek/deepseek-v4-pro", "name": "DeepSeek V4 Pro" },
    { "id": "openai/gpt-4o", "name": "GPT-4o" },
    { "id": "anthropic/claude-3.5-sonnet", "name": "Claude 3.5 Sonnet" }
  ]
}
```

---

## Account endpoints

### `POST /api/account/api-key`

Save or update the user's own OpenRouter API key. **Requires auth.**

The backend validates the key against OpenRouter before storing it. The key is encrypted with AES-256-GCM before being written to the database.

**Request body:**

```json
{ "apiKey": "sk-or-v1-..." }
```

**Success `200`:**

```json
{ "success": true, "maskedKey": "sk-or-v1****abcd" }
```

**Errors:**

| Status | Body | Condition |
|---|---|---|
| `400` | `{ "error": "apiKey is required" }` | Missing key |
| `400` | `{ "error": "Invalid OpenRouter API key" }` | Key failed validation |

---

### `PATCH /api/account/model`

Update the user's preferred model. **Requires auth.**

**Request body:**

```json
{ "model": "openai/gpt-4o" }
```

**Success `200`:**

```json
{ "success": true }
```

---

### `DELETE /api/account/api-key`

Remove the user's stored API key. **Requires auth.** The user reverts to trial mode.

**No request body.**

**Success `200`:**

```json
{ "success": true }
```

---

## Admin endpoints

All admin endpoints require `role === "admin"`. Non-admins receive `403`.

---

### `GET /api/admin/users`

Full user list with usage data. **Admin only.**

**Success `200`:**

```json
{
  "users": [
    {
      "id": 1,
      "email": "user@example.com",
      "name": null,
      "role": "user",
      "suspended": false,
      "createdAt": "2025-01-01T00:00:00.000Z",
      "lastSignedIn": "2025-06-14T10:00:00.000Z",
      "hasOwnKey": true,
      "maskedKey": "sk-or-v1****abcd",
      "trialMessagesUsed": 5
    }
  ]
}
```

---

### `GET /api/admin/stats`

Aggregate platform statistics. **Admin only.**

**Success `200`:**

```json
{
  "totalUsers": 142,
  "totalMessages": 1840,
  "trialMessages": 710,
  "ownKeyMessages": 1130,
  "totalTokens": 4200000,
  "usersWithOwnKey": 38,
  "dailyVolume": [
    { "date": "2025-06-13", "count": 84 },
    { "date": "2025-06-14", "count": 61 }
  ]
}
```

`dailyVolume` contains the last 30 days, ordered oldest to newest.

---

### `GET /api/admin/settings`

All system settings. **Admin only.**

**Success `200`:**

```json
{
  "settings": [
    { "key": "trial_message_cap", "value": "5" },
    { "key": "default_model", "value": "deepseek/deepseek-v4-pro" }
  ]
}
```

All values are stored and returned as strings.

---

### `PATCH /api/admin/settings`

Update a single system setting. **Admin only.**

**Request body:**

```json
{ "key": "trial_message_cap", "value": "10" }
```

**Success `200`:**

```json
{ "success": true }
```

---

### `PATCH /api/admin/users/:id/suspend`

Suspend or unsuspend a user. **Admin only.**

**Request body:**

```json
{ "suspended": true }
```

**Success `200`:**

```json
{ "success": true }
```

---

### `DELETE /api/admin/users/:id`

Permanently delete a user and all their data. **Admin only.**

**Success `200`:**

```json
{ "success": true }
```

---

### `GET /api/admin/users/:id/usage`

Per-user message usage log. **Admin only.**

**Success `200`:**

```json
{
  "usage": [
    {
      "id": 1,
      "model": "deepseek/deepseek-v4-pro",
      "promptTokens": 120,
      "completionTokens": 340,
      "totalTokens": 460,
      "keyType": "platform",
      "createdAt": "2025-06-14T10:30:00.000Z"
    }
  ]
}
```

`keyType` is either `"platform"` (trial) or `"own"` (user's own key).

---

## Health check

### `GET /api/health`

**Public.** Returns `200` when the server is running.

```json
{
  "status": "ok",
  "timestamp": "2025-06-14T10:00:00.000Z",
  "env": "production"
}
```

---

## CORS configuration

The backend allows the following origins with `credentials: true`:

- `https://genwhisperer.com`
- `https://www.genwhisperer.com`
- `http://localhost:3000` (dev only)
- `http://localhost:5173` (dev only)
- `http://localhost:4321` (dev only — Astro default)

Additional origins can be added via the `ALLOWED_ORIGINS` environment variable (comma-separated).

---

## Deployment topology options

The backend is a pure API server. Two deployment topologies are supported:

**Option A — Same origin (recommended for simplicity)**

The frontend is served from `genwhisperer.com` and the API runs at `genwhisperer.com/api`. A reverse proxy (nginx, Caddy, Cloudflare) routes `/api/*` to the Node.js process. Cookies work with `sameSite: lax` and no `domain` attribute needed.

**Option B — Subdomain split**

Frontend at `genwhisperer.com`, API at `api.genwhisperer.com`. In this case, set `sameSite: "none"` and `domain: ".genwhisperer.com"` in the cookie config (already commented in `src/routes/auth.ts`). Both origins must be HTTPS.

---

## Data types reference

```ts
interface User {
  id: number;
  email: string;
  role: "user" | "admin";
  suspended: boolean;
}

interface ChatStatus {
  trialMessagesUsed: number;
  trialMessageCap: number;
  trialExhausted: boolean;
  hasOwnKey: boolean;
  maskedKey: string | null;
  preferredModel: string;
}

interface Message {
  role: "user" | "assistant" | "system";
  content: string;
}

interface Setting {
  key: string;
  value: string;
}

interface UsageRecord {
  id: number;
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  keyType: "platform" | "own";
  createdAt: string; // ISO 8601
}
```
