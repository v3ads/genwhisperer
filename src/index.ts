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
import chatRouter from "./routes/chat.js";
import accountRouter from "./routes/account.js";
import adminRouter from "./routes/admin.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
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
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
  })
);

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      if (ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
      callback(new Error(`CORS: origin '${origin}' not allowed`));
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

app.use(morgan(process.env.NODE_ENV === "production" ? "combined" : "dev"));
app.use(cookieParser());
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));

// Apply gzip compression to everything EXCEPT the SSE chat endpoint.
// The SSE route must not be compressed — compression buffers chunks which
// breaks token-by-token streaming.
app.use(
  compression({
    filter: (req, res) => {
      if (req.path === "/api/chat/message") return false;
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
app.use("/api/auth", authLimiter, authRouter);
app.use("/api/chat", chatLimiter, chatRouter);
app.use("/api/account", accountRouter);
app.use("/api/admin", adminRouter);

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
// index.html so client-side routes (/chat, /account, /admin, /auth/verify)
// work on hard refresh.
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
app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 GenWhisperer running on http://0.0.0.0:${PORT}`);
  console.log(`   Environment : ${process.env.NODE_ENV ?? "development"}`);
  console.log(`   Frontend    : ${FRONTEND_DIST}`);
  console.log(`   CORS origins: ${ALLOWED_ORIGINS.join(", ")}`);
});

export default app;
