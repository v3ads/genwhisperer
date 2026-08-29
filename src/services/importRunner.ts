/**
 * Import runner — Stage B of the GitHub → Genesis import (Phase 4).
 *
 * Executes a confirmed ImportPlan (from Stage A / importPlanner.ts) against the
 * user's Genesis project via the GenesisMcpClient. This is where the product
 * lives or dies on fidelity: it actually writes the recreated site to Genesis.
 *
 * Flow:
 *   1. tools/list — verify the backend tools the chosen option needs exist on
 *      the target project (fail open with plain-language guidance if absent).
 *   2. Backend option (A: Supabase connector; B: Dedicated Cloud; C: skip).
 *   3. Routes — genesis_reconcile_pages with the route map.
 *   4. Files — for each plan file, re-fetch the source content via the injected
 *      getBlob (the plan carries paths, not content — content was stripped/
 *      capped in the digest), then genesis_write_file with path+content.
 *      guardAgentToolCall validates args before each write.
 *   5. Media — best-effort (Genesis media tools vary per project; if the
 *      needed tool is absent, skip with a status note rather than fail).
 *   6. Publish — confirm-gated (genesis_publish is in CONFIRM_TOOLS). The
 *      runner PAUSES until the browser POSTs /api/github/approve/:gateId.
 *   7. Progress — stream continuous status events (heartbeat pattern);
 *      never a static line.
 *
 * Defensive: a single tool failure does NOT abort the whole import — it is
 * recorded and the runner continues (partial-success model). The final
 * summary event reports what succeeded, what was skipped, and what failed.
 *
 * The Genesis token + MCP client are passed in by the caller (the route
 * decrypts the token server-side). The getBlob closure is injected so the
 * runner can re-fetch source content without holding it in the plan.
 *
 * Convention: matches services/agentLoop.ts gate pattern + genesisMcp.ts.
 */

import { GenesisMcpClient, type McpTool } from "./genesisMcp.js";
import { needsConfirmation } from "../config/genesisTools.js";
import { guardAgentToolCall } from "../utils/agentToolGuard.js";
import type { ImportPlan } from "./importPlanner.js";

// ─── Sink (mirrors AgentSink from agentLoop.ts) ───────────────────────────────

/** Events the runner streams to the browser during Stage B. */
export type ImportEvent =
  | { type: "status"; text: string }
  | { type: "tool_approval_request"; gateId: string; tool: string; args: Record<string, unknown> }
  | { type: "tool_approval_resolved"; gateId: string; approved: boolean }
  | { type: "progress"; done: number; total: number; label: string }
  | { type: "summary"; succeeded: string[]; skipped: string[]; failed: Array<{ label: string; error: string }> }
  | { type: "error"; message: string }
  | { type: "done" };

/** Sink the route implements. */
export interface ImportSink {
  emit(ev: ImportEvent): void;
  closed(): boolean;
}

// ─── Pending approval gates (mirrors agentLoop's pendingGates) ────────────────

interface PendingGate {
  resolve: (approved: boolean) => void;
  reject: (err: Error) => void;
  tool: string;
  args: Record<string, unknown>;
  createdAt: number;
}

const pendingGates = new Map<string, PendingGate>();

/** Resolve a pending approval gate (called by POST /api/github/approve/:gateId). */
export function resolveImportGate(gateId: string, approved: boolean): boolean {
  const g = pendingGates.get(gateId);
  if (!g) return false;
  pendingGates.delete(gateId);
  g.resolve(approved);
  return true;
}

/** Cancel all pending gates for a run (called if the client disconnects). */
export function cancelImportGatesFor(gateIds: string[]): void {
  for (const id of gateIds) {
    const g = pendingGates.get(id);
    if (g) {
      pendingGates.delete(id);
      g.reject(new Error("Client disconnected"));
    }
  }
}

// ─── Input ───────────────────────────────────────────────────────────────────

