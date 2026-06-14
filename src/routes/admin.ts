import { Router } from "express";
import { eq, desc, count, sum, sql } from "drizzle-orm";
import axios from "axios";
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

  // Model usage breakdown
  const modelUsage = await db
    .select({
      model: messageUsage.model,
      count: count(),
    })
    .from(messageUsage)
    .groupBy(messageUsage.model)
    .orderBy(desc(count()));

  const ownKeyCount = usersWithOwnKey?.count ?? 0;
  const trialUsers = (totalUsers?.count ?? 0) - ownKeyCount;

  res.json({
    totalUsers: totalUsers?.count ?? 0,
    totalMessages: totalMessages?.count ?? 0,
    trialMessages: trialMessages?.count ?? 0,
    ownKeyMessages: ownMessages?.count ?? 0,
    totalTokens: Number(totalTokens?.total ?? 0),
    usersWithOwnKey: ownKeyCount,
    ownKeyUsers: ownKeyCount,
    trialUsers,
    dailyVolume,
    modelUsage,
  });
});

// ─── GET /api/admin/settings ──────────────────────────────────────────────────
router.get("/settings", async (_req, res) => {
  const rows = await db.select().from(systemSettings).orderBy(systemSettings.key);
  // Return as a flat key→value map for easy frontend consumption
  const settings: Record<string, string> = {};
  for (const row of rows) settings[row.key] = row.value;
  res.json({ settings });
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

// ─── PATCH /api/admin/users/:id/role ─────────────────────────────────────────
// Promote or demote a user's role
router.patch("/users/:id/role", async (req, res) => {
  const userId = parseInt(req.params.id ?? "0", 10);
  const schema = z.object({ role: z.enum(["user", "admin"]) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success || !userId) {
    res.status(400).json({ error: "Invalid input" });
    return;
  }
  await db.update(users).set({ role: parsed.data.role }).where(eq(users.id, userId));
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

// ─── GET /api/admin/getresponse/status ────────────────────────────────────────
// Test the GetResponse connection and return list info
router.get("/getresponse/status", async (_req, res) => {
  const apiKey = process.env.GETRESPONSE_API_KEY;
  if (!apiKey) {
    res.json({ connected: false, error: "GETRESPONSE_API_KEY not configured" });
    return;
  }

  try {
    const [{ data: account }, { data: campaigns }] = await Promise.all([
      axios.get("https://api.getresponse.com/v3/accounts", {
        headers: { "X-Auth-Token": `api-key ${apiKey}` },
        timeout: 10_000,
      }),
      axios.get("https://api.getresponse.com/v3/campaigns", {
        headers: { "X-Auth-Token": `api-key ${apiKey}` },
        timeout: 10_000,
      }),
    ]);

    const listId = process.env.GETRESPONSE_LIST_ID ?? "";
    let contactCount = 0;
    if (listId) {
      try {
        const { data: contacts } = await axios.get("https://api.getresponse.com/v3/contacts", {
          headers: { "X-Auth-Token": `api-key ${apiKey}` },
          params: { "query[campaignId]": listId, perPage: 100 },
          timeout: 10_000,
        });
        contactCount = Array.isArray(contacts) ? contacts.length : 0;
      } catch { /* non-fatal */ }
    }

    res.json({
      connected: true,
      accountName: account?.firstName
        ? `${account.firstName} ${account.lastName ?? ""}`.trim()
        : account?.email ?? "Unknown",
      email: account?.email ?? null,
      listId,
      listName: Array.isArray(campaigns)
        ? (campaigns.find((c: any) => c.campaignId === listId)?.name ?? null)
        : null,
      campaigns: Array.isArray(campaigns)
        ? campaigns.map((c: any) => ({ id: c.campaignId, name: c.name }))
        : [],
      contactCount,
    });
  } catch (err: any) {
    res.json({
      connected: false,
      error: err?.response?.data?.message ?? err.message ?? "Connection failed",
    });
  }
});

// ─── POST /api/admin/getresponse/test-subscribe ───────────────────────────────
// Send a test subscription to verify the list is working
router.post("/getresponse/test-subscribe", async (req, res) => {
  const schema = z.object({ email: z.string().email() });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid email" });
    return;
  }

  const apiKey = process.env.GETRESPONSE_API_KEY;
  const listId = process.env.GETRESPONSE_LIST_ID ?? "";
  if (!apiKey || !listId) {
    res.status(400).json({ error: "GetResponse not configured" });
    return;
  }

  try {
    await axios.post(
      "https://api.getresponse.com/v3/contacts",
      {
        email: parsed.data.email,
        name: "Test Subscriber",
        campaign: { campaignId: listId },
        ipAddress: "0.0.0.0",
      },
      {
        headers: {
          "X-Auth-Token": `api-key ${apiKey}`,
          "Content-Type": "application/json",
        },
        timeout: 10_000,
      }
    );
    res.json({ success: true });
  } catch (err: any) {
    if (err?.response?.status === 409) {
      res.json({ success: true, note: "Already subscribed" });
      return;
    }
    res.status(500).json({ error: err?.response?.data?.message ?? err.message });
  }
});

export default router;
