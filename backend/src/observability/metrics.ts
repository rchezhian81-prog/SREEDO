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
}

const state: State = {
  requestsTotal: 0,
  errorsTotal: 0,
  durationSumMs: 0,
  durationCount: 0,
  jobsSuccess: 0,
  jobsRetried: 0,
  jobsFailed: 0,
};

const byStatusClass = new Map<string, number>();

export function recordRequest(status: number, durationMs: number): void {
  state.requestsTotal += 1;
  if (status >= 500) state.errorsTotal += 1;
  state.durationSumMs += durationMs;
  state.durationCount += 1;
  const cls = `${Math.floor(status / 100)}xx`;
  byStatusClass.set(cls, (byStatusClass.get(cls) ?? 0) + 1);
}

export function recordJob(result: JobResult): void {
  if (result === "success") state.jobsSuccess += 1;
  else if (result === "failed") state.jobsFailed += 1;
  else state.jobsRetried += 1;
}

export interface MetricsSnapshot extends State {
  byStatusClass: Record<string, number>;
}

export function snapshot(): MetricsSnapshot {
  return { ...state, byStatusClass: Object.fromEntries(byStatusClass) };
}
