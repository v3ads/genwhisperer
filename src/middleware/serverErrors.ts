import type { NextFunction, Request, Response } from "express";
import type { AuthRequest } from "./auth.js";
import { reportUnexpectedError, SUPPORT_MESSAGE } from "../services/errorReporting.js";

function projectIdFrom(req: Request): number | undefined {
  const raw = req.body?.genesisProjectId ?? req.body?.projectId ??
    (req.path.startsWith("/api/projects/") ? req.params?.id : undefined);
  const id = Number(raw);
  return Number.isSafeInteger(id) && id > 0 ? id : undefined;
}

function alert(req: Request, res: Response, error: unknown): void {
  const userId = (req as AuthRequest).user?.id;
  const requestId = res.getHeader("X-Agent-Request-Id") ?? res.getHeader("X-Import-Request-Id");
  void reportUnexpectedError({
    error,
    method: req.method,
    path: req.path,
    projectId: projectIdFrom(req),
    userId,
    requestId: typeof requestId === "string" ? requestId : undefined,
  });
}

/** Ensure every JSON server failure is safe to display and alerts the owner. */
export function supportOnServerError(req: Request, res: Response, next: NextFunction): void {
  const originalJson = res.json.bind(res);
  res.json = ((body: unknown) => {
    if (res.statusCode >= 500 && req.path.startsWith("/api/")) {
      alert(req, res, res.locals.failureError ?? (body as { error?: unknown })?.error ?? `HTTP ${res.statusCode}`);
      return originalJson({ error: SUPPORT_MESSAGE });
    }
    return originalJson(body);
  }) as typeof res.json;
  next();
}

export function reportStreamError(req: Request, res: Response, error: unknown): void {
  alert(req, res, error);
}
