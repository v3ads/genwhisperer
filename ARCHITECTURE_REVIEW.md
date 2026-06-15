# GenWhisperer — Architecture Code Review

**Reviewer:** Claude (architect-level review)
**Date:** 2026-06-15
**Scope:** Full repository — Express/TypeScript backend (`src/`), Drizzle/Neon data layer, React/Vite frontend (`frontend/`), deployment config.
**Commit reviewed:** `b2bf8db` on `main` (review branch `claude/genwhisperer-code-review-arch-y7lmtp`)

---

## 1. Executive Summary

GenWhisperer is a single-origin SaaS: an Express API that also serves a compiled
React SPA, backed by Neon Postgres via Drizzle ORM, with OpenRouter as the LLM
provider. The overall architecture is **clean, well-layered, and appropriate for
its scale**. Concerns are cleanly separated (`routes` / `services` / `middleware`
/ `utils` / `db`), authentication is cookie-based JWT with a revocation
blocklist, and user API keys are encrypted at rest with AES-256-GCM. The code is
readable, consistently styled, and the security fundamentals (encryption,
parameterized queries via Drizzle, input validation with Zod, rate limiting,
CORS allow-listing) are present.

The review found **two functional bugs that silently break features**
(model selection and token-usage analytics), several **medium-severity
correctness/security hardening items**, and a set of **lower-priority polish and
scalability notes**. None are architecture-breaking; all are fixable without
restructuring.

| Severity | Count | Headline items |
|----------|-------|----------------|
| 🔴 High   | 2 | Frontend↔backend field mismatch breaks model save/update; token usage never recorded |
| 🟠 Medium | 5 | Trial-cap race (TOCTOU), no CSRF defense-in-depth, unbounded chat payload, missing DB indexes, "Deploy" workflow doesn't deploy |
| 🟡 Low    | 6 | CSP disabled, magic-link/token table growth, misleading `extractJti` comment, disconnect skips usage log, hardcoded system prompt, no chat persistence |

---

## 2. Architecture Overview

```
                 ┌──────────────────────────────────────────┐
   Browser  ───▶ │  Express (src/index.ts)                  │
  (SPA, same     │   • helmet / cors / compression          │
   origin)       │   • rate limiters (auth 10/15m, chat 30/m)│
                 │   • /api/auth  /api/chat                  │
                 │   • /api/account  /api/admin             │
                 │   • static SPA + index.html fallback     │
                 └───────┬───────────────────┬──────────────┘
                         │                   │
              ┌──────────▼────────┐   ┌──────▼─────────────┐
              │ Neon Postgres     │   │ External services  │
              │ (Drizzle ORM)     │   │ • OpenRouter (LLM) │
              │ users / keys /    │   │ • Brevo (email)    │
              │ usage / settings /│   │ • GetResponse (CRM)│
              │ magic_links /     │   └────────────────────┘
              │ revoked_sessions  │
              └───────────────────┘
```

**Strengths worth preserving:**

- **Single-origin topology** (`vite.config.ts` proxies `/api` in dev; the Node
  process serves the SPA in prod). This sidesteps CORS complexity for first-party
  traffic and lets the `httpOnly` session cookie "just work."
- **Encryption at rest** for user OpenRouter keys (`src/utils/crypto.ts`), with a
  random 96-bit IV per encryption and auth-tag verification — and tests covering
  tamper detection.
- **JWT revocation blocklist** (`revoked_sessions`) gives real logout semantics
  for long-lived (1-year) sessions, with opportunistic cleanup.
- **Fresh-from-DB authorization** — `requireAuth` re-reads `role`/`suspended` on
  every request rather than trusting the JWT claims, so privilege changes and
  suspensions take effect immediately (`src/middleware/auth.ts:39-52`).
- **SSE streaming is explicitly excluded from gzip compression**
  (`src/index.ts:66-73`) — a subtle correctness detail that many teams miss.
- **Settings cache** (`src/services/settings.ts`) avoids a DB round-trip per chat
  request for the trial cap / default model, with explicit invalidation.

---

