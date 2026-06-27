import crypto from "node:crypto";
import type { NextFunction, Request, Response } from "express";

/**
 * Correlation id: reuse a sane incoming `x-request-id`, otherwise generate one.
 * Stored on the request and echoed in the response so a client/log line can be
 * traced end-to-end.
 */
export function requestContext(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.get("x-request-id");
  const id = incoming && /^[\w.\-]{1,200}$/.test(incoming) ? incoming : crypto.randomUUID();
  req.requestId = id;
  res.setHeader("x-request-id", id);
  next();
}
