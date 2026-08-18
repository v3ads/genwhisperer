# GenWhisperer V2 — API Contract

The V2 backend is a secure server-side agent runtime. All `/api` routes are same-origin (the SPA is served by the same Express server). Every request must include `credentials: "include"` so the `gw_session` httpOnly cookie is sent. CSRF origin guard rejects cross-origin state-changing requests.

---

## Auth

### `POST /api/auth/request`
Request a magic-link sign-in email.

```json
// request
{ "email": "user@example.com" }

// 200
{ "success": true, "message": "Check your email for a sign-in link." }
// 400 invalid email
```

### `GET /api/auth/verify?token=<token>`
Verify the token, upsert the user, set the `gw_session` cookie, 302 redirect to `/builder`. **Must be a full browser navigation** (not `fetch()`) — httpOnly cookies can only be set by a real navigation that receives the `Set-Cookie` header.

On a new user, side effects fire-and-forget: GetResponse `subscribeUser`, Brevo `notifyNewSignup`.

### `POST /api/auth/logout`
Insert the JWT's `jti` into the `revoked_sessions` blocklist, clear the cookie.

### `GET /api/auth/me`  `requireAuth`
```json
{ "user": { "id": 1, "email": "user@example.com", "role": "user", "suspended": false } }
```

---

## Profile (OpenRouter key + model)

### `GET /api/profile`  `requireAuth`
```json
{
  "hasOpenRouterKey": true,
  "maskedKey": "sk-or-v1-****abcd",
  "preferredModel": "z-ai/glm-5.2",
  "models": [ { "id": "...", "name": "...", "context_length": 1000000, "pricing": {...}, "_group": "Recommended" } ]
}
```
`models` is the curated Option A list (function-calling + ≥128k context + no `:free`/`:batch`/`:nitro`), fetched with the tenant's own key. Empty if no key or the key is invalid.

### `POST /api/profile/api-key`  `requireAuth`
Save/update the OpenRouter key. Validated against OpenRouter before storing; encrypted at rest (AES-256-GCM).
```json
// request
{ "apiKey": "sk-or-v1-...", "model": "z-ai/glm-5.2" }
// 200
{ "success": true, "maskedKey": "sk-or-v1-****abcd", "preferredModel": "z-ai/glm-5.2" }
```

### `PATCH /api/profile/model`  `requireAuth`
```json
{ "model": "z-ai/glm-5.2" }
// 200 { "success": true, "preferredModel": "z-ai/glm-5.2" }
```

### `DELETE /api/profile/api-key`  `requireAuth`
Remove the OpenRouter key. → `204`.

---

## Projects (Genesis projects)

### `GET /api/projects`  `requireAuth`
```json
{
  "projects": [
    { "id": 1, "name": "Main marketing site", "genesisProjectId": "75572",
      "mcpUrl": "https://genesis.estage.com/api/agent/75572/mcp",
      "tokenMasked": "tok_****abcd", "lastUsedAt": null,
      "createdAt": "...", "updatedAt": "..." }
  ]
}
```
Tokens are **masked** in list responses — the decrypted token is only ever used server-side by the agent loop.

### `POST /api/projects`  `requireAuth`
Add a project. The MCP URL is shape-checked and the token is validated via the MCP handshake (`initialize` + `tools/list`) **before storing**.
```json
// request
{ "name": "Main marketing site", "mcpUrl": "https://genesis.estage.com/api/agent/75572/mcp", "token": "<one-time-token>" }
// 200
{ "success": true, "id": 1, "toolCount": 62, "genesisProjectId": "75572", "mcpUrl": "...", "tokenMasked": "tok_****abcd" }
// 400 if the URL is malformed or the handshake fails (wrong/consumed token)
```

### `PATCH /api/projects/:id`  `requireAuth`
Update name and/or refresh the token (a new token is re-validated against the existing MCP URL).
```json
{ "name": "Renamed", "token": "<fresh-token>" }
```

### `DELETE /api/projects/:id`  `requireAuth`
Remove a project. Cascades to its conversations. → `204`.

---

## Agent (the loop + history + KB)

