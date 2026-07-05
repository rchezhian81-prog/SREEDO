import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import { ApiError } from "../utils/api-error";
import { env } from "../config/env";
import { maskFreeText } from "../modules/platform/audit.service";

export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({ error: `Route not found: ${req.method} ${req.path}` });
}

/** Stash a masked, truncated error message on res.locals so the error-capture
 *  middleware can record a useful (but secret-free) 5xx message. Never stores a
 *  stack, headers, cookies or the request body. */
function stashCapturedError(res: Response, message: string): void {
  res.locals.capturedError = String(maskFreeText(message)).slice(0, 500);
}

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  if (err instanceof ZodError) {
    res.status(400).json({
      error: "Validation failed",
      details: err.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    });
    return;
  }

  if (err instanceof ApiError) {
    // Only 5xx ApiErrors are captured (server faults) — 4xx are client errors.
    if (err.statusCode >= 500) stashCapturedError(res, err.message);
    res.status(err.statusCode).json({
      error: err.message,
      ...(err.details !== undefined ? { details: err.details } : {}),
    });
    return;
  }

  // PostgreSQL unique violation → friendly conflict response
  if (isPgError(err) && err.code === "23505") {
    res.status(409).json({ error: "A record with that value already exists" });
    return;
  }
  // PostgreSQL foreign key violation
  if (isPgError(err) && err.code === "23503") {
    res.status(400).json({ error: "Referenced record does not exist" });
    return;
  }

  console.error("Unhandled error:", err);
  stashCapturedError(res, err instanceof Error ? err.message : "Internal server error");
  res.status(500).json({
    error: "Internal server error",
    ...(env.isProduction ? {} : { details: String(err) }),
  });
}

function isPgError(err: unknown): err is { code: string } {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    typeof (err as { code: unknown }).code === "string"
  );
}
