/**
 * Admin routes (V2) — owner dashboard for the admin account.
 *
 *   GET  /api/admin/users                       All users + project/conversation counts
 *   GET  /api/admin/users/:id/projects          A user's Genesis projects (masked tokens)
 *   GET  /api/admin/users/:id/conversations     A user's conversations
 *   GET  /api/admin/conversations/:id           Any conversation's full message history (admin override)
 *   GET  /api/admin/usage                      Per-tenant usage/cost rollup (by user, by model)
 *   GET  /api/admin/usage/:userId              A single user's usage/cost (by model, recent)
 *   PATCH /api/admin/users/:id/suspend          Suspend/unsuspend a user
 *   DELETE /api/admin/users/:id                 Delete a user (cascades to projects/conversations)
 *
 * All routes require requireAuth + requireAdmin. The admin is auto-promoted
 * by ADMIN_EMAIL on sign-in (kept from v1).
 */

import { Router } from "express";
import { eq, desc, count, sum, and, gte } from "drizzle-orm";
import {
  db,
  users,
  genesisProjects,
  conversations,
  messages,
} from "../db/index.js";
import { requireAuth, requireAdmin, type AuthRequest } from "../middleware/auth.js";
import { loadHistory } from "../services/history.js";

const router = Router();
router.use(requireAuth, requireAdmin);

// ─── GET /api/admin/users ─────────────────────────────────────────────────────
// All users with project + conversation counts, most-recent first.
router.get("/users", async (_req: AuthRequest, res) => {
  const allUsers = await db.select().from(users).orderBy(desc(users.createdAt));

  // Aggregate counts in one pass each (small tables; fine without a join).
  const [projCounts, convCounts] = await Promise.all([
    db.select({ userId: genesisProjects.userId, n: count() }).from(genesisProjects).groupBy(genesisProjects.userId),
    db.select({ userId: conversations.userId, n: count() }).from(conversations).groupBy(conversations.userId),
  ]);
  const pMap = new Map(projCounts.map((r) => [r.userId, Number(r.n)]));
  const cMap = new Map(convCounts.map((r) => [r.userId, Number(r.n)]));

  res.json({
    users: allUsers.map((u) => ({
      id: u.id,
      email: u.email,
      role: u.role,
      suspended: u.suspended,
      createdAt: u.createdAt.toISOString(),
      lastSignedIn: u.lastSignedIn ? u.lastSignedIn.toISOString() : null,
      projectCount: pMap.get(u.id) ?? 0,
      conversationCount: cMap.get(u.id) ?? 0,
    })),
  });
});

// ─── GET /api/admin/users/:id/projects ────────────────────────────────────────
// A specific user's Genesis projects (masked tokens — admin never sees the
// decrypted token either; that's server-runtime-only).
router.get("/users/:id/projects", async (req: AuthRequest, res) => {
  const id = parseInt(String(req.params.id), 10);
  if (Number.isNaN(id)) { res.status(400).json({ error: "Invalid user id" }); return; }
  const rows = await db.select().from(genesisProjects).where(eq(genesisProjects.userId, id));
  res.json({
    projects: rows.map((p) => ({
      id: p.id,
      name: p.name,
      genesisProjectId: p.genesisProjectId,
      mcpUrl: p.mcpUrl,
      tokenMasked: p.tokenMasked,
      lastUsedAt: p.lastUsedAt ? p.lastUsedAt.toISOString() : null,
      createdAt: p.createdAt.toISOString(),
    })),
  });
});

// ─── GET /api/admin/users/:id/conversations ───────────────────────────────────
// A specific user's conversations (most-recent first).
router.get("/users/:id/conversations", async (req: AuthRequest, res) => {
  const id = parseInt(String(req.params.id), 10);
  if (Number.isNaN(id)) { res.status(400).json({ error: "Invalid user id" }); return; }
  const rows = await db
    .select()
    .from(conversations)
    .where(eq(conversations.userId, id))
    .orderBy(desc(conversations.updatedAt));
  res.json({
    conversations: rows.map((c) => ({
      id: c.id,
      genesisProjectId: c.genesisProjectId,
      title: c.title,
      model: c.model,
      createdAt: c.createdAt.toISOString(),
      updatedAt: c.updatedAt.toISOString(),
    })),
  });
});

// ─── GET /api/admin/conversations/:id ─────────────────────────────────────────
// Any conversation's full message history (admin can read any user's
// conversations — no ownership check, unlike the /api/agent endpoint).
router.get("/conversations/:id", async (req: AuthRequest, res) => {
  const id = parseInt(String(req.params.id), 10);
  if (Number.isNaN(id)) { res.status(400).json({ error: "Invalid conversation id" }); return; }
  // Verify the conversation exists + pull its header (join to get the owner).
  const convRows = await db
    .select({
      id: conversations.id,
      userId: conversations.userId,
      genesisProjectId: conversations.genesisProjectId,
      title: conversations.title,
      model: conversations.model,
    })
    .from(conversations)
    .where(eq(conversations.id, id))
    .limit(1);
  if (!convRows.length) { res.status(404).json({ error: "Conversation not found" }); return; }
  const conv = convRows[0];
  const history = await loadHistory(id);
  res.json({
    conversation: {
      id: conv.id,
      userId: conv.userId,
      genesisProjectId: conv.genesisProjectId,
      title: conv.title,
      model: conv.model,
    },
    messages: history.map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      toolCalls: m.toolCalls,
      promptTokens: m.promptTokens,
      completionTokens: m.completionTokens,
      costUsd: m.costUsd,
      createdAt: m.createdAt.toISOString(),
    })),
  });
});

