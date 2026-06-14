# GenWhisperer — Frontend Architect Handoff

**Prepared for:** Claude (Frontend Architect)
**Repository:** [https://github.com/v3ads/genwhisperer](https://github.com/v3ads/genwhisperer)
**Production domain:** `genwhisperer.com`
**Date:** June 2025

---

## What this document covers

Everything you need to build the GenWhisperer frontend from scratch. The backend API is fully implemented, live on Neon Postgres, and ready to accept requests. This document covers the product purpose, the complete backend architecture, every API endpoint, the authentication flow, security constraints, and deployment topology.

The full machine-readable API specification (request/response shapes, streaming protocol, TypeScript types) lives in [`API_CONTRACT.md`](./API_CONTRACT.md) in the same repo. Read both documents before writing a line of frontend code.

---

## Product overview

GenWhisperer is an AI prompt assistant SaaS product built for users of the **Genesis AI website-builder** inside the **E-Stage platform**. Its core job is to interview a user about what they want to build, then output a single, perfectly-structured Genesis prompt with the correct bracket tags that route to the right Genesis builder.

### The system prompt (baked into every chat request)

The backend prepends this system prompt to every conversation before forwarding to OpenRouter. The frontend does not need to send it — it is injected server-side and never exposed to the user:

> You are GenWhisperer, an expert AI assistant that helps users of the Genesis AI website-builder (inside the E-Stage platform) craft perfectly structured prompts.
>
> Genesis routes each prompt to a specific builder based on phrasing, verbs, and special bracket tags:
> - `[estage-dedicated:]` — triggers backend/API creation
> - `[product list:]` — triggers product catalog/e-commerce pages
> - `[tracking:]` — triggers pixel/analytics integration
> - `[section:]` — targets a specific page section
> - `[page:]` — targets an entire page
> - `[app:]` — triggers app/tool creation
> - `[blog:]` — triggers blog/content creation
>
> Your job is to interview the user about what they want to build, understand their goal completely, then output a single, copy-ready, correctly-tagged Genesis prompt that will produce exactly what they want.

### User journey

1. User lands on `genwhisperer.com` (landing page — not yet built)
2. User enters their email → receives a magic-link email from `Geny <support@genwhisperer.com>`
3. User clicks the link → browser is redirected to `/chat` with a session cookie set
4. User chats with the AI (5 free messages on the platform key)
5. After 5 messages, user sees an upgrade prompt and enters their own OpenRouter API key
6. With their own key, usage is unlimited

---

## Backend architecture

### Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js 22 · TypeScript (ESM) |
| Framework | Express 4 |
| Database | Neon (serverless Postgres) · Drizzle ORM |
| Auth | Magic-link email · JWT session cookies |
| AI proxy | OpenRouter API (`deepseek/deepseek-v4-pro` default) |
| Encryption | AES-256-GCM (user API keys at rest) |
| Email | Brevo transactional API |
| Marketing | GetResponse subscriber sync |

### Repository structure

```
genwhisperer/
├── src/
│   ├── index.ts                  # Express server entry point
│   ├── db/
│   │   ├── schema.ts             # Drizzle ORM schema (all 5 tables)
│   │   ├── index.ts              # Neon connection + schema re-exports
│   │   ├── migrate.ts            # Migration runner (npm run db:migrate)
│   │   └── seed.ts               # Default settings seed (npm run db:seed)
│   ├── routes/
│   │   ├── auth.ts               # Magic-link request, verify, logout, me
│   │   ├── chat.ts               # OpenRouter proxy, trial cap, streaming
│   │   ├── account.ts            # API key save/remove, model preference
│   │   └── admin.ts              # User list, stats, settings, suspend/delete
│   ├── services/
│   │   ├── brevo.ts              # Transactional email (magic-link + notifications)
│   │   ├── getresponse.ts        # Subscriber sync to "GenWhisperer" list
│   │   └── settings.ts           # DB-backed settings with in-memory cache
│   ├── middleware/
│   │   └── auth.ts               # requireAuth + requireAdmin middleware
│   └── utils/
│       ├── crypto.ts             # AES-256-GCM encrypt/decrypt + key masking
│       ├── crypto.test.ts        # 5 unit tests
│       ├── jwt.ts                # JWT sign/verify (jose, HS256, 365-day)
│       └── jwt.test.ts           # 3 unit tests
├── drizzle/
│   ├── migrations/               # Generated SQL migrations (applied to Neon)
│   └── meta/                     # Drizzle migration metadata
├── .github/
│   └── workflows/
│       └── deploy.yml            # CI: test → build → env-check
├── .env.example                  # Template with all required variables
├── API_CONTRACT.md               # Complete endpoint specification
├── CLAUDE_HANDOFF.md             # This document
├── Dockerfile                    # ⚠ Needs update (see note below)
├── docker-compose.yml
├── package.json
├── tsconfig.json
└── vitest.config.ts
```

> **Note on Dockerfile:** The Dockerfile still contains a `frontend-build` stage from an earlier version. Since the frontend was removed from this repo, that stage will fail. If you plan to containerise the backend, either use the Dockerfile as a reference and strip the frontend stages, or simply run `npm run build && npm start` directly.

---

## Database schema

The database is live on Neon Postgres. All migrations have been applied. The following tables exist:

### `users`

| Column | Type | Notes |
|---|---|---|
| `id` | `serial` PK | Auto-increment |
| `email` | `varchar(320)` UNIQUE | Normalised to lowercase |
| `name` | `varchar(255)` | Optional |
| `role` | `enum('user','admin')` | Default `user`; `ADMIN_EMAIL` is auto-promoted |
| `suspended` | `boolean` | Default `false`; blocks all AI access when `true` |
| `created_at` | `timestamptz` | |
| `updated_at` | `timestamptz` | |
| `last_signed_in` | `timestamptz` | Updated on every verify |

### `magic_links`

| Column | Type | Notes |
|---|---|---|
| `id` | `serial` PK | |
| `email` | `varchar(320)` | |
| `token` | `varchar(128)` UNIQUE | 64-char nanoid |
| `used` | `boolean` | Default `false`; set to `true` on first use |
| `expires_at` | `timestamptz` | 15 minutes from creation |
| `created_at` | `timestamptz` | |

### `user_api_keys`

| Column | Type | Notes |
|---|---|---|
| `id` | `serial` PK | |
| `user_id` | `integer` FK → `users.id` | `ON DELETE CASCADE` |
| `encrypted_key` | `text` | AES-256-GCM: `iv:authTag:ciphertext` (all hex) |
| `masked_key` | `varchar(32)` | e.g. `sk-or-v1-****abcd` — safe to display |
| `preferred_model` | `varchar(128)` | Default `deepseek/deepseek-v4-pro` |
| `created_at` | `timestamptz` | |
| `updated_at` | `timestamptz` | |

### `message_usage`

| Column | Type | Notes |
|---|---|---|
| `id` | `serial` PK | |
| `user_id` | `integer` FK → `users.id` | `ON DELETE CASCADE` |
| `model` | `varchar(128)` | OpenRouter model ID used |
| `key_type` | `enum('trial','own')` | `trial` = platform key; `own` = user's key |
| `prompt_tokens` | `integer` | |
| `completion_tokens` | `integer` | |
| `total_tokens` | `integer` | |
| `created_at` | `timestamptz` | |

### `system_settings`

| Column | Type | Notes |
|---|---|---|
| `id` | `serial` PK | |
| `key` | `varchar(128)` UNIQUE | |
| `value` | `text` | All values stored as strings |
| `updated_at` | `timestamptz` | |

**Seeded default settings:**

| Key | Default value |
|---|---|
| `trial_message_cap` | `"5"` |
| `default_model` | `"deepseek/deepseek-v4-pro"` |
| `brevo_sender_name` | `"Geny"` |
| `brevo_sender_email` | `"support@genwhisperer.com"` |
| `getresponse_list_id` | `""` (auto-resolved on first run) |

---

## Authentication — detailed flow

This is the most important section for the frontend. Read it carefully.

### Overview

Authentication is fully passwordless. There are no passwords, no OAuth providers, no third-party login widgets. The entire flow is:

1. User submits their email → backend sends a magic-link email via Brevo
2. User clicks the link → browser navigates to the backend verify endpoint → backend sets an `httpOnly` cookie and redirects to `/chat`
3. All subsequent API calls include the cookie automatically (with `credentials: "include"`)

### The verify redirect — critical implementation detail

The magic-link email contains a URL pointing to **the frontend**:

```
https://genwhisperer.com/auth/verify?token=<64-char-token>
```

The frontend's `/auth/verify` page **must not** call the API with `fetch`. It must perform a **full browser navigation** to the backend verify endpoint:

```ts
// On the /auth/verify page, on mount:
const token = new URLSearchParams(window.location.search).get("token");
window.location.href = `https://api.genwhisperer.com/api/auth/verify?token=${token}`;
// (or /api/auth/verify if same-origin)
```

This is required because `httpOnly` cookies can only be set by the browser receiving a `Set-Cookie` response header from a full navigation — not from a `fetch` call. After the backend sets the cookie, it issues a `302` redirect to `https://genwhisperer.com/chat`.

### Session cookie properties

| Property | Value |
|---|---|
| Name | `gw_session` |
| Algorithm | HS256 JWT |
| `httpOnly` | `true` — JavaScript cannot read it |
| `secure` | `true` in production |
| `sameSite` | `lax` |
| `domain` | `.genwhisperer.com` in production |
| `maxAge` | 1 year |
| Payload | `{ userId, email, role }` |

### Checking auth state

Call `GET /api/auth/me` on page load. If the user is authenticated, it returns:

```json
{ "user": { "id": 1, "email": "user@example.com", "role": "user", "suspended": false } }
```

If not authenticated, it returns `401`. Use this to gate protected routes.

### Logout

`POST /api/auth/logout` — clears the cookie server-side. No request body needed.

---

## The chat endpoint — streaming

The most complex endpoint. Read this section in full before building the chat UI.

### Request

```
POST /api/chat/message
Content-Type: application/json
credentials: include

{
  "messages": [
    { "role": "user", "content": "I want to build a product page" }
  ]
}
```

The `messages` array is the full conversation history. The backend is **stateless** — it does not persist conversation history. The frontend must maintain the message array in state and send the entire history on every request.

### Response: SSE stream

On success (`200`), the response is `Content-Type: text/event-stream`. Parse each `data:` line:

```
data: {"choices":[{"delta":{"content":"Sure"},"index":0}]}

data: {"choices":[{"delta":{"content":", let me"},"index":0}]}

data: [DONE]
```

Extract `choices[0].delta.content` from each chunk and append it to the message being built.

### Trial exhausted: `402`

When the user has used all their free messages and has no own key, the response is `402` (not a stream — a plain JSON body):

```json
{
  "error": "trial_exhausted",
  "message": "You've used all 5 free messages. Add your own OpenRouter API key to continue.",
  "trialMessagesUsed": 5,
  "trialMessageCap": 5
}
```

**Check `response.status` before reading the body.** If `402`, parse JSON and show the upgrade UI. If `200`, begin reading the SSE stream.

### Complete fetch example

```ts
const response = await fetch("/api/chat/message", {
  method: "POST",
  credentials: "include",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ messages }),
});

if (response.status === 402) {
  const data = await response.json();
  showUpgradePrompt(data.message);
  return;
}

if (!response.ok || !response.body) {
  throw new Error("Chat request failed");
}

const reader = response.body.getReader();
const decoder = new TextDecoder();
let assistantMessage = "";

while (true) {
  const { done, value } = await reader.read();
  if (done) break;

  const chunk = decoder.decode(value, { stream: true });
  for (const line of chunk.split("\n")) {
    if (!line.startsWith("data: ")) continue;
    const payload = line.slice(6).trim();
    if (payload === "[DONE]") break;
    try {
      const json = JSON.parse(payload);
      const delta = json.choices?.[0]?.delta?.content;
      if (delta) {
        assistantMessage += delta;
        setStreamingMessage(assistantMessage); // update UI
      }
    } catch {
      // malformed chunk — skip
    }
  }
}
```

---

## Trial status and upgrade flow

Before rendering the chat UI, call `GET /api/chat/status`:

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

Use this to:
- Show a trial progress indicator (e.g. "3 of 5 free messages used")
- Pre-emptively show the upgrade UI when `trialExhausted: true`
- Show the masked key when `hasOwnKey: true`

### Saving an API key (upgrade flow)

```
POST /api/account/api-key
{ "apiKey": "sk-or-v1-..." }
```

The backend validates the key against OpenRouter before storing it. On success:

```json
{ "success": true, "maskedKey": "sk-or-v1-****abcd", "preferredModel": "deepseek/deepseek-v4-pro" }
```

On invalid key:

```json
{ "error": "Invalid OpenRouter API key — validation failed." }
```

### Removing an API key

```
DELETE /api/account/api-key
```

The user reverts to trial mode. If they have already exhausted their trial, they will immediately hit the `402` wall again.

---

## Admin dashboard

The admin role is assigned automatically to the email address in `ADMIN_EMAIL` (`vipaymanshalaby@gmail.com`) on first sign-in. All `/api/admin/*` endpoints require `role === "admin"` — non-admins receive `403`.

### Available admin endpoints

| Method | Path | Returns |
|---|---|---|
| `GET` | `/api/admin/users` | Full user list with trial counts, key status, suspension state |
| `GET` | `/api/admin/stats` | Aggregate: total users, messages, tokens, daily volume (30 days) |
| `GET` | `/api/admin/settings` | All system settings as key-value pairs |
| `PATCH` | `/api/admin/settings` | Update a single setting (e.g. change trial cap) |
| `PATCH` | `/api/admin/users/:id/suspend` | `{ "suspended": true/false }` |
| `DELETE` | `/api/admin/users/:id` | Permanently delete user + all their data (cascade) |
| `GET` | `/api/admin/users/:id/usage` | Last 100 usage records for a specific user |

### Changing the trial cap

```
PATCH /api/admin/settings
{ "key": "trial_message_cap", "value": "10" }
```

The change takes effect immediately — the settings service invalidates its in-memory cache on every write.

### Changing the default model

```
PATCH /api/admin/settings
{ "key": "default_model", "value": "openai/gpt-4o" }
```

---

## Email flows

All emails are sent via Brevo from `Geny <support@genwhisperer.com>`.

| Trigger | Recipient | Subject |
|---|---|---|
| User requests magic link | The user | "Your GenWhisperer sign-in link" |
| New user signs up | Admin (`vipaymanshalaby@gmail.com`) | "[GenWhisperer] New sign-up" |
| User exhausts trial | Admin | "[GenWhisperer] Trial exhausted" |

The magic-link email is a dark-themed HTML email with a white CTA button. It states the 15-minute expiry and single-use behaviour.

---

## GetResponse integration

On every new sign-up, the backend adds the user to the **"GenWhisperer"** GetResponse list. On first run, if the list does not exist, it is created automatically. The list ID is cached in `system_settings` after the first run.

The frontend does not interact with GetResponse directly.

---

## CORS and cookie configuration

### Allowed origins (production)

- `https://genwhisperer.com`
- `https://www.genwhisperer.com`

Additional origins can be added via the `ALLOWED_ORIGINS` environment variable (comma-separated) without a code change.

### Development origins (automatically added when `NODE_ENV !== "production"`)

- `http://localhost:3000`
- `http://localhost:5173`
- `http://localhost:4321` (Astro default)

### Required on every frontend request

```ts
fetch(url, { credentials: "include" })
// or
axios.create({ withCredentials: true })
```

Without `credentials: "include"`, the browser will not send the session cookie and every protected endpoint will return `401`.

---

## Deployment topology

Two options are supported. Choose before building the frontend so you configure the right base URL.

### Option A — Same origin (recommended)

Frontend and API both served from `genwhisperer.com`. A reverse proxy (nginx, Caddy, Cloudflare Workers) routes `/api/*` to the Node.js process on port 3001. Everything else serves the frontend.

With this setup, `credentials: "include"` works with `sameSite: lax` and no `domain` attribute needed. The `APP_URL` env var should be `https://genwhisperer.com`.

### Option B — Subdomain split

Frontend at `genwhisperer.com`, API at `api.genwhisperer.com`. In this case, update `src/routes/auth.ts` to use `sameSite: "none"` (already commented in the source). Both origins must be HTTPS.

---

## Environment variables (for reference)

The backend reads these from environment. All are set as GitHub Actions secrets and assembled into `.env` at deploy time — they are never committed to the repo.

| Variable | Value |
|---|---|
| `NEON_DATABASE_URL` | Neon Postgres connection string |
| `JWT_SECRET` | 64-char hex — JWT signing |
| `ENCRYPTION_SECRET` | 64-char hex — AES-256-GCM key encryption |
| `OPENROUTER_PLATFORM_KEY` | Platform key for free-trial users |
| `BREVO_API_KEY` | Brevo transactional email |
| `BREVO_SENDER_NAME` | `Geny` |
| `BREVO_SENDER_EMAIL` | `support@genwhisperer.com` |
| `GETRESPONSE_API_KEY` | GetResponse subscriber sync |
| `ADMIN_EMAIL` | `vipaymanshalaby@gmail.com` |
| `APP_URL` | `https://genwhisperer.com` |
| `ALLOWED_ORIGINS` | `https://genwhisperer.com,https://www.genwhisperer.com` |
| `NODE_ENV` | `production` |
| `PORT` | `3001` |

---

## Running the backend locally

```bash
git clone https://github.com/v3ads/genwhisperer.git
cd genwhisperer
npm install
cp .env.example .env
# Fill in .env with your credentials
npm run dev   # starts on http://localhost:3001
```

Health check: `GET http://localhost:3001/api/health` → `{ "status": "ok" }`

---

## Tests

```bash
npm test
```

8 unit tests pass:

| Suite | Tests |
|---|---|
| `crypto.test.ts` | encrypt/decrypt round-trip, wrong key rejection, masked key format, empty string handling, key derivation |
| `jwt.test.ts` | sign/verify round-trip, expired token rejection, tampered token rejection |

---

## Pages the frontend needs to build

Based on the product spec, the frontend requires at minimum:

| Route | Purpose |
|---|---|
| `/` | Landing page — hero, features, CTA to sign in |
| `/sign-in` | Magic-link email form |
| `/auth/verify` | Intercept token from URL, redirect to backend verify endpoint |
| `/chat` | Core AI prompt assistant interface (protected) |
| `/account` | API key management, model preference (protected) |
| `/admin` | Admin dashboard (protected, admin role only) |
| `/404` | Not found |

The backend redirects to `/chat` after successful magic-link verification. If the user is not authenticated and tries to access `/chat`, the frontend should redirect them to `/sign-in`.

---

## What is not yet built

The following items are in `todo.md` as future work:

- Resend magic-link option (currently the user must request a new one)
- Conversation history persistence (currently stateless — history lives only in frontend state)
- Model selector UI in the chat interface
- Stripe payment integration
- Email template customisation via admin dashboard
- GetResponse webhook handling

---

## Key contacts

| Role | Detail |
|---|---|
| Owner / admin | `vipaymanshalaby@gmail.com` |
| Support email | `support@genwhisperer.com` |
| Sender name | Geny |
| GitHub org | `v3ads` |
