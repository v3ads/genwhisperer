import { Router } from "express";
import { eq } from "drizzle-orm";
import { db, userApiKeys } from "../db/index.js";
import { requireAuth, type AuthRequest } from "../middleware/auth.js";
import { encrypt, maskApiKey } from "../utils/crypto.js";
import { z } from "zod";

const router = Router();

// ─── POST /api/account/api-key ────────────────────────────────────────────────
// Save or update the user's OpenRouter API key
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

  // Validate the key against OpenRouter before storing
  try {
    const resp = await fetch("https://openrouter.ai/api/v1/models", {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!resp.ok) {
      res.status(400).json({ error: "Invalid OpenRouter API key — validation failed." });
      return;
    }
  } catch {
    res.status(400).json({ error: "Could not validate API key. Check your connection." });
    return;
  }

  const encryptedKey = encrypt(apiKey);
  const maskedKey = maskApiKey(apiKey);
  const preferredModel = model ?? "deepseek/deepseek-v4-pro";

  // Upsert
  const existing = await db.select().from(userApiKeys).where(eq(userApiKeys.userId, userId)).limit(1);
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

// ─── PATCH /api/account/model ─────────────────────────────────────────────────
// Update the user's preferred model (requires own key)
router.patch("/model", requireAuth, async (req: AuthRequest, res) => {
  const schema = z.object({ model: z.string().min(1) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid model" });
    return;
  }

  const userId = req.user!.id;
  const existing = await db.select().from(userApiKeys).where(eq(userApiKeys.userId, userId)).limit(1);
  if (!existing.length) {
    res.status(400).json({ error: "No API key saved. Add your key first." });
    return;
  }

  await db
    .update(userApiKeys)
    .set({ preferredModel: parsed.data.model, updatedAt: new Date() })
    .where(eq(userApiKeys.userId, userId));

  res.json({ success: true, preferredModel: parsed.data.model });
});

// ─── DELETE /api/account/api-key ─────────────────────────────────────────────
// Remove the user's stored API key (reverts to trial mode)
router.delete("/api-key", requireAuth, async (req: AuthRequest, res) => {
  const userId = req.user!.id;
  await db.delete(userApiKeys).where(eq(userApiKeys.userId, userId));
  res.json({ success: true });
});

export default router;
