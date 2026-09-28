import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ sendEmail: vi.fn() }));
vi.mock("./brevo.js", () => ({ sendEmail: mocks.sendEmail }));
vi.mock("../db/index.js", () => ({ db: {}, genesisProjects: {} }));

import { reportUnexpectedError, SUPPORT_MESSAGE } from "./errorReporting.js";

describe("unexpected server failure reporting", () => {
  beforeEach(() => mocks.sendEmail.mockReset());

  it("emails the owner with project, time, and error while escaping HTML", async () => {
    mocks.sendEmail.mockResolvedValue(undefined);
    await reportUnexpectedError({
      error: new Error("OpenRouter returned 500 <script>alert(1)</script>"),
      method: "POST",
      path: "/api/agent/message",
      projectId: 42,
      projectName: "Brett's <Agency>",
      requestId: "req-123",
      occurredAt: new Date("2026-09-28T10:00:00Z"),
    });

    const email = mocks.sendEmail.mock.calls[0][0];
    expect(email.to).toBe("vipaymanshalaby@gmail.com");
    expect(email.textContent).toContain("2026-09-28T10:00:00.000Z");
    expect(email.textContent).toContain("Brett's <Agency> (ID 42)");
    expect(email.textContent).toContain("OpenRouter returned 500");
    expect(email.htmlContent).toContain("Brett&#39;s &lt;Agency&gt;");
    expect(email.htmlContent).not.toContain("<script>");
    expect(SUPPORT_MESSAGE).toContain("support@genwhisperer.com");
  });

  it("does not throw or replace the customer response when email delivery fails", async () => {
    mocks.sendEmail.mockImplementationOnce(async () => { throw new Error("Brevo unavailable"); });
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await expect(reportUnexpectedError({ error: "HTTP 500", method: "GET", path: "/api/profile" })).resolves.toBeUndefined();
      expect(log).toHaveBeenCalledWith("[Error alert] Email delivery failed:", "Brevo unavailable");
    } finally {
      log.mockRestore();
    }
  });
});