## 3. Findings

### 🔴 HIGH-1 — Frontend/backend field-name mismatch silently breaks model selection

The frontend API client and the backend route handlers disagree on the JSON
field name for the model, on **both** account endpoints.

**Save key** — frontend sends `preferredModel`, backend reads `model`:

- `frontend/src/lib/api.ts:204-208`
  ```ts
  saveKey: (apiKey, preferredModel?) =>
    request(..., { body: JSON.stringify({ apiKey, preferredModel }) })
  ```
- `src/routes/account.ts:13-25,43` expects `model` and falls back to the default:
  ```ts
  const schema = z.object({ apiKey: ..., model: z.string().optional() });
  const { apiKey, model } = parsed.data;          // model is undefined
  const preferredModel = model ?? "deepseek/deepseek-v4-pro";
  ```
  → The model the user picked in the dropdown when saving their key is **discarded**;
  everyone is silently pinned to `deepseek/deepseek-v4-pro`.

**Update model** — frontend sends `preferredModel`, backend requires `model`:

- `frontend/src/lib/api.ts:212-216` → `body: JSON.stringify({ preferredModel })`
- `src/routes/account.ts:62` → `z.object({ model: z.string().min(1) })` →
  validation fails → **HTTP 400**, which the caller swallows:
- `frontend/src/pages/Account.tsx:74-77`
  ```ts
  async function commitModel(next) {
    ...
    try { await account.setModel(next); ... }
    catch { /* non-fatal */ }     // 400 is silently eaten
  }
  ```
  → Changing the model after a key is saved appears to succeed in the UI but
  **never persists**.

**Impact:** A core paid-tier feature (choose your own model) is non-functional and
fails silently in both directions.

**Fix:** Align on one field name. Lowest-risk: change the two frontend call sites
to send `model` (matching the backend and the rest of the wire contract), or
have the backend accept `preferredModel`. Add an integration test that round-trips
save → status → setModel to prevent regression.

---

### 🔴 HIGH-2 — Token usage is never captured (analytics always report 0 tokens)

The chat proxy reads token counts from streamed chunks:

- `src/routes/chat.ts:294-297`
  ```ts
  if (json.usage) {
    promptTokens = json.usage.prompt_tokens ?? 0;
    completionTokens = json.usage.completion_tokens ?? 0;
  }
  ```

But the OpenRouter/OpenAI streaming API only emits a `usage` object when the
request includes `stream_options: { include_usage: true }`. The request body
(`src/routes/chat.ts:255-260`) sets `stream: true` and `max_tokens` but **not**
`stream_options`:

```ts
{ model, messages: fullMessages, stream: true, max_tokens: 1024 }
```

**Impact:** `prompt_tokens`/`completion_tokens` stay `0`, so every
`message_usage` row stores `totalTokens = 0`. The admin dashboard's
`totalTokens` (`src/routes/admin.ts:67-69,103`) is therefore permanently `0`.
(The trial gate itself is unaffected — it counts *rows*, not tokens.)

**Fix:** Add `stream_options: { include_usage: true }` to the OpenRouter request
body. Verify the final pre-`[DONE]` chunk carries `usage` and is parsed before
the stream ends.

---

### 🟠 MEDIUM-1 — Trial cap is checked non-atomically (TOCTOU bypass)

The trial gate reads the count, then the usage row is inserted only *after* the
stream finishes:

- Check: `src/routes/chat.ts:209-223`
- Insert: `src/routes/chat.ts:313-315` (in `stream.on("end")`)

Concurrent requests from the same user all observe `used < cap` before any of
them inserts a row, so a user can fire N parallel requests and exceed the free
cap. Because usage is logged at stream *end*, the window is wide (seconds).

**Impact:** Free-tier abuse on the platform-paid key — bounded but real cost leak.

**Fix options:** reserve the slot atomically (insert a "pending" usage row up
front inside a transaction with a `SELECT ... FOR UPDATE`/conditional insert), or
add a per-user concurrency guard, or enforce the cap with a DB-side check
(`INSERT ... WHERE (SELECT count ...) < cap`). For the current scale a simple
in-flight per-user lock is probably sufficient.

