# GenWhisperer

**AI Prompt Assistant for Genesis / E-Stage users.**

GenWhisperer interviews you about what you want to build, then outputs a single, perfectly-tagged prompt ready to paste into Genesis — no guesswork required.

---

## Architecture

| Layer | Technology |
|---|---|
| Backend | Node.js 22 · TypeScript · Express 4 |
| Database | Neon (serverless Postgres) · Drizzle ORM |
| Auth | Magic-link email (Brevo) · JWT session cookies |
| AI proxy | OpenRouter API (`deepseek/deepseek-v4-pro` default) |
| Encryption | AES-256-GCM (user API keys at rest) |
| Email | Brevo transactional API |
| Marketing | GetResponse subscriber sync |
| Frontend | React 19 · Vite · React Router |

---

## Features

1. **Magic-link authentication** — fully passwordless, no passwords stored.
2. **OpenRouter proxy** — all prompts route through the platform key during trial.
3. **Free-trial cap** — default 5 messages; adjustable from the admin dashboard.
4. **Bring-your-own-key** — users can add their own OpenRouter key for unlimited usage.
5. **AES-256-GCM encryption** — user API keys are encrypted at rest; never stored in plaintext.
6. **Usage tracking** — every message logged with model, token counts, key type, and timestamp.
7. **Admin dashboard** — adjust trial cap, default model, view all users and usage stats, suspend/unsuspend users.
8. **GetResponse sync** — new sign-ups are automatically added to the "GenWhisperer" list (created on first run if it doesn't exist).
9. **Owner email notifications** — new sign-up, trial exhausted, and system errors via Brevo.
10. **Premium dark UI** — responsive React frontend with streaming markdown rendering.

---

## Quick Start

### Prerequisites

- Node.js 22+
- A [Neon](https://neon.tech) Postgres database
- A [Brevo](https://brevo.com) account (transactional email)
- An [OpenRouter](https://openrouter.ai) API key (platform key for trial users)
- A [GetResponse](https://getresponse.com) API key (subscriber sync)

### 1. Clone and install

```bash
git clone https://github.com/v3ads/genwhisperer.git
cd genwhisperer
npm install
cd client && npm install && cd ..
```

### 2. Configure environment

```bash
cp .env.example .env
# Edit .env with your credentials
```

Required variables:

| Variable | Description |
|---|---|
| `NEON_DATABASE_URL` | Neon Postgres connection string |
| `JWT_SECRET` | 32+ char random string for session signing |
| `ENCRYPTION_SECRET` | 64 hex chars (32 bytes) for AES-256-GCM |
| `OPENROUTER_PLATFORM_KEY` | OpenRouter key for free-trial users |
| `BREVO_API_KEY` | Brevo API key |
| `BREVO_SENDER_NAME` | From-name for emails (e.g. `Geny`) |
| `BREVO_SENDER_EMAIL` | From-address (e.g. `support@genwhisperer.com`) |
| `GETRESPONSE_API_KEY` | GetResponse API key |
| `ADMIN_EMAIL` | Your email — gets admin role on first sign-in |
| `APP_URL` | Frontend URL (e.g. `http://localhost:5173`) |

### 3. Run migrations and seed

```bash
npm run db:migrate   # Create all tables
npm run db:seed      # Insert default system settings
```

### 4. Start development servers

```bash
# Terminal 1 — backend API (port 3001)
npm run dev

# Terminal 2 — frontend (port 5173)
cd client && npm run dev
```

Open [http://localhost:5173](http://localhost:5173).

---

## Making yourself admin

Sign in with the email address set in `ADMIN_EMAIL`. The system automatically assigns the `admin` role to that email on first sign-in. The admin dashboard is at `/admin`.

---

## Production build

```bash
# Build frontend
cd client && npm run build && cd ..

# Build backend
npm run build

# Start production server (serves frontend + API on port 3001)
NODE_ENV=production npm start
```

---

## Docker

```bash
docker compose up --build
```

The `docker-compose.yml` starts the app on port 3001. Set all environment variables in a `.env` file at the project root before running.

---

## API Contract

### Auth

| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/api/auth/request` | Public | Request magic-link email |
| `GET` | `/api/auth/verify?token=` | Public | Verify token, set session cookie |
| `POST` | `/api/auth/logout` | Public | Clear session cookie |
| `GET` | `/api/auth/me` | Required | Get current user |

### Chat

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/api/chat/status` | Required | Trial usage, key status |
| `POST` | `/api/chat/message` | Required | Send message (SSE streaming) |
| `GET` | `/api/chat/models` | Required | List available OpenRouter models |

### Account

| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/api/account/api-key` | Required | Save/update OpenRouter key |
| `PATCH` | `/api/account/model` | Required | Update preferred model |
| `DELETE` | `/api/account/api-key` | Required | Remove stored key |

### Admin

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/api/admin/users` | Admin | Full user list with usage |
| `GET` | `/api/admin/stats` | Admin | Aggregate stats + daily volume |
| `GET` | `/api/admin/settings` | Admin | All system settings |
| `PATCH` | `/api/admin/settings` | Admin | Update a setting |
| `PATCH` | `/api/admin/users/:id/suspend` | Admin | Suspend/unsuspend user |
| `DELETE` | `/api/admin/users/:id` | Admin | Delete user |
| `GET` | `/api/admin/users/:id/usage` | Admin | Per-user usage log |

---

## Database Schema

```
users              — email, role, suspended, timestamps
magic_links        — tokenized sign-in links (15 min TTL)
user_api_keys      — AES-256-GCM encrypted OpenRouter keys
message_usage      — per-message log (model, tokens, key_type)
system_settings    — admin-configurable key-value store
```

---

## Security notes

- **API keys at rest** — encrypted with AES-256-GCM; the `ENCRYPTION_SECRET` must be kept secret and never committed.
- **JWT sessions** — `httpOnly`, `secure`, `sameSite=none` in production; 1-year expiry.
- **Rate limiting** — auth endpoints: 10 req/15 min; chat: 30 req/min.
- **Input validation** — all endpoints validated with Zod.
- **Suspended users** — blocked at the middleware level on every request.

---

## License

MIT © GenWhisperer
