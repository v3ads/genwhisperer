# GenWhisperer — Claude Session Handoff

**Prepared for:** Claude (next session)
**Repository:** [https://github.com/v3ads/genwhisperer](https://github.com/v3ads/genwhisperer)
**Production URL:** `https://www.genwhisperer.com`
**Railway URL:** `https://genwhisperer-web-production.up.railway.app`
**Last updated:** 2026-06-14 — after security bug fixes and full E2E test pass
**Latest commit:** `abaf5f5` on `main`

---

## Current Status — Read This First

The application is **fully deployed and all 16 end-to-end tests pass**. Two security bugs were fixed in this session (see §Security Fixes below). The database is clean with one production user. No outstanding blockers.

| Item | State |
|---|---|
| Production health | `{"status":"ok","env":"production"}` ✅ |
| `www.genwhisperer.com` | Live, TLSv1.3, Let's Encrypt ✅ |
| `genwhisperer.com` | Cloudflare Page Rule → `www.genwhisperer.com` ✅ |
| Railway deployment | `SUCCESS` (commit `31989b5`) ✅ |
| All E2E tests | 16/16 passing ✅ |
| DB users | 1 — `vipaymanshalaby@gmail.com` (admin) |
| GetResponse list | `LJpJ3` "GenWhisperer" — 1 contact (admin) |

---

## What GenWhisperer Is

GenWhisperer is an AI prompt assistant SaaS for users of the **Genesis AI website-builder** inside the **E-Stage platform**. It interviews users about what they want to build, then outputs a single perfectly-structured Genesis prompt with the correct bracket tags.

### Genesis routing tags (baked into server-side system prompt)

| Tag | Routes to |
|---|---|
| `[estage-dedicated:]` | Backend/API creation |
| `[product list:]` | Product catalog / e-commerce |
| `[tracking:]` | Pixel / analytics integration |
| `[section:]` | Specific page section |
| `[page:]` | Entire page |
| `[app:]` | App / tool creation |
| `[blog:]` | Blog / content creation |

The system prompt is injected server-side and never exposed to the frontend or user.

### User journey

1. User lands on `genwhisperer.com` → sees landing page
2. Enters email → receives magic-link from `Geny <support@genwhisperer.com>`
3. Clicks link → browser navigates to `/auth/verify?token=...` → frontend redirects to `/api/auth/verify?token=...` (full navigation, not fetch) → backend sets `httpOnly` cookie → 302 to `/chat`
4. 5 free trial messages on the platform OpenRouter key
5. After 5 messages → 402 response → user enters their own OpenRouter API key
6. With own key: unlimited usage on their preferred model

---

## Repository Structure

```
genwhisperer/
├── src/
│   ├── index.ts                  # Express server entry point + CORS config
│   ├── db/
│   │   ├── schema.ts             # Drizzle ORM schema (6 tables incl. revoked_sessions)
│   │   ├── index.ts              # Neon connection + schema re-exports
│   │   ├── migrate.ts            # Migration runner
│   │   └── seed.ts               # Default settings seed
│   ├── routes/
│   │   ├── auth.ts               # Magic-link request/verify/logout/me + JWT blocklist
│   │   ├── chat.ts               # OpenRouter proxy (SSE), trial cap, key fallback
│   │   ├── account.ts            # API key save/remove, model preference
│   │   └── admin.ts              # User list, stats, settings, suspend/delete
│   ├── services/
│   │   ├── brevo.ts              # Magic-link email + owner notifications
│   │   ├── getresponse.ts        # List creation + subscriber sync
│   │   └── settings.ts           # DB-backed settings with in-memory cache
│   ├── middleware/
│   │   └── auth.ts               # requireAuth (incl. blocklist check) + requireAdmin
│   └── utils/
│       ├── crypto.ts             # AES-256-GCM encrypt/decrypt + maskApiKey
│       ├── jwt.ts                # JWT sign/verify + jti claim + extractJti()
│       ├── crypto.test.ts        # 5 Vitest tests
│       └── jwt.test.ts           # 3 Vitest tests
├── frontend/                     # Vite + React 19 + TypeScript SPA
│   ├── src/
│   │   ├── App.tsx               # Router (BrowserRouter + AuthProvider)
│   │   ├── lib/
│   │   │   ├── api.ts            # Typed API client + streamChat SSE helper
│   │   │   └── auth.tsx          # AuthContext (GET /auth/me, logout)
│   │   ├── components/
│   │   │   ├── Brand.tsx         # Logo mark + wordmark
│   │   │   ├── Guards.tsx        # RequireAuth / RequireAdmin route guards
│   │   │   └── AssistantContent.tsx  # Tag highlighting + copy card
│   │   └── pages/
│   │       ├── Landing.tsx       # Public landing page
│   │       ├── SignIn.tsx        # Magic-link email form
│   │       ├── Verify.tsx        # Token redirect (window.location → /api/auth/verify)
│   │       ├── Chat.tsx          # Core AI chat interface
│   │       ├── Account.tsx       # API key management + model preference
│   │       ├── Admin.tsx         # Admin dashboard
│   │       └── NotFound.tsx      # 404
│   └── vite.config.ts            # Dev: proxies /api → localhost:3001
├── drizzle/
│   └── migrations/
│       ├── 0000_hard_miss_america.sql  # Initial schema (applied)
│       └── 0001_revoked_sessions.sql   # JWT blocklist table (applied 2026-06-14)
├── Dockerfile                    # Multi-stage: frontend → backend → slim prod
├── nixpacks.toml                 # Railway build plan (Node 22)
├── API_CONTRACT.md               # Full REST API contract
├── DEPLOYMENT_REPORT.md          # Full deployment + test results (authoritative)
└── CLAUDE_HANDOFF.md             # This document
```

---

## Database Schema (Neon Postgres — all migrations applied)

### `users`

| Column | Type | Notes |
|---|---|---|
| `id` | `serial` PK | |
| `email` | `varchar(320)` UNIQUE | Normalised to lowercase |
| `name` | `varchar(255)` | Optional |
| `role` | `enum('user','admin')` | `ADMIN_EMAIL` auto-promoted on sign-in |
| `suspended` | `boolean` | Default `false`; blocks all AI access |
| `created_at` | `timestamptz` | |
| `updated_at` | `timestamptz` | |
| `last_signed_in` | `timestamptz` | Updated on every verify |

### `magic_links`

| Column | Type | Notes |
|---|---|---|
| `id` | `serial` PK | |
| `email` | `varchar(320)` | |
| `token` | `varchar(128)` UNIQUE | 64-char nanoid |
| `used` | `boolean` | Set to `true` on first use |
| `expires_at` | `timestamptz` | 15 minutes from creation |
| `created_at` | `timestamptz` | |

### `user_api_keys`

| Column | Type | Notes |
|---|---|---|
| `id` | `serial` PK | |
| `user_id` | `integer` FK → `users.id` | `ON DELETE CASCADE` |
| `encrypted_key` | `text` | AES-256-GCM: `iv:authTag:ciphertext` (hex) |
| `masked_key` | `varchar(32)` | e.g. `sk-or-v1-****abcd` |
| `preferred_model` | `varchar(128)` | Default `deepseek/deepseek-v4-pro` |
| `created_at` | `timestamptz` | |
| `updated_at` | `timestamptz` | |

### `message_usage`

| Column | Type | Notes |
|---|---|---|
| `id` | `serial` PK | |
| `user_id` | `integer` FK → `users.id` | `ON DELETE CASCADE` |
| `model` | `varchar(128)` | OpenRouter model ID |
| `key_type` | `enum('trial','own')` | |
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

**Current seeded values:**

| Key | Value |
|---|---|
| `trial_message_cap` | `5` |
| `default_model` | `deepseek/deepseek-v4-pro` |
| `brevo_sender_name` | `Geny` |
| `brevo_sender_email` | `support@genwhisperer.com` |
| `getresponse_list_id` | `""` (auto-resolved at runtime — resolves to `LJpJ3`) |

### `revoked_sessions` *(added 2026-06-14)*

| Column | Type | Notes |
|---|---|---|
| `jti` | `varchar(128)` PK | JWT ID claim — unique per token |
| `expires_at` | `timestamptz` | Matches JWT expiry (365 days from issue) |
| `revoked_at` | `timestamptz` | Default `NOW()` |

Index: `idx_revoked_sessions_expires_at` on `expires_at` (for cleanup queries).

---

## Authentication Flow

### Magic-link request

```
POST /api/auth/request { "email": "user@example.com" }
→ nanoid(64) token stored in magic_links (15-min TTL)
→ Brevo sends: "Sign in to GenWhisperer" with link:
    https://genwhisperer.com/auth/verify?token=<token>
→ { "success": true }
```

### Magic-link verify — CRITICAL: full browser navigation required

```
User clicks email link → browser navigates to:
  https://genwhisperer.com/auth/verify?token=<token>

Frontend /auth/verify page (Verify.tsx):
  window.location.href = `/api/auth/verify?token=${token}`
  ↑ MUST be window.location.href, NOT fetch().
    httpOnly cookies can only be set by a real browser navigation.

Backend GET /api/auth/verify?token=<token>:
  → Validates token (not used, not expired)
  → Marks token used = true
  → Upserts user (creates if new, updates lastSignedIn)
  → If email === ADMIN_EMAIL → role = 'admin'
  → Signs JWT: { userId, email, role, jti: nanoid(32) } HS256 365d
  → Sets cookie: gw_session=<jwt>
      httpOnly: true, secure: true, sameSite: 'lax'
      domain: '.genwhisperer.com', maxAge: 365 days
  → 302 redirect → /chat
```

### Session validation (every protected request)

```
requireAuth middleware:
  1. Read req.cookies.gw_session
  2. verifySession(token) → { userId, email, role, jti }
  3. Check revoked_sessions WHERE jti = <jti>
     → If found: 401 "Session has been revoked. Please sign in again."
  4. Fresh DB lookup: users WHERE id = userId
  5. Check user.suspended → 403 if true
  6. Set req.user = { id, email, role, suspended }
```

### Logout

```
POST /api/auth/logout
→ Extract jti from cookie JWT
→ INSERT INTO revoked_sessions (jti, expires_at) ON CONFLICT DO NOTHING
→ DELETE FROM revoked_sessions WHERE expires_at < NOW()  (cleanup)
→ Clear gw_session cookie (maxAge: 0)
→ { "success": true }
```

After logout, the old JWT is immediately rejected by `requireAuth` even if the cookie is replayed.

---

## Chat / AI Proxy

### Request

```
POST /api/chat/message
Content-Type: application/json
credentials: include

{ "messages": [{ "role": "user", "content": "..." }] }
```

The `messages` array is the **full conversation history**. The backend is stateless — it does not persist chat history. The frontend must maintain the array in state and send the entire history on every request.

### Response: SSE stream (200)

```
Content-Type: text/event-stream

data: {"choices":[{"delta":{"content":"Sure"},"index":0}]}
data: {"choices":[{"delta":{"content":", let me"},"index":0}]}
data: [DONE]
```

Extract `choices[0].delta.content` from each chunk and append to the building message.

### Trial exhausted: 402 (plain JSON, not SSE)

```json
{
  "error": "trial_exhausted",
  "message": "You've used all 5 free messages. Add your own OpenRouter API key to continue.",
  "trialMessagesUsed": 5,
  "trialMessageCap": 5
}
```

**Always check `response.status` before reading the body.** If `402`, parse JSON and show upgrade UI. If `200`, begin reading the SSE stream.

### Trial status endpoint

```
GET /api/chat/status
→ {
    "trialMessagesUsed": 3,
    "trialMessageCap": 5,
    "trialExhausted": false,
    "hasOwnKey": false,
    "maskedKey": null,
    "preferredModel": "deepseek/deepseek-v4-pro"
  }
```

---

## Security Fixes Applied (2026-06-14)

### Fix 1 — CORS 500 → proper rejection

**File:** `src/index.ts`

**Before:** `callback(new Error('Not allowed by CORS'))` — triggered Express error handler → HTTP 500

**After:** `callback(null, false)` — clean rejection, no `Access-Control-Allow-Origin` header, no error response

### Fix 2 — Logout JWT invalidation

**Problem:** After logout, old JWT tokens were still accepted by the server. An attacker who captured a cookie could continue using it after the user logged out.

**Solution:** `revoked_sessions` blocklist table. On logout, the token's `jti` is inserted. On every authenticated request, `requireAuth` checks the blocklist before proceeding.

**Files changed:**
- `src/db/schema.ts` — `revokedSessions` table
- `src/utils/jwt.ts` — `jti` claim in payload, `extractJti()`, `SESSION_TTL_SECONDS`
- `src/middleware/auth.ts` — blocklist check
- `src/routes/auth.ts` — insert on logout + cleanup
- `drizzle/migrations/0001_revoked_sessions.sql` — applied to Neon

---

## Full E2E Test Results (all passing)

| Section | Test | Result |
|---|---|---|
| A | Health check, SPA fallback, cache headers | ✅ |
| B | Magic-link auth, JWT cookie, single-use enforcement | ✅ |
| C | Admin auto-promotion by ADMIN_EMAIL | ✅ |
| D | SSE streaming, trial cap (5 msg), 402 on exhaustion | ✅ |
| E5 | Model update via PATCH /api/account/model | ✅ |
| F | Multi-tenant isolation | ✅ |
| G1 | GetResponse "GenWhisperer" list exists (id=LJpJ3) | ✅ |
| G2 | Admin user auto-subscribed on first sign-in | ✅ |
| H1 | Logout returns 200, clears cookie | ✅ |
| H2 | Logout invalidates JWT server-side (blocklist) | ✅ fixed |
| I1 | Unauthenticated /api/chat/message → 401 | ✅ |
| I2 | Unauthenticated /api/account/api-key → 401 | ✅ |
| I3 | CORS blocked origin → no ACAO header, not 500 | ✅ fixed |
| I4 | CORS allowed origin → ACAO header present | ✅ |
| I5 | SQL injection in email → 400 Zod validation | ✅ |
| I6 | XSS in email → 400 Zod validation | ✅ |

---

## API Reference (Quick)

| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/api/auth/request` | Public | Request magic-link email |
| `GET` | `/api/auth/verify?token=` | Public | Verify token → set cookie → redirect `/chat` |
| `POST` | `/api/auth/logout` | Public | Revoke JWT + clear cookie |
| `GET` | `/api/auth/me` | `requireAuth` | `{ user: { id, email, role, suspended } }` |
| `GET` | `/api/chat/status` | `requireAuth` | Trial status, key presence, model |
| `POST` | `/api/chat/message` | `requireAuth` | SSE stream to OpenRouter |
| `GET` | `/api/chat/models` | `requireAuth` | List OpenRouter models |
| `POST` | `/api/account/api-key` | `requireAuth` | Save/update encrypted API key |
| `PATCH` | `/api/account/model` | `requireAuth` | Update preferred model |
| `DELETE` | `/api/account/api-key` | `requireAuth` | Remove API key (revert to trial) |
| `GET` | `/api/admin/users` | `requireAdmin` | Full user list with usage |
| `GET` | `/api/admin/stats` | `requireAdmin` | Aggregate stats + 30-day chart |
| `GET` | `/api/admin/settings` | `requireAdmin` | All system settings |
| `PATCH` | `/api/admin/settings` | `requireAdmin` | Update a setting by key |
| `PATCH` | `/api/admin/users/:id/suspend` | `requireAdmin` | Suspend/unsuspend user |
| `DELETE` | `/api/admin/users/:id` | `requireAdmin` | Delete user (cascades) |
| `GET` | `/api/admin/users/:id/usage` | `requireAdmin` | Per-user usage log (last 100) |
| `GET` | `/api/health` | Public | `{"status":"ok","env":"..."}` |

---

## Infrastructure

### Railway

| Item | Value |
|---|---|
| Project ID | `34c538d4-4523-465f-8f5e-0112f9ec6a3f` |
| Service ID | `cf7a9c54-1256-4af1-acca-8a1e214c0140` |
| Environment ID | `cc1d954a-ab52-4ee7-9208-9e9425203f77` |
| Service name | `genwhisperer-web` |
| Auto-deploy | On push to `main` |
| Builder | Nixpacks (Node 22) |

### DNS / TLS

| Domain | Status |
|---|---|
| `www.genwhisperer.com` | CNAME → `nsabtvu1.up.railway.app`, TLS valid ✅ |
| `genwhisperer.com` | Cloudflare Page Rule → `https://www.genwhisperer.com` ✅ |

> **Note:** The root domain `genwhisperer.com` CNAME to Railway (`1iomeb1m.up.railway.app`) is not set in Cloudflare DNS. Instead, a Cloudflare Page Rule redirects `genwhisperer.com/*` to `https://www.genwhisperer.com/$1`. This works but Railway cannot issue a TLS cert for the root domain. If you want Railway to serve the root domain directly, add the CNAME in Cloudflare with **DNS only** (grey cloud, not proxied).

### Neon Postgres

- Region: US East 2 (Ohio)
- Connection var: `NEON_DATABASE_URL`
- ORM: Drizzle ORM (`drizzle-orm/neon-http`)
- Applied migrations: `0000_hard_miss_america.sql`, `0001_revoked_sessions.sql`

---

## Environment Variables

All 13 secrets are stored in Railway's variable store and injected at runtime.

| Variable | Purpose |
|---|---|
| `NEON_DATABASE_URL` | Neon Postgres connection string |
| `JWT_SECRET` | 64-char hex — JWT signing (HS256) |
| `ENCRYPTION_SECRET` | 64-char hex — AES-256-GCM key encryption |
| `OPENROUTER_PLATFORM_KEY` | Platform trial key (`sk-or-v1-272...`) |
| `BREVO_API_KEY` | Transactional email |
| `BREVO_SENDER_NAME` | `Geny` |
| `BREVO_SENDER_EMAIL` | `support@genwhisperer.com` |
| `GETRESPONSE_API_KEY` | Subscriber sync |
| `ADMIN_EMAIL` | `vipaymanshalaby@gmail.com` |
| `APP_URL` | `https://genwhisperer.com` |
| `ALLOWED_ORIGINS` | `https://genwhisperer.com,https://www.genwhisperer.com` |
| `NODE_ENV` | `production` |
| `PORT` | `3001` |

> **Security note:** `JWT_SECRET` and `ENCRYPTION_SECRET` are currently set to the same value. For maximum security, generate two independent 32-byte secrets before scaling to real users.

---

## CORS Configuration

Allowed origins (production): `https://genwhisperer.com`, `https://www.genwhisperer.com`

Dev origins (auto-added when `NODE_ENV !== "production"`): `localhost:3000`, `localhost:5173`, `localhost:4321`

**Every frontend request must include `credentials: "include"`** or the session cookie will not be sent and all protected endpoints return 401.

Blocked origins receive a clean rejection (no `Access-Control-Allow-Origin` header) — not an error response.

---

## Email Flows

All emails from `Geny <support@genwhisperer.com>` via Brevo.

| Trigger | Recipient | Subject |
|---|---|---|
| Magic-link request | The user | "Your GenWhisperer sign-in link" |
| New sign-up | `vipaymanshalaby@gmail.com` | "[GenWhisperer] New sign-up" |
| Trial exhausted | `vipaymanshalaby@gmail.com` | "[GenWhisperer] Trial exhausted" |

---

## GetResponse Integration

- List: **"GenWhisperer"** (id: `LJpJ3`)
- On every new sign-up, `subscribeUser(email)` is called (non-blocking, errors silently ignored)
- List ID is cached in `system_settings.getresponse_list_id` after first run
- Single opt-in configured
- Current contacts: 1 (`vipaymanshalaby@gmail.com`)
- Note: test email addresses with fake domains (e.g. `@genwhisperer-test.com`) are rejected by GetResponse with 202 but never appear in the list — this is expected behaviour

---

## Running Locally

```bash
git clone https://github.com/v3ads/genwhisperer.git
cd genwhisperer
npm install
cp .env.example .env
# Fill in .env with credentials from Railway or .env.example
npm run dev   # backend on http://localhost:3001

# In a second terminal:
cd frontend
npm install
npm run dev   # frontend on http://localhost:5173 (proxies /api → :3001)
```

---

## Tests

```bash
npm test   # runs 8 Vitest unit tests
```

| Suite | Tests |
|---|---|
| `crypto.test.ts` | encrypt/decrypt round-trip, wrong key rejection, masked key format, empty string, key derivation |
| `jwt.test.ts` | sign/verify round-trip, expired token rejection, tampered token rejection |

---

## What Is Not Yet Built

| Feature | Notes |
|---|---|
| Stripe payment integration | No billing/subscription system |
| Conversation persistence | Chat history lives in React state only; refresh loses it |
| Resend magic-link button | No UI for requesting a new link from the verify page |
| User self-service name update | `users.name` column exists, no endpoint |
| Email unsubscribe / GDPR delete | No self-service account deletion |
| OpenRouter model selector UI | `/api/chat/models` endpoint exists, no frontend dropdown |
| Usage export | Admin can view per-user usage but cannot export CSV |

---

## Git History (recent)

```
abaf5f5  docs: update DEPLOYMENT_REPORT with bug fixes, test results, and revoked_sessions schema
31989b5  fix: CORS 500 error + JWT logout invalidation via revoked_sessions blocklist
67fa46d  fix: apply Gemini Code Assist review fixes
29c8280  docs: add comprehensive deployment report for Claude
af7aaf3  fix: Dockerfile — use frontend/ dir and build:server script
3e832ba  Add GenWhisperer frontend + Railway deploy config
ba7fad5  docs: add CLAUDE_HANDOFF.md — comprehensive frontend architect briefing
6f8d19f  ci: add GitHub Actions workflow — test, build, env assembly from secrets
```

---

## Key Contacts

| Role | Detail |
|---|---|
| Owner / admin | `vipaymanshalaby@gmail.com` |
| Support email | `support@genwhisperer.com` |
| Sender name | Geny |
| GitHub org | `v3ads` |
| Railway token | Stored in Railway project — ask owner |
| GetResponse API key | Stored in Railway env vars as `GETRESPONSE_API_KEY` |
| GitHub PAT | Stored in GitHub Actions secrets as `GH_PAT` |