---

### 🟠 MEDIUM-2 — Cookie auth without CSRF defense-in-depth

Auth is via a long-lived `httpOnly` cookie (`gw_session`, 1-year,
`sameSite: "lax"`) and all state-changing endpoints (`/api/chat/message`,
`/api/account/*`, `/api/admin/*`) are cookie-authenticated. There is no CSRF
token or `Origin`/custom-header check.

Today this is *mostly* mitigated incidentally:
- `SameSite=Lax` blocks cookies on cross-site sub-requests.
- All mutating requests use `Content-Type: application/json`, which forces a CORS
  preflight that the allow-list (`src/index.ts:45-56`) would reject.

But these are implicit guarantees. `SameSite=Lax` still allows top-level
cross-site **GET** navigations to carry the cookie, and the admin
`GET` endpoints are state-reading only, so the current surface is low-risk — but
the posture is fragile to future changes (e.g. adding a `GET` mutation, or
relaxing content-type handling).

**Fix:** Make it explicit — either `SameSite=Strict` for the session cookie, or a
double-submit CSRF token / `Origin` assertion on mutating routes. Document the
reliance on JSON-content-type preflight if you keep it.

---

### 🟠 MEDIUM-3 — Unbounded chat payload (cost + 413 risk)

The frontend resends the **entire** message history on every turn
(`frontend/src/pages/Chat.tsx:49,59`) and the body cap is `1mb`
(`src/index.ts:60`). There is no client- or server-side history truncation or
token-window management.

**Impact:** Long conversations (a) grow LLM cost super-linearly, (b) eventually
hit the `1mb` limit and start returning `413`, breaking the session with no
graceful handling. Combined with HIGH-2, there is no visibility into the cost.

**Fix:** Cap/trim history (e.g. keep system prompt + last N turns or a token
budget) before sending, and handle `413`/length errors in `streamChat`.

---

### 🟠 MEDIUM-4 — Missing indexes on the hottest query paths

`message_usage` is queried by `(userId, keyType)` on every chat request and
status poll (`src/routes/chat.ts:140-145,209-213`, `src/routes/admin.ts:34-41`),
and by `createdAt` for the 30-day rollup (`src/routes/admin.ts:80-83`). The schema
(`src/db/schema.ts:68-78`) defines only the serial PK and the FK column — no
secondary indexes.

**Impact:** Every trial check is a full scan of the user's usage rows; admin
stats scan the whole table. Fine at hundreds of rows, increasingly costly as
usage accumulates (the table is append-only and never pruned).

**Fix:** Add a composite index on `message_usage(user_id, key_type)` and an index
on `message_usage(created_at)`. Consider an index on
`magic_links(expires_at)` / `revoked_sessions(expires_at)` to support cleanup.

---

### 🟠 MEDIUM-5 — The "Deploy" workflow does not deploy

`.github/workflows/deploy.yml` runs test → build → upload-artifact → `env-check`.
The `env-check` job writes a `.env` from secrets onto the ephemeral runner and
then... the runner is destroyed. There is no step that ships the build or the
env anywhere.

