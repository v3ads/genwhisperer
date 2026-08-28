/**
 * Repo digest builder (server-side) — Phase 2 of the GitHub → Genesis import.
 *
 * Takes a GitHub file tree (from services/github.ts getFileTree) + a blob
 * fetcher and produces a compact "project digest" that the later import
 * planner (Stage A) feeds to the model. The digest is deliberately bounded:
 *
 *   - Filters out non-source paths (node_modules, .git, dist, build, lockfiles,
 *     generated/minified files) so the model sees real source, not noise.
 *   - Caps the total inlined TEXT content (default 256KB). Binary assets are
 *     listed in the tree but NOT inlined — later phases upload them to Genesis
 *     media and rewrite references, never via genesis_write_file.
 *   - Runs scanForSecrets (from services/github.ts) on the inlined text and
 *     STRIPS the content of any flagged file (content set to "" + flaggedSecret
 *     set on the manifest) so a secret found in a repo is never copied into
 *     Genesis. The path/name is retained so the planner can tell the user.
 *
 * The blob fetcher is injected (a callback) so this module is pure and unit-
 * testable without hitting GitHub — tests pass a fake fetcher keyed by sha.
 *
 * Convention: matches services/github.ts — no external deps, plain TypeScript.
 */

import {
  isBinaryPath,
  scanForSecrets,
  type GithubTreeEntry,
} from "./github.js";

/** A file entry in the digest. */
export interface DigestFile {
  /** Repo-relative path, e.g. "src/App.tsx". */
  path: string;
  /** Git blob SHA (for later media upload / dedup). */
  sha: string;
  /** Decoded text content, or "" for binary / capped / secret-stripped files. */
  content: string;
  /** True for binary assets (images/fonts/etc.) — route to Genesis media. */
  isBinary: boolean;
  /** True when this file's content was omitted because the byte cap was hit. */
  capped: boolean;
  /** Byte size of the original blob (GitHub's reported size). */
  size: number;
}

/** The full digest handed to the import planner. */
export interface RepoDigest {
  repo: { owner: string; name: string; branch: string };
  /** The filtered tree (directories + surviving file entries), for orientation. */
  tree: GithubTreeEntry[];
  /** The inlined/filtered files the planner should consider. */
  files: DigestFile[];
  manifest: DigestManifest;
}

/** Summary metadata about the digest (for the UI + planner budgeting). */
export interface DigestManifest {
  /** Total entries in the raw GitHub tree (before filtering). */
  rawTreeEntries: number;
  /** File entries that survived filtering. */
  fileCount: number;
  /** Binary files listed (content not inlined). */
  binaryCount: number;
  /** Files whose content was omitted due to the byte cap. */
  cappedCount: number;
  /** Total bytes of inlined text content. */
  inlinedBytes: number;
  /** The configured byte cap. */
  byteCap: number;
  /** Whether the byte cap was reached (content was dropped). */
  capped: boolean;
  /** Paths flagged by the secret scan (content stripped, never sent to Genesis). */
  secretHits: Array<{ path: string; rule: string }>;
  /** Paths filtered out, grouped by reason — for the UI to show what was skipped. */
  filteredOut: Record<string, number>;
}

/** Injected blob fetcher: given a tree entry, return its decoded text content.
 *  Used so this module is testable without GitHub. The real caller passes a
 *  closure over services/github.ts getBlob. Returns "" for binary/capped files
 *  is fine — the digest builder decides inlining, not the fetcher. */
export type BlobFetcher = (entry: GithubTreeEntry) => Promise<string>;

/** Default cap on inlined text content (256KB) — keeps Stage A within a
 *  reasonable model context budget. Oversized repos chunk across passes. */
export const DEFAULT_BYTE_CAP = 256 * 1024;

/** Paths that are always filtered out (not source). */
const BLOCKED_DIRS = ["node_modules/", ".git/", "dist/", "build/", ".next/", ".cache/", "coverage/"];

/** Filename/glob patterns to filter out (generated, lockfiles, minified). */
const BLOCKED_FILE_PATTERNS = [
  /(^|\/)package-lock\.json$/,
  /(^|\/)yarn\.lock$/,
  /(^|\/)pnpm-lock\.yaml$/,
  /(^|\/)bun\.lockb$/,
  /(^|\/)composer\.lock$/,
  /(^|\/)Gemfile\.lock$/,
  /(^|\/)Cargo\.lock$/,
  /(^|\/)poetry\.lock$/,
  /\.min\.js$/,
  /\.min\.css$/,
  /\.map$/,
  /\.d\.ts$/,
];

