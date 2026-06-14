import { Router } from "express";
import { eq, desc, count, sum, sql } from "drizzle-orm";
import { db, users, userApiKeys, messageUsage, systemSettings } from "../db/index.js";
import { requireAuth, requireAdmin, type AuthRequest } from "../middleware/auth.js";
import { setSetting, invalidateCache } from "../services/settings.js";
import { z } from "zod";

const router = Router();

// All admin routes require auth + admin role
router.use(requireAuth, requireAdmin);

// ─── GET /api/admin/users ─────────────────────────────────────────────────────
// Full user list with trial usage and key status
router.get("/users", async (_req, res) => {
  const rows = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      role: users.role,
      suspended: users.suspended,
      createdAt: users.createdAt,
      lastSignedIn: users.lastSignedIn,
      maskedKey: userApiKeys.maskedKey,
      preferredModel: userApiKeys.preferredModel,
    })
    .from(users)
    .leftJoin(userApiKeys, eq(users.id, userApiKeys.userId))
    .orderBy(desc(users.createdAt));

  // Get trial message counts per user
  const trialCounts = await db
    .select({
      userId: messageUsage.userId,
      count: count(),
    })
    .from(messageUsage)
    .where(eq(messageUsage.keyType, "trial"))
    .groupBy(messageUsage.userId);

  const countMap = new Map(trialCounts.map((r) => [r.userId, r.count]));

  const result = rows.map((u) => ({
    ...u,
    trialMessagesUsed: countMap.get(u.id) ?? 0,
    hasOwnKey: !!u.maskedKey,
  }));

  res.json({ users: result });
});

// ─── GET /api/admin/stats ─────────────────────────────────────────────────────
// Aggregate usage stats
router.get("/stats", async (_req, res) => {
  const [totalUsers] = await db.select({ count: count() }).from(users);
  const [totalMessages] = await db.select({ count: count() }).from(messageUsage);
  const [trialMessages] = await db
    .select({ count: count() })
    .from(messageUsage)
    .where(eq(messageUsage.keyType, "trial"));
  const [ownMessages] = await db
    .select({ count: count() })
    .from(messageUsage)
    .where(eq(messageUsage.keyType, "own"));
  const [totalTokens] = await db
    .select({ total: sum(messageUsage.totalTokens) })
    .from(messageUsage);
  const [usersWithOwnKey] = await db
    .select({ count: count() })
    .from(userApiKeys);

  // Daily message volume for the last 30 days
  const dailyVolume = await db
    .select({
      date: sql<string>`DATE(${messageUsage.createdAt})`,
      count: count(),
    })
    .from(messageUsage)
    .where(sql`${messageUsage.createdAt} >= NOW() - INTERVAL '30 days'`)
    .groupBy(sql`DATE(${messageUsage.createdAt})`)
    .orderBy(sql`DATE(${messageUsage.createdAt})`);

  res.json({
    totalUsers: totalUsers?.count ?? 0,
    totalMessages: totalMessages?.count ?? 0,
    trialMessages: trialMessages?.count ?? 0,
    ownKeyMessages: ownMessages?.count ?? 0,
    totalTokens: Number(totalTokens?.total ?? 0),
    usersWithOwnKey: usersWithOwnKey?.count ?? 0,
    dailyVolume,
  });
});

// ─── GET /api/admin/settings ──────────────────────────────────────────────────
router.get("/settings", async (_req, res) => {
  const rows = await db.select().from(systemSettings).orderBy(systemSettings.key);
  res.json({ settings: rows });
});

// ─── PATCH /api/admin/settings ────────────────────────────────────────────────
router.patch("/settings", async (req, res) => {
  const schema = z.object({
    key: z.string().min(1),
    value: z.string(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid input" });
    return;
  }
  await setSetting(parsed.data.key, parsed.data.value);
  invalidateCache(parsed.data.key);
  res.json({ success: true });
});

// ─── PATCH /api/admin/users/:id/suspend ───────────────────────────────────────
router.patch("/users/:id/suspend", async (req, res) => {
  const userId = parseInt(req.params.id ?? "0", 10);
  const schema = z.object({ suspended: z.boolean() });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success || !userId) {
    res.status(400).json({ error: "Invalid input" });
    return;
  }
  await db.update(users).set({ suspended: parsed.data.suspended }).where(eq(users.id, userId));
  res.json({ success: true });
});

// ─── DELETE /api/admin/users/:id ─────────────────────────────────────────────
router.delete("/users/:id", async (req, res) => {
  const userId = parseInt(req.params.id ?? "0", 10);
  if (!userId) {
    res.status(400).json({ error: "Invalid user ID" });
    return;
  }
  await db.delete(users).where(eq(users.id, userId));
  res.json({ success: true });
});

// ─── GET /api/admin/users/:id/usage ──────────────────────────────────────────
router.get("/users/:id/usage", async (req, res) => {
  const userId = parseInt(req.params.id ?? "0", 10);
  if (!userId) {
    res.status(400).json({ error: "Invalid user ID" });
    return;
  }

  const usage = await db
    .select()
    .from(messageUsage)
    .where(eq(messageUsage.userId, userId))
    .orderBy(desc(messageUsage.createdAt))
    .limit(100);

  res.json({ usage });
});

export default router;
