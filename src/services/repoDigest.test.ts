import { describe, expect, it } from "vitest";
import {
  buildRepoDigest,
  filterReason,
  DEFAULT_BYTE_CAP,
  type BlobFetcher,
} from "./repoDigest.js";
import type { GithubTreeEntry } from "./github.js";

/** Build a fake blob fetcher from a map of sha -> content. */
function fakeFetcher(bySha: Record<string, string>): BlobFetcher {
  return async (entry) => bySha[entry.sha] ?? "";
}

/** Make a blob tree entry. */
function blob(path: string, sha: string, content: string, size = content.length): GithubTreeEntry {
  return { path, type: "blob", sha, size };
}

describe("repoDigest.filterReason", () => {
  it("drops node_modules, .git, dist, build paths", () => {
    expect(filterReason("node_modules/react/index.js")).toBe("dir:node_modules");
    expect(filterReason("src/node_modules/x.js")).toBe("dir:node_modules");
    expect(filterReason(".git/HEAD")).toBe("dir:.git");
    expect(filterReason("dist/main.js")).toBe("dir:dist");
    expect(filterReason("build/index.html")).toBe("dir:build");
  });

  it("drops lockfiles and generated/minified files", () => {
    expect(filterReason("package-lock.json")).toBe("generated/lockfile");
    expect(filterReason("yarn.lock")).toBe("generated/lockfile");
    expect(filterReason("pnpm-lock.yaml")).toBe("generated/lockfile");
    expect(filterReason("assets/main.min.js")).toBe("generated/lockfile");
    expect(filterReason("assets/main.min.css")).toBe("generated/lockfile");
    expect(filterReason("assets/main.js.map")).toBe("generated/lockfile");
  });

  it("keeps real source files", () => {
    expect(filterReason("src/App.tsx")).toBeNull();
    expect(filterReason("index.html")).toBeNull();
    expect(filterReason("package.json")).toBeNull();
    expect(filterReason("README.md")).toBeNull();
  });
});

describe("repoDigest.buildRepoDigest", () => {
  it("filters out non-source paths and inlines real source content", async () => {
    const tree: GithubTreeEntry[] = [
      blob("node_modules/react/index.js", "s1", "module.exports = 1;"),
      blob("package-lock.json", "s2", "{}"),
      blob("src/App.tsx", "s3", "export default function App() { return null; }"),
      blob("index.html", "s4", "<!doctype html><html></html>"),
    ];
    const fetcher = fakeFetcher({
      s1: "module.exports = 1;",
      s2: "{}",
      s3: "export default function App() { return null; }",
      s4: "<!doctype html><html></html>",
    });

    const d = await buildRepoDigest(tree, fetcher, {
      owner: "v3ads",
      name: "demo",
      branch: "main",
    });

    // Only the two source files survived.
    expect(d.files.map((f) => f.path).sort()).toEqual(["index.html", "src/App.tsx"]);
    expect(d.manifest.fileCount).toBe(2);
    // The filtered-out paths are accounted for on the manifest.
    expect(d.manifest.filteredOut["dir:node_modules"]).toBe(1);
    expect(d.manifest.filteredOut["generated/lockfile"]).toBe(1);
    // Content was inlined for the survivors.
    const app = d.files.find((f) => f.path === "src/App.tsx")!;
    expect(app.content).toContain("export default function App");
    expect(app.isBinary).toBe(false);
    expect(app.capped).toBe(false);
  });

  it("lists binary assets without inlining their content", async () => {
    const tree: GithubTreeEntry[] = [
      blob("logo.png", "b1", "", 40960),
      blob("src/App.tsx", "s3", "export default function App() { return null; }"),
    ];
    const fetcher = fakeFetcher({ s3: "export default function App() { return null; }", b1: "" });

    const d = await buildRepoDigest(tree, fetcher, {
      owner: "v3ads",
      name: "demo",
      branch: "main",
    });

    const logo = d.files.find((f) => f.path === "logo.png")!;
    expect(logo.isBinary).toBe(true);
    expect(logo.content).toBe("");
    expect(logo.size).toBe(40960);
    expect(d.manifest.binaryCount).toBe(1);
  });

  it("caps inlined text content and marks the remainder as capped", async () => {
    // Two text files; cap set tiny so the first fills it and the second is capped.
    const a = "A".repeat(100);
    const b = "B".repeat(100);
    const tree: GithubTreeEntry[] = [
      blob("a.txt", "sa", a),
      blob("b.txt", "sb", b),
    ];
    const fetcher = fakeFetcher({ sa: a, sb: b });

    const d = await buildRepoDigest(tree, fetcher, {
      owner: "v3ads",
      name: "demo",
      branch: "main",
      byteCap: 100,
    });

    const fa = d.files.find((f) => f.path === "a.txt")!;
    const fb = d.files.find((f) => f.path === "b.txt")!;
    expect(fa.capped).toBe(false);
    expect(fa.content).toBe(a);
    expect(fb.capped).toBe(true);
    expect(fb.content).toBe("");
    expect(d.manifest.capped).toBe(true);
    expect(d.manifest.cappedCount).toBe(1);
    expect(d.manifest.inlinedBytes).toBe(100);
    expect(d.manifest.byteCap).toBe(100);
  });

  it("strips content from files flagged by the secret scan and records the hits", async () => {
    // A source file containing a fake-but-patterned GitHub PAT and a clean file.
    const pat = "ghp_" + "A".repeat(36);
    const leaky = `const token = "${pat}";`;
    const clean = "export const x = 1;";
    const tree: GithubTreeEntry[] = [
      blob("src/leaky.ts", "sl", leaky),
      blob("src/clean.ts", "sc", clean),
    ];
    const fetcher = fakeFetcher({ sl: leaky, sc: clean });

    const d = await buildRepoDigest(tree, fetcher, {
      owner: "v3ads",
      name: "demo",
      branch: "main",
    });

    const leakyFile = d.files.find((f) => f.path === "src/leaky.ts")!;
    const cleanFile = d.files.find((f) => f.path === "src/clean.ts")!;
    // Secret content stripped so it never reaches Genesis...
    expect(leakyFile.content).toBe("");
    // ...clean file kept.
    expect(cleanFile.content).toBe(clean);
    // Hit recorded on the manifest for the UI.
    expect(d.manifest.secretHits.length).toBe(1);
    expect(d.manifest.secretHits[0].path).toBe("src/leaky.ts");
    expect(d.manifest.secretHits[0].rule).toContain("GitHub PAT");
  });

  it("uses the default 256KB cap when none is provided", async () => {
    const tree: GithubTreeEntry[] = [blob("a.txt", "sa", "x")];
    const d = await buildRepoDigest(tree, fakeFetcher({ sa: "x" }), {
      owner: "v3ads",
      name: "demo",
      branch: "main",
    });
    expect(d.manifest.byteCap).toBe(DEFAULT_BYTE_CAP);
    expect(d.manifest.byteCap).toBe(256 * 1024);
  });

  it("retains the raw tree (including dirs) for orientation", async () => {
    const tree: GithubTreeEntry[] = [
      { path: "src", type: "tree", sha: "tsrc" },
      blob("src/App.tsx", "s3", "x"),
    ];
    const d = await buildRepoDigest(tree, fakeFetcher({ s3: "x" }), {
      owner: "v3ads",
      name: "demo",
      branch: "main",
    });
    expect(d.tree.length).toBe(2);
    expect(d.manifest.rawTreeEntries).toBe(2);
    expect(d.manifest.fileCount).toBe(1);
  });
});
