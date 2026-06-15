import { SignJWT, jwtVerify } from "jose";
import { nanoid } from "nanoid";

const ALG = "HS256";
const EXPIRY = "365d";
/** 365 days in seconds — must match EXPIRY above */
export const SESSION_TTL_SECONDS = 365 * 24 * 60 * 60;

export interface SessionPayload {
  userId: number;
  email: string;
  role: "user" | "admin";
  /** JWT ID — used for revocation blocklist */
  jti: string;
}

function getSecret(): Uint8Array {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET is not set");
  return new TextEncoder().encode(secret);
}

export async function signSession(payload: Omit<SessionPayload, "jti">): Promise<string> {
  const jti = nanoid(32);
  return new SignJWT({ ...payload, jti })
    .setProtectedHeader({ alg: ALG })
    .setIssuedAt()
    .setJti(jti)
    .setExpirationTime(EXPIRY)
    .sign(getSecret());
}

export async function verifySession(token: string): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret(), { algorithms: [ALG] });
    const { userId, email, role, jti } = payload as Record<string, unknown>;
    if (
      typeof userId !== "number" ||
      typeof email !== "string" ||
      typeof role !== "string" ||
      typeof jti !== "string"
    ) {
      return null;
    }
    return { userId, email, role: role as "user" | "admin", jti };
  } catch {
    return null;
  }
}

/**
 * Extract the jti from a JWT token, verifying signature and expiry first.
 * Used during logout to add the still-valid token to the revocation blocklist.
 * (An already-expired token returns null — it is rejected by auth anyway, so it
 * does not need to be blocklisted.)
 */
export async function extractJti(token: string): Promise<string | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret(), { algorithms: [ALG] });
    const jti = payload.jti;
    return typeof jti === "string" ? jti : null;
  } catch {
    return null;
  }
}
