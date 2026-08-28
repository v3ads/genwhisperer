/**
 * GitHub routes (V2) — the GitHub → Genesis import feature, Phase 1.
 *
 *   GET    /api/github/status    Is a GitHub token connected? (masked only)
 *   POST   /api/github/connect   Save/replace a PAT (validate + encrypt)
 *   DELETE /api/github/connect   Remove the stored PAT
 *   GET    /api/github/repos     List the user's repos (for the import picker)
 *
 * All state-changing routes are PRO-ONLY: tier !== 'pro' → HTTP 402 + the
 * existing upgrade envelope (mirrors projects.ts's project-limit gate), so
 * the frontend shows PricingBlock + live Stripe checkout. Admin bypasses
 * (admin is treated as 'pro' in getTierState — handled in billing.ts).
 *
 * The PAT is AES-256-GCM encrypted at rest (same crypto util as user_api_keys
 * / genesis_projects) and only decrypted in server memory by later phases
 * (import ingestion). status returns maskedToken only — never the plaintext.
 *
 * Phase 1 ships connect/status/repos only. The import SSE route
 * (POST /api/github/import) is a later phase and is not wired here yet.
 */

import { Router, type Response } from "express";
import { eq } from "drizzle-orm";
import { db, githubTokens } from "../db/index.js";
import { requireAuth, type AuthRequest } from "../middleware/auth.js";
import { encrypt, decrypt } from "../utils/crypto.js";
import { getTierState, type Tier } from "../services/billing.js";
import { validateToken, listRepos, type GithubRepo } from "../services/github.js";
import { z } from "zod";

const router: ReturnType<typeof Router> = Router();

/** Mask a GitHub PAT for display: keep a recognizable prefix + last 4,
 *  e.g. "ghp_****abcd" for classic tokens, "github_****wxyz" for fine-grained.
 *  Mirrors the maskApiKey convention (first 8 + last 4) when no clear prefix. */
function maskGithubToken(token: string): string {
  if (token.length <= 8) return "****";
  // GitHub classic tokens start with "ghp_"/"gho_"/"ghu_"/"ghs_"/"ghr_";
  // fine-grained start with "github_pat_". Keep up to the first underscore
  // boundary when it's within the first 12 chars, else fall back to first 8.
  const underscore = token.indexOf("_");
  const prefix = underscore > 0 && underscore <= 11 ? token.slice(0, underscore + 1) : token.slice(0, 8);
  const suffix = token.slice(-4);
  return `${prefix}****${suffix}`;
}

/** Pro-only gate shared by every state-changing route. Returns the tier on
 *  success; sends a 402 and returns null on failure. Also performs a defensive
 *  auth re-check (requireAuth already guarantees req.user, but we re-verify
 *  here so the downstream handlers never need a non-null assertion on it). */
async function requirePro(
  req: AuthRequest,
  res: Response
): Promise<{ userId: number; tier: Tier } | null> {
  const user = req.user;
  if (!user) {
    res.status(401).json({ error: "Unauthorized" });
    return null;
  }
  const tierState = await getTierState(user.id);
  if (tierState.tier !== "pro") {
    res.status(402).json({
      error: "GitHub → Genesis import is a Pro feature. Upgrade to import a repo.",
      tier: tierState.tier,
      feature: "github_import",
    });
    return null;
  }
  return { userId: user.id, tier: tierState.tier };
}

// ─── GET /api/github/status ───────────────────────────────────────────────────
// Whether a GitHub token is connected. Returns masked token + login only.
router.get("/status", requireAuth, async (req: AuthRequest, res) => {
  const user = req.user;
  if (!user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const userId = user.id;
  const rows = await db
    .select()
    .from(githubTokens)
    .where(eq(githubTokens.userId, userId))
    .limit(1);
  if (!rows.length) {
    res.json({ connected: false });
    return;
  }
  const row = rows[0];
  res.json({
    connected: true,
    login: row.login,
    maskedToken: row.maskedToken,
    scopes: row.scopes,
    updatedAt: row.updatedAt.toISOString(),
  });
});

// ─── POST /api/github/connect ─────────────────────────────────────────────────
// Save or replace a PAT. Validates it via /user, then encrypts + upserts.
// Pro-only. One token per user (upsert on userId).
router.post("/connect", requireAuth, async (req: AuthRequest, res) => {
  const gate = await requirePro(req, res);
  if (!gate) return;

  const schema = z.object({
    token: z.string().min(20, "Token looks too short to be a valid GitHub PAT."),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.errors[0]?.message ?? "Invalid input" });
    return;
  }

  const userId = gate.userId;
  const { token } = parsed.data;

  // Validate the token against GitHub before storing (mirrors the
  // validate-before-save pattern used for Genesis projects + OpenRouter keys).
  let login: string;
  let scopes: string;
  try {
    const user = await validateToken(token);
    login = user.login;
    scopes = user.scopes;
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
    return;
  }

  const encryptedToken = encrypt(token);
  const maskedToken = maskGithubToken(token);

  // Upsert on userId (one token per user).
  const existing = await db
    .select({ id: githubTokens.id })
    .from(githubTokens)
    .where(eq(githubTokens.userId, userId))
    .limit(1);
  if (existing.length) {
    await db
      .update(githubTokens)
      .set({ encryptedToken, maskedToken, login, scopes, updatedAt: new Date() })
      .where(eq(githubTokens.userId, userId));
  } else {
    await db.insert(githubTokens).values({
      userId,
      encryptedToken,
      maskedToken,
      login,
      scopes,
    });
  }

  res.json({ success: true, login, maskedToken, scopes });
});

// ─── DELETE /api/github/connect ───────────────────────────────────────────────
// Remove the stored PAT. Pro-only, consistent with connect. A user who has
// lapsed from pro is blocked here too — if a lapsed user needs to clear a
// stale token, an admin can do it, or they can resubscribe. Keeping the gate
// uniform across all github state-changing routes is predictable and simple.
router.delete("/connect", requireAuth, async (req: AuthRequest, res) => {
  const gate = await requirePro(req, res);
  if (!gate) return;

  const userId = gate.userId;
  await db.delete(githubTokens).where(eq(githubTokens.userId, userId));
  res.json({ success: true });
});

// ─── GET /api/github/repos ────────────────────────────────────────────────────
// List the user's repos for the import picker. Pro-only. Decrypts the PAT
// server-side, calls GitHub, returns the filtered repo list (no forks/archived).
router.get("/repos", requireAuth, async (req: AuthRequest, res) => {
  const gate = await requirePro(req, res);
  if (!gate) return;

  const userId = gate.userId;
  const rows = await db
    .select()
    .from(githubTokens)
    .where(eq(githubTokens.userId, userId))
    .limit(1);
  if (!rows.length) {
    res.status(400).json({ error: "Connect your GitHub account first." });
    return;
  }
  let token: string;
  try {
    token = decrypt(rows[0].encryptedToken);
  } catch {
    res.status(500).json({ error: "Could not read your stored GitHub token. Reconnect it." });
    return;
  }

  let repos: GithubRepo[];
  try {
    repos = await listRepos(token);
  } catch (e) {
    res.status(502).json({ error: (e as Error).message });
    return;
  }

  res.json({
    repos: repos.map((r) => ({
      id: r.id,
      name: r.name,
      fullName: r.fullName,
      owner: r.owner,
      defaultBranch: r.defaultBranch,
      private: r.private,
      description: r.description,
      updatedAt: r.updatedAt,
      sizeKb: r.sizeKb,
      htmlUrl: r.htmlUrl,
    })),
  });
});

export default router;
