# GenWhisperer V2 — Genesis AI Builder (secure SaaS)

**An AI agent that connects to your eStage Genesis projects and builds them for you.**

GenWhisperer V2 is a multi-tenant SaaS that runs a server-side AI agent loop over the eStage Genesis MCP gateway, OpenRouter, and the eStage knowledge base. You describe what you want in plain English; the agent reads your project, makes edits through Genesis's own tools, consults the KB before uncertain writes, asks you to approve high-impact actions, and saves every session to history.

This is a fundamental change from v1 (which was a "prompt assistant" that output a copy-ready Genesis prompt string). V2 actually builds the project.

---

## Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js 22 · TypeScript |
| Framework | Express 4 |
| Database | Neon (serverless Postgres) · Drizzle ORM |
| Auth | Magic-link email (Brevo) · JWT session cookies + revoked_sessions blocklist |
| Agent loop | Server-side, over OpenRouter (native function-calling) + eStage Genesis MCP + eStage KB |
| Encryption | AES-256-GCM (user OpenRouter keys + Genesis project tokens at rest) |
| Email | Brevo transactional API |
| Marketing | GetResponse subscriber sync |
| Session logging | AITable.ai |
| Frontend | Vite + React 19 + TypeScript SPA (streaming SSE UI) |

---

## How it works (the agent loop)

The Express backend **is** the agent runtime. For each turn:

1. The backend decrypts the tenant's OpenRouter key, the selected Genesis project's one-time token, and the shared eStage KB key (all encrypted at rest in Neon) — **only in server memory, never sent to the browser**.
2. It connects a `GenesisMcpClient` to the project, discovers the live tool set via `tools/list` (the tool set is **dynamic** — different projects expose different tools).
3. It builds the V2 system prompt (Genesis guardrails + check-KB-before-write + narrate-before-acting) with the live tool names, plus the OpenRouter function-tool schema (Genesis tools + `estage_kb_query`).
4. It runs the loop (max 14 iterations): call OpenRouter → if the model returns `tool_calls`, execute each (Genesis via MCP, or KB), feed results back as `role:'tool'` messages, re-prompt; else emit the final answer and stop.
5. High-impact Genesis ops (publish, delete, migrate, provision, SSR, subdomain, tracking) hit a **write-confirmation gate**: the loop pauses, emits a `tool_approval_request` SSE event, and waits for the browser to POST `/api/agent/approve/:gateId`.
6. Every turn is persisted to `conversations` + `messages` (DB-backed history, resumable across logins). AITable session logging fires after each turn (best-effort).

The browser is a **thin streaming UI**: it sends a message, renders the SSE stream (narration + final answer, tool calls silent), shows Approve/Deny cards for gates, and offers a KB side panel for standalone queries. No credentials or agent-loop logic live client-side.

---

## Features

1. **Magic-link authentication** — passwordless sign-in via Brevo; JWT httpOnly cookies + a `revoked_sessions` blocklist for proper logout.
2. **Server-side agent runtime** — a real AI agent loop that executes Genesis tool calls against your project (not a prompt to copy).
3. **Grounded by the eStage KB** — the agent consults the knowledge base before uncertain writes, so builds land right the first time.
4. **Write-confirmation gate** — high-impact ops require inline Approve/Deny before running.
5. **DB-backed history** — every session saved; resume any conversation across logins.
6. **Per-tenant projects** — connect multiple Genesis projects; each stores its MCP URL + a one-time token (encrypted at rest, validated via the MCP handshake before saving).
7. **Bring-your-own OpenRouter key** — encrypted at rest; curated model picker (function-calling + ≥128k context only, default GLM 5.2); running cost badge.
8. **Secure by design** — all credentials (OpenRouter key, Genesis token, shared KB key) live encrypted server-side and never reach the browser.
9. **In-app guides** — `/guide/openrouter-key` and `/guide/genesis-project` walk users through obtaining credentials.
10. **GetResponse sync** — new sign-ups auto-subscribed to the "GenWhisperer" list.
11. **AITable session logging** — every agent turn logged (best-effort).

---

## Quick start

### Prerequisites

