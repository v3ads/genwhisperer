/**
 * Import planner — Stage A of the GitHub → Genesis import (Phase 3).
 *
 * Takes a repo digest (from services/repoDigest.ts) and asks the model to
 * produce a structured TRANSLATION PLAN: how to recreate the repo as a
 * Genesis-native site (pages, files, media, data catalogs, backend options).
 * The plan is shown to the user for confirmation before Stage B executes it.
 *
 * This is the de-risk gate: we validate translation QUALITY here, on real
 * Lovable repos, before committing to Phase 4 execution.
 *
 * Design:
 *   - Single non-streaming OpenRouter `chat()` call (the plan is one structured
 *     JSON response; the SSE route emits progress events around it).
 *   - Genesis-aware system prompt — knows Genesis primitives (pages via
 *     genesis_reconcile_pages, files via genesis_write_file, media, data catalogs
 *     via genesis_data_files, backend via Dedicated Cloud / Supabase connector).
 *   - The digest is the user message (compact, bounded — see repoDigest.ts).
 *   - The model returns JSON. We parse it DEFENSIVELY and FAIL OPEN: if the
 *     shape is malformed, we return a plan with an `error` field + whatever we
 *     could salvage, rather than throwing — so the UI can tell the user "the
 *     plan didn't come back cleanly" instead of a 500.
 *
 * Uses the user's OWN OpenRouter key (paid users have one), consistent with the
 * free-turns model. Cost is on the user.
 *
 * Convention: matches services/openrouter.ts + repoDigest.ts — no external deps.
 */

import { chat, type ChatMessage } from "./openrouter.js";
import type { RepoDigest } from "./repoDigest.js";

// ─── Plan shape (the structured output we ask the model for) ───────────────────

/** A route → Genesis page mapping entry. */
export interface PlanRoute {
  /** Source route from the repo, e.g. "/" or "/about". */
  source: string;
  /** Genesis page slug to create, e.g. "/" or "/about". */
  genesisPage: string;
  /** Whether this is the home/index page. */
  isHome: boolean;
}

/** A file the planner wants written to Genesis via genesis_write_file. */
export interface PlanFile {
  /** Genesis destination path, e.g. "src/pages/About.tsx". */
  genesisPath: string;
  /** Source repo path it's translated from, for traceability. */
  fromRepoPath: string;
  /** Git blob SHA of the source file — used by Stage B to re-fetch content
   *  via the GitHub git/blobs/{sha} API (host-constant URL; avoids SSRF). */
  sha: string;
  /** Whether this file's content is generated/translated (true) or copied as-is. */
  translated: boolean;
  /** A short note on what this file is (for the review UI). */
  note: string;
}

/** A binary asset to upload to Genesis media + rewrite references. */
export interface PlanAsset {
  /** Source repo path, e.g. "public/logo.png". */
  repoPath: string;
  /** What it becomes in Genesis (media library entry). */
  genesisMediaName: string;
  /** Files whose references should be rewritten to point at the media URL. */
  rewriteIn: string[];
}

/** A data catalog entry (products/testimonials/etc. → genesis_data_files). */
export interface PlanDataCatalog {
  /** Genesis data file path, e.g. "src/data/products.json". */
  genesisPath: string;
  /** Source repo path or description it's derived from. */
  fromRepoPath: string;
  /** Git blob SHA of the source file (when derived from a repo file) — used by
   *  Stage B to re-fetch content via git/blobs/{sha} (host-constant URL; avoids SSRF).
   *  Empty string when the catalog is not derived from a single repo file. */
  sha: string;
  /** Short note for the review UI. */
  note: string;
}

/** The backend OPTIONS panel — presented to the user when backend deps detected. */
export interface BackendOptions {
  /** True when the planner detected backend deps (Supabase/edge functions). */
  detected: boolean;
  /** What was detected (e.g. "Supabase project + 2 edge functions"). */
  summary: string;
  /** The three options, each with concrete user setup steps. */
  options: BackendOption[];
}

/** One backend option (A/B/C) with concrete "what you do" steps. */
export interface BackendOption {
  key: "reuse-supabase" | "dedicated-cloud" | "skip";
  label: string;
  /** What GenWhisperer will do if the user picks this. */
  agentDoes: string;
  /** What the USER must do first (concrete steps). */
  userDoes: string;
  /** Recommended-when description. */
  recommendedWhen: string;
}

