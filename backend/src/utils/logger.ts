import { env } from "../config/env";

type Level = "info" | "warn" | "error";

/**
 * Minimal structured JSON logger to stdout (one line per event), suitable for
 * external aggregation (Loki/CloudWatch/etc.). Suppressed under tests to keep
 * test output clean. Callers MUST pass only safe, curated fields — never request
 * bodies, headers, tokens, passwords or payment data.
 */
export function log(level: Level, message: string, fields: Record<string, unknown> = {}): void {
  if (env.nodeEnv === "test") return;
  const line = JSON.stringify({ level, ts: new Date().toISOString(), msg: message, ...fields });
  if (level === "error") console.error(line);
  else console.log(line);
}

/** Logs an error with the stack included only outside production. */
export function logError(message: string, err: unknown, fields: Record<string, unknown> = {}): void {
  const base: Record<string, unknown> = {
    ...fields,
    error: err instanceof Error ? err.message : String(err),
  };
  if (!env.isProduction && err instanceof Error && err.stack) base.stack = err.stack;
  log("error", message, base);
}
