// Hot-endpoint scenarios for the load/performance suite. Pure data (no network),
// so it can be validated in CI without a running server.

export type ScenarioAuth = "none" | "staff" | "super";

export interface Scenario {
  /** Stable id, e.g. "dashboard:stats". */
  name: string;
  method: "GET" | "POST";
  /** Path relative to the API base (e.g. http://host/api/v1). May contain the
   *  `{today}` token, replaced with the current date at run time. */
  path: string;
  auth: ScenarioAuth;
  /** P95 latency budget in ms. Gated conservatively on autocannon's p97.5 (≥ p95),
   *  so passing the gate guarantees the P95 target is met. */
  thresholdMs: number;
  /** Cache-backed hot read (subject to the 300 ms target). */
  cached?: boolean;
  /** The login scenario; its body is filled from the configured staff creds. */
  isLogin?: boolean;
  /** Measured and reported but NOT gated — e.g. login, whose latency is
   *  bcrypt-bound by design (a deliberate security cost, not a system bottleneck)
   *  and is naturally high under heavy concurrency. The 300 ms target is for
   *  cached hot READ endpoints, not auth. */
  informational?: boolean;
}

/** Default P95 budget for cached hot read endpoints at seeded scale. */
export const HOT_READ_P95_MS = 300;

export const scenarios: Scenario[] = [
  { name: "auth:login", method: "POST", path: "/auth/login", auth: "none", thresholdMs: 1500, isLogin: true, informational: true },
  { name: "dashboard:stats", method: "GET", path: "/dashboard/stats", auth: "staff", thresholdMs: HOT_READ_P95_MS, cached: true },
  { name: "students:list", method: "GET", path: "/students?limit=25", auth: "staff", thresholdMs: HOT_READ_P95_MS },
  { name: "staff:list", method: "GET", path: "/teachers?limit=25", auth: "staff", thresholdMs: HOT_READ_P95_MS },
  { name: "attendance:summary", method: "GET", path: "/attendance?date={today}", auth: "staff", thresholdMs: HOT_READ_P95_MS },
  { name: "fees:summary", method: "GET", path: "/fees/summary", auth: "staff", thresholdMs: HOT_READ_P95_MS, cached: false },
  { name: "reports:center", method: "GET", path: "/report-center", auth: "staff", thresholdMs: 400 },
  { name: "timetable:reads", method: "GET", path: "/timetable/entries", auth: "staff", thresholdMs: HOT_READ_P95_MS },
  { name: "rbac:catalogue", method: "GET", path: "/platform/permissions", auth: "super", thresholdMs: HOT_READ_P95_MS, cached: true },
  { name: "rbac:matrix", method: "GET", path: "/platform/roles", auth: "super", thresholdMs: HOT_READ_P95_MS, cached: true },
];