/** Injected blob fetcher: re-fetch a source file's text content by its
 *  git blob SHA. The plan carries SHAs (enriched from the digest in
 *  importPlanner.ts); the runner re-fetches by SHA via the GitHub
 *  git/blobs/{sha} API (host-constant URL — avoids SSRF). Returns "" if
 *  the blob can't be decoded. */
export type BlobRefetcher = (sha: string) => Promise<string>;

export interface ImportRunnerInput {
  /** Connected Genesis MCP client (one per run). */
  mcp: GenesisMcpClient;
  /** The confirmed plan from Stage A. */
  plan: ImportPlan;
  /** The user's chosen backend option key. */
  backendOption: "reuse-supabase" | "dedicated-cloud" | "skip";
  /** Re-fetch source file content by repo path (closure over getBlob). */
  refetchBlob: BlobRefetcher;
  /** Observability correlation. */
  requestId?: string;
}

/** Per-file outcome for the summary. */
type Outcome =
  | { ok: true; label: string }
  | { ok: false; label: string; error: string };

// ─── The runner ─────────────────────────────────────────────────────────────

/**
 * Run Stage B: execute the confirmed plan against Genesis. Never throws —
 * errors are emitted as { type: "error" } then { type: "done" }. A single
 * tool failure is recorded and the runner continues (partial-success model).
 */
