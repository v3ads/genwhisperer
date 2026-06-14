# GenWhisperer — Backend API

**AI Prompt Assistant for Genesis / E-Stage users.**

This repository contains the **backend API only**. The frontend is built and maintained separately by the frontend architect. See [`API_CONTRACT.md`](./API_CONTRACT.md) for the full endpoint specification.

---

## Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js 22 · TypeScript |
| Framework | Express 4 |
| Database | Neon (serverless Postgres) · Drizzle ORM |
| Auth | Magic-link email (Brevo) · JWT session cookies |
| AI proxy | OpenRouter API (`deepseek/deepseek-v4-pro` default) |
| Encryption | AES-256-GCM (user API keys at rest) |
| Email | Brevo transactional API |
| Marketing | GetResponse subscriber sync |

---

## Features

The API provides the following capabilities to the frontend:

1. **Magic-link authentication** — passwordless sign-in via tokenized email links; no passwords stored.
2. **OpenRouter proxy with SSE streaming** — all prompts route through the platform key during the free trial.
3. **Free-trial cap enforcement** — default 5 messages; adjustable from the admin dashboard.
4. **Bring-your-own-key** — users can store their own OpenRouter key for unlimited usage.
5. **AES-256-GCM encryption** — user API keys are encrypted at rest and never stored in plaintext.
6. **Usage tracking** — every message logged with model, token counts, key type, and timestamp.
7. **Admin dashboard API** — adjust trial cap, default model, view all users and stats, suspend/unsuspend users.
8. **GetResponse sync** — new sign-ups are automatically added to the "GenWhisperer" list (created on first run if missing).
9. **Owner email notifications** — new sign-up and trial-exhausted events via Brevo.

---

## Quick start

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
```

### 2. Configure environment

```bash
cp .env.example .env
# Edit .env with your credentials
```

Key variables:

| Variable | Description |
|---|---|
| `NEON_DATABASE_URL` | Neon Postgres connection string |
| `JWT_SECRET` | 32+ char random string for session signing |
| `ENCRYPTION_SECRET` | 64 hex chars (32 bytes) for AES-256-GCM |
| `OPENROUTER_PLATFORM_KEY` | OpenRouter key for free-trial users |
| `BREVO_API_KEY` | Brevo API key |
| `BREVO_SENDER_NAME` | From-name for emails (e.g. `Geny`) |
| `BREVO_SENDER_EMAIL` | From-address (`support@genwhisperer.com`) |
| `GETRESPONSE_API_KEY` | GetResponse API key |
| `ADMIN_EMAIL` | Your email — auto-promoted to admin on first sign-in |
| `APP_URL` | Frontend URL (`https://genwhisperer.com`) |
| `ALLOWED_ORIGINS` | Comma-separated CORS origins |

### 3. Run migrations and seed

```bash
npm run db:migrate   # Create all tables in Neon
npm run db:seed      # Insert default system settings
```

### 4. Start the development server

```bash
npm run dev   # API on http://localhost:3001
```

---

## Production deployment

### Docker (recommended)

```bash
docker compose up --build
```

### Manual

```bash
npm run build        # Compile TypeScript → dist/
NODE_ENV=production npm start
```

The server listens on `PORT` (default `3001`).

---

## Making yourself admin

Sign in with the email address set in `ADMIN_EMAIL`. The system automatically assigns the `admin` role to that email on first sign-in. The admin API is at `/api/admin/*`.

---

## Generating secrets

```bash
# JWT_SECRET (32 bytes)
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# ENCRYPTION_SECRET (32 bytes → 64 hex chars)
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

---

## Testing

```bash
npm test          # Run all tests once
npm run test:watch  # Watch mode
```

8 unit tests cover the AES-256-GCM encryption utility and JWT session utility.

---

## Database schema

```
users              — email, role, suspended, timestamps
magic_links        — tokenized sign-in links (15 min TTL)
user_api_keys      — AES-256-GCM encrypted OpenRouter keys
message_usage      — per-message log (model, tokens, key_type)
system_settings    — admin-configurable key-value store
```

---

## Security notes

- **API keys at rest** — encrypted with AES-256-GCM. The `ENCRYPTION_SECRET` must be kept secret and never committed.
- **JWT sessions** — `httpOnly`, `secure`, `sameSite=lax`, `domain=.genwhisperer.com` in production; 1-year expiry.
- **Rate limiting** — auth endpoints: 10 req/15 min; chat: 30 req/min.
- **Input validation** — all endpoints validated with Zod.
- **Suspended users** — blocked at the middleware level on every request.

---

## API reference

See [`API_CONTRACT.md`](./API_CONTRACT.md) for the complete endpoint specification including request/response shapes, streaming protocol, error codes, and CORS configuration.

---

## License

MIT © GenWhisperer
