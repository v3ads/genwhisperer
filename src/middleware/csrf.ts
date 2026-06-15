import type { Request, Response, NextFunction } from "express";

/**
 * CSRF defense-in-depth for cookie-authenticated APIs.
 *
 * Auth rides on an httpOnly cookie, so any state-changing request must be proven
 * to originate from an allowed first-party origin. For unsafe methods we require
 * the `Origin` header (which browsers always send on cross-site POST/PUT/PATCH/
 * DELETE) to be in the allow-list. Requests with no Origin (same-origin GETs,
 * server-to-server, curl) are left alone; safe methods are never checked.
 *
 * This layers on top of CORS and the JSON content-type preflight rather than
 * replacing them, and intentionally does NOT touch the magic-link `GET /verify`
 * flow, which relies on top-level navigation.
 */
const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export function csrfOriginGuard(allowedOrigins: string[]) {
  const allowed = new Set(allowedOrigins);
  return (req: Request, res: Response, next: NextFunction) => {
    if (!UNSAFE_METHODS.has(req.method)) return next();

    const origin = req.get("origin");
    // No Origin header => not a browser cross-site request; allow.
    if (!origin) return next();

    if (allowed.has(origin)) return next();

    res.status(403).json({ error: "Cross-origin request blocked" });
  };
}
