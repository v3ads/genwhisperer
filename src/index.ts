import "dotenv/config";
import path from "path";
import { fileURLToPath } from "url";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import cookieParser from "cookie-parser";
import rateLimit from "express-rate-limit";
import compression from "compression";

import authRouter from "./routes/auth.js";
import profileRouter from "./routes/profile.js";
import projectsRouter from "./routes/projects.js";
import agentRouter from "./routes/agent.js";
import adminRouter from "./routes/admin.js";
import billingRouter from "./routes/billing.js";
import githubRouter from "./routes/github.js";
import { csrfOriginGuard } from "./middleware/csrf.js";
import { startCleanupJobs } from "./services/cleanup.js";
import { runMigrations } from "./db/runMigrations.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app: ReturnType<typeof express> = express();
const PORT = parseInt(process.env.PORT ?? "3001", 10);

// ─── Frontend dist path ───────────────────────────────────────────────────────
// In production the build step runs `npm run build` inside frontend/ which
// produces frontend/dist.  At runtime __dirname is dist/ (compiled output),
// so we go up one level to reach the project root.
const FRONTEND_DIST = path.resolve(__dirname, "..", "frontend", "dist");

// ─── CORS origins ─────────────────────────────────────────────────────────────
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS ?? "https://genwhisperer.com,https://www.genwhisperer.com")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

if (process.env.NODE_ENV !== "production") {
  ALLOWED_ORIGINS.push("http://localhost:3000", "http://localhost:5173", "http://localhost:4321");
}

// ─── Security & middleware ────────────────────────────────────────────────────
app.use(
  helmet({
    crossOriginEmbedderPolicy: false,
    // Tuned CSP for the bundled SPA. Scripts are external hashed Vite bundles
    // ('self'); the only third-party subresources are Google Fonts. All API
    // traffic is same-origin, so connect-src stays 'self'.
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        fontSrc: ["'self'", "https://fonts.gstatic.com", "data:"],
        imgSrc: ["'self'", "data:"],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
      },
    },
  })
);

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      if (ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
      callback(null, false);
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

app.use(morgan(process.env.NODE_ENV === "production" ? "combined" : "dev"));
app.use(cookieParser());
// express.json with a verify hook that captures the raw body for the Stripe
// webhook route (signature verification needs the exact raw bytes).
app.use(
  express.json({
    limit: "1mb",
    verify: (req, _res, buf) => {
      const url = req.url ?? "";
      if (url.startsWith("/api/billing/webhook")) {
        (req as unknown as { rawBody?: string }).rawBody = buf.toString("utf8");
      }
    },
  })
);
// Parse URL-encoded request bodies with `extended: false` (Node's `querystring`,
// flat key/value pairs only). The previous `extended: true` used the `qs` library,
// which parses nested objects and is susceptible to prototype-pollution via crafted
// params like `__proto__[isAdmin]=true` (flagged by Rafter). No route in this app
// relies on nested body parsing — every handler reads a flat object via zod
// `safeParse(req.body)` — so `extended: false` is a safe hardening with no behavior
// change. If a future route needs nested form bodies, validate input to reject
// `__proto__`/`constructor` keys rather than re-enabling `qs`.
app.use(express.urlencoded({ extended: false }));

// Apply gzip compression to everything EXCEPT the SSE agent endpoint.
// The SSE route must not be compressed — compression buffers chunks which
// breaks the agent-loop event stream.
app.use(
  compression({
    filter: (req, res) => {
      // SSE routes must not be compressed — compression buffers chunks which
      // breaks the event stream. The agent /message endpoint and the (future)
      // github /import endpoint both stream.
      if (req.path === "/api/agent/message" || req.path === "/api/github/import") {
        return false;
      }
      return compression.filter(req, res);
    },
  })
);

// ─── Rate limiting ────────────────────────────────────────────────────────────
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: "Too many requests. Please wait before trying again." },
  standardHeaders: true,
  legacyHeaders: false,
});

const chatLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  message: { error: "Too many chat requests. Slow down." },
  standardHeaders: true,
  legacyHeaders: false,
});