// ─── PATCH /api/admin/users/:id/suspend ───────────────────────────────────────
// Suspend or unsuspend a user. Suspended users are blocked at requireAuth.
router.patch("/users/:id/suspend", async (req: AuthRequest, res) => {
  const id = parseInt(String(req.params.id), 10);
  if (Number.isNaN(id)) { res.status(400).json({ error: "Invalid user id" }); return; }
  const suspended = req.body?.suspended === true;
  if (id === req.user!.id) {
    res.status(400).json({ error: "You cannot suspend your own admin account." });
    return;
  }
  await db.update(users).set({ suspended, updatedAt: new Date() }).where(eq(users.id, id));
  res.json({ success: true, suspended });
});

// ─── DELETE /api/admin/users/:id ──────────────────────────────────────────────
// Delete a user (cascades to genesis_projects, conversations, messages,
// user_api_keys, message_usage). Guard against self-delete.
router.delete("/users/:id", async (req: AuthRequest, res) => {
  const id = parseInt(String(req.params.id), 10);
  if (Number.isNaN(id)) { res.status(400).json({ error: "Invalid user id" }); return; }
  if (id === req.user!.id) {
    res.status(400).json({ error: "You cannot delete your own admin account." });
    return;
  }
  await db.delete(users).where(eq(users.id, id));
  res.json({ success: true });
});

// ─── GET /api/admin/usage ──────────────────────────────────────────────────────
// Per-tenant usage/cost rollup. Aggregates messages.cost_usd + tokens per user
// (messages join conversations → users for email), optional ?days=N window (default 30).
router.get("/usage", async (req: AuthRequest, res) => {
  const days = Math.min(Math.max(parseInt(String(req.query.days ?? "30"), 10) || 30, 1), 365);
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  // Per-user totals: messages → conversations → users (owner email).
  const perUser = await db
    .select({
      userId: conversations.userId,
      email: users.email,
      turns: count(),
      promptTokens: sum(messages.promptTokens),
      completionTokens: sum(messages.completionTokens),
      costUsd: sum(messages.costUsd),
    })
    .from(messages)
    .innerJoin(conversations, eq(messages.conversationId, conversations.id))
    .innerJoin(users, eq(conversations.userId, users.id))
    .where(gte(messages.createdAt, since))
    .groupBy(conversations.userId, users.email)
    .orderBy(desc(sum(messages.costUsd)));

  // Per-model totals (which models are burning the cost). model lives on conversations.
  const perModel = await db
    .select({
      model: conversations.model,
      turns: count(),
      costUsd: sum(messages.costUsd),
    })
    .from(messages)
    .innerJoin(conversations, eq(messages.conversationId, conversations.id))
    .where(gte(messages.createdAt, since))
    .groupBy(conversations.model)
    .orderBy(desc(sum(messages.costUsd)));

  const totalCost = perUser.reduce((a, r) => a + Number(r.costUsd ?? 0), 0);
  const totalTurns = perUser.reduce((a, r) => a + Number(r.turns ?? 0), 0);

  res.json({
    days,
    since: since.toISOString(),
    totalTurns,
    totalCostUsd: totalCost,
    perUser: perUser.map((r) => ({
      userId: r.userId,
      email: r.email,
      turns: Number(r.turns ?? 0),
      promptTokens: Number(r.promptTokens ?? 0),
      completionTokens: Number(r.completionTokens ?? 0),
      costUsd: Number(r.costUsd ?? 0),
    })),
    perModel: perModel.map((r) => ({
      model: r.model,
      turns: Number(r.turns ?? 0),
      costUsd: Number(r.costUsd ?? 0),
    })),
  });
});

// ─── GET /api/admin/usage/:userId ──────────────────────────────────────────────
// A single user's usage/cost (by model, recent turns first), optional ?days=N.
// Joins messages → conversations to scope by user.
router.get("/usage/:userId", async (req: AuthRequest, res) => {
  const userId = parseInt(String(req.params.userId), 10);
  if (Number.isNaN(userId)) { res.status(400).json({ error: "Invalid user id" }); return; }
  const days = Math.min(Math.max(parseInt(String(req.query.days ?? "30"), 10) || 30, 1), 365);
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const byModel = await db
    .select({ model: conversations.model, turns: count(), costUsd: sum(messages.costUsd) })
    .from(messages)
    .innerJoin(conversations, eq(messages.conversationId, conversations.id))
    .where(and(eq(conversations.userId, userId), gte(messages.createdAt, since)))
    .groupBy(conversations.model)
    .orderBy(desc(sum(messages.costUsd)));

  const recent = await db
    .select({
      id: messages.id,
      model: conversations.model,
      role: messages.role,
      costUsd: messages.costUsd,
      promptTokens: messages.promptTokens,
      completionTokens: messages.completionTokens,
      createdAt: messages.createdAt,
    })
    .from(messages)
    .innerJoin(conversations, eq(messages.conversationId, conversations.id))
    .where(and(eq(conversations.userId, userId), gte(messages.createdAt, since)))
    .orderBy(desc(messages.createdAt))
    .limit(50);

  const totalCost = byModel.reduce((a, r) => a + Number(r.costUsd ?? 0), 0);
  const totalTurns = byModel.reduce((a, r) => a + Number(r.turns ?? 0), 0);

  res.json({
    userId,
    days,
    since: since.toISOString(),
    totalTurns,
    totalCostUsd: totalCost,
    byModel: byModel.map((r) => ({
      model: r.model,
      turns: Number(r.turns ?? 0),
      costUsd: Number(r.costUsd ?? 0),
    })),
    recent: recent.map((r) => ({
      id: r.id,
      model: r.model,
      role: r.role,
      costUsd: Number(r.costUsd ?? 0),
      promptTokens: Number(r.promptTokens ?? 0),
      completionTokens: Number(r.completionTokens ?? 0),
      createdAt: r.createdAt.toISOString(),
    })),
  });
});

export default router;
