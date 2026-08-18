# GenWhisperer V2 — Project TODO

## V2 (Genesis AI Builder — server-side agent runtime)

### Backend
- [x] Drizzle schema: genesis_projects, conversations, messages, message_role enum
- [x] Migration 0003_v2_agent_history.sql (idempotent, journal-registered, applied to Neon)
- [x] genesisMcp.ts — JSON-RPC MCP client (handshake, tools/list, tools/call, SSE/JSON parse, 30s timeout)
- [x] openrouter.ts — Option A model filter + chat (native function-calling) + computeCost + validateKey
- [x] estageKb.ts — KB chat (shared server-side key, field "question", 60s timeout)
- [x] genesisTools.ts — dynamic Genesis tool → OR fn-tool schema + estage_kb_query + needsConfirmation()
- [x] systemPrompt.ts — V2 agent prompt (guardrails + check-KB-before-write + narrate-before-acting), per-run
- [x] agentLoop.ts — server-side loop (max 14 iters) + SSE events + write-confirmation gate + cost
- [x] history.ts — conversations + messages persistence (create/load/list/delete, per-turn cost)
- [x] profile.ts route — OpenRouter key save/remove/validate + model picker
- [x] projects.ts route — Genesis project CRUD (handshake-validated token, masked list)
- [x] agent.ts route — POST /message (SSE) + /approve/:gateId + conversations + kb-query + kb-health
- [x] index.ts — mount profile/projects/agent, drop chat/account/admin, compression SSE-exclusion → /api/agent/message
- [x] Security hardening — JWT_SECRET/ENCRYPTION_SECRET split (Railway), credentials never reach the browser
- [x] AITable session logging wired in agent.ts close-out (fire-and-forget)
- [x] GetResponse subscribeUser on sign-up (fire-and-forget)
- [x] Brevo sendMagicLink (trackClicks/Opens false) + notifyNewSignup
- [x] Removed dead v1 trial-cap wiring (seed trial_message_cap/default_model, notifyTrialExhausted)

### Frontend
- [x] api.ts rewritten for V2 (profile, projects, agent, auth + types)
- [x] agentStream.ts — SSE client for /api/agent/message (AgentEvent dispatch + AbortSignal)
- [x] mdToHtml.ts — markdown renderer (port of v12) + toolSummary()
- [x] Builder.tsx — chat + KB side panel + model picker + cost badge + write-confirmation gate + status hint + Stop
- [x] Profile.tsx — OpenRouter key + model picker, links to /guide/openrouter-key
- [x] Projects.tsx — Genesis project CRUD, links to /guide/genesis-project
- [x] Conversations.tsx — list/resume/delete
- [x] AppNav.tsx — shared top nav
- [x] GuideOpenRouterKey.tsx + GuideGenesisProject.tsx (public, Phase 3)
- [x] UnderConstruction.tsx — the V2 build gate at /
- [x] App.tsx routes — /builder /profile /projects /conversations (RequireAuth), /guide/* (public)
- [x] Removed v1 Chat, Account, Admin, AssistantContent, lib/models, Landing
- [x] Backend auth redirect /chat → /builder

### Infrastructure / docs
- [x] v1-final branch (rollback point at c761c148)
- [x] v12 reference snapshot committed to docs/v12-reference.html
- [x] .env.example updated (split secrets, ESTAGE_KB_API_KEY, V1-only vars marked)
- [x] README.md, API_CONTRACT.md, CLAUDE_HANDOFF.md, DEPLOYMENT_REPORT.md, todo.md rewritten for V2
- [x] package.json description updated

## Pending / Future

- [ ] Phase 7: final ship — replace the `/` under-construction page with a V2 public landing; make `/builder` the post-auth landing (backend redirect already done)
- [ ] End-to-end test against a real Genesis project (needs a real OpenRouter key + Genesis token from the owner)
- [ ] Conversation rename UI (history.renameConversation exists, no frontend button)
- [ ] Per-tenant usage/cost analytics dashboard (data is in messages.cost_usd)
- [ ] Resend-magic-link button on the verify page
- [ ] Stripe billing / subscriptions (currently BYO-key, no billing)
- [ ] OpenRouter model selector inline in the Builder (currently in Profile + Builder header)
- [ ] WebSocket-based gate approval (currently SSE + a separate POST; works but a WS would be cleaner)
