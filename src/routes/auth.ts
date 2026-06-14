import { Router } from "express";
import { nanoid } from "nanoid";
import { eq, and, gt } from "drizzle-orm";
import { db, users, magicLinks } from "../db/index.js";
import { signSession } from "../utils/jwt.js";
import { sendMagicLink, notifyNewSignup } from "../services/brevo.js";
import { subscribeUser } from "../services/getresponse.js";
import type { AuthRequest } from "../middleware/auth.js";
import { requireAuth } from "../middleware/auth.js";
import { z } from "zod";

const router = Router();

const MAGIC_LINK_TTL_MS = 15 * 60 * 1000; // 15 minutes
const SESSION_COOKIE = "gw_session";

// ─── POST /api/auth/request ───────────────────────────────────────────────────
// Request a magic-link sign-in email
router.post("/request", async (req, res) => {
  const schema = z.object({ email: z.string().email() });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid email address" });
    return;
  }

  const { email } = parsed.data;
  const normalizedEmail = email.toLowerCase().trim();

  // Generate token
  const token = nanoid(64);
  const expiresAt = new Date(Date.now() + MAGIC_LINK_TTL_MS);

  await db.insert(magicLinks).values({ email: normalizedEmail, token, expiresAt });

  const appUrl = process.env.APP_URL ?? "http://localhost:5173";
  const link = `${appUrl}/auth/verify?token=${token}`;

  try {
    await sendMagicLink(normalizedEmail, link);
  } catch (err) {
    console.error("[Auth] Failed to send magic link:", err);
    res.status(500).json({ error: "Failed to send sign-in email. Please try again." });
    return;
  }

  res.json({ success: true, message: "Check your email for a sign-in link." });
});

// ─── GET /api/auth/verify?token=xxx ──────────────────────────────────────────
// Verify magic-link token, create session
router.get("/verify", async (req, res) => {
  const { token } = req.query;
  if (!token || typeof token !== "string") {
    res.status(400).json({ error: "Missing token" });
    return;
  }

  const now = new Date();
  const rows = await db
    .select()
    .from(magicLinks)
    .where(and(eq(magicLinks.token, token), eq(magicLinks.used, false), gt(magicLinks.expiresAt, now)))
    .limit(1);

  const link = rows[0];
  if (!link) {
    res.status(400).json({ error: "Invalid or expired sign-in link." });
    return;
  }

  // Mark token as used
  await db.update(magicLinks).set({ used: true }).where(eq(magicLinks.id, link.id));

  const normalizedEmail = link.email.toLowerCase().trim();
  const isNewUser = !(await db.select().from(users).where(eq(users.email, normalizedEmail)).limit(1)).length;

  // Upsert user
  const adminEmail = (process.env.ADMIN_EMAIL ?? "").toLowerCase().trim();
  const role = normalizedEmail === adminEmail ? "admin" : "user";

  let user: typeof users.$inferSelect;
  if (isNewUser) {
    const inserted = await db
      .insert(users)
      .values({ email: normalizedEmail, role, lastSignedIn: now })
      .returning();
    user = inserted[0]!;

    // Side effects for new users (non-blocking)
    notifyNewSignup(normalizedEmail).catch(console.error);
    subscribeUser(normalizedEmail).catch(console.error);
  } else {
    const updated = await db
      .update(users)
      .set({ lastSignedIn: now, role })
      .where(eq(users.email, normalizedEmail))
      .returning();
    user = updated[0]!;
  }

  const sessionToken = await signSession({ userId: user.id, email: user.email, role: user.role });

  const isProduction = process.env.NODE_ENV === "production";
  res.cookie(SESSION_COOKIE, sessionToken, {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? "none" : "lax",
    maxAge: 365 * 24 * 60 * 60 * 1000, // 1 year
    path: "/",
  });

  // Redirect to app
  const appUrl = process.env.APP_URL ?? "http://localhost:5173";
  res.redirect(`${appUrl}/chat`);
});

// ─── POST /api/auth/logout ────────────────────────────────────────────────────
router.post("/logout", (req, res) => {
  res.clearCookie(SESSION_COOKIE, { path: "/" });
  res.json({ success: true });
});

// ─── GET /api/auth/me ─────────────────────────────────────────────────────────
router.get("/me", requireAuth, (req: AuthRequest, res) => {
  res.json({ user: req.user });
});

export default router;