### `POST /api/agent/message`  `requireAuth`  · **SSE stream**
Run the agent loop. Returns `text/event-stream`; each line is `data: <json>\n\n` where `<json>` is an `AgentEvent` (see below).

```json
// request
{ "genesisProjectId": 1, "conversationId": 12, "message": "Add a dark hero section", "model": "z-ai/glm-5.2" }
```
`conversationId` is optional — omit it to start a new conversation (the server creates one and emits a `conversation` event with its id). Include it to resume.

**Errors before the stream starts** (plain JSON, not SSE): `400` if no OpenRouter key saved, `404` if the project/conversation isn't found, `400` if the conversation belongs to a different project.

#### SSE event protocol (`AgentEvent`)

| `type` | Payload | Meaning |
|---|---|---|
| `status` | `{ text }` | Live status hint for the composer (e.g. "Thinking…", "Running: genesis_read_files") |
| `narration` | `{ text }` | The assistant's plain-English narration emitted before tool calls (markdown) |
| `tool_approval_request` | `{ gateId, tool, args }` | A high-impact op needs approval — render an Approve/Deny card; POST `/api/agent/approve/:gateId` |
| `tool_approval_resolved` | `{ gateId, approved }` | The gate was resolved (echoed so the UI can mark the card done) |
| `kb_answer` | `{ question, answer, sources }` | A KB lookup result (also surfaced in the side panel) |
| `final_answer` | `{ text }` | The agent's final answer for this turn (markdown) — render then stop |
| `cost` | `{ totalUsd }` | Running OpenRouter cost this session (update the cost badge) |
| `conversation` | `{ id }` | The conversation id (captured on first turn of a new conversation) |
| `error` | `{ message }` | A recoverable error during the loop (render as an error bubble) |
| `done` | — | The stream is ending; close the reader |

Tool execution is **silent** — the chat shows narration + final answer only (no tool-call cards), per the v12 decision.

### `POST /api/agent/approve/:gateId`  `requireAuth`
Resolve a pending write gate.
```json
// request
{ "approved": true }
// 200 { "success": true, "approved": true }
// 404 if the gate expired / doesn't exist
```
The agent loop is paused waiting on this; approving resumes it, denying feeds "User denied this write operation." back to the model.

### `GET /api/agent/conversations`  `requireAuth`
```json
{ "conversations": [ { "id": 12, "genesisProjectId": 1, "title": "Add a dark hero section", "model": "z-ai/glm-5.2", "createdAt": "...", "updatedAt": "..." } ] }
```

### `GET /api/agent/conversations/:id`  `requireAuth`
Load a conversation's message history (for resume). Only `user`/`assistant` rows are rendered client-side; `system`/`tool` rows are present for completeness.
```json
{
  "conversation": { "id": 12, "genesisProjectId": 1, "title": "...", "model": "z-ai/glm-5.2" },
  "messages": [ { "id": 1, "role": "user", "content": "...", "toolCalls": null, "costUsd": "0", "createdAt": "..." } ]
}
```

### `DELETE /api/agent/conversations/:id`  `requireAuth`
Delete a conversation (cascades to its messages). → `204`.

### `GET /api/agent/kb-query?question=<q>`  `requireAuth`
Standalone KB side-panel query (uses the shared server-side `ESTAGE_KB_API_KEY`).
```json
{ "answer": "...", "sources": [ { "title": "...", "url": "..." } ], "responseTimeMs": 420 }
```

### `GET /api/agent/kb-health`  `requireAuth`
```json
{ "status": "ok", "version": "..." }
```

---

## Health

### `GET /api/health`  Public
```json
{ "status": "ok", "timestamp": "2026-08-18T12:00:00.000Z", "env": "production" }
```

---

## CORS / cookies / rate limits

- **Allowed origins:** `APP_URL` + `www.genwhisperer.com` (production); localhost dev origins added when `NODE_ENV !== "production"`.
- **Cookie:** `gw_session` — httpOnly, secure (production), sameSite=lax, domain=.genwhisperer.com, 1-year maxAge. Must be sent with `credentials: "include"`.
- **Rate limits:** auth 10 req/15min; agent 30 req/min.
- **Compression:** disabled on `/api/agent/message` (SSE must not be buffered).
