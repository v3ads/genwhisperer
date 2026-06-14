# GenWhisperer — Project TODO

## Backend

- [x] Neon Postgres database setup with Drizzle ORM
- [x] Full schema: users, magic_links, user_api_keys, message_usage, system_settings
- [x] Database migrations (run against Neon)
- [x] Database seed (default system settings)
- [x] Magic-link email authentication via Brevo
- [x] JWT session management (httpOnly cookie, 1-year expiry)
- [x] Auth middleware (requireAuth, requireAdmin)
- [x] OpenRouter proxy with SSE streaming
- [x] Free-trial message cap enforcement (default: 5, DB-configurable)
- [x] Per-user encrypted OpenRouter API key storage (AES-256-GCM)
- [x] API key validation against OpenRouter before storing
- [x] Usage tracking per message (model, tokens, key_type, timestamp)
- [x] Admin endpoints: user list, stats, settings CRUD, suspend/unsuspend
- [x] GetResponse subscriber sync (auto-create "GenWhisperer" list)
- [x] Owner email notifications: new sign-up, trial exhausted
- [x] Rate limiting: auth (10/15min), chat (30/min)
- [x] Input validation with Zod on all endpoints
- [x] Health check endpoint

## Frontend

- [x] Premium dark design system (CSS variables, Inter font)
- [x] Landing page with hero, features, CTA
- [x] Sign-in page (magic-link email form)
- [x] Email verify page (handles /auth/verify redirect)
- [x] Chat page with streaming markdown rendering
- [x] Trial status indicator in chat header
- [x] Upgrade banner when trial exhausted
- [x] Starter prompt suggestions
- [x] Account page: usage stats, API key management
- [x] Admin dashboard: overview stats, user table, settings editor
- [x] Auth context (useAuth hook)
- [x] Protected routes (ProtectedRoute, AdminRoute)
- [x] Vite dev proxy to backend API

## Infrastructure

- [x] TypeScript throughout (backend + frontend)
- [x] Docker + docker-compose
- [x] .env.example with all required variables documented
- [x] README with setup, API contract, schema, security notes
- [x] Vitest unit tests (crypto, JWT) — 8 tests passing
- [x] GitHub repository: https://github.com/v3ads/genwhisperer

## Pending / Future

- [ ] Password-reset / re-send magic link from UI
- [ ] Conversation history persistence (DB-backed)
- [ ] Model selector UI in chat
- [ ] Stripe payment integration
- [ ] Email template customization from admin
- [ ] Webhook for GetResponse events