// ─── API routes ───────────────────────────────────────────────────────────────
// CSRF defense-in-depth: reject cross-origin state-changing requests.
// The Stripe webhook is exempt (Stripe doesn't send an Origin header; it's
// authenticated by signature instead).
app.use("/api", (req, res, next) => {
  if (req.path === "/billing/webhook") return next();
  return csrfOriginGuard(ALLOWED_ORIGINS)(req, res, next);
});

app.use("/api/auth", authLimiter, authRouter);
app.use("/api/profile", profileRouter);
app.use("/api/projects", projectsRouter);
// The agent /message endpoint is SSE + runs an AI loop, so it gets the
// stricter chat limiter (30/min). The other agent sub-routes (conversations,
// kb-query, approve) are plain JSON and don't need it.
app.use("/api/agent", chatLimiter, agentRouter);
app.use("/api/admin", adminRouter);
app.use("/api/billing", billingRouter);
app.use("/api/github", githubRouter);

// ─── Health check ─────────────────────────────────────────────────────────────
app.get("/api/health", (_req, res) => {
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    env: process.env.NODE_ENV ?? "development",
  });
});

// ─── 404 for unknown API routes ───────────────────────────────────────────────
app.use("/api/*", (_req, res) => {
  res.status(404).json({ error: "API endpoint not found" });
});

// ─── Static frontend assets ───────────────────────────────────────────────────
// Hashed asset files (JS/CSS under /assets/*) get a 1-year immutable cache.
// index.html gets no-cache so new deploys are picked up immediately.
app.use(
  "/assets",
  express.static(path.join(FRONTEND_DIST, "assets"), {
    maxAge: "1y",
    immutable: true,
    setHeaders: (res) => {
      res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    },
  })
);

// Serve other static files (favicon, robots.txt, etc.) without long-term caching
app.use(
  express.static(FRONTEND_DIST, {
    index: false, // We handle index.html ourselves below
    setHeaders: (res, filePath) => {
      if (filePath.endsWith("index.html")) {
        res.setHeader("Cache-Control", "no-cache");
      }
    },
  })
);

// ─── SPA fallback ─────────────────────────────────────────────────────────────
// Any GET that is not /api/* and does not match a static file returns
// index.html so client-side routes (/builder, /profile, /projects,
// /conversations, /auth/verify) work on hard refresh.
app.get("*", (req, res, next) => {
  // Don't let the SPA fallback shadow API routes or static asset requests.
  // Anything under /api or any path with a file extension should 404 if not matched.
  if (req.path.startsWith("/api/") || req.path.includes(".")) {
    return next();
  }
  res.setHeader("Cache-Control", "no-cache");
  res.sendFile(path.join(FRONTEND_DIST, "index.html"));
});

// ─── Error handler ────────────────────────────────────────────────────────────
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error("[Server Error]", err.message);
  res.status(500).json({ error: "Internal server error" });
});

// ─── Start server ─────────────────────────────────────────────────────────────
// Bind to 0.0.0.0 so Railway (and Docker) can reach the process.
// Run DB migrations BEFORE binding so the schema matches the code before any
// request is served. Migrations are idempotent, so running on every boot is
// safe and self-heals drift.
//
// Migration failure is NON-FATAL: if runMigrations() throws (e.g. the
// migrations folder isn't present in the image, or the DB is unreachable), we
// log the error and start the server anyway. This avoids an outage where a
// migration-path problem takes the whole app down. The schema drift surfaces
// as per-query errors (visible in logs) rather than as a dead site. A future
// deploy that fixes the migration path will then self-heal on the next boot.
runMigrations()
  .catch((err) => {
    console.error("⚠️ Startup migration failed (non-fatal — server starting anyway):", err);
  })
  .finally(() => {
    app.listen(PORT, "0.0.0.0", () => {
      console.log(`🚀 GenWhisperer running on http://0.0.0.0:${PORT}`);
      console.log(`   Environment : ${process.env.NODE_ENV ?? "development"}`);
      console.log(`   Frontend    : ${FRONTEND_DIST}`);
      console.log(`   CORS origins: ${ALLOWED_ORIGINS.join(", ")}`);

      // Background pruning of expired magic links and revoked sessions.
      startCleanupJobs();
    });
  });

export default app;
