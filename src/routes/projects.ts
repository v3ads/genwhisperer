/**
 * Projects routes (V2) — per-tenant Genesis projects.
 *
 * Each user connects one or more of their Genesis projects. For every project
 * they store: a human name, the MCP gateway URL
 * (https://genesis.estage.com/api/agent/<projectId>/mcp), and a fresh one-time
 * x-agent-token. The token is AES-256-GCM encrypted at rest (same crypto util
 * as the OpenRouter key) and validated via the MCP handshake before storing.
 *
 * The decrypted token is only ever returned to the server-side agent route
 * (never to the browser). List/get responses return the MASKED token only.
 */

import { Router } from "express";
import { eq } from "drizzle-orm";
import { db, genesisProjects } from "../db/index.js";
import { requireAuth, type AuthRequest } from "../middleware/auth.js";
import { encrypt, maskApiKey, decrypt } from "../utils/crypto.js";
import {
  GenesisMcpClient,
  parseGenesisProjectId,
  validateGenesisConnection,
} from "../services/genesisMcp.js";
import { canAddProject, getTierState } from "../services/billing.js";
import { z } from "zod";

const router: ReturnType<typeof Router> = Router();

// A project row in list responses (token masked, never decrypted).
interface ProjectListRow {
  id: number;
  name: string;
  genesisProjectId: string | null;
  mcpUrl: string;
  tokenMasked: string;
  lastUsedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

// ─── GET /api/projects ─────────────────────────────────────────────────────────
// List the user's Genesis projects (masked tokens only).
router.get("/", requireAuth, async (req: AuthRequest, res) => {
  const userId = req.user!.id;
  const rows = await db
    .select()
    .from(genesisProjects)
    .where(eq(genesisProjects.userId, userId));
  const list: ProjectListRow[] = rows.map((r) => ({
    id: r.id,
    name: r.name,
    genesisProjectId: r.genesisProjectId,
    mcpUrl: r.mcpUrl,
    tokenMasked: r.tokenMasked,
    lastUsedAt: r.lastUsedAt ? r.lastUsedAt.toISOString() : null,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  }));
  res.json({ projects: list });
});

// ─── POST /api/projects ────────────────────────────────────────────────────────
// Add a Genesis project. Validates the MCP URL shape + runs the handshake +
// tools/list before storing (mirrors v1's validate-before-save for keys).
router.post("/", requireAuth, async (req: AuthRequest, res) => {
  const schema = z.object({
    name: z.string().min(1).max(120),
    mcpUrl: z
      .string()
      .url()
      .refine((u) => /\/api\/agent\/[^/]+\/mcp/.test(u), {
        message:
          "MCP URL should look like https://genesis.estage.com/api/agent/<projectId>/mcp",
      }),
    token: z.string().min(8, "Token is too short"),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.errors[0]?.message ?? "Invalid input" });
    return;
  }

  const userId = req.user!.id;
  const { name, mcpUrl, token } = parsed.data;
  const genesisProjectId = parseGenesisProjectId(mcpUrl);

  // Tier gate: enforce the per-tier project-count limit (trial=1, starter=2, pro=∞).
  const allowed = await canAddProject(userId);
  if (!allowed.ok) {
    const state = await getTierState(userId);
    const limit = allowed.maxProjects;
    res.status(402).json({
      error: `Your plan allows ${limit === 1 ? "1 project" : `${limit} projects`}. Upgrade to add more.`,
      tier: state.tier,
      maxProjects: limit,
      current: allowed.current,
    });
    return;
  }

  // Validate the connection (handshake + tools/list) before storing.
  let toolCount = 0;
  try {
    const { tools } = await validateGenesisConnection(mcpUrl, token);
    toolCount = tools.length;
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
    return;
  }

  const tokenEncrypted = encrypt(token);
  const tokenMasked = maskApiKey(token);
  const [row] = await db
    .insert(genesisProjects)
    .values({
      userId,
      name,
      genesisProjectId,
      mcpUrl,
      tokenEncrypted,
      tokenMasked,
    })
    .returning({ id: genesisProjects.id });

  res.json({
    success: true,
    id: row!.id,
    name,
    genesisProjectId,
    mcpUrl,
    tokenMasked,
    toolCount,
  });
});

