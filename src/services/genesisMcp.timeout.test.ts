import { afterEach, describe, expect, it, vi } from "vitest";
import { GenesisMcpClient } from "./genesisMcp.js";

describe("Genesis request timeout", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("times out while reading a response body that never finishes", async () => {
    vi.stubGlobal("fetch", vi.fn(async (_url: string, options: { signal: AbortSignal }) => ({
      status: 200,
      text: () => new Promise<string>((_resolve, reject) => {
        options.signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })), { once: true });
      }),
    })));
    const client = new GenesisMcpClient("https://genesis.example/api/agent/project/mcp", "token");
    const post = client as unknown as { post: (body: unknown, timeoutMs: number) => Promise<unknown> };
    await expect(post.post({}, 20)).rejects.toThrow("Genesis request timed out");
  });
});
