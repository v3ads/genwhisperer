# GenWhisperer V2 — Deployment Report

**Last updated:** 2026-08-18 (after Phase 6 docs)
**Production URL:** `https://www.genwhisperer.com`
**Status:** V2 built, deployed, healthy. Public landing `/` is the under-construction gate (Phase 7 will swap it).

---

## 1. Current deployment state

| Item | Value |
|---|---|
| Railway project ID | `34c538d4-4523-465f-8f5e-0112f9ec6a3f` |
| Railway service ID | `cf7a9c54-1256-4af1-acca-8a1e214c0140` |
| Service name | `genwhisperer-web` |
| Auto-deploy | On push to `main` |
| Builder | Nixpacks (Node 22) |
| Health | `GET /api/health` → `{"status":"ok","env":"production"}` |
| `www.genwhisperer.com` | CNAME → Railway, TLSv1.3 (Let's Encrypt) |
| `genwhisperer.com` | Cloudflare Page Rule → `https://www.genwhisperer.com` |
| Neon | US East 2 (Ohio); migrations 0000–0003 applied |
| Build | tsc clean · 8/8 vitest pass · frontend builds · server compiles to dist/ |

**Rollback to v1:** deploy the `v1-final` branch (last v1 commit `c761c148`).

---

## 2. V2 phases shipped (2026-08-17 → 2026-08-18)

| Phase | What | Key commit(s) |
|---|---|---|
| 0 | Baseline, `v1-final` rollback branch, v12 reference in `docs/`, under-construction gate live | `7923580`, `d510267`, `c50423b` |
| 1 | DB schema (genesis_projects, conversations, messages, message_role enum) + migration 0003 + `.env.example` (split secrets, ESTAGE_KB_API_KEY) | `52e5c3f`, `ec27074`, `6c039a8` (journal) |
| 2 | Backend: genesisMcp, openrouter, estageKb, agentLoop, history services + profile/projects/agent routes; dropped v1 chat/account/admin routes | `63fc19d`, `9e350d6`, `204e18a`, `fa271b8` |
| 3 | In-app guides: `/guide/openrouter-key`, `/guide/genesis-project` (public) | `743292c` |
| 4 | Frontend streaming UI: Builder, Profile, Projects, Conversations + agentStream/mdToHtml/api libs + AppNav; dropped v1 Chat/Account/Admin/AssistantContent/models/Landing | `46ed1bc` + 7 deletion commits through `c992717` |
| 5 | Integration verification (AITable, GetResponse, Brevo) + dead v1 trial-cap cleanup | `0c13bf0` |
| 6 | Docs: README, API_CONTRACT, CLAUDE_HANDOFF, todo, DEPLOYMENT_REPORT rewritten for V2; package.json description | (this phase) |
| 7 | Final ship (pending) — replace `/` under-construction with a V2 public landing; end-to-end test | — |

---

## 3. Environment variables (Railway)

| Variable | V2 use |
|---|---|
| `NEON_DATABASE_URL` | Neon Postgres |
| `JWT_SECRET` | 64-hex (32-byte) JWT signing — **independent of ENCRYPTION_SECRET** (rotated 2026-08-18) |
| `ENCRYPTION_SECRET` | 64-hex (32-byte) AES-256-GCM for OpenRouter keys + Genesis tokens — **independent of JWT_SECRET** (rotated 2026-08-18) |
| `ESTAGE_KB_API_KEY` | **V2** — shared server-side eStage KB key (added 2026-08-18) |
| `BREVO_API_KEY` / `BREVO_SENDER_NAME` / `BREVO_SENDER_EMAIL` | Magic-link + sign-up emails |
| `GETRESPONSE_API_KEY` / `GETRESPONSE_LIST_ID` | Subscriber sync (list auto-resolved if blank) |
| `AITABLE_TOKEN` | Session logging |
| `APP_URL` / `ALLOWED_ORIGINS` / `NODE_ENV` / `PORT` | App config |
| `OPENROUTER_PLATFORM_KEY` / `ADMIN_EMAIL` | V1-only (kept for the `v1-final` rollback; V2 doesn't use them) |

---

## 4. Database (Neon)

9 tables after migration 0003:
- v1 retained: `users`, `magic_links`, `user_api_keys`, `message_usage`, `system_settings`, `revoked_sessions`
- V2 added: `genesis_projects`, `conversations`, `messages` (+ `message_role` enum)

Migration ledger: the Drizzle journal tracks `0000` and `0003` (0001/0002 were hand-written SQL applied without journal entries). For a new migration, add a journal entry with the next idx + a matching `0004_*.sql` in the hand-written idempotent style. Do not run `drizzle-kit generate` (the 0000 snapshot is intentionally stale).

---

## 5. Security posture (V2)

- **Credentials never reach the browser.** OpenRouter key, Genesis project token, and the shared KB key are encrypted at rest (AES-256-GCM) and decrypted only in server memory to drive the agent loop.
- **JWT_SECRET ≠ ENCRYPTION_SECRET** — two independent 32-byte values (the v1 identity was the known note, fixed 2026-08-18).
- **JWT logout invalidation** via `revoked_sessions` blocklist (carried from v1).
- **Rate limiting** — auth 10/15min, agent 30/min.
- **CSRF origin guard** on all `/api` state-changing requests.
- **CSP** tuned for the bundled SPA (script-src 'self'; Google Fonts allowed).
- **Genesis tokens are one-time-use** — validated via the MCP handshake before storing; clear error on consumed/invalid tokens.

---

## 6. Known limitations / next steps

- The public landing `/` is still the under-construction gate (Phase 7 will replace it with a V2 public landing).
- End-to-end test against a real Genesis project is pending (requires a real OpenRouter key + Genesis token from the owner).
- No billing (BYO-key model).
- Conversation rename UI not yet exposed (the backend helper exists).
