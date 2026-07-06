/**
 * In-process metrics registry (counters/gauges). Process-local and reset on
 * restart — the standard model for Prometheus-style scraping. Live gauges that
 * must be accurate (queue depth, run counts) are queried from the DB at scrape
 * time rather than tracked here.
 */

export type JobResult = "success" | "retry" | "failed";

interface State {
  requestsTotal: number;
  errorsTotal: number; // status >= 500
  durationSumMs: number;
  durationCount: number;
  jobsSuccess: number;
  jobsRetried: number;
  jobsFailed: number;
  backupsSuccess: number;
  backupsFailed: number;
  restoresSuccess: number;
  restoresFailed: number;
}

const state: State = {
  requestsTotal: 0,
  errorsTotal: 0,
  durationSumMs: 0,
  durationCount: 0,
  jobsSuccess: 0,
  jobsRetried: 0,
  jobsFailed: 0,
  backupsSuccess: 0,
  backupsFailed: 0,
  restoresSuccess: 0,
  restoresFailed: 0,
};

const byStatusClass = new Map<string, number>();

// --- Per-route latency tracking (Super Admin L — performance view) ----------
//
// A capped, in-process registry of per-route request stats used to compute p95
// latency and the slowest routes "since deployment". Reset on restart (like the
// counters above). Both the number of distinct routes and the per-route sample
// buffer are capped so memory stays bounded no matter how many distinct paths
// are hit. Route keys are normalised (ids collapsed to :id) to keep cardinality
// meaningful and the map small.

interface RouteStat {
  count: number;
  errors: number; // status >= 500
  sumMs: number;
  samples: number[]; // recent durations, capped for a rolling p95
}

const ROUTE_CAP = 200; // max distinct routes tracked
const SAMPLE_CAP = 200; // max latency samples retained per route
const perRoute = new Map<string, RouteStat>();

/** Collapse UUIDs / numeric id segments to `:id` so per-route cardinality stays
 *  bounded and meaningful (e.g. /students/<uuid> → /students/:id). */
function normalizeRoute(path: string): string {
  return (
    path
      .replace(
        /\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
        "/:id"
      )
      .replace(/\/\d+/g, "/:id") || "/"
  ).slice(0, 200);
}

function recordRoute(route: string, status: number, durationMs: number): void {
  const key = normalizeRoute(route);
  let stat = perRoute.get(key);
  if (!stat) {
    if (perRoute.size >= ROUTE_CAP) return; // registry full — drop new routes
    stat = { count: 0, errors: 0, sumMs: 0, samples: [] };
    perRoute.set(key, stat);
  }
  stat.count += 1;
  if (status >= 500) stat.errors += 1;
  stat.sumMs += durationMs;
  stat.samples.push(durationMs);
  if (stat.samples.length > SAMPLE_CAP) stat.samples.shift();
}

/** Nearest-rank percentile from a sample array (0 when empty). */
function percentile(samples: number[], p: number): number {
  if (samples.length === 0) return 0;
  const sorted = [...samples].sort((a, b) => a - b);
  const rank = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return Math.round(sorted[Math.max(0, rank)]);
}

export interface PerRouteStat {
  route: string;
  count: number;
  errors: number;
  avgMs: number;
  p95Ms: number;
}

/** Snapshot of per-route request stats (avg + p95), busiest first. */
export function perRouteSnapshot(): PerRouteStat[] {
  const out: PerRouteStat[] = [];
  for (const [route, s] of perRoute) {
    out.push({
      route,
      count: s.count,
      errors: s.errors,
      avgMs: s.count ? Math.round(s.sumMs / s.count) : 0,
      p95Ms: percentile(s.samples, 95),
    });
  }
  return out.sort((a, b) => b.count - a.count);
}

/** The `n` slowest routes by p95 latency (only routes with real traffic). */
export function topSlowRoutes(n = 10): PerRouteStat[] {
  return perRouteSnapshot()
    .filter((r) => r.count > 0)
    .sort((a, b) => b.p95Ms - a.p95Ms)
    .slice(0, n);
}

export function recordRequest(status: number, durationMs: number, route?: string): void {
  state.requestsTotal += 1;
  if (status >= 500) state.errorsTotal += 1;
  state.durationSumMs += durationMs;
  state.durationCount += 1;
  const cls = `${Math.floor(status / 100)}xx`;
  byStatusClass.set(cls, (byStatusClass.get(cls) ?? 0) + 1);
  if (route) recordRoute(route, status, durationMs);
}

export function recordJob(result: JobResult): void {
  if (result === "success") state.jobsSuccess += 1;
  else if (result === "failed") state.jobsFailed += 1;
  else state.jobsRetried += 1;
}

export function recordBackup(result: "success" | "failed"): void {
  if (result === "success") state.backupsSuccess += 1;
  else state.backupsFailed += 1;
}

export function recordRestore(result: "success" | "failed"): void {
  if (result === "success") state.restoresSuccess += 1;
  else state.restoresFailed += 1;
}

export interface MetricsSnapshot extends State {
  byStatusClass: Record<string, number>;
}

export function snapshot(): MetricsSnapshot {
  return { ...state, byStatusClass: Object.fromEntries(byStatusClass) };
}
