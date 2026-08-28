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
import { randomUUID } from "node:crypto";
import { db, githubTokens, genesisProjects, userApiKeys } from "../db/index.js";
import { requireAuth, type AuthRequest } from "../middleware/auth.js";
import { encrypt, decrypt } from "../utils/crypto.js";
import { getTierState, type Tier } from "../services/billing.js";
import {
  validateToken,
  listRepos,
  getFileTree,
  getBlob,
  type GithubRepo,
  type GithubTreeEntry,
} from "../services/github.js";
import { buildRepoDigest } from "../services/repoDigest.js";
import { planImport, type ImportPlan, type ImportPlannerInput } from "../services/importPlanner.js";
import { DEFAULT_V2_MODEL } from "../config/systemPrompt.js";
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

// ─── POST /api/github/import ──────────────────────────────────────────────────
// Stage A of the GitHub → Genesis import. Pro-only SSE route:
//   gate → load GitHub PAT + Genesis token + OpenRouter key → fetch file tree →
//   build digest → run planner → emit the plan. NO Stage B execution yet.
//
// Emits SSE events (ImportEvent):
//   status     — plain-language progress (continuous, never a static line)
//   plan       — the structured ImportPlan once Stage A completes
//   cost       — running OpenRouter cost estimate (when available)
//   error      — plain-language error (fail-open: a planner error is surfaced
//                as a plan with .error set, not a 500)
//   done      — terminal
//
// Phase 3 deliberately stops at emitting the plan. Stage B (execute the plan
// against Genesis) is Phase 4. This is the de-risk gate: validate translation
// quality before touching Genesis.
router.post("/import", requireAuth, async (req: AuthRequest, res: Response) => {
  const gate = await requirePro(req, res);
  if (!gate) return;
  const userId = gate.userId;

  const schema = z.object({
    genesisProjectId: z.number().int().positive(),
    repoOwner: z.string().min(1).max(100),
    repoName: z.string().min(1).max(100),
    branch: z.string().min(1).max(100),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.errors[0]?.message ?? "Invalid input" });
    return;
  }
  const { genesisProjectId, repoOwner, repoName, branch } = parsed.data;
  const requestId = randomUUID();
  res.setHeader("X-Import-Request-Id", requestId);

  // ── Load the GitHub PAT (decrypt server-side) ──────────────────────────────
  const ghRows = await db
    .select()
    .from(githubTokens)
    .where(eq(githubTokens.userId, userId))
    .limit(1);
  if (!ghRows.length) {
    res.status(400).json({ error: "Connect your GitHub account first." });
    return;
  }
  let githubToken: string;
  try {
    githubToken = decrypt(ghRows[0].encryptedToken);
  } catch {
    res.status(500).json({ error: "Could not read your stored GitHub token. Reconnect it." });
    return;
  }

  // ── Load the target Genesis project (ownership-checked) ────────────────────
  const projRows = await db
    .select()
    .from(genesisProjects)
    .where(eq(genesisProjects.id, genesisProjectId))
    .limit(1);
  if (!projRows.length || projRows[0].userId !== userId) {
    res.status(404).json({ error: "Genesis project not found" });
    return;
  }

  // ── Load the OpenRouter key (paid users have their own; pro-gated above) ──
  const keyRows = await db
    .select()
    .from(userApiKeys)
    .where(eq(userApiKeys.userId, userId))
    .limit(1);
  if (!keyRows.length) {
    res.status(400).json({ error: "Add your OpenRouter key in Profile first." });
    return;
  }
  const openrouterKey = decrypt(keyRows[0].encryptedKey);
  const model = keyRows[0].preferredModel || DEFAULT_V2_MODEL;

  // ── SSE headers (must not be compressed — see index.ts filter) ─────────────
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();
  res.write(": connected\n\n");
  (res as Response & { flush?: () => void }).flush?.();

  let closed = false;
  const emit = (ev: Record<string, unknown>) => {
    if (closed) return;
    res.write(`data: ${JSON.stringify(ev)}\n\n`);
    (res as Response & { flush?: () => void }).flush?.();
  };
  const heartbeat = setInterval(() => {
    if (!closed && !res.writableEnded) {
      res.write(": keepalive\n\n");
      (res as Response & { flush?: () => void }).flush?.();
    }
  }, 15_000);
  res.on("close", () => {
    closed = true;
    clearInterval(heartbeat);
  });

  try {
    // ── 1. Fetch the file tree ──────────────────────────────────────────────
    emit({ type: "status", text: `Reading the file tree for ${repoOwner}/${repoName}…` });
    let tree: GithubTreeEntry[];
    try {
      tree = await getFileTree(githubToken, repoOwner, repoName, branch);
    } catch (e) {
      emit({ type: "error", message: (e as Error).message });
      return;
    }

    // ── 2. Build the digest (getBlob closure over the decrypted PAT) ────────
    emit({ type: "status", text: "Building a compact digest of your repo…" });
    const digest = await buildRepoDigest(
      tree,
      async (entry) => {
        const blob = await getBlob(githubToken, repoOwner, repoName, entry.sha, entry.path);
        return blob.content;
      },
      { owner: repoOwner, name: repoName, branch }
    );

    if (digest.manifest.capped) {
      emit({
        type: "status",
        text: `Note: ${digest.manifest.cappedCount} file(s) were too large to include fully — the plan will note them.`,
      });
    }
    if (digest.manifest.secretHits.length) {
      emit({
        type: "status",
        text: `Security: ${digest.manifest.secretHits.length} file(s) contained likely secrets and were stripped — they will NOT be copied into Genesis.`,
      });
    }

    // ── 3. Run the planner (Stage A) ───────────────────────────────────────
    emit({ type: "status", text: "Asking the model to plan the translation… this can take a bit" });
    const plannerInput: ImportPlannerInput = {
      openrouterKey,
      model,
      digest,
      requestId,
      userId,
    };
    const plan: ImportPlan = await planImport(plannerInput);

    if (plan.error) {
      // Fail-open: the planner surfaced an error in the plan itself.
      emit({ type: "plan", plan });
      emit({ type: "error", message: plan.error });
    } else {
      emit({ type: "plan", plan });
    }
  } catch (e) {
    emit({ type: "error", message: (e as Error).message });
  } finally {
    clearInterval(heartbeat);
    if (!closed) {
      emit({ type: "done" });
      res.end();
    }
  }
});

export default router;
