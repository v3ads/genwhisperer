/**
 * Agent routes (V2) — the server-side agent runtime surface.
 *
 *   POST /api/agent/message        Start/resume an agent turn (SSE stream).
 *   POST /api/agent/approve/:gateId  Approve or deny a pending write gate.
 *   GET  /api/agent/conversations    List the user's conversations.
 *   GET  /api/agent/conversations/:id  Load a conversation's history.
 *   DELETE /api/agent/conversations/:id  Delete a conversation.
 *   GET  /api/agent/kb-query         Standalone KB side-panel query.
 *   GET  /api/agent/kb-health        KB health check (lightweight status).
 *
 * The /message route decrypts the tenant's OpenRouter key + the selected
 * Genesis project's token (server-side only), hands them to runAgentLoop,
 * and streams the loop's events to the browser as SSE. Credentials never
 * reach the browser.
 */

import { Router } from "express";
import type { Response } from "express";
import { eq } from "drizzle-orm";
import { db, userApiKeys, genesisProjects } from "../db/index.js";
import { requireAuth, type AuthRequest } from "../middleware/auth.js";
import { decrypt } from "../utils/crypto.js";
import {
  runAgentLoop,
  resolveGate,
  type AgentEvent,
  type AgentSink,
} from "../services/agentLoop.js";
import { kbAsk, kbHealth } from "../services/estageKb.js";
import { DEFAULT_V2_MODEL } from "../config/systemPrompt.js";
import { getTierState, incrementTrialTurns } from "../services/billing.js";
import {
  listConversations,
  loadHistory,
  getConversation,
  deleteConversation,
} from "../services/history.js";
import { logSessionToAITable, type ChatMessage as AitableChatMessage } from "../services/aitable.js";
import { z } from "zod";

const router = Router();

// ─── POST /api/agent/message ───────────────────────────────────────────────────
// Start (or resume) an agent turn. Streams SSE events from the agent loop.
router.post("/message", requireAuth, async (req: AuthRequest, res: Response) => {
  const schema = z.object({
    genesisProjectId: z.number().int().positive(),
    conversationId: z.number().int().positive().optional(),
    message: z.string().min(1).max(8000),
    model: z.string().optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.errors[0]?.message ?? "Invalid input" });
    return;
  }

  const userId = req.user!.id;
  const { genesisProjectId, message, model } = parsed.data;
  const conversationId = parsed.data.conversationId ?? null;

  // ── Tier gate: lapsed users can't start turns; trial users hit the turn cap ──
  const tierState = await getTierState(userId);
  if (!tierState.canStartTurn) {
    res.status(402).json({
      error: tierState.statusLabel,
      tier: tierState.tier,
      trialTurnsUsed: tierState.trialTurnsUsed,
      trialTurnCap: tierState.trialTurnCap,
    });
    return;
  }

  // ── Load the OpenRouter key: platform key for trial, BYO key for paid ──────
  // Trial users run on the shared OPENROUTER_PLATFORM_KEY (bounded by the turn
  // cap). Paid users must have their own key stored (encrypted at rest).
  let openrouterKey: string;
  let chosenModel: string;
  if (tierState.usePlatformKey) {
    openrouterKey = process.env.OPENROUTER_PLATFORM_KEY ?? "";
    if (!openrouterKey) {
      res.status(500).json({ error: "Trial key not configured. Please contact support." });
      return;
    }
    chosenModel = model || DEFAULT_V2_MODEL;
  } else {
    const keyRows = await db
      .select()
      .from(userApiKeys)
      .where(eq(userApiKeys.userId, userId))
      .limit(1);
    if (!keyRows.length) {
      res
        .status(400)
        .json({ error: "No OpenRouter key saved. Add one in Profile first." });
      return;
    }
    openrouterKey = decrypt(keyRows[0].encryptedKey);
    chosenModel = model || keyRows[0].preferredModel || DEFAULT_V2_MODEL;
  }

  // ── Load + decrypt the selected Genesis project's token ──────────────────
  const projRows = await db
    .select()
    .from(genesisProjects)
    .where(eq(genesisProjects.id, genesisProjectId))
    .limit(1);
  if (!projRows.length || projRows[0].userId !== userId) {
    res.status(404).json({ error: "Genesis project not found" });
    return;
  }
  const project = projRows[0];
  const genesisToken = decrypt(project.tokenEncrypted);

  // If resuming, verify the conversation belongs to this user + project.
  if (conversationId) {
    const conv = await getConversation(conversationId, userId);
    if (!conv) {
      res.status(404).json({ error: "Conversation not found" });
      return;
    }
    if (conv.genesisProjectId !== genesisProjectId) {
      res.status(400).json({ error: "Conversation belongs to a different project." });
      return;
    }
  }

  // ── SSE headers (must not be compressed — see index.ts compression filter) ─
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  // ── Sink: writes each AgentEvent as an SSE `data:` line ───────────────────
  let closed = false;
  const sink: AgentSink = {
    emit(ev: AgentEvent) {
      if (closed) return;
      res.write(`data: ${JSON.stringify(ev)}\n\n`);
    },
    closed() {
      return closed;
    },
  };
  res.on("close", () => {
    closed = true;
  });

  // ── Run the loop ──────────────────────────────────────────────────────────
  const result = await runAgentLoop(
    {
      userId,
      conversationId,
      genesisProjectId,
      mcpUrl: project.mcpUrl,
      genesisToken,
      openrouterKey,
      model: chosenModel,
      userMessage: message,
    },
    sink
  );

  // ── Close-out: increment the trial turn counter (trial users only) ────────
  if (tierState.usePlatformKey) {
    try { await incrementTrialTurns(userId); } catch { /* non-fatal */ }
  }

  // ── Close-out: AITable session logging (fire-and-forget) ──────────────────
  // Mirrors v1's pattern — logSessionToAITable is already fire-and-forget
  // (void return; errors logged internally), so this never blocks.
  try {
    const aitableMessages: AitableChatMessage[] = [
      { role: "user", content: message },
    ];
    logSessionToAITable(
      req.user!.email,
      aitableMessages,
      result.finalAnswer,
      chosenModel
    );
  } catch {
    /* AITable logging is best-effort */
  }

  res.end();
});

