import { createHash } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { query } from "../db/postgres";
import { maskFreeText } from "../modules/platform/audit.service";
import { buildAccessLog } from "./request-logger";

/**
 * Captured-error middleware (Super Admin L — Error Explorer).
 *
 * Mirrors the access-logger: once a response finishes, if it was a 4xx/5xx it is
 * deduped into `error_events` by a stable fingerprint (method + route + status
 * class + normalised message) and its count / last-seen bumped. Best-effort and
 * fully decoupled from the response — it never throws and never blocks.
 *
 * SECURITY: the stored `message` is masked (maskFreeText) and, for 4xx, is a
 * fully synthetic status/route string. We NEVER read the request body, headers,
 * cookies, tokens or an error stack — 5xx detail comes only from the masked
 * `res.locals.capturedError` the central error handler set.
 */

const STATUS_TEXT: Record<number, string> = {
  400: "Bad Request",
  401: "Unauthorized",
  403: "Forbidden",
  404: "Not Found",
  409: "Conflict",
  422: "Unprocessable Entity",
  429: "Too Many Requests",
  500: "Internal Server Error",
  502: "Bad Gateway",
  503: "Service Unavailable",
};

/** Collapse ids/uuids/digits in a route so distinct records share a fingerprint. */
function normalizeRoute(path: string): string {
  return (
    path
      .replace(
        /\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
        "/:id"
      )
      .replace(/\/\d+/g, "/:id") || "/"
  ).slice(0, 300);
}

/** Normalise a message for fingerprinting (lower-cased, ids/numbers collapsed). */
function normalizeMessage(msg: string): string {
  return msg
    .toLowerCase()
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ":id")
    .replace(/\d+/g, "#")
    .slice(0, 200);
}

async function capture(req: Request, res: Response): Promise<void> {
  const status = res.statusCode;
  const access = buildAccessLog(req, res, 0); // path/method/user are the only fields read
  const route = normalizeRoute(access.path);
  const method = access.method;
  const statusClass = `${Math.floor(status / 100)}xx`;
  const errorType = status >= 500 ? "server_error" : "client_error";

  // 5xx → the masked message the error handler stashed; 4xx → a safe synthetic one.
  const captured =
    typeof res.locals.capturedError === "string" ? res.locals.capturedError : "";
  const rawMessage =
    captured || `${status} ${STATUS_TEXT[status] ?? "Error"} — ${method} ${route}`;
  const message = String(maskFreeText(rawMessage)).slice(0, 500);

  const fingerprint = createHash("sha256")
    .update(`${method}|${route}|${statusClass}|${normalizeMessage(message)}`)
    .digest("hex");

  await query(
    `INSERT INTO error_events
       (fingerprint, route, method, status_code, error_type, message,
        last_request_id, last_actor_id, last_institution_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     ON CONFLICT (fingerprint) DO UPDATE SET
       count = error_events.count + 1,
       last_seen = now(),
       message = EXCLUDED.message,
       status_code = EXCLUDED.status_code,
       error_type = EXCLUDED.error_type,
       last_request_id = EXCLUDED.last_request_id,
       last_actor_id = EXCLUDED.last_actor_id,
       last_institution_id = EXCLUDED.last_institution_id`,
    [
      fingerprint,
      route,
      method,
      status,
      errorType,
      message,
      access.requestId,
      access.userId,
      access.institutionId,
    ]
  );
}

/** Records 4xx/5xx responses into `error_events`. Best-effort; never throws. */
export function errorCapture(_req: Request, res: Response, next: NextFunction): void {
  const req = _req;
  res.on("finish", () => {
    if (res.statusCode < 400) return;
    void capture(req, res).catch(() => undefined);
  });
  next();
}
