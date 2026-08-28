import { describe, expect, it } from "vitest";
import { extractJson, coercePlan, type ImportPlan } from "./importPlanner.js";
import type { RepoDigest } from "./repoDigest.js";

/** A minimal digest fixture for the coerce tests. */
function fixtureDigest(): RepoDigest {
  return {
    repo: { owner: "v3ads", name: "demo", branch: "main" },
    tree: [{ path: "src/App.tsx", type: "blob", sha: "s1" }],
    files: [
      { path: "src/App.tsx", sha: "s1", content: "export default function App() {}", isBinary: false, capped: false, size: 30 },
    ],
    manifest: {
      rawTreeEntries: 1,
      fileCount: 1,
      binaryCount: 0,
      cappedCount: 0,
      inlinedBytes: 30,
      byteCap: 262144,
      capped: false,
      secretHits: [],
      filteredOut: {},
    },
  };
}

describe("importPlanner.extractJson", () => {
  it("returns raw JSON when the response is already clean JSON", () => {
    expect(extractJson('{"a":1}')).toBe('{"a":1}');
  });

  it("strips a markdown ```json fence", () => {
    expect(extractJson("```json\n{\"a\":1}\n```")).toBe('{"a":1}');
  });

  it("strips a bare ``` fence", () => {
    expect(extractJson("```\n{\"a\":1}\n```")).toBe('{"a":1}');
  });

  it("extracts JSON from prose-wrapped output", () => {
    const raw = 'Here is the plan:\n{"summary":"x","routes":[]}\nHope that helps!';
    expect(extractJson(raw)).toBe('{"summary":"x","routes":[]}');
  });

  it("returns null when there is no JSON object at all", () => {
    expect(extractJson("just prose, no braces here")).toBeNull();
  });

  it("handles nested braces by matching the outermost balanced pair", () => {
    const raw = '{"a":{"b":2},"c":3}';
    expect(extractJson(raw)).toBe('{"a":{"b":2},"c":3}');
  });
});