// ─── POST /api/agent/approve/:gateId ───────────────────────────────────────────
// Resolve a pending write-confirmation gate (Approve/Deny from the browser).
router.post("/approve/:gateId", requireAuth, async (req: AuthRequest, res) => {
  const approved = req.body?.approved === true;
  const ok = resolveGate(String(req.params.gateId), approved);
  if (!ok) {
    res.status(404).json({ error: "No pending gate with that id (it may have expired)." });
    return;
  }
  res.json({ success: true, approved });
});

// ─── GET /api/agent/conversations ──────────────────────────────────────────────
// List the user's conversations, most-recent first.
router.get("/conversations", requireAuth, async (req: AuthRequest, res) => {
  const userId = req.user!.id;
  const list = await listConversations(userId);
  res.json({
    conversations: list.map((c) => ({
      id: c.id,
      genesisProjectId: c.genesisProjectId,
      title: c.title,
      model: c.model,
      createdAt: c.createdAt.toISOString(),
      updatedAt: c.updatedAt.toISOString(),
    })),
  });
});

// ─── GET /api/agent/conversations/:id ──────────────────────────────────────────
// Load a conversation's message history (for resume).
router.get("/conversations/:id", requireAuth, async (req: AuthRequest, res) => {
  const id = parseInt(String(req.params.id), 10);
  if (Number.isNaN(id)) {
    res.status(400).json({ error: "Invalid conversation id" });
    return;
  }
  const userId = req.user!.id;
  const conv = await getConversation(id, userId);
  if (!conv) {
    res.status(404).json({ error: "Conversation not found" });
    return;
  }
  const history = await loadHistory(id);
  res.json({
    conversation: {
      id: conv.id,
      genesisProjectId: conv.genesisProjectId,
      title: conv.title,
      model: conv.model,
    },
    messages: history.map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      toolCalls: m.toolCalls,
      costUsd: m.costUsd,
      createdAt: m.createdAt.toISOString(),
    })),
  });
});

// ─── DELETE /api/agent/conversations/:id ───────────────────────────────────────
// Delete a conversation (cascades to its messages).
router.delete("/conversations/:id", requireAuth, async (req: AuthRequest, res) => {
  const id = parseInt(String(req.params.id), 10);
  if (Number.isNaN(id)) {
    res.status(400).json({ error: "Invalid conversation id" });
    return;
  }
  const userId = req.user!.id;
  const conv = await getConversation(id, userId);
  if (!conv) {
    res.status(404).json({ error: "Conversation not found" });
    return;
  }
  await deleteConversation(id, userId);
  res.json({ success: true });
});

// ─── GET /api/agent/kb-query ───────────────────────────────────────────────────
// Standalone KB side-panel query (separate from the agent loop). Uses the
// shared server-side KB key.
router.get("/kb-query", requireAuth, async (req: AuthRequest, res) => {
  const question = typeof req.query.question === "string" ? req.query.question : "";
  if (!question.trim()) {
    res.status(400).json({ error: "Missing 'question' query parameter" });
    return;
  }
  try {
    const r = await kbAsk(question, { topK: 5 });
    res.json({
      answer: r.answer,
      sources: r.sources || [],
      responseTimeMs: r.response_time_ms,
    });
  } catch (e) {
    res.status(502).json({ error: (e as Error).message });
  }
});

// ─── GET /api/agent/kb-health ──────────────────────────────────────────────────
// Lightweight KB health check (public within auth).
router.get("/kb-health", requireAuth, async (_req, res) => {
  try {
    const h = await kbHealth();
    res.json(h);
  } catch (e) {
    res.status(502).json({ error: (e as Error).message });
  }
});

export default router;
