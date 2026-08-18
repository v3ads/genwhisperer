# GenWhisperer V2 — Session Handoff

**Prepared for:** the next session
**Repository:** [https://github.com/v3ads/genwhisperer](https://github.com/v3ads/genwhisperer)
**Production URL:** `https://www.genwhisperer.com`
**Railway URL:** `https://genwhisperer-web-production.up.railway.app`
**Last updated:** 2026-08-18 (after Phase 6 docs)

---

## Current Status — Read This First

GenWhisperer V2 is **built and deployed**. The backend is a secure server-side agent runtime; the frontend is a thin streaming SPA. Railway auto-deploys on push to `main`.

| Item | State |
|---|---|
| Production health | `{"status":"ok","env":"production"}` ✅ |
| `www.genwhisperer.com` | Live, TLS valid ✅ |
| Railway auto-deploy | On push to `main` ✅ |
| Build (tsc + vitest + frontend) | clean / 8 tests pass ✅ |
| Neon migration 0003 | Applied (genesis_projects, conversations, messages) ✅ |
| Railway env | JWT_SECRET + ENCRYPTION_SECRET split (independent); ESTAGE_KB_API_KEY added ✅ |
| Public landing `/` | **Under-construction page** (the Phase 0 gate — still in place) |
| V2 app reachable | `/builder`, `/profile`, `/projects`, `/conversations`, `/guide/*` behind auth ✅ |
| Rollback to v1 | Deploy the `v1-final` branch (commit `c761c148`) |

**What's not done:** the final ship swap (Phase 7) — make `/builder` the post-auth landing (done) and replace the `/` under-construction page with a V2 public landing; plus an end-to-end test against a real Genesis project (requires a real OpenRouter key + Genesis token, which only the owner can supply).

---

## What GenWhisperer V2 Is

A multi-tenant SaaS that runs a **server-side AI agent loop** over the eStage Genesis MCP gateway, OpenRouter, and the eStage KB. The user describes what they want in plain English; the agent reads their Genesis project, makes edits through Genesis's own MCP tools, consults the KB before uncertain writes, asks for approval on high-impact ops, and saves every session to DB-backed history.

This is a fundamental change from v1 (a "prompt assistant" that output a copy-ready prompt string). V2 actually builds the project.

### The agent loop (server-side, in `src/services/agentLoop.ts`)
1. Decrypt the tenant's OpenRouter key + the selected Genesis project's one-time token + the shared KB key (all encrypted at rest in Neon) — **server memory only, never sent to the browser**.
2. `GenesisMcpClient` connects, discovers the **dynamic** per-project tool set via `tools/list` (different projects expose different tools — not a static list).
3. Build the V2 system prompt (Genesis guardrails + check-KB-before-write + narrate-before-acting) with the live tool names; build the OpenRouter function-tool schema (Genesis tools + `estage_kb_query`).
4. Loop (max 14 iters): OpenRouter chat (native function-calling, `parallel_tool_calls:false`) → if `tool_calls`, execute each (Genesis via MCP or KB), feed results back as `role:'tool'` messages, re-prompt; else emit `final_answer` + stop.
5. High-impact ops (`CONFIRM_TOOLS` + `genesis_cloud_sql` w/ `allowWrite`) hit the **write-confirmation gate**: loop pauses, emits `tool_approval_request`, awaits `POST /api/agent/approve/:gateId`.
6. Persist every turn to `conversations` + `messages`; AITable session logging on close-out (fire-and-forget).

### The browser (thin streaming UI, `frontend/src/pages/Builder.tsx`)
Sends `POST /api/agent/message` → renders the SSE stream (narration + final answer; tool calls silent) → shows Approve/Deny cards for gates → KB side panel for standalone queries. No credentials or agent-loop logic client-side.

---

## Architecture

```
src/
├── index.ts                  Express: CORS, CSP, CSRF, routes, SPA fallback, cleanup cron
├── config/
│   ├── systemPrompt.ts       buildSystemPrompt(genesisTools) — V2 agent prompt, per-run
│   └── genesisTools.ts       dynamic Genesis tool → OR fn-tool schema + estage_kb_query + needsConfirmation()
├── db/                       schema (9 tables), migrate, seed
├── routes/
│   ├── auth.ts               magic-link + JWT blocklist + GetResponse/Brevo on sign-up → redirect /builder
│   ├── profile.ts            OpenRouter key (validate/encrypt/save/remove) + model picker
│   ├── projects.ts           Genesis project CRUD (handshake-validated token)
│   └── agent.ts              POST /message (SSE) + /approve/:gateId + conversations + kb-query
├── services/
│   ├── genesisMcp.ts         GenesisMcpClient (JSON-RPC handshake, tools/list, tools/call, SSE/JSON parse)
│   ├── openrouter.ts         Option A model filter + chat (native tools) + computeCost + validateKey
│   ├── estageKb.ts           kbAsk/kbHealth (shared ESTAGE_KB_API_KEY)
│   ├── agentLoop.ts          THE CORE: runAgentLoop(input, sink) + SSE events + pending-gate registry
│   ├── history.ts            conversations + messages CRUD (create/load/list/delete, per-turn cost)
│   ├── brevo.ts              sendMagicLink + notifyNewSignup (trackClicks/Opens false)
│   ├── getresponse.ts        subscribeUser + ensureGenWhispererList
│   ├── aitable.ts            logSessionToAITable (fire-and-forget)
│   ├── settings.ts           DB-backed settings cache (Brevo/GetResponse defaults)
│   └── cleanup.ts            prune expired magic_links / revoked_sessions
├── middleware/auth.ts        requireAuth (blocklist check)
├── middleware/csrf.ts        origin guard on /api
└── utils/                    crypto (AES-256-GCM), jwt (sign/verify + jti)

frontend/src/
├── lib/api.ts                V2 API client (profile, projects, agent, auth)
├── lib/agentStream.ts        SSE client for /api/agent/message (AgentEvent dispatch + AbortSignal)
├── lib/mdToHtml.ts           markdown renderer (port of v12) + toolSummary()
├── components/AppNav.tsx     shared top nav (Builder/History/Projects/Profile + sign out)
└── pages/                    Builder, Profile, Projects, Conversations, GuideOpenRouterKey,
                              GuideGenesisProject, SignIn, Verify, UnderConstruction, NotFound
```

---

## Database Schema (Neon — all migrations applied)

9 tables: `users`, `magic_links`, `user_api_keys`, `genesis_projects` (V2), `conversations` (V2), `messages` (V2), `revoked_sessions`, `system_settings`, `message_usage` (v1, retained).

### V2 tables (migration `0003_v2_agent_history.sql`)

**`genesis_projects`** — per-tenant Genesis project
- `id` serial PK, `user_id` FK→users CASCADE, `name` varchar(120)
- `genesis_project_id` varchar(64) (parsed from the MCP URL), `mcp_url` text
- `token_encrypted` text (AES-256-GCM `iv:authTag:ciphertext`), `token_masked` varchar(40)
- `last_used_at`, `created_at`, `updated_at` timestamptz
- index on `user_id`

**`conversations`** — a session of agent turns against one project (resumable)
- `id` serial PK, `user_id` FK CASCADE, `genesis_project_id` FK CASCADE
- `title` varchar(200) (derived from first user message), `model` varchar(128) default `z-ai/glm-5.2`
- `created_at`, `updated_at`; indexes on `user_id`, `genesis_project_id`

**`messages`** — the persisted turns
- `id` serial PK, `conversation_id` FK CASCADE, `role` `message_role` enum (system/user/assistant/tool)
- `content` text, `tool_calls` jsonb (raw OpenRouter tool_calls for audit/replay)
- `prompt_tokens`, `completion_tokens` int, `cost_usd` numeric(12,6)
- `created_at`; index on `conversation_id`

**Drizzle journal note:** the journal tracks `0000` and `0003` only (`0001`/`0002` were hand-written SQL applied without journal entries). For a new V2 migration, add a journal entry with the next idx + a matching `0004_*.sql` in the hand-written idempotent style. Do **not** run `drizzle-kit generate` — the `0000` snapshot is stale by design and generate would emit a noisy diff.

---

## Authentication Flow

Unchanged from v1 (magic-link + JWT + `revoked_sessions` blocklist) except the verify redirect now goes to `/builder` instead of `/chat`. See `API_CONTRACT.md` for the full flow. On a new user, GetResponse `subscribeUser` + Brevo `notifyNewSignup` fire (best-effort).

---

## Environment Variables (Railway)

| Variable | Purpose |
|---|---|
| `NEON_DATABASE_URL` | Neon Postgres |
| `JWT_SECRET` | 64-hex (32-byte) — JWT signing. **Must differ from ENCRYPTION_SECRET.** |
| `ENCRYPTION_SECRET` | 64-hex (32-byte) — AES-256-GCM for keys/tokens. **Must differ from JWT_SECRET.** |
| `OPENROUTER_PLATFORM_KEY` | (V1-only — kept for the v1-final rollback; V2 doesn't use it) |
| `BREVO_API_KEY` / `BREVO_SENDER_NAME` / `BREVO_SENDER_EMAIL` | Transactional email |
| `GETRESPONSE_API_KEY` / `GETRESPONSE_LIST_ID` | Subscriber sync (list id auto-resolved if blank) |
| `ESTAGE_KB_API_KEY` | **V2** — shared server-side eStage KB key |
| `AITABLE_TOKEN` | Session logging |
| `ADMIN_EMAIL` | (V1-only — V2 dropped the admin dashboard) |
| `APP_URL` / `ALLOWED_ORIGINS` / `NODE_ENV` / `PORT` | App config |

---

## Infrastructure

- **Railway:** project `34c538d4-4523-465f-8f5e-0112f9ec6a3f`, service `genwhisperer-web` (`cf7a9c54-…`), auto-deploy on push to `main`, Nixpacks (Node 22).
- **DNS/TLS:** `www.genwhisperer.com` CNAME → Railway, TLS valid. `genwhisperer.com` → Cloudflare Page Rule → `www`.
- **Neon:** US East 2 (Ohio), `NEON_DATABASE_URL`.

---

## Running Locally

```bash
git clone https://github.com/v3ads/genwhisperer.git && cd genwhisperer
npm install && cd frontend && npm install && cd ..
cp .env.example .env  # fill in
npm run db:migrate && npm run db:seed
npm run dev           # backend :3001
cd frontend && npm run dev   # frontend :5173 (proxies /api → :3001)
```

---

## Tests

```bash
npm test   # 8 Vitest unit tests (crypto AES-256-GCM + jwt sign/verify)
```

---

## What's Not Yet Built (post-V2 future)

| Feature | Notes |
|---|---|
| V2 public landing page | The `/` under-construction page is still the gate; Phase 7 replaces it |
| End-to-end test against a real Genesis project | Needs a real OpenRouter key + Genesis token (owner-supplied) |
| Conversation rename UI | `history.renameConversation` exists, no frontend button yet |
| Usage export / analytics | Per-tenant cost rollups (the data is in `messages.cost_usd`) |
| Stripe billing | No subscription system (BYO key model for now) |
| Resend magic-link from the verify page | Verify shows an error but no "resend" button |

---

## Git History (recent, V2)

```
0c13bf0 chore(v2): drop dead v1 trial-cap wiring from seed + brevo (Phase 5)
46ed1bc feat(v2): frontend streaming UI — Builder, Profile, Projects, Conversations (Phase 4)
743292c feat(v2): in-app guide pages for OpenRouter key + Genesis project (Phase 3)
fa271b8 refactor(v2): drop v1 account route (replaced by profile.ts)
204e18a refactor(v2): drop v1 admin dashboard route
9e350d6 refactor(v2): drop v1 SSE chat proxy route (replaced by agent runtime)
63fc19d feat(v2): server-side agent runtime — services, routes, history (Phase 2)
ec27074 docs(v2): .env.example — split JWT/ENCRYPTION secrets, add ESTAGE_KB_API_KEY
52e5c3f feat(v2): add genesis_projects, conversations, messages schema + migration 0003
6c039a8 fix(db): register v2 migration 0003
c50423b fix(v2): update index.html title + meta to V2 coming-soon copy
d510267 feat(v2): ship under-construction page as the V2 build gate (Phase 0)
7923580 docs(v2): add v12 Genesis AI Builder reference snapshot
c761c14 feat: add AITable.ai session logging   ← last v1 commit (v1-final branch)
```

---

## Key Reference

| Role | Detail |
|---|---|
| Owner / admin | `vipaymanshalaby@gmail.com` |
| Support email | `support@genwhisperer.com` |
| Sender name | Geny |
| GitHub org | `v3ads` |
| v12 reference snapshot | `docs/v12-reference.html` (in-repo, SHA256 `7d51048a…e29b`) |
| Rollback to v1 | deploy the `v1-final` branch |
