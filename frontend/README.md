# GenWhisperer — Frontend

Production frontend for GenWhisperer, the AI prompt assistant for Genesis (the AI website-builder inside E-Stage). Built to the backend contract in `CLAUDE_HANDOFF.md` / `API_CONTRACT.md`.

**Stack:** Vite + React 19 + TypeScript, React Router. No UI framework — a small hand-built component set on a navy/cyan/teal theme.

## Why Vite SPA

The backend owns auth, data, and the AI proxy, and runs as a separate Node process. The frontend has no server-side rendering needs and no secrets, so a static SPA is the cleanest fit: one build, served behind the same reverse proxy that routes `/api/*` to the backend on port 3001. This is the **same-origin** topology from the handoff — `credentials: "include"` works with `sameSite: lax` and no cookie `domain` juggling.

## Routes

| Route | Access | Purpose |
|---|---|---|
| `/` | public | Landing page |
| `/sign-in` | public | Magic-link email request |
| `/auth/verify` | public | Reads `?token=`, full-navigates to `/api/auth/verify` so the backend can set the httpOnly cookie |
| `/chat` | auth | Core assistant: SSE streaming, trial counter, upgrade wall, copy-ready prompt cards |
| `/account` | auth | Save/remove OpenRouter key (encrypted server-side), model preference |
| `/admin` | admin only | Users, stats, 30-day chart, trial cap + default model, suspend/delete |
| `*` | public | 404 |

## Key implementation notes

- **`/auth/verify` uses a full browser navigation, not `fetch`.** An httpOnly cookie can only be set by the browser receiving `Set-Cookie` from a real navigation. The page redirects `window.location` to `/api/auth/verify?token=...`; the backend sets `gw_session` and 302s to `/chat`.
- **Every request sends `credentials: "include"`** (centralised in `src/lib/api.ts`). Without it, protected endpoints return 401.
- **Chat is stateless on the backend.** The frontend holds the full message array in React state and sends all of it on each `POST /api/chat/message`. The SSE reader buffers partial lines and extracts `choices[0].delta.content`.
- **Trial wall:** `POST /api/chat/message` returning `402` is caught and surfaces the "add your key" UI. `GET /api/chat/status` drives the free-messages-left indicator.
- **The Genesis system prompt is NOT in the frontend** — it's injected server-side. The frontend only highlights known bracket tags and lifts the tagged prompt into a copy card.

## Develop

```bash
npm install
npm run dev      # http://localhost:5173, proxies /api -> http://localhost:3001
```

Run the backend on port 3001 first, or point the proxy elsewhere in vite.config.ts.

## Build & deploy

```bash
npm run build    # -> dist/
```

Serve dist/ as static files behind a reverse proxy that:
1. routes /api/* to the Node backend on :3001,
2. serves dist/index.html for all other paths (SPA fallback, so client routes like /auth/verify resolve).

Example nginx fallback: try_files $uri /index.html;

## Project layout

```
src/
├── lib/
│   ├── api.ts          # typed client for every endpoint + SSE streamer + 402 handling
│   └── auth.tsx        # session context (GET /auth/me), logout
├── components/
│   ├── Brand.tsx       # logo mark + wordmark
│   ├── Guards.tsx      # RequireAuth / RequireAdmin
│   └── AssistantContent.tsx  # tag highlighting + prompt copy card
├── pages/              # Landing, SignIn, Verify, Chat, Account, Admin, NotFound
├── styles/theme.css    # design tokens + base + shared components
└── App.tsx             # router
```
