import { Router } from "express";
import { eq, count, and } from "drizzle-orm";
import axios from "axios";
import { db, users, userApiKeys, messageUsage } from "../db/index.js";
import { requireAuth, type AuthRequest } from "../middleware/auth.js";
import { decrypt } from "../utils/crypto.js";
import { getTrialCap, getDefaultModel, getSystemPrompt } from "../services/settings.js";
import { notifyTrialExhausted } from "../services/brevo.js";
import { logSessionToAITable } from "../services/aitable.js";
import { z } from "zod";
import type { Response } from "express";

const router = Router();
const OPENROUTER_API = "https://openrouter.ai/api/v1";

// ─── GET /api/chat/status ─────────────────────────────────────────────────────
// Returns the user's trial status, message count, and whether they have their own key
router.get("/status", requireAuth, async (req: AuthRequest, res) => {
  const userId = req.user!.id;

  const [trialCount, ownKeyRows, cap] = await Promise.all([
    db
      .select({ count: count() })
      .from(messageUsage)
      .where(and(eq(messageUsage.userId, userId), eq(messageUsage.keyType, "trial"))),
    db.select().from(userApiKeys).where(eq(userApiKeys.userId, userId)).limit(1),
    getTrialCap(),
  ]);

  const usedTrial = trialCount[0]?.count ?? 0;
  const hasOwnKey = ownKeyRows.length > 0;
  const ownKey = ownKeyRows[0];
  const isAdmin = req.user!.role === "admin";

  res.json({
    trialMessagesUsed: usedTrial,
    trialMessageCap: cap,
    // Admins are never considered trial-exhausted
    trialExhausted: isAdmin ? false : usedTrial >= cap,
    hasOwnKey,
    maskedKey: hasOwnKey ? ownKey!.maskedKey : null,
    preferredModel: hasOwnKey ? ownKey!.preferredModel : await getDefaultModel(),
    isAdmin,
  });
});