/** Anything Genesis genuinely can't represent. */
export interface PlanOutOfScope {
  description: string;
  reason: string;
}

/** The full translation plan. */
export interface ImportPlan {
  repo: { owner: string; name: string; branch: string };
  /** One-line summary of the repo (what kind of site it is). */
  summary: string;
  routes: PlanRoute[];
  files: PlanFile[];
  assets: PlanAsset[];
  dataCatalogs: PlanDataCatalog[];
  backend: BackendOptions;
  outOfScope: PlanOutOfScope[];
  /** A plain-language note the UI shows the user before they confirm. */
  userNote: string;
  /** Present when the model call or parse failed (fail-open). */
  error?: string;
  /** Estimated OpenRouter token cost of Stage A (for transparency). */
  estimatedCostUsd?: number;
}

// ─── The Genesis-aware system prompt ──────────────────────────────────────────

const SYSTEM_PROMPT = `You are GenWhisperer's GitHub→Genesis import planner. You take a GitHub repository (typically a Lovable export: React + Vite + Tailwind + shadcn/ui, possibly with Supabase backend) and produce a structured TRANSLATION PLAN for recreating it as an eStage Genesis web project.

Genesis is NOT a generic host — it is a structured website builder with its own primitives. Translate, don't copy:
- React Router routes → Genesis pages (use genesis_reconcile_pages). Routes are flat (e.g. "/about", not "/company/about").
- Source components/pages → Genesis files via genesis_write_file. Drop entry boilerplate (main.tsx, vite config) and lockfiles — Genesis owns those.
- Binary assets (images/fonts/videos) → Genesis media uploads; references rewritten to point at the media URL.
- Content data (products, testimonials, listings) → Genesis data catalogs at src/data/*.json via genesis_data_files.
- Backend (Supabase schema/RLS/edge functions):
  - DETECT it and fill the "backend" panel with three options, each with concrete user setup steps:
    A) "reuse-supabase": wire the Genesis project to the user's EXISTING Supabase via the Supabase connector (genesis_connector_save). User step: Genesis → Settings → Connectors → Supabase, enter Project URL + Publishable (anon) key + (recommended) Management token. Recommended when the user already owns the Supabase project.
    B) "dedicated-cloud": recreate the backend on Genesis Dedicated Cloud (genesis_cloud_migrate for schema, genesis_cloud_function_deploy for edge functions, genesis_cloud_secrets_set for env — UPPER_SNAKE_CASE, SUPABASE_/SB_ prefixes reserved). User step: enable Dedicated Cloud via Genesis → Settings → Dedicated Cloud. Recommended when the user wants Genesis to own the backend.
    C) "skip": frontend only; surface that the site won't be fully functional until a backend is wired. Recommended for static/marketing sites.
  - If NO backend deps detected, set backend.detected=false and leave options empty.
- Out-of-scope: anything Genesis genuinely cannot represent — list it with a reason.

Return ONLY a JSON object matching this shape (no prose, no markdown fences):
{
  "summary": "one line: what kind of site this is",
  "routes": [{ "source": "/", "genesisPage": "/", "isHome": true }],
  "files": [{ "genesisPath": "src/pages/Home.tsx", "fromRepoPath": "src/pages/Index.tsx", "sha": "<git blob sha>", "translated": true, "note": "..." }],
  "assets": [{ "repoPath": "public/logo.png", "genesisMediaName": "logo.png", "rewriteIn": ["src/pages/Home.tsx"] }],
  "dataCatalogs": [{ "genesisPath": "src/data/products.json", "fromRepoPath": "supabase/products", "sha": "<git blob sha or empty>", "note": "..." }],
  "backend": { "detected": false, "summary": "", "options": [] },
  "outOfScope": [{ "description": "...", "reason": "..." }],
  "userNote": "plain-language note shown to the user before they confirm"
}

Be concise. The user is an eStage Genesis user — they know Genesis. Don't explain Genesis to them.`;

// ─── The planner ─────────────────────────────────────────────────────────────

