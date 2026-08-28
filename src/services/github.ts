/**
 * GitHub REST API client (server-side).
 *
 * Reads a user's GitHub repos so the GitHub → Genesis import feature can
 * ingest a repo and recreate it on a Genesis project. Uses the GitHub REST
 * API v3 with a personal access token (PAT) supplied by the caller.
 *
 * Convention: matches genesisMcp.ts / openrouter.ts — uses the built-in
 * `fetch`, no external HTTP dependency. The PAT is passed in by the caller
 * (the github route decrypts it from Neon) and is NEVER logged, echoed, or
 * persisted here.
 *
 * All methods throw on auth/network failure with a plain-language message
 * suitable for surfacing to the user.
 */

const GITHUB_API = "https://api.github.com";
const DEFAULT_TIMEOUT_MS = 30_000;

/** A repo as returned by listRepos (subset of GitHub's fields). */
export interface GithubRepo {
  id: number;
  name: string;
  fullName: string;
  owner: string;
  /** Default branch name, e.g. "main". */
  defaultBranch: string;
  private: boolean;
  fork: boolean;
  archived: boolean;
  description: string | null;
  /** "Updated" timestamp from GitHub, ISO string. */
  updatedAt: string | null;
  /** Size in KB (GitHub's reported repo size). */
  sizeKb: number;
  htmlUrl: string;
}

/** Result of validating a token via /user. */
export interface GithubUser {
  login: string;
  id: number;
  scopes: string;
}

/** A file-tree entry from git/trees?recursive=1. */
export interface GithubTreeEntry {
  path: string;
  type: "blob" | "tree" | "commit" | string;
  sha: string;
  size?: number;
}

/** A fetched blob (file content). GitHub returns base64 content. */
export interface GithubBlob {
  path: string;
  sha: string;
  /** base64-decoded file content (text only; binary callers should use isBinary path). */
  content: string;
  /** True when GitHub reports the blob encoding is base64 and it's a binary asset. */
  isBinary: boolean;
  size: number;
}

/** Paths flagged by scanForSecrets (never copied into Genesis). */
export interface SecretScanHit {
  path: string;
  /** Which rule matched, for the log/UI. */
  rule: string;
}

/**
 * Validate a PAT by calling /user. Returns the login + granted scopes.
 * Throws on 401/403/network. Scopes come from the X-OAuth-Scopes header.
 */
export async function validateToken(token: string): Promise<GithubUser> {
  const r = await ghFetch(token, "/user", "GET");
  if (r.status === 401 || r.status === 403) {
    throw new Error(
      "Your GitHub token was rejected. Check that it's a valid personal access token with the `repo` (or `public_repo`) scope."
    );
  }
  if (r.status >= 400) {
    throw new Error(`GitHub returned HTTP ${r.status} while verifying your token.`);
  }
  const j = (await r.json()) as { login?: string; id?: number };
  const scopes = r.headers.get("x-oauth-scopes") || "";
  if (!j.login) {
    throw new Error("GitHub accepted the token but returned no login. Try a fresh token.");
  }
  return { login: j.login, id: j.id ?? 0, scopes };
}

/**
 * List the user's repos (most-recently-updated first). Filters out forks and
 * archived repos by default — the import target is a project the user owns
 * and actively maintains (typically a Lovable export pushed to GitHub).
 */
