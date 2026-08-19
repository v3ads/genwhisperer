import { describe, expect, it } from "vitest";
import { guardAgentToolCall } from "./agentToolGuard.js";

describe("guardAgentToolCall", () => {
  it("allows one complete file write, then blocks the same write before it can execute again", () => {
    const attempts = new Map<string, number>();
    const args = { path: "src/App.tsx", content: "export default function App() { return null; }" };

    const first = guardAgentToolCall(attempts, "genesis_write_file", args);
    const duplicate = guardAgentToolCall(attempts, "genesis_write_file", args);

    expect(first).toEqual({ allowed: true });
    expect(duplicate).toMatchObject({
      allowed: false,
      errorName: "DuplicateToolCallBlocked",
    });
    if (!duplicate.allowed) {
      expect(duplicate.message).toContain("stopped here");
    }
  });

  it("rejects an empty file write before recording or forwarding it", () => {
    const attempts = new Map<string, number>();
    const result = guardAgentToolCall(attempts, "genesis_write_file", {
      path: "src/App.css",
      content: "   ",
    });

    expect(result).toMatchObject({
      allowed: false,
      errorName: "InvalidToolArguments",
    });
    expect(attempts.size).toBe(0);
  });
});
