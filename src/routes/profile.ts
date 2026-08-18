/**
 * Profile routes (V2) — the tenant's OpenRouter key + preferred model.
 *
 * Replaces v1's account.ts. V2 drops the trial cap and platform key, so the
 * profile holds only the tenant's own OpenRouter key (encrypted at rest via
 * the AES-256-GCM util, validated against OpenRouter before storing) and
 * their preferred model. The KB key is NOT here — it's a shared server-side
 * key (ESTAGE_KB_API_KEY).
 *
 * The decrypted OpenRouter key is only ever read server-side by the agent
 * route to drive the loop; it is never returned to the browser.
 */

import { Router } from "express";
import { eq } from "drizzle-orm";
import { db, userApiKeys } from "../db/index.js";
import { requireAuth, type AuthRequest } from "../middleware/auth.js";
import { encrypt, decrypt, maskApiKey } from "../utils/crypto.js";
import { validateOpenRouterKey, fetchModels, type OrModel } from "../services/openrouter.js";
import { DEFAULT_V2_MODEL } from "../config/systemPrompt.js";
import { z } from "zod";

const router = Router();

// ─── GET /api/profile ──────────────────────────────────────────────────────────
// Returns the user's masked OpenRouter key + preferred model (never the
// decrypted key). Also returns the curated model list for the picker.
router.get("/", requireAuth, async (req: AuthRequest, res) => {
  const userId = req.user!.id;
  const rows = await db
    .select()
    .from(userApiKeys)
    .where(eq(userApiKeys.userId, userId))
    .limit(1);
  const key = rows[0];

  let models: OrModel[] = [];
  if (key) {
    // The tenant has a key — fetch the curated list with it (picker needs it).
    try {
      const decrypted = decrypt(key.encryptedKey);
      models = await fetchModels(decrypted);
    } catch {
      // Key invalid / network — return empty list; the UI prompts to re-enter.
      models = [];
    }
  }

  res.json({
    hasOpenRouterKey: !!key,
    maskedKey: key?.maskedKey ?? null,
    preferredModel: key?.preferredModel ?? DEFAULT_V2_MODEL,
    models,
  });
});

// ─── POST /api/profile/api-key ─────────────────────────────────────────────────
// Save or update the tenant's OpenRouter API key. Validates against OpenRouter
// before storing (mirrors v1's validate-before-save).
router.post("/api-key", requireAuth, async (req: AuthRequest, res) => {
  const schema = z.object({
    apiKey: z.string().min(10, "API key is too short"),
    model: z.string().optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.errors[0]?.message ?? "Invalid input" });
    return;
  }

  const userId = req.user!.id;
  const { apiKey, model } = parsed.data;

  // Validate the key against OpenRouter before storing.
  try {
    await validateOpenRouterKey(apiKey);
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
    return;
  }

  const encryptedKey = encrypt(apiKey);
  const maskedKey = maskApiKey(apiKey);
  const preferredModel = model ?? DEFAULT_V2_MODEL;

  const existing = await db
    .select()
    .from(userApiKeys)
    .where(eq(userApiKeys.userId, userId))
    .limit(1);
  if (existing.length > 0) {
    await db
      .update(userApiKeys)
      .set({ encryptedKey, maskedKey, preferredModel, updatedAt: new Date() })
      .where(eq(userApiKeys.userId, userId));
  } else {
    await db.insert(userApiKeys).values({ userId, encryptedKey, maskedKey, preferredModel });
  }

  res.json({ success: true, maskedKey, preferredModel });
});

// ─── PATCH /api/profile/model ──────────────────────────────────────────────────
// Update the tenant's preferred model (requires a saved key).
router.patch("/model", requireAuth, async (req: AuthRequest, res) => {
  const schema = z.object({ model: z.string().min(1) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid model" });
    return;
  }

  const userId = req.user!.id;
  const existing = await db
    .select()
    .from(userApiKeys)
    .where(eq(userApiKeys.userId, userId))
    .limit(1);
  if (!existing.length) {
    res.status(400).json({ error: "No OpenRouter key saved. Add your key first." });
    return;
  }

  await db
    .update(userApiKeys)
    .set({ preferredModel: parsed.data.model, updatedAt: new Date() })
    .where(eq(userApiKeys.userId, userId));

  res.json({ success: true, preferredModel: parsed.data.model });
});

// ─── DELETE /api/profile/api-key ───────────────────────────────────────────────
// Remove the tenant's stored OpenRouter key.
router.delete("/api-key", requireAuth, async (req: AuthRequest, res) => {
  const userId = req.user!.id;
  await db.delete(userApiKeys).where(eq(userApiKeys.userId, userId));
  res.json({ success: true });
});

export default router;