/** Input to planImport. */
export interface ImportPlannerInput {
  /** Decrypted tenant OpenRouter key (server-side only). */
  openrouterKey: string;
  /** Model id, e.g. "z-ai/glm-5.2". */
  model: string;
  /** The bounded repo digest from buildRepoDigest. */
  digest: RepoDigest;
  /** Observability correlation. */
  requestId?: string;
  userId?: number;
}

/**
 * Run Stage A: ask the model for a translation plan.
 *
 * Never throws — on model failure or malformed JSON, returns an ImportPlan
 * with `error` set (fail-open) so the SSE route can surface it to the user
 * rather than 500-ing.
 */
export async function planImport(input: ImportPlannerInput): Promise<ImportPlan> {
  const { openrouterKey, model, digest } = input;

  // Compact the digest into the user message. We send the manifest + the
  // inlined file contents (binary/capped/secret-stripped files carry no
  // content — just path + flags, which is what the planner needs to decide).
  const fileSummary = digest.files
    .map((f) => {
      const flags = [
        f.isBinary ? "binary" : null,
        f.capped ? "capped" : null,
        digest.manifest.secretHits.some((h) => h.path === f.path) ? "secret-stripped" : null,
      ]
        .filter(Boolean)
        .join(",");
      const content = f.content ? `\n----- ${f.path} -----\n${f.content}` : `\n----- ${f.path} ----- [${flags || "empty"}]`;
      return content;
    })
    .join("\n");

  const userMessage = `Repository: ${digest.repo.owner}/${digest.repo.name} (branch: ${digest.repo.branch})

Manifest:
- raw tree entries: ${digest.manifest.rawTreeEntries}
- files kept: ${digest.manifest.fileCount}
- binary assets: ${digest.manifest.binaryCount}
- files capped (content omitted, > ${digest.manifest.byteCap} bytes): ${digest.manifest.cappedCount}
- secret-stripped files: ${digest.manifest.secretHits.length} (${digest.manifest.secretHits
    .map((h) => h.path)
    .join(", ") || "none"})
- filtered out: ${JSON.stringify(digest.manifest.filteredOut)}

File tree (dirs + surviving files):
${digest.tree.map((e) => (e.type === "tree" ? `dir:  ${e.path}` : `file: ${e.path}`)).join("\n")}

Inlined file contents:
${fileSummary}

Produce the translation plan JSON now.`;

  const messages: ChatMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: userMessage },
  ];

  let result;
  let estimatedCostUsd: number | undefined;
  try {
    // Non-streaming: the plan is a single JSON response. The SSE route
    // emits progress events around this call.
    result = await chat({
      apiKey: openrouterKey,
      model,
      messages,
      observability: {
        requestId: input.requestId ?? "import-planner",
        userId: input.userId,
      },
    });
  } catch (e) {
    // Fail open: model/network error → return a plan with error set.
    return failOpenPlan(digest, `Could not reach the model: ${(e as Error).message}`);
  }

  // Estimate cost if usage came back (best-effort; pricing resolution is
  // the caller's job — we just carry usage through if present).
  if (result.usage) {
    // Rough estimate: we don't have pricing here, so leave a token count
    // the route can price later. Keep it simple — the route computes real cost.
    estimatedCostUsd = undefined;
  }

  const raw = result.choices?.[0]?.message?.content ?? "";
  if (!raw) {
    return failOpenPlan(digest, "The model returned an empty response. Try again.");
  }

  // Defensive parse: the model may wrap JSON in prose or markdown fences.
  const jsonText = extractJson(raw);
  if (!jsonText) {
    return failOpenPlan(digest, "The model response wasn't valid JSON. Try again.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return failOpenPlan(digest, "The model response was malformed JSON. Try again.");
  }

  // Coerce into the plan shape, filling defaults for missing fields.
  const plan = coercePlan(parsed, digest);

  // Enrich SHAs from the digest: the planner's JSON output may carry the
  // blob SHA, but if the model omitted it, fill it from the digest's
  // file map (keyed by fromRepoPath). Stage B re-fetches content via the
  // GitHub git/blobs/{sha} API, so every plan file MUST carry a SHA.
  const shaByPath = new Map<string, string>();
  for (const df of digest.files) shaByPath.set(df.path, df.sha);
  for (const f of plan.files) {
    if (!f.sha && f.fromRepoPath && shaByPath.has(f.fromRepoPath)) {
      f.sha = shaByPath.get(f.fromRepoPath)!;
    }
  }
  for (const d of plan.dataCatalogs) {
    if (!d.sha && d.fromRepoPath && shaByPath.has(d.fromRepoPath)) {
      d.sha = shaByPath.get(d.fromRepoPath)!;
    }
  }

  if (estimatedCostUsd !== undefined) plan.estimatedCostUsd = estimatedCostUsd;
  return plan;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Build a fail-open plan when the model call or parse failed. Carries the
 *  digest so the UI can still show what was ingested. */
function failOpenPlan(digest: RepoDigest, error: string): ImportPlan {
  return {
    repo: digest.repo,
    summary: "",
    routes: [],
    files: [],
    assets: [],
    dataCatalogs: [],
    backend: { detected: false, summary: "", options: [] },
    outOfScope: [],
    userNote: "",
    error,
  };
}

/** Extract the first JSON object/array from a possibly-prose-wrapped response.
 *  Strips markdown fences ```json ... ``` and trims to the outermost braces. */
export function extractJson(raw: string): string | null {
  let s = raw.trim();
  // Strip markdown code fences if present.
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (fence) s = fence[1].trim();
  // Find the first balanced { ... } or [ ... ].
  const start = s.search(/[{[]/);
  if (start < 0) return null;
  const open = s[start];
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  for (let i = start; i < s.length; i++) {
    if (s[i] === open) depth++;
    else if (s[i] === close) {
      depth--;
      if (depth === 0) return s.slice(start, i + 1);
    }
  }
  return null;
}

/** Coerce a parsed unknown into an ImportPlan, defaulting missing fields.
 *  Never throws — bad shapes become empty arrays / empty strings. */
export function coercePlan(parsed: unknown, digest: RepoDigest): ImportPlan {
  const p = (parsed ?? {}) as Record<string, unknown>;
  const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
  const str = (v: unknown): string => (typeof v === "string" ? v : "");
  const bool = (v: unknown): boolean => v === true;

  const backendRaw = (p.backend ?? {}) as Record<string, unknown>;
  const optionsRaw = arr(backendRaw.options);
  const knownKeys = new Set(["reuse-supabase", "dedicated-cloud", "skip"]);

  return {
    repo: digest.repo,
    summary: str(p.summary),
    routes: arr(p.routes).map((r) => {
      const o = (r ?? {}) as Record<string, unknown>;
      return {
        source: str(o.source),
        genesisPage: str(o.genesisPage),
        isHome: bool(o.isHome),
      };
    }),
    files: arr(p.files).map((f) => {
      const o = (f ?? {}) as Record<string, unknown>;
      return {
        genesisPath: str(o.genesisPath),
        fromRepoPath: str(o.fromRepoPath),
        sha: str(o.sha),
        translated: bool(o.translated),
        note: str(o.note),
      };
    }),
    assets: arr(p.assets).map((a) => {
      const o = (a ?? {}) as Record<string, unknown>;
      return {
        repoPath: str(o.repoPath),
        genesisMediaName: str(o.genesisMediaName),
        rewriteIn: arr(o.rewriteIn).map((x) => str(x)),
      };
    }),
    dataCatalogs: arr(p.dataCatalogs).map((d) => {
      const o = (d ?? {}) as Record<string, unknown>;
      return {
        genesisPath: str(o.genesisPath),
        fromRepoPath: str(o.fromRepoPath),
        sha: str(o.sha),
        note: str(o.note),
      };
    }),
    backend: {
      detected: bool(backendRaw.detected),
      summary: str(backendRaw.summary),
      options: optionsRaw
        .map((o) => {
          const ob = (o ?? {}) as Record<string, unknown>;
          const key = str(ob.key);
          return {
            key: knownKeys.has(key) ? (key as BackendOption["key"]) : "skip",
            label: str(ob.label),
            agentDoes: str(ob.agentDoes),
            userDoes: str(ob.userDoes),
            recommendedWhen: str(ob.recommendedWhen),
          };
        })
        .filter((o) => o.label || o.agentDoes || o.userDoes),
    },
    outOfScope: arr(p.outOfScope).map((o) => {
      const ob = (o ?? {}) as Record<string, unknown>;
      return {
        description: str(ob.description),
        reason: str(ob.reason),
      };
    }),
    userNote: str(p.userNote),
  };
}