**Impact:** The workflow name implies a deployment pipeline, but actual deploys
must be happening out-of-band (e.g. Railway's own GitHub integration). This is a
maintenance/clarity hazard: someone will assume CI deploys and it doesn't, and
the `env-check` job is dead weight (it can't fail meaningfully — `grep` on a
file it just wrote).

**Fix:** Either add the real deploy step, or rename the workflow to `CI` and drop
the misleading `env-check` job (or convert it to a genuine required-secrets
presence check that runs against the deploy target).

---

### 🟡 LOW — Polish & smaller items

1. **CSP disabled.** `helmet({ contentSecurityPolicy: false, ... })`
   (`src/index.ts:38-43`). For an app serving its own SPA, a baseline CSP is
   achievable and would meaningfully harden XSS. Consider enabling a tuned policy.

2. **Token tables grow unbounded except opportunistically.** `magic_links` rows
   are never deleted (used or expired). `revoked_sessions` is only cleaned on a
   logout event (`src/routes/auth.ts:136-139`). With 1-year session TTLs the
   blocklist can accumulate. A `node-cron` sweep (the dependency is already
   present) would be cleaner and bound both tables.

3. **Misleading comment on `extractJti`.** The doc comment says "without full
   verification" but the implementation calls `jwtVerify`
   (`src/utils/jwt.ts:55-62`). Consequence: an *expired-but-genuine* token can't
   have its `jti` extracted at logout, so it won't be blocklisted — harmless
   (it's already invalid) but the comment misrepresents behavior. Either decode
   without verifying (if you want to revoke near-expiry tokens) or fix the
   comment.

4. **Client disconnect skips usage logging.** On `res` close, `finished` is set
   and `stream.on("end")` returns early (`src/routes/chat.ts:248-250,306-309`),
   so a user who aborts mid-stream is not charged a trial message. Minor trial
   bypass; acceptable, but worth a deliberate decision.

5. **System prompt hardcoded in a route file.** The ~120-line
   `GENWHISPERER_SYSTEM_PROMPT` lives inline in `src/routes/chat.ts:15-132`.
   Given there is already an admin-editable `system_settings` store and a
   `default_model` setting, consider moving the prompt to a setting (or at least a
   dedicated module) so it can be tuned without a redeploy.

6. **No chat persistence.** Conversations are client-only React state
   (`Chat.tsx`) and vanish on refresh/navigation. This may be intentional
   (stateless, privacy-friendly), but it's a notable product/architecture choice
   worth recording — and it interacts with MEDIUM-3 (no server-side history to
   trim against).

---

## 4. Cross-Cutting Observations

- **Wire-contract drift (root cause of HIGH-1).** The frontend `api.ts` types and
  the backend Zod schemas are maintained independently, and `API_CONTRACT.md` is
  a third hand-maintained copy. This is structurally prone to silent skew.
  Recommend a single source of truth — e.g. share the Zod schemas between
  frontend and backend (a `shared/` package), or generate the client from the
  schemas. At minimum, add request/response contract tests on the account and
  chat endpoints.
- **Error visibility.** Several non-fatal paths swallow errors
  (`catch { /* non-fatal */ }` in `Account.tsx`, `.catch(console.error)` for
  usage logging and CRM). Combined with HIGH-1/HIGH-2, this is how two broken
  features stayed invisible. Consider surfacing failures to logs/metrics even
  when they don't block the user.
- **Test coverage is narrow but good where it exists.** `crypto` and `jwt` have
  solid unit tests (including tamper detection). The untested surface is exactly
  where the bugs are: the route handlers and the frontend↔backend contract.

---

## 5. Prioritized Recommendations

| # | Action | Severity | Effort |
|---|--------|----------|--------|
| 1 | Fix `model`/`preferredModel` field mismatch on both account endpoints | 🔴 High | XS |
| 2 | Add `stream_options: { include_usage: true }` to OpenRouter request | 🔴 High | XS |
| 3 | Make the trial-cap check atomic (reserve slot / DB-side guard) | 🟠 Med | M |
| 4 | Add CSRF defense-in-depth (`SameSite=Strict` or token/Origin check) | 🟠 Med | S |
| 5 | Trim chat history client-side + handle `413`/length errors | 🟠 Med | S |
| 6 | Add indexes: `message_usage(user_id,key_type)`, `(created_at)` | 🟠 Med | XS |
| 7 | Make the Deploy workflow actually deploy, or rename to CI | 🟠 Med | S |
| 8 | Share Zod schemas / add contract tests for account + chat | 🟠 Med | M |
| 9 | Enable a tuned CSP; add cron cleanup for token tables | 🟡 Low | S |

**Bottom line:** The foundation is sound and the security basics are right. The
highest-value work is the two XS-effort bug fixes (#1, #2) — they restore a paid
feature and the usage analytics — followed by closing the trial-cap race and the
contract-drift gap that let those bugs ship silently.