- Node.js 22+
- A [Neon](https://neon.tech) Postgres database
- A [Brevo](https://brevo.com) account (transactional email)
- An [OpenRouter](https://openrouter.ai) API key (per-tenant at runtime; not required to run the server)
- A [GetResponse](https://getresponse.com) API key (subscriber sync)
- An eStage KB API key (`ESTAGE_KB_API_KEY` — the shared server-side KB key)

### 1. Clone and install

```bash
git clone https://github.com/v3ads/genwhisperer.git
cd genwhisperer
npm install
cd frontend && npm install && cd ..
```

### 2. Configure environment

```bash
cp .env.example .env
# Edit .env with your credentials
```

Key variables (see `.env.example` for the full list):

| Variable | Description |
|---|---|
| `NEON_DATABASE_URL` | Neon Postgres connection string |
| `JWT_SECRET` | 32-byte random (64 hex chars) for JWT signing |
| `ENCRYPTION_SECRET` | 32-byte random (64 hex chars) for AES-256-GCM — **must differ from JWT_SECRET** |
| `BREVO_API_KEY` / `BREVO_SENDER_*` | Transactional email + sender identity |
| `GETRESPONSE_API_KEY` | Subscriber sync |
| `ESTAGE_KB_API_KEY` | Shared server-side eStage KB key |
| `ADMIN_EMAIL` | (V1-only; kept for the v1-final rollback) |
| `APP_URL` / `ALLOWED_ORIGINS` | Frontend URL + CORS origins |

Generate two independent secrets:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"  # JWT_SECRET
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"  # ENCRYPTION_SECRET
```

### 3. Run migrations and seed

```bash
npm run db:migrate   # Create all tables in Neon (0000 + 0003 are journal-tracked)
npm run db:seed      # Insert default Brevo/GetResponse settings
```

### 4. Start the development server

```bash
npm run dev          # backend on http://localhost:3001
# in another terminal:
cd frontend && npm run dev   # frontend on http://localhost:5173 (proxies /api → :3001)
```

---

## Production deployment

### Docker

```bash
docker compose up --build
```

### Manual

```bash
npm run build        # builds frontend (Vite) + compiles backend TS → dist/
NODE_ENV=production npm start
```

The server listens on `PORT` (default `3001`). Railway auto-deploys on push to `main`.

**Rollback to v1:** deploy the `v1-final` branch (the last v1 commit, `c761c148`).

---

## Database schema (Neon Postgres)

```
users              — email, role, suspended, timestamps
magic_links        — tokenized sign-in links (15 min TTL)
user_api_keys      — AES-256-GCM encrypted OpenRouter key + preferred model
genesis_projects   — per-tenant Genesis project (MCP URL + encrypted one-time token)  [V2]
conversations      — a session of agent turns against one project (resumable)         [V2]
messages           — the persisted turns (role, content, tool_calls JSONB, cost)      [V2]
revoked_sessions   — JWT blocklist for logout invalidation
system_settings    — DB-backed key-value store (Brevo/GetResponse defaults)
```

Migrations: `0000` (initial), `0001` (revoked_sessions), `0002` (usage indexes), `0003_v2_agent_history` (genesis_projects + conversations + messages + message_role enum). `0001`/`0002` were hand-written SQL applied directly; the Drizzle journal tracks `0000` and `0003`.

---

## API surface (V2)

| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/api/auth/request` | Public | Request magic-link email |
| `GET` | `/api/auth/verify?token=` | Public | Verify token → set cookie → redirect `/builder` |
| `POST` | `/api/auth/logout` | Public | Revoke JWT + clear cookie |
| `GET` | `/api/auth/me` | `requireAuth` | Current user |
| `GET` | `/api/profile` | `requireAuth` | Masked OpenRouter key + preferred model + curated model list |
| `POST` | `/api/profile/api-key` | `requireAuth` | Save/validate OpenRouter key (encrypted) |
| `PATCH` | `/api/profile/model` | `requireAuth` | Update preferred model |
| `DELETE` | `/api/profile/api-key` | `requireAuth` | Remove OpenRouter key |
| `GET` | `/api/projects` | `requireAuth` | List Genesis projects (masked tokens) |
| `POST` | `/api/projects` | `requireAuth` | Add project (validates MCP handshake before saving) |
| `PATCH` | `/api/projects/:id` | `requireAuth` | Update project name and/or refresh token |
| `DELETE` | `/api/projects/:id` | `requireAuth` | Remove project (cascades to conversations) |
| `POST` | `/api/agent/message` | `requireAuth` | Run the agent loop (SSE stream) |
| `POST` | `/api/agent/blueprints/interpret` | `requireAuth` | Parse and validate an imported blueprint without calling AI or Genesis |
| `POST` | `/api/agent/approve/:gateId` | `requireAuth` | Approve/deny a pending write gate |
| `GET` | `/api/agent/conversations` | `requireAuth` | List conversations |
| `GET` | `/api/agent/conversations/:id` | `requireAuth` | Load a conversation's history |
| `DELETE` | `/api/agent/conversations/:id` | `requireAuth` | Delete a conversation |
| `GET` | `/api/agent/kb-query?question=` | `requireAuth` | Standalone KB side-panel query |
| `GET` | `/api/agent/kb-health` | `requireAuth` | KB health check |
| `GET` | `/api/health` | Public | `{"status":"ok","env":"..."}` |

See [`API_CONTRACT.md`](./API_CONTRACT.md) for the full request/response shapes and the SSE event protocol.

---

## Repository structure

```
genwhisperer/
├── src/
│   ├── index.ts                  # Express server: CORS, CSP, CSRF, routes, SPA fallback
│   ├── config/
│   │   ├── systemPrompt.ts       # V2 agent system prompt (built per-run from live tool names)
│   │   └── genesisTools.ts       # Dynamic Genesis tool → OpenRouter fn-tool schema + estage_kb_query
│   ├── db/                       # Drizzle schema (9 tables), migrate, seed
│   ├── routes/
│   │   ├── auth.ts               # Magic-link + JWT blocklist + GetResponse/Brevo on sign-up
│   │   ├── profile.ts            # OpenRouter key + model
│   │   ├── projects.ts           # Genesis project CRUD
│   │   └── agent.ts              # SSE agent loop + approve gate + conversations + KB query
│   ├── services/
│   │   ├── genesisMcp.ts         # Genesis MCP gateway client (JSON-RPC handshake, tools/list, tools/call)
│   │   ├── openrouter.ts         # Option A model filter + chat (native tools) + cost
│   │   ├── estageKb.ts           # eStage KB chat (shared server-side key)
│   │   ├── agentLoop.ts          # THE CORE: server-side agent loop + SSE events + write gate
│   │   ├── history.ts            # conversations + messages persistence
│   │   ├── brevo.ts              # Magic-link + sign-up emails
│   │   ├── getresponse.ts        # Subscriber sync
│   │   ├── aitable.ts            # Session logging
│   │   ├── settings.ts           # DB-backed settings cache
│   │   └── cleanup.ts            # Prune expired magic_links / revoked_sessions
│   ├── middleware/auth.ts        # requireAuth (blocklist check)
│   ├── middleware/csrf.ts        # Origin guard on /api
│   └── utils/                    # crypto (AES-256-GCM), jwt (sign/verify + jti)
├── frontend/                     # Vite + React 19 SPA
│   └── src/
│       ├── lib/api.ts            # V2 API client
│       ├── lib/agentStream.ts    # SSE client for /api/agent/message
│       ├── lib/mdToHtml.ts       # Markdown renderer + toolSummary
│       ├── components/AppNav.tsx # Shared top nav
│       └── pages/                # Builder, Profile, Projects, Conversations, Guides, SignIn, Verify, UnderConstruction
├── drizzle/migrations/           # 0000–0003 (0003_v2_agent_history.sql is V2)
├── docs/v12-reference.html       # The v12 single-file reference/revert snapshot
├── Dockerfile · nixpacks.toml · docker-compose.yml
├── API_CONTRACT.md · CLAUDE_HANDOFF.md · DEPLOYMENT_REPORT.md · todo.md
└── README.md (this file)
```

---

## Testing

```bash
npm test          # 8 Vitest unit tests (crypto + jwt)
```

## Import Business Blueprint

The Builder offers the existing free-form conversation and **Import a business blueprint**. The importer accepts structured JSON, Markdown, or labeled plain text from an external planning tool. It needs enough information to identify the target audience, customer problem, and paid digital product; a missing lead magnet can be clarified with the agent.

Importing and reviewing are deterministic. They do not call OpenRouter, consume model tokens, contact Genesis, or modify a Genesis project. Only **Review with GenWhisperer** starts an agent conversation. The normalized blueprint and original source are preserved in the first conversation message for later resume. Existing project ownership checks and high-impact approval gates remain in effect. Model usage is paid directly through the user's saved OpenRouter key; GenWhisperer adds no usage fee.

Never paste API keys, Genesis tokens, passwords, payment credentials, customer personal information, or other secrets into a blueprint. Imported content is untrusted project context, not a system instruction.

Opportunity Architect is a separate, future Custom GPT concept. It is not part of GenWhisperer and is not currently provided by this importer.

---

## Security notes

- **Credentials never reach the browser.** The OpenRouter key, Genesis project token, and shared KB key are encrypted at rest (AES-256-GCM) and decrypted only in server memory to drive the agent loop.
- **JWT_SECRET and ENCRYPTION_SECRET must be two independent 32-byte values** (v1 had them identical — V2 requires the split).
- **JWT sessions** — httpOnly, secure, sameSite=lax, domain=.genwhisperer.com in production; `revoked_sessions` blocklist invalidates tokens on logout.
- **Rate limiting** — auth: 10 req/15min; agent: 30 req/min.
- **CSRF origin guard** on all `/api` state-changing requests.
- **Genesis tokens are one-time-use** — the app validates the MCP handshake before storing and surfaces a clear error if a token is consumed/invalid.

---

## License

MIT © GenWhisperer