// ─── PATCH /api/projects/:id ───────────────────────────────────────────────────
// Update a project's name and/or token (re-validates a new token). The MCP
// URL is editable only if a new token is also provided (URL+token are paired).
router.patch("/:id", requireAuth, async (req: AuthRequest, res) => {
  const id = parseInt(String(req.params.id), 10);
  if (Number.isNaN(id)) {
    res.status(400).json({ error: "Invalid project id" });
    return;
  }
  const schema = z.object({
    name: z.string().min(1).max(120).optional(),
    token: z.string().min(8).optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.errors[0]?.message ?? "Invalid input" });
    return;
  }

  const userId = req.user!.id;
  const existing = await db
    .select()
    .from(genesisProjects)
    .where(eq(genesisProjects.id, id))
    .limit(1);
  if (!existing.length || existing[0].userId !== userId) {
    res.status(404).json({ error: "Project not found" });
    return;
  }
  const cur = existing[0];

  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (parsed.data.name) updates.name = parsed.data.name;
  if (parsed.data.token) {
    // Re-validate a new token against the existing MCP URL.
    try {
      await validateGenesisConnection(cur.mcpUrl, parsed.data.token);
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
      return;
    }
    updates.tokenEncrypted = encrypt(parsed.data.token);
    updates.tokenMasked = maskApiKey(parsed.data.token);
  }

  await db.update(genesisProjects).set(updates).where(eq(genesisProjects.id, id));
  res.json({ success: true });
});

// ─── DELETE /api/projects/:id ──────────────────────────────────────────────────
// Remove a project (cascades to its conversations).
router.delete("/:id", requireAuth, async (req: AuthRequest, res) => {
  const id = parseInt(String(req.params.id), 10);
  if (Number.isNaN(id)) {
    res.status(400).json({ error: "Invalid project id" });
    return;
  }
  const userId = req.user!.id;
  const existing = await db
    .select()
    .from(genesisProjects)
    .where(eq(genesisProjects.id, id))
    .limit(1);
  if (!existing.length || existing[0].userId !== userId) {
    res.status(404).json({ error: "Project not found" });
    return;
  }
  await db.delete(genesisProjects).where(eq(genesisProjects.id, id));
  res.json({ success: true });
});

// ─── GET /api/projects/:id/pages-count ─────────────────────────────────────────
// First-load guard for the Builder: reports whether the linked Genesis project
// has any pages yet. The frontend uses this to block the builder with an
// instructional modal when the project is empty (zero pages) — there is nothing
// to build on until the user creates a page in Genesis.
//
// The Genesis token is encrypted at rest and must never reach the browser, so
// this route decrypts it server-side and calls the Genesis MCP `genesis_pages`
// tool via the same GenesisMcpClient the agent loop uses.
//
// FAIL-OPEN CONTRACT: on ANY error (auth failure, network error, unexpected
// response shape, parse failure), the route returns 200 with ok:false and
// pageCount:null. The frontend treats a non-null pageCount===0 as the only
// condition that shows the blocking modal — a transient API failure must never
// lock a user out of a project that actually has pages.
router.get("/:id/pages-count", requireAuth, async (req: AuthRequest, res) => {
  const id = parseInt(String(req.params.id), 10);
  if (Number.isNaN(id)) {
    res.status(400).json({ error: "Invalid project id" });
    return;
  }
  const userId = req.user!.id;

  const rows = await db
    .select()
    .from(genesisProjects)
    .where(eq(genesisProjects.id, id))
    .limit(1);
  if (!rows.length || rows[0].userId !== userId) {
    res.status(404).json({ error: "Project not found" });
    return;
  }
  const project = rows[0];

  // Fail-open envelope for any transient/unexpected failure.
  const failOpen = () => res.json({ ok: false, pageCount: null, hasPages: null });

  let token: string;
  try {
    token = decrypt(project.tokenEncrypted);
  } catch {
    return failOpen();
  }

  try {
    const client = new GenesisMcpClient(project.mcpUrl, token);
    const result = await client.callTool("genesis_pages", {});
    const text = (result?.text || "").trim();

    // genesis_pages returns its page list as text content. Try to parse it as
    // JSON and count items; accept both a bare array and an envelope shaped
    // like { pages: [...] } or { items: [...] }.
    let count: number | null = null;
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) {
        count = parsed.length;
      } else if (parsed && typeof parsed === "object") {
        const arr =
          (parsed as { pages?: unknown[] }).pages ||
          (parsed as { items?: unknown[] }).items ||
          (parsed as { data?: unknown[] }).data;
        if (Array.isArray(arr)) count = arr.length;
      }
    } catch {
      /* not JSON — fall through to fail-open */
    }

    if (count === null) {
      // Couldn't determine the page count from the response. Fail open rather
      // than risk blocking a project that actually has pages.
      return failOpen();
    }
    res.json({ ok: true, pageCount: count, hasPages: count > 0 });
  } catch {
    // Auth failure, network error, gateway 5xx, timeout — all fail open.
    return failOpen();
  }
});

export default router;