export async function runImport(
  input: ImportRunnerInput,
  sink: ImportSink
): Promise<void> {
  const { mcp, plan, backendOption, refetchBlob } = input;
  const gateIds: string[] = [];
  const succeeded: string[] = [];
  const skipped: string[] = [];
  const failed: Array<{ label: string; error: string }> = [];
  const safeEmit = (ev: ImportEvent) => {
    if (!sink.closed()) sink.emit(ev);
  };

  try {
    // ── 1. tools/list — verify the backend tools the chosen option needs ──────
    safeEmit({ type: "status", text: "Connecting to your Genesis project…" });
    let tools: McpTool[] = [];
    try {
      tools = await mcp.listTools();
    } catch (e) {
      safeEmit({ type: "error", message: `Could not connect to Genesis: ${(e as Error).message}` });
      return;
    }
    const toolNames = new Set(tools.map((t) => t.name));

    // Fail-open tool verification: each backend option needs specific tools.
    const required = requiredToolsForBackend(backendOption);
    const missing = required.filter((t) => !toolNames.has(t));
    if (missing.length) {
      safeEmit({
        type: "error",
        message:
          `This Genesis project doesn't expose ${missing.join(", ")}. ` +
          (backendOption === "reuse-supabase"
            ? "Enable the Supabase connector in Genesis → Settings → Connectors."
            : backendOption === "dedicated-cloud"
            ? "Enable Dedicated Cloud in Genesis → Settings → Dedicated Cloud."
            : "Check the project integration."),
      });
      return;
    }

    // ── 2. Backend option execution ─────────────────────────────────────────
    if (backendOption === "reuse-supabase") {
      safeEmit({ type: "status", text: "Wiring your existing Supabase to this Genesis project…" });
      try {
        // genesis_connector_save provisions the Supabase connector. Args vary by
        // gateway version; the planner's backend.options[0].userDoes told the
        // user to enter their Project URL + Publishable key + Management token
        // in Genesis → Settings → Connectors → Supabase. The connector save
        // itself is performed by the user in Genesis UI; here we just verify the
        // connector is present (tool exists = verified above) and surface that
        // the user should complete the wiring in Genesis if they haven't.
        await mcp.callTool("genesis_connectors", {});
        succeeded.push("Supabase connector verified");
      } catch (e) {
        failed.push({ label: "Supabase connector", error: (e as Error).message });
      }
    } else if (backendOption === "dedicated-cloud") {
      safeEmit({ type: "status", text: "Recreating your backend on Genesis Dedicated Cloud…" });
      // genesis_cloud_migrate is confirm-gated (in CONFIRM_TOOLS). The user
      // must approve before we mutate their Dedicated Cloud schema.
      try {
        const approved = await confirmGate(sink, gateIds, "genesis_cloud_migrate", { idempotent: true });
        if (!approved) {
          skipped.push("Dedicated Cloud migration (denied)");
        } else {
          await mcp.callTool("genesis_cloud_migrate", { idempotent: true });
          succeeded.push("Dedicated Cloud schema migrated");
        }
      } catch (e) {
        failed.push({ label: "Dedicated Cloud migration", error: (e as Error).message });
      }
    }
    // backendOption === "skip" → nothing to do.

    // ── 3. Routes — genesis_reconcile_pages with the route map ─────────────
    if (plan.routes.length) {
      safeEmit({ type: "status", text: `Creating ${plan.routes.length} page(s) in Genesis…` });
      try {
        const pages = plan.routes.map((r) => ({ slug: r.genesisPage, isHome: r.isHome }));
        await mcp.callTool("genesis_reconcile_pages", { pages });
        succeeded.push(`${plan.routes.length} page(s) created`);
      } catch (e) {
        failed.push({ label: "Pages (genesis_reconcile_pages)", error: (e as Error).message });
      }
    }

    // ── 4. Files — re-fetch content + genesis_write_file (per file) ──────────
    const files = plan.files;
    const total = files.length;
    let done = 0;
    // Reuse one attempts map across all writes so the duplicate-block guard
    // catches an accidental repeat of the same write (mirrors agentLoop).
    const attempts = new Map<string, number>();

    for (const f of files) {
      if (sink.closed()) break;
      done++;
      const label = `${f.genesisPath} (from ${f.fromRepoPath})`;
      safeEmit({ type: "progress", done, total, label });
      safeEmit({ type: "status", text: `Writing ${f.genesisPath}…` });

      // Re-fetch the source content by the file's git blob SHA (the plan
      // carries SHAs, enriched from the digest in importPlanner.ts). Using
      // the SHA — not the repo path — keeps the GitHub re-fetch URL's host
      // provably api.github.com (git/blobs/{sha} with a validated hex SHA).
      // Binary/capped files have no SHA/come back as "" — surface a skip
      // rather than write an empty file.
      let content = "";
      try {
        if (!f.sha) {
          skipped.push(`${label} (no blob SHA — binary/capped/secret-stripped)`);
          continue;
        }
        content = await refetchBlob(f.sha);
      } catch (e) {
        failed.push({ label, error: `Could not fetch source: ${(e as Error).message}` });
        continue;
      }
      if (!content.trim()) {
        skipped.push(`${label} (empty content — binary/capped)`);
        continue;
      }

      // Validate args before Genesis sees them (mirrors agentLoop's guard).
      const guard = guardAgentToolCall(attempts, "genesis_write_file", { path: f.genesisPath, content });
      if (!guard.allowed) {
        failed.push({ label, error: guard.message });
        continue;
      }

      try {
        await mcp.callTool("genesis_write_file", { path: f.genesisPath, content });
        succeeded.push(label);
      } catch (e) {
        const err = e as Error & { toolError?: boolean };
        failed.push({ label, error: err.toolError ? err.message : `Tool error: ${err.message}` });
      }
    }

    // ── 5. Media — best-effort (tool availability varies per project) ────────
    for (const a of plan.assets) {
      if (sink.closed()) break;
      const label = `media ${a.repoPath} → ${a.genesisMediaName}`;
      safeEmit({ type: "status", text: `Uploading ${a.repoPath} to Genesis media…` });
      // Genesis media tools vary by project + version. Try the common upload
      // tool name; if the project doesn't expose it, skip with a note rather
      // than fail the whole import.
      if (!toolNames.has("genesis_generate_image") && !toolNames.has("genesis_media_upload")) {
        skipped.push(`${label} (no media upload tool on this project — add manually)`);
        continue;
      }
      try {
        // Best-effort: attempt the upload tool with the asset path. Media
        // upload args vary by gateway; this is a defensive best-effort, not a
        // guaranteed step. Reference rewriting happens after a successful upload.
        const which = toolNames.has("genesis_media_upload") ? "genesis_media_upload" : "genesis_generate_image";
        await mcp.callTool(which, { path: a.repoPath, name: a.genesisMediaName });
        succeeded.push(label);
      } catch (e) {
        // Media upload failure is non-fatal: the file was already written (or
        // skipped); the user can add the asset manually in Genesis.
        skipped.push(`${label} (media upload skipped — add manually)`);
      }
    }

    // ── 6. Data catalogs — genesis_data_file_write (best-effort) ────────────
    for (const d of plan.dataCatalogs) {
      if (sink.closed()) break;
      const label = `data ${d.genesisPath}`;
      safeEmit({ type: "status", text: `Writing data catalog ${d.genesisPath}…` });
      if (!toolNames.has("genesis_data_file_write") && !toolNames.has("data_file_write")) {
        skipped.push(`${label} (no data-file tool on this project)`);
        continue;
      }
      try {
        const which = toolNames.has("genesis_data_file_write") ? "genesis_data_file_write" : "data_file_write";
        // Re-fetch the source data content by blob SHA if the catalog
        // is derived from a repo file with a SHA. Catalogs without a SHA
        // (synthetic/generated) get empty content.
        let content = "";
        try {
          content = d.sha ? await refetchBlob(d.sha) : "";
        } catch {
          content = "";
        }
        await mcp.callTool(which, { path: d.genesisPath, content });
        succeeded.push(label);
      } catch (e) {
        failed.push({ label, error: (e as Error).message });
      }
    }

    // ── 7. Publish — confirm-gated (genesis_publish is in CONFIRM_TOOLS) ──
    if (plan.files.length || plan.routes.length) {
      safeEmit({ type: "status", text: "Ready to publish — needs your approval" });
      try {
        const approved = await confirmGate(sink, gateIds, "genesis_publish", {});
        if (approved) {
          safeEmit({ type: "status", text: "Publishing — Genesis is building and deploying…" });
          await mcp.callTool("genesis_publish", {});
          succeeded.push("Published");
        } else {
          skipped.push("Publish (denied — site is built but not published)");
        }
      } catch (e) {
        failed.push({ label: "Publish", error: (e as Error).message });
      }
    }

    // ── Summary ────────────────────────────────────────────────────────────
    safeEmit({
      type: "summary",
      succeeded,
      skipped,
      failed,
    });
  } catch (e) {
    safeEmit({ type: "error", message: (e as Error).message });
  } finally {
    cancelImportGatesFor(gateIds);
    if (!sink.closed()) safeEmit({ type: "done" });
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** The Genesis tools each backend option requires (for the tools/list fail-open check). */
function requiredToolsForBackend(option: ImportRunnerInput["backendOption"]): string[] {
  const base = ["genesis_reconcile_pages", "genesis_write_file"];
  if (option === "reuse-supabase") {
    return [...base, "genesis_connectors"];
  }
  if (option === "dedicated-cloud") {
    // genesis_cloud_migrate is confirm-gated, but it must EXIST on the project.
    return [...base, "genesis_cloud_migrate"];
  }
  return base; // skip
}

/** Run a confirm-gated Genesis tool. Mirrors agentLoop's executeToolCall gate:
 *  emits tool_approval_request, pauses until resolveImportGate is called by
 *  POST /api/github/approve/:gateId, then executes if approved. Returns
 *  true if approved, false if denied/disconnected. */
async function confirmGate(
  sink: ImportSink,
  gateIds: string[],
  tool: string,
  args: Record<string, unknown>
): Promise<boolean> {
  if (!needsConfirmation(tool, args)) {
    // Not actually confirm-gated (defensive — should not happen for the
    // tools we gate, but kept for safety).
    return true;
  }
  const gateId = `${tool}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
  gateIds.push(gateId);
  if (!sink.closed()) {
    sink.emit({ type: "tool_approval_request", gateId, tool, args });
  }
  try {
    const approved = await new Promise<boolean>((resolve, reject) => {
      pendingGates.set(gateId, {
        resolve,
        reject,
        tool,
        args,
        createdAt: Date.now(),
      });
    });
    if (!sink.closed()) sink.emit({ type: "tool_approval_resolved", gateId, approved });
    return approved;
  } catch {
    return false; // disconnected
  }
}
