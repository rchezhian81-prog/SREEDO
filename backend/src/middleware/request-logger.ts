import type { NextFunction, Request, Response } from "express";
import { log } from "../utils/logger";
import { recordRequest } from "../observability/metrics";

export interface AccessLog {
  requestId: string | null;
  method: string;
  path: string;
  status: number;
  durationMs: number;
  userId: string | null;
  institutionId: string | null;
  role: string | null;
  ip: string | null;
  userAgent: string | null;
}

/**
 * Builds the structured access-log record. Only curated, safe fields are
 * included — never headers, request bodies, query strings, tokens, passwords or
 * payment data — so the log can never leak secrets by construction. `user`
 * context is read from `req.user` (set by `authenticate`) when present.
 */
export function buildAccessLog(req: Request, res: Response, durationMs: number): AccessLog {
  return {
    requestId: req.requestId ?? null,
    method: req.method,
    // Path only — the query string is dropped so a stray ?token=… never lands in logs.
    path: req.originalUrl.split("?")[0],
    status: res.statusCode,
    durationMs,
    userId: req.user?.id ?? null,
    institutionId: req.user?.institutionId ?? null,
    role: req.user?.role ?? null,
    ip: req.ip ?? null,
    userAgent: req.get("user-agent") ?? null,
  };
}

/** Structured access logging + request metrics, emitted once the response ends. */
export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const start = Date.now();
  res.on("finish", () => {
    const durationMs = Date.now() - start;
    recordRequest(res.statusCode, durationMs);
    const entry = buildAccessLog(req, res, durationMs);
    log(res.statusCode >= 500 ? "error" : "info", "request", entry as unknown as Record<string, unknown>);
  });
  next();
}