/**
 * Decide whether a tree entry (blob path) should be kept in the digest.
 * Returns the filter reason string if it should be dropped, or null if kept.
 */
export function filterReason(path: string): string | null {
  for (const d of BLOCKED_DIRS) {
    if (path.startsWith(d) || path.includes("/" + d)) return `dir:${d.slice(0, -1)}`;
  }
  for (const re of BLOCKED_FILE_PATTERNS) {
    if (re.test(path)) return "generated/lockfile";
  }
  return null;
}

/**
 * Build a compact repo digest from a GitHub file tree.
 *
 * @param tree       the raw recursive tree from getFileTree
 * @param fetchBlob  injected blob fetcher (returns decoded text for an entry)
 * @param opts       repo metadata + optional byteCap override
 */
export async function buildRepoDigest(
  tree: GithubTreeEntry[],
  fetchBlob: BlobFetcher,
  opts: { owner: string; name: string; branch: string; byteCap?: number }
): Promise<RepoDigest> {
  const byteCap = opts.byteCap ?? DEFAULT_BYTE_CAP;
  const filteredOut: Record<string, number> = {};
  const files: DigestFile[] = [];
  let inlinedBytes = 0;
  let cappedCount = 0;
  let capped = false;

  // Only blob entries (files) are fetched/considered; tree entries (dirs) are
  // retained in the digest's tree for orientation but not fetched.
  const blobs = tree.filter((e) => e.type === "blob");

  for (const entry of blobs) {
    const reason = filterReason(entry.path);
    if (reason) {
      filteredOut[reason] = (filteredOut[reason] ?? 0) + 1;
      continue;
    }

    const isBinary = isBinaryPath(entry.path);
    const size = entry.size ?? 0;

    if (isBinary) {
      // Binary assets are listed (later phases upload to Genesis media) but
      // never inlined as text.
      files.push({
        path: entry.path,
        sha: entry.sha,
        content: "",
        isBinary: true,
        capped: false,
        size,
      });
      continue;
    }

    // Text file: respect the byte cap. Once reached, list the remaining files
    // as capped (path retained for the planner, content omitted).
    if (capped) {
      cappedCount++;
      files.push({
        path: entry.path,
        sha: entry.sha,
        content: "",
        isBinary: false,
        capped: true,
        size,
      });
      continue;
    }

    let content = "";
    try {
      content = await fetchBlob(entry);
    } catch {
      // A single blob fetch failure shouldn't abort the whole digest — list
      // the file with empty content so the planner knows it exists but can't
      // see it. (The real fetcher logs the error.)
      content = "";
    }

    // Enforce the cap on the fetched content. If this file would push us over,
    // truncate the inlining and mark capped for the rest.
    if (inlinedBytes + content.length > byteCap) {
      capped = true;
      cappedCount++;
      files.push({
        path: entry.path,
        sha: entry.sha,
        content: "",
        isBinary: false,
        capped: true,
        size,
      });
      continue;
    }

    inlinedBytes += content.length;
    files.push({
      path: entry.path,
      sha: entry.sha,
      content,
      isBinary: false,
      capped: false,
      size,
    });
  }

  // Secret scan: run over the inlined text files. Any flagged file has its
  // content STRIPPED (set to "") so secrets never reach Genesis. The hit is
  // recorded on the manifest so the planner/UI can tell the user.
  const inlinedForScan = files
    .filter((f) => !f.isBinary && !f.capped && f.content)
    .map((f) => ({ path: f.path, content: f.content }));
  const secretHits = scanForSecrets(inlinedForScan);
  const hitPaths = new Set(secretHits.map((h) => h.path));
  for (const f of files) {
    if (hitPaths.has(f.path)) {
      f.content = "";
    }
  }

  const binaryCount = files.filter((f) => f.isBinary).length;

  return {
    repo: { owner: opts.owner, name: opts.name, branch: opts.branch },
    tree,
    files,
    manifest: {
      rawTreeEntries: tree.length,
      fileCount: files.length,
      binaryCount,
      cappedCount,
      inlinedBytes,
      byteCap,
      capped,
      secretHits,
      filteredOut,
    },
  };
}
