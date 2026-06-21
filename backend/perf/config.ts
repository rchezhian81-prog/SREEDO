// Runtime configuration for the performance runner — all from env, no secrets in
// source. Credentials are only needed for the actual run (local/staging), never
// for CI validation.

export interface Credentials {
  email: string;
  password: string;
}

export interface PerfConfig {
  /** API base, e.g. http://localhost:4000/api/v1 (trailing slash trimmed). */
  baseUrl: string;
  staff: Credentials | null;
  super: Credentials | null;
  /** Concurrent connections per scenario. */
  connections: number;
  /** Seconds each scenario runs. */
  durationSec: number;
  /** Warm the cache with one request before measuring (so the first hit isn't a miss). */
  warmup: boolean;
  /** When true, threshold breaches are reported but do not fail the process. */
  soft: boolean;
}

function creds(emailKey: string, passwordKey: string): Credentials | null {
  const email = process.env[emailKey];
  const password = process.env[passwordKey];
  return email && password ? { email, password } : null;
}

export function loadConfig(): PerfConfig {
  return {
    baseUrl: (process.env.PERF_BASE_URL ?? "http://localhost:4000/api/v1").replace(/\/+$/, ""),
    staff: creds("PERF_STAFF_EMAIL", "PERF_STAFF_PASSWORD"),
    super: creds("PERF_SUPER_EMAIL", "PERF_SUPER_PASSWORD"),
    connections: Math.max(1, Number(process.env.PERF_CONNECTIONS ?? 10)),
    durationSec: Math.max(1, Number(process.env.PERF_DURATION ?? 10)),
    warmup: process.env.PERF_WARMUP !== "false",
    soft: process.env.PERF_SOFT === "true",
  };
}
