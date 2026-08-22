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

  it("rejects a write_file with no path before recording or forwarding it", () => {
    const attempts = new Map<string, number>();
    const result = guardAgentToolCall(attempts, "genesis_write_file", {
      content: "export default function App() { return null; }",
    });

    expect(result).toMatchObject({
      allowed: false,
      errorName: "InvalidToolArguments",
    });
    if (!result.allowed) {
      expect(result.message).toContain("file path is required");
    }
    expect(attempts.size).toBe(0);
  });

  it("rejects an edit_file with no path before recording or forwarding it", () => {
    const attempts = new Map<string, number>();
    const result = guardAgentToolCall(attempts, "genesis_edit_file", {
      old_string: "old",
      new_string: "new",
    });

    expect(result).toMatchObject({
      allowed: false,
      errorName: "InvalidToolArguments",
    });
    if (!result.allowed) {
      expect(result.message).toContain("file path is required");
    }
    expect(attempts.size).toBe(0);
  });

  it("rejects an edit_file with a missing old_string before recording or forwarding it", () => {
    const attempts = new Map<string, number>();
    const result = guardAgentToolCall(attempts, "genesis_edit_file", {
      path: "src/App.tsx",
      new_string: "new",
    });

    expect(result).toMatchObject({
      allowed: false,
      errorName: "InvalidToolArguments",
    });
    if (!result.allowed) {
      expect(result.message).toContain("old_string");
    }
    expect(attempts.size).toBe(0);
  });

  it("rejects an edit_file with a missing new_string before recording or forwarding it", () => {
    const attempts = new Map<string, number>();
    const result = guardAgentToolCall(attempts, "genesis_edit_file", {
      path: "src/App.tsx",
      old_string: "old",
    });

    expect(result).toMatchObject({
      allowed: false,
      errorName: "InvalidToolArguments",
    });
    if (!result.allowed) {
      expect(result.message).toContain("new_string");
    }
    expect(attempts.size).toBe(0);
  });

  it("allows one complete file edit, then blocks the same edit before it can execute again", () => {
    const attempts = new Map<string, number>();
    const args = { path: "src/App.tsx", old_string: "old", new_string: "new" };

    const first = guardAgentToolCall(attempts, "genesis_edit_file", args);
    const duplicate = guardAgentToolCall(attempts, "genesis_edit_file", args);

    expect(first).toEqual({ allowed: true });
    expect(duplicate).toMatchObject({
      allowed: false,
      errorName: "DuplicateToolCallBlocked",
    });
  });

  it("allows a corrected edit_file after an arg-rejected attempt (rejected calls are not recorded)", () => {
    const attempts = new Map<string, number>();
    // First attempt is rejected for missing path — must NOT be recorded.
    const rejected = guardAgentToolCall(attempts, "genesis_edit_file", {
      old_string: "old",
      new_string: "new",
    });
    expect(rejected).toMatchObject({ allowed: false, errorName: "InvalidToolArguments" });
    expect(attempts.size).toBe(0);

    // Corrected retry with a valid path succeeds and is not seen as a duplicate.
    const corrected = guardAgentToolCall(attempts, "genesis_edit_file", {
      path: "src/App.tsx",
      old_string: "old",
      new_string: "new",
    });
    expect(corrected).toEqual({ allowed: true });
  });
});
