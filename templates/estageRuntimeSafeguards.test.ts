import { describe, expect, it, vi } from "vitest";
import {
  invokeEstageCapability,
  type SafeTelemetryEvent,
} from "./estageRuntimeSafeguards.js";

describe("invokeEstageCapability retry boundaries", () => {
  it("retries a transient idempotent read once, then returns the successful value", async () => {
    const run = vi
      .fn<() => Promise<{ id: string }>>()
      .mockRejectedValueOnce(new TypeError("network unavailable"))
      .mockResolvedValueOnce({ id: "thread_1" });
    const events: SafeTelemetryEvent[] = [];

    const result = await invokeEstageCapability({
      capability: "community",
      operation: "fetch_threads",
      available: true,
      run,
      unavailableMessage: "Community is unavailable.",
      failureMessage: "Threads could not be loaded.",
      retryMode: "idempotent-read",
      telemetry: (event) => events.push(event),
    });

    expect(result).toEqual({ ok: true, value: { id: "thread_1" }, attempts: 2 });
    expect(run).toHaveBeenCalledTimes(2);
    expect(events.map((event) => event.outcome)).toEqual(["retrying", "succeeded"]);
  });

  it("does not replay a side-effecting call after a transient network failure", async () => {
    let externalWriteCount = 0;
    const run = vi.fn(async () => {
      externalWriteCount += 1;
      throw new TypeError("connection dropped after request dispatch");
    });

    const result = await invokeEstageCapability({
      capability: "connector",
      operation: "send_notification",
      available: true,
      run,
      unavailableMessage: "Notifications are unavailable.",
      failureMessage: "Notification could not be confirmed. Please retry manually.",
      retryMode: "never",
    });

    expect(result).toEqual({
      ok: false,
      code: "FAILED",
      message: "Notification could not be confirmed. Please retry manually.",
      attempts: 1,
    });
    expect(run).toHaveBeenCalledTimes(1);
    expect(externalWriteCount).toBe(1);
  });

  it("does not retry an idempotent read when the failure is not a transient network error", async () => {
    const run = vi.fn(async () => {
      throw new Error("feature rejected the request");
    });

    const result = await invokeEstageCapability({
      capability: "blog",
      operation: "load_posts",
      available: true,
      run,
      unavailableMessage: "Blog is unavailable.",
      failureMessage: "Posts could not be loaded.",
      retryMode: "idempotent-read",
    });

    expect(result).toMatchObject({ ok: false, code: "FAILED", attempts: 1 });
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("short-circuits unavailable capabilities without executing the action", async () => {
    const run = vi.fn(async () => "should never run");

    const result = await invokeEstageCapability({
      capability: "ai",
      operation: "summarize",
      available: false,
      run,
      unavailableMessage: "AI summaries are not enabled for this site.",
      failureMessage: "Summary failed.",
      retryMode: "never",
    });

    expect(result).toEqual({
      ok: false,
      code: "UNAVAILABLE",
      message: "AI summaries are not enabled for this site.",
      attempts: 0,
    });
    expect(run).not.toHaveBeenCalled();
  });
});