describe("importPlanner.coercePlan", () => {
  it("coerces a well-formed plan into the ImportPlan shape", () => {
    const digest = fixtureDigest();
    const parsed = {
      summary: "A marketing landing page",
      routes: [{ source: "/", genesisPage: "/", isHome: true }],
      files: [{ genesisPath: "src/pages/Home.tsx", fromRepoPath: "src/pages/Index.tsx", translated: true, note: "home page" }],
      assets: [{ repoPath: "public/logo.png", genesisMediaName: "logo.png", rewriteIn: ["src/pages/Home.tsx"] }],
      dataCatalogs: [],
      backend: { detected: false, summary: "", options: [] },
      outOfScope: [],
      userNote: "We'll recreate your landing page on Genesis.",
    };
    const plan = coercePlan(parsed, digest);
    expect(plan.summary).toBe("A marketing landing page");
    expect(plan.routes).toHaveLength(1);
    expect(plan.routes[0].isHome).toBe(true);
    expect(plan.files).toHaveLength(1);
    expect(plan.files[0].genesisPath).toBe("src/pages/Home.tsx");
    expect(plan.assets[0].rewriteIn).toEqual(["src/pages/Home.tsx"]);
    expect(plan.backend.detected).toBe(false);
    expect(plan.userNote).toContain("recreate");
    expect(plan.error).toBeUndefined();
  });

  it("coerces the backend OPTIONS panel when backend deps are detected", () => {
    const digest = fixtureDigest();
    const parsed = {
      summary: "An app with Supabase",
      routes: [],
      files: [],
      assets: [],
      dataCatalogs: [],
      backend: {
        detected: true,
        summary: "Supabase project + 2 edge functions",
        options: [
          {
            key: "reuse-supabase",
            label: "Reuse your existing Supabase",
            agentDoes: "Wire the Genesis project to your existing Supabase via the connector.",
            userDoes: "Genesis → Settings → Connectors → Supabase; enter Project URL + Publishable key + Management token.",
            recommendedWhen: "You already own the Supabase project.",
          },
          {
            key: "dedicated-cloud",
            label: "Recreate on Genesis Dedicated Cloud",
            agentDoes: "Migrate schema + deploy edge functions + set secrets.",
            userDoes: "Enable Dedicated Cloud via Genesis → Settings → Dedicated Cloud.",
            recommendedWhen: "You want Genesis to own the backend.",
          },
          {
            key: "skip",
            label: "Skip backend for now",
            agentDoes: "Frontend only; backend is a manual follow-up.",
            userDoes: "Pick A or B later from the Builder.",
            recommendedWhen: "Static/marketing sites.",
          },
        ],
      },
      outOfScope: [],
      userNote: "Pick how you want the backend handled.",
    };
    const plan = coercePlan(parsed, digest);
    expect(plan.backend.detected).toBe(true);
    expect(plan.backend.summary).toContain("Supabase");
    expect(plan.backend.options).toHaveLength(3);
    expect(plan.backend.options[0].key).toBe("reuse-supabase");
    expect(plan.backend.options[0].userDoes).toContain("Connectors");
    expect(plan.backend.options[1].key).toBe("dedicated-cloud");
    expect(plan.backend.options[2].key).toBe("skip");
  });

  it("defaults missing fields to empty arrays/strings (fail-open, no throw)", () => {
    const digest = fixtureDigest();
    // Only summary provided; everything else missing.
    const plan = coercePlan({ summary: "partial" }, digest);
    expect(plan.summary).toBe("partial");
    expect(plan.routes).toEqual([]);
    expect(plan.files).toEqual([]);
    expect(plan.assets).toEqual([]);
    expect(plan.dataCatalogs).toEqual([]);
    expect(plan.backend.detected).toBe(false);
    expect(plan.backend.options).toEqual([]);
    expect(plan.outOfScope).toEqual([]);
    expect(plan.userNote).toBe("");
    expect(plan.error).toBeUndefined();
  });

  it("never throws on garbage input — coerces to an empty plan", () => {
    const digest = fixtureDigest();
    const plan = coercePlan("not an object", digest);
    expect(plan.routes).toEqual([]);
    expect(plan.summary).toBe("");
    // repo is always carried from the digest regardless of parse outcome
    expect(plan.repo).toEqual(digest.repo);
  });

  it("drops an unknown backend option key, falling back to 'skip'", () => {
    const digest = fixtureDigest();
    const parsed = {
      backend: {
        detected: true,
        summary: "x",
        options: [
          { key: "reuse-supabase", label: "A", agentDoes: "a", userDoes: "u", recommendedWhen: "r" },
          { key: "bogus-key", label: "B", agentDoes: "b", userDoes: "u2", recommendedWhen: "r2" },
        ],
      },
    };
    const plan = coercePlan(parsed, digest);
    expect(plan.backend.options).toHaveLength(2);
    expect(plan.backend.options[0].key).toBe("reuse-supabase");
    // unknown key falls back to "skip"
    expect(plan.backend.options[1].key).toBe("skip");
  });

  it("filters out an option with no label/agentDoes/userDoes (empty noise)", () => {
    const digest = fixtureDigest();
    const parsed = {
      backend: {
        detected: true,
        summary: "x",
        options: [
          { key: "reuse-supabase", label: "A", agentDoes: "a", userDoes: "u", recommendedWhen: "r" },
          { key: "skip", label: "", agentDoes: "", userDoes: "", recommendedWhen: "" },
        ],
      },
    };
    const plan = coercePlan(parsed, digest);
    expect(plan.backend.options).toHaveLength(1);
    expect(plan.backend.options[0].key).toBe("reuse-supabase");
  });

  it("always carries the repo metadata from the digest, not from the parsed output", () => {
    const digest = fixtureDigest();
    // parsed tries to override repo — should be ignored.
    const plan = coercePlan(
      { repo: { owner: "evil", name: "hijack", branch: "x" }, summary: "s" },
      digest
    );
    expect(plan.repo).toEqual(digest.repo);
  });
});