export async function listRepos(
  token: string,
  opts: { includeForks?: boolean; includeArchived?: boolean } = {}
): Promise<GithubRepo[]> {
  const all: GithubRepo[] = [];
  let page = 1;
  // Paginate up to a sane cap (10 pages × 100 = 1000 repos).
  for (let i = 0; i < 10; i++) {
    const r = await ghFetch(
      token,
      `/user/repos?per_page=100&sort=updated&direction=desc&page=${page}`,
      "GET"
    );
    if (r.status >= 400) {
      throw new Error(`GitHub returned HTTP ${r.status} while listing your repos.`);
    }
    const arr = (await r.json()) as Array<{
      id: number;
      name: string;
      full_name: string;
      owner?: { login: string };
      default_branch?: string;
      private?: boolean;
      fork?: boolean;
      archived?: boolean;
      description?: string | null;
      updated_at?: string | null;
      size?: number;
      html_url?: string;
    }>;
    if (!arr.length) break;
    for (const a of arr) {
      if (!opts.includeForks && a.fork) continue;
      if (!opts.includeArchived && a.archived) continue;
      all.push({
        id: a.id,
        name: a.name,
        fullName: a.full_name,
        owner: a.owner?.login ?? "",
        defaultBranch: a.default_branch ?? "main",
        private: a.private ?? false,
        fork: a.fork ?? false,
        archived: a.archived ?? false,
        description: a.description ?? null,
        updatedAt: a.updated_at ?? null,
        sizeKb: a.size ?? 0,
        htmlUrl: a.html_url ?? "",
      });
    }
    if (arr.length < 100) break;
    page++;
  }
  return all;
}

/**
 * Get the recursive file tree for a repo + branch. Returns every blob/tree
 * entry under that ref. Throws on 404 (missing branch/repo) and network.
 */
export async function getFileTree(
  token: string,
  owner: string,
  repo: string,
  branch: string
): Promise<GithubTreeEntry[]> {
  // Resolve the branch ref to a commit SHA, then fetch its tree recursively.
  const refR = await ghFetch(token, `/repos/${enc(owner)}/${enc(repo)}/branches/${enc(branch)}`, "GET");
  if (refR.status === 404) {
    throw new Error(`Branch "${branch}" was not found in ${owner}/${repo}.`);
  }
  if (refR.status >= 400) {
    throw new Error(`GitHub returned HTTP ${refR.status} while reading the branch.`);
  }
  const refJ = (await refR.json()) as { commit?: { sha?: string } };
  const commitSha = refJ.commit?.sha;
  if (!commitSha) {
    throw new Error(`Could not resolve a commit SHA for branch "${branch}".`);
  }

  const treeR = await ghFetch(
    token,
    `/repos/${enc(owner)}/${enc(repo)}/git/trees/${commitSha}?recursive=1`,
    "GET"
  );
  if (treeR.status === 404) {
    throw new Error(`The file tree for ${owner}/${repo}@${branch} was not found.`);
  }
  if (treeR.status >= 400) {
    throw new Error(`GitHub returned HTTP ${treeR.status} while reading the file tree.`);
  }
  const treeJ = (await treeR.json()) as { tree?: GithubTreeEntry[]; truncated?: boolean };
  if (treeJ.truncated) {
    // GitHub caps recursive trees at ~100k entries. Surface this so the
    // caller can warn the user rather than silently importing a partial tree.
    throw new Error(
      `The file tree for ${owner}/${repo} is too large for GitHub's recursive API (truncated). Use a smaller repo or a subdirectory.`
    );
  }
  return treeJ.tree ?? [];
}

/**
 * Fetch a single blob (file content). GitHub returns base64. Decodes text;
 * marks binary entries (caller routes binary → Genesis media, not write_file).
 */
export async function getBlob(
  token: string,
  owner: string,
  repo: string,
  sha: string,
  path: string
): Promise<GithubBlob> {
  const r = await ghFetch(token, `/repos/${enc(owner)}/${enc(repo)}/git/blobs/${sha}`, "GET");
  if (r.status >= 400) {
    throw new Error(`GitHub returned HTTP ${r.status} while reading ${path}.`);
  }
  const j = (await r.json()) as { content?: string; encoding?: string; size?: number };
  const encoding = j.encoding ?? "base64";
  const raw = j.content ?? "";
  // GitHub base64 content may contain newlines; strip them before decoding.
  const isBinary = isBinaryPath(path);
  if (encoding === "base64") {
    try {
      const decoded = Buffer.from(raw.replace(/\n/g, ""), "base64").toString(
        isBinary ? "base64" : "utf8"
      );
      return { path, sha, content: decoded, isBinary, size: j.size ?? 0 };
    } catch {
      // If decoding fails, treat as binary and keep base64 for media upload.
      return { path, sha, content: raw, isBinary: true, size: j.size ?? 0 };
    }
  }
  return { path, sha, content: raw, isBinary, size: j.size ?? 0 };
}

