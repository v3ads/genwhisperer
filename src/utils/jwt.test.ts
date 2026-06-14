import { describe, it, expect, beforeAll } from "vitest";
import { signSession, verifySession } from "./jwt.js";

beforeAll(() => {
  process.env.JWT_SECRET = "test-jwt-secret-32chars-minimum!!";
});

describe("JWT session", () => {
  it("signs and verifies a session payload", async () => {
    const payload = { userId: 42, email: "test@example.com", role: "user" as const };
    const token = await signSession(payload);
    expect(typeof token).toBe("string");
    expect(token.split(".")).toHaveLength(3);

    const verified = await verifySession(token);
    expect(verified).not.toBeNull();
    expect(verified!.userId).toBe(42);
    expect(verified!.email).toBe("test@example.com");
    expect(verified!.role).toBe("user");
  });

  it("returns null for an invalid token", async () => {
    const result = await verifySession("not.a.valid.token");
    expect(result).toBeNull();
  });

  it("returns null for an empty string", async () => {
    const result = await verifySession("");
    expect(result).toBeNull();
  });
});
