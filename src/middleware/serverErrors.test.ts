import express from "express";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ report: vi.fn(async () => {}) }));
vi.mock("../services/errorReporting.js", () => ({
  SUPPORT_MESSAGE: "Please contact support@genwhisperer.com.",
  reportUnexpectedError: mocks.report,
}));

import { supportOnServerError } from "./serverErrors.js";

describe("server error responses", () => {
  afterEach(() => mocks.report.mockClear());

  it("hides a 500 and alerts with the requested project id", async () => {
    const app = express();
    app.use(express.json());
    app.use(supportOnServerError);
    app.post("/api/agent/message", (_req, res) => res.status(500).json({ error: "Internal server error" }));
    const server = app.listen(0);
    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("No test port");
      const response = await fetch(`http://127.0.0.1:${address.port}/api/agent/message`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ genesisProjectId: 42 }),
      });
      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({ error: "Please contact support@genwhisperer.com." });
      expect(mocks.report).toHaveBeenCalledWith(expect.objectContaining({
        projectId: 42, method: "POST", path: "/api/agent/message", error: "Internal server error",
      }));
    } finally {
      server.close();
    }
  });

  it("keeps an actionable 413 and does not send an internal-error alert", async () => {
    const app = express();
    app.use(supportOnServerError);
    app.get("/api/image", (_req, res) => res.status(413).json({ error: "Choose a smaller image." }));
    const server = app.listen(0);
    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("No test port");
      const response = await fetch(`http://127.0.0.1:${address.port}/api/image`);
      expect(await response.json()).toEqual({ error: "Choose a smaller image." });
      expect(mocks.report).not.toHaveBeenCalled();
    } finally {
      server.close();
    }
  });
});
