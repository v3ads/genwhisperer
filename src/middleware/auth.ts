import type { Request, Response, NextFunction } from "express";
import { verifySession } from "../utils/jwt.js";
import { db, users, revokedSessions } from "../db/index.js";
import { eq } from "drizzle-orm";

export interface AuthRequest extends Request {
  user?: {
    id: number;
    email: string;
    role: "user" | "admin";
    suspended: boolean;
  };
}

export async function requireAuth(req: AuthRequest, res: Response, next: NextFunction) {
  const token = req.cookies?.gw_session;
  if (!token) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const session = await verifySession(token);
  if (!session) {
    res.status(401).json({ error: "Invalid or expired session" });
    return;
  }

  // Check if this jti has been revoked (i.e. the user has logged out)
  const revoked = await db
    .select()
    .from(revokedSessions)
    .where(eq(revokedSessions.jti, session.jti))
    .limit(1);
  if (revoked.length > 0) {
    res.status(401).json({ error: "Session has been revoked. Please sign in again." });
    return;
  }

  // Fetch fresh user from DB to get current role/suspended state
  const rows = await db.select().from(users).where(eq(users.id, session.userId)).limit(1);
  const user = rows[0];
  if (!user) {
    res.status(401).json({ error: "User not found" });
    return;
  }

  if (user.suspended) {
    res.status(403).json({ error: "Account suspended" });
    return;
  }

  req.user = { id: user.id, email: user.email, role: user.role, suspended: user.suspended };
  next();
}

export function requireAdmin(req: AuthRequest, res: Response, next: NextFunction) {
  if (!req.user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  if (req.user.role !== "admin") {
    res.status(403).json({ error: "Forbidden: admin only" });
    return;
  }
  next();
}