/**
 * Scan file contents/paths for likely secrets. Used pre-write so secrets
 * found in a repo are NEVER copied into Genesis. Returns hits with the rule.
 * This is a defense-in-depth heuristic, not a guarantee — the import also
 * never logs token contents.
 */
const SECRET_RULES: Array<{ rule: string; re: RegExp }> = [
  { rule: "GitHub PAT (ghp_)", re: /\bghp_[A-Za-z0-9]{36}\b/ },
  { rule: "GitHub fine-grained PAT (github_pat_)", re: /\bgithub_pat_[A-Za-z0-9_]{22,}\b/ },
  { rule: "Supabase anon/service key", re: /\bsb_(?:publishable|secret)_[A-Za-z0-9]{32,}\b/i },
  { rule: "Supabase service role (eyJ...)", re: /eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/ },
  { rule: "Stripe live key", re: /\bsk_live_[A-Za-z0-9]{20,}\b/ },
  { rule: "AWS access key id", re: /\bAKIA[0-9A-Z]{16}\b/ },
  { rule: "Google API key", re: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { rule: "OpenAI key", re: /\bsk-[A-Za-z0-9]{40,}\b/ },
];

export function scanForSecrets(files: Array<{ path: string; content?: string }>): SecretScanHit[] {
  const hits: SecretScanHit[] = [];
  for (const f of files) {
    // Path-based: obvious secret filenames.
    if (/\.(env|pem|key)$/i.test(f.path) || /(^|\/)\.env\b/i.test(f.path)) {
      hits.push({ path: f.path, rule: "secret-looking filename" });
      continue;
    }
    if (!f.content) continue;
    for (const { rule, re } of SECRET_RULES) {
      if (re.test(f.content)) {
        hits.push({ path: f.path, rule });
        break;
      }
    }
  }
  return hits;
}

// ─── helpers ────────────────────────────────────────────────────────────────

/** URL-encode a path segment. */
function enc(s: string): string {
  return encodeURIComponent(s);
}

/** Heuristic: is this path a binary asset (image/font/archive/etc.)? */
export function isBinaryPath(path: string): boolean {
  return /\.(png|jpe?g|gif|webp|avif|ico|bmp|tiff?|svgz|mp[34]|wav|ogg|flac|aac|webm|mov|avi|mkv|woff2?|otf|ttf|eot|zip|tar|gz|rar|7z|pdf|psd|ai|sketch|sqlite?|db)$/i.test(
    path
  );
}

/** One GitHub REST call with timeout + standard headers. */
async function ghFetch(
  token: string,
  path: string,
  method: string,
  timeoutMs = DEFAULT_TIMEOUT_MS
): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let r: Response;
  try {
    r = await fetch(`${GITHUB_API}${path}`, {
      method,
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "genwhisperer",
      },
      signal: ctrl.signal,
    });
  } catch (e) {
    const err = e as Error;
    if (err.name === "AbortError") {
      throw new Error(`GitHub request timed out (${timeoutMs / 1000}s).`);
    }
    throw new Error(`GitHub unreachable: ${err.message}`);
  } finally {
    clearTimeout(timer);
  }
  // Handle the common rate-limit case with a plain-language message.
  if (r.status === 403 && r.headers.get("x-ratelimit-remaining") === "0") {
    throw new Error(
      "GitHub rate limit reached. Wait a few minutes and try again, or use a token with fewer recent requests."
    );
  }
  return r;
}