// ─── POST /api/chat/message ───────────────────────────────────────────────────
// Proxy a chat message to OpenRouter (streaming SSE)
router.post("/message", requireAuth, async (req: AuthRequest, res: Response) => {
  const schema = z.object({
    messages: z.array(
      z.object({
        role: z.enum(["user", "assistant", "system"]),
        content: z.string(),
      })
    ),
    model: z.string().optional(),
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request body" });
    return;
  }

  const userId = req.user!.id;
  const { messages } = parsed.data;

  // Determine which key and model to use
  const ownKeyRows = await db.select().from(userApiKeys).where(eq(userApiKeys.userId, userId)).limit(1);
  const ownKey = ownKeyRows[0];

  let apiKey: string;
  let model: string;
  let keyType: "trial" | "own";
  // For capped trial users we reserve a usage row up front so the cap check and
  // the usage write are effectively atomic (closing the concurrent-request race)
  // and so a message still counts even if the client disconnects mid-stream.
  let reservedId: number | null = null;

  const isAdmin = req.user!.role === "admin";

  if (ownKey) {
    // User has their own key — use it
    apiKey = decrypt(ownKey.encryptedKey);
    model = parsed.data.model ?? ownKey.preferredModel;
    keyType = "own";
  } else if (isAdmin) {
    // Admin always uses the platform key with no cap
    apiKey = process.env.OPENROUTER_PLATFORM_KEY!;
    model = await getDefaultModel();
    keyType = "trial"; // logged as trial so usage is still tracked
  } else {
    // Trial flow — check cap
    const cap = await getTrialCap();
    const [trialCount] = await db
      .select({ count: count() })
      .from(messageUsage)
      .where(and(eq(messageUsage.userId, userId), eq(messageUsage.keyType, "trial")));

    const used = trialCount?.count ?? 0;
    if (used >= cap) {
      res.status(402).json({
        error: "trial_exhausted",
        message: `You've used all ${cap} free messages. Add your own OpenRouter API key to continue.`,
        trialMessagesUsed: used,
        trialMessageCap: cap,
      });
      return;
    }

    apiKey = process.env.OPENROUTER_PLATFORM_KEY!;
    model = await getDefaultModel();
    keyType = "trial";

    // Reserve the trial slot immediately. This shrinks the check→write window
    // to a single round-trip and guarantees the message is counted; the row is
    // refunded below if the upstream call fails before any tokens stream back.
    const [reserved] = await db
      .insert(messageUsage)
      .values({ userId, model, keyType: "trial", promptTokens: 0, completionTokens: 0, totalTokens: 0 })
      .returning({ id: messageUsage.id });
    reservedId = reserved?.id ?? null;
  }

  // Prepend system prompt
  const fullMessages = [
    { role: "system" as const, content: await getSystemPrompt() },
    ...messages,
  ];

  // Stream response from OpenRouter
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  let finished = false;
  let receivedAny = false;
  let promptTokens = 0;
  let completionTokens = 0;
  // Buffer the assistant's response text so we can log it to AITable after streaming
  let assistantResponseText = "";

  // Release a reserved trial slot when the request fails before producing output,
  // so a failed call never consumes one of the user's free messages.
  const refundReservation = () => {
    if (reservedId !== null) {
      const id = reservedId;
      reservedId = null;
      db.delete(messageUsage).where(eq(messageUsage.id, id)).catch(console.error);
    }
  };

  // Handle client disconnect
  res.on("close", () => {
    finished = true;
  });

  try {
    const response = await axios.post(
      `${OPENROUTER_API}/chat/completions`,
      {
        model,
        messages: fullMessages,
        stream: true,
        max_tokens: 1024,
        // Required for OpenRouter to emit a final usage chunk on a streamed response.
        stream_options: { include_usage: true },
      },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": process.env.APP_URL ?? "https://genwhisperer.com",
          "X-Title": "GenWhisperer",
        },
        responseType: "stream",
        timeout: 120_000,
      }
    );

    const stream = response.data as NodeJS.ReadableStream;
    let buffer = "";

    stream.on("data", (chunk: Buffer) => {
      if (finished) return;
      buffer += chunk.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed === "data: [DONE]") {
          if (trimmed === "data: [DONE]") {
            res.write("data: [DONE]\n\n");
          }
          continue;
        }
        if (trimmed.startsWith("data: ")) {
          receivedAny = true;
          try {
            const json = JSON.parse(trimmed.slice(6));
            // Track token usage from final chunk
            if (json.usage) {
              promptTokens = json.usage.prompt_tokens ?? 0;
              completionTokens = json.usage.completion_tokens ?? 0;
            }
            // Accumulate assistant response text for AITable logging
            const delta = json.choices?.[0]?.delta?.content;
            if (typeof delta === "string") {
              assistantResponseText += delta;
            }
            res.write(`${trimmed}\n\n`);
          } catch {
            res.write(`${trimmed}\n\n`);
          }
        }
      }
    });

    stream.on("end", async () => {
      if (finished) return;
      finished = true;
      res.end();

      // Log usage (non-blocking). Trial messages have a pre-reserved row that we
      // update with the final token counts; everything else inserts a fresh row.
      const total = promptTokens + completionTokens;
      if (reservedId !== null) {
        db.update(messageUsage)
          .set({ promptTokens, completionTokens, totalTokens: total })
          .where(eq(messageUsage.id, reservedId))
          .catch(console.error);
      } else {
        db.insert(messageUsage)
          .values({ userId, model, keyType, promptTokens, completionTokens, totalTokens: total })
          .catch(console.error);
      }

      // Log session to AITable (non-blocking, fire-and-forget)
      if (assistantResponseText) {
        logSessionToAITable(req.user!.email, messages, assistantResponseText, model);
      }

      // Notify owner if trial just exhausted
      if (keyType === "trial") {
        const cap = await getTrialCap();
        const [trialCount] = await db
          .select({ count: count() })
          .from(messageUsage)
          .where(and(eq(messageUsage.userId, userId), eq(messageUsage.keyType, "trial")));
        const used = trialCount?.count ?? 0;
        if (used >= cap) {
          notifyTrialExhausted(req.user!.email, used).catch(console.error);
        }
      }
    });

    stream.on("error", (err: Error) => {
      if (!finished) {
        finished = true;
        // If the stream died before any output, don't charge the user.
        if (!receivedAny) refundReservation();
        res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
        res.end();
      }
    });
  } catch (err: any) {
    // The upstream request failed before streaming any tokens — refund the slot.
    refundReservation();
    if (!finished) {
      finished = true;
      const message = err?.response?.data?.error?.message ?? err.message ?? "OpenRouter error";
      res.write(`data: ${JSON.stringify({ error: message })}\n\n`);
      res.end();
    }
  }
});

// ─── GET /api/chat/models ─────────────────────────────────────────────────────
// List available OpenRouter models (uses platform key)
router.get("/models", requireAuth, async (_req, res) => {
  try {
    const { data } = await axios.get(`${OPENROUTER_API}/models`, {
      headers: { Authorization: `Bearer ${process.env.OPENROUTER_PLATFORM_KEY}` },
      timeout: 15_000,
    });
    res.json({ models: data.data });
  } catch {
    res.status(500).json({ error: "Failed to fetch models" });
  }
});

export default router;
