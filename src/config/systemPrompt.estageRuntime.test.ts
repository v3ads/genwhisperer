import { describe, expect, it } from "vitest";
import { buildSystemPrompt } from "./systemPrompt.js";

describe("eStage runtime generation guidance", () => {
  it("injects feature detection, retry boundaries, and credential-safety rules", () => {
    const prompt = buildSystemPrompt([{ name: "genesis_context", description: "Context" }]);

    expect(prompt).toContain("feature-detect the exact global and method");
    expect(prompt).toContain("Retry only idempotent reads, at most once");
    expect(prompt).toContain("Never automatically retry AI calls, connector sends, uploads");
    expect(prompt).toContain("Never place API keys, connector secrets");
    expect(prompt).toContain("estageConnectorPresign");
    expect(prompt).toContain("estage_kb_query before generating or editing the integration");
  });
});
