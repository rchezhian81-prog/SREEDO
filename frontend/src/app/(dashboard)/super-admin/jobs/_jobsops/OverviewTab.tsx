"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { api, ApiError } from "@/lib/api";
import { Badge, Button, Card, EmptyState, ErrorNote, Input, Spinner } from "@/components/ui";
import { Icon } from "@/components/icons";
import type { JobsDashboard, JobWindow } from "@/types";
import type { JobsTab } from "../page";
import { formatNumber } from "../../platform/_utils";
import {
  JOB_WINDOWS,
  alertStatusTone,
  formatDateTime,
  formatDuration,
  humanizeToken,
  severityTone,
  shortId,
  titleCase,
  windowLabel,
} from "./taxonomy";

export function OverviewTab({
  reloadKey,
  onJump,
}: {
  reloadKey: number;
  onJump: (tab: JobsTab) => void;
}) {
  const [window, setWindow] = useState<JobWindow>("24h");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [data, setData] = useState<JobsDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const query = useMemo(() => {
    const p = new URLSearchParams();
    p.set("window", window);
    if (window === "custom") {
      if (dateFrom) p.set("dateFrom", dateFrom);
      if (dateTo) p.set("dateTo", dateTo);
    }
    return p.toString();
  }, [window, dateFrom, dateTo]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await api.get<JobsDashboard>(`/jobs-ops/summary?${query}`));
    } catch (err) {
      setData(null);
      setError(err instanceof ApiError ? err.message : "Failed to load the jobs dashboard");
    } finally {
      setLoading(false);
    }
  }, [query]);

  useEffect(() => {
    load();
  }, [load, reloadKey]);

  const total = data
    ? data.statuses.pending +
      data.statuses.running +
      data.statuses.success +
      data.statuses.failed +
      data.statuses.cancelled +
      data.statuses.dead_letter
    : 0;

  return (
    <section className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <WindowSelector
          value={window}
          onValue={setWindow}
          dateFrom={dateFrom}
          dateTo={dateTo}
          onDateFrom={setDateFrom}
          onDateTo={setDateTo}
        />
      </div>

      <ErrorNote message={error} />

      {loading ? (
        <Spinner />
      ) : data ? (
        <>
          {/* Queue status (live snapshot) */}
          <div>
            <SectionHeading>Queue status</SectionHeading>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
              <StatCard label="Total jobs" value={formatNumber(total)} />
              <StatCard label="Pending" value={formatNumber(data.statuses.pending)} />
              <StatCard label="Running" value={formatNumber(data.statuses.running)} />
              <StatCard label="Completed" value={formatNumber(data.statuses.success)} />
              <StatCard
                label="Failed"
                value={formatNumber(data.statuses.failed)}
                tone={data.statuses.failed > 0 ? "red" : undefined}
              />
              <StatCard label="Cancelled" value={formatNumber(data.statuses.cancelled)} />
              <StatCard
                label="Dead-letter"
                value={formatNumber(data.statuses.dead_letter)}
                tone={data.statuses.dead_letter > 0 ? "red" : undefined}
              />
              <StatCard label="Queue depth" value={formatNumber(data.queueDepth)} sub={<span className="text-xs text-faint">pending + running</span>} />
              <StatCard
                label="Stuck"
                value={formatNumber(data.stuck)}
                tone={data.stuck > 0 ? "amber" : undefined}
                sub={<span className="text-xs text-faint">running &gt; 10m</span>}
              />
              <StatCard
                label="Needs attention"
                value={formatNumber(data.jobsNeedingAttention)}
                tone={data.jobsNeedingAttention > 0 ? "red" : undefined}
                sub={
                  <button
                    onClick={() => onJump("jobs")}
                    className="text-xs font-medium text-brand-600 hover:underline"
                  >
                    View jobs →
                  </button>
                }
              />
            </div>
          </div>

          {/* Throughput (windowed) */}
          <div>
            <SectionHeading>
              Throughput · {windowLabel(data.window)}
            </SectionHeading>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
              <StatCard label="Retried" value={formatNumber(data.retriedInWindow)} />
              <StatCard
                label="Failed"
                value={formatNumber(data.failedInWindow)}
                tone={data.failedInWindow > 0 ? "amber" : undefined}
              />
              <StatCard
                label="Failure rate"
                value={`${data.failureRatePct}%`}
                tone={data.failureRatePct > 0 ? "amber" : undefined}
              />
              <StatCard label="Avg duration" value={formatDuration(data.avgJobDurationMs)} />
              <StatCard
                label="Longest running"
                value={data.longestRunningJob ? formatDuration(data.longestRunningJob.ageMs) : "—"}
                sub={
                  data.longestRunningJob ? (
                    <span className="text-xs text-faint">{data.longestRunningJob.type}</span>
                  ) : undefined
                }
              />
            </div>
          </div>

          {/* Workers & scheduler */}
          <div>
            <SectionHeading>Workers &amp; scheduler</SectionHeading>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <StatCard
                label="Workers"
                value={formatNumber(data.workers.total)}
                sub={
                  <button
                    onClick={() => onJump("workers")}
                    className="text-xs font-medium text-brand-600 hover:underline"
                  >
                    View workers →
                  </button>
                }
              />
              <StatCard
                label="Active workers"
                value={formatNumber(data.workers.active)}
                sub={<span className="text-xs text-faint">heartbeat &lt; 5m</span>}
              />
              <StatCard label="Scheduler" value={humanizeToken(data.scheduler.status)} />
              <StatCard label="Last tick" value={formatDateTime(data.scheduler.lastTickAt)} />
            </div>
            {data.scheduler.note && <p className="mt-2 text-xs text-faint">{data.scheduler.note}</p>}
          </div>

          {/* Recent job alerts */}
          <Card className="p-0">
            <div className="flex items-center justify-between border-b border-line px-5 py-3">
              <p className="text-sm font-semibold text-ink">Recent job alerts</p>
              <button
                onClick={() => onJump("alerts")}
                className="text-xs font-medium text-brand-600 hover:underline"
              >
                View all →
              </button>
            </div>
            {data.recentAlerts.length === 0 ? (
              <p className="px-5 py-6 text-sm text-muted">No job alerts recorded yet.</p>
            ) : (
              <ul className="divide-y divide-line">
                {data.recentAlerts.map((a) => (
                  <li
                    key={a.id}
                    className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-sm"
                  >
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <span className="truncate font-medium text-ink">{a.ruleName}</span>
                      <Badge tone={severityTone(a.severity)}>{titleCase(a.severity)}</Badge>
                      <Badge tone={alertStatusTone(a.status)}>{titleCase(a.status)}</Badge>
                      <span className="text-xs text-muted">{humanizeToken(a.type)}</span>
                      {a.service && <span className="text-xs text-faint">· {a.service}</span>}
                    </div>
                    <span className="text-xs text-faint">{formatDateTime(a.triggeredAt)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </>
      ) : (
        !error && <EmptyState message="No jobs dashboard data available." />
      )}
    </section>
  );
}

// ---- shared presentational helpers (reused by ReportsTab) ------------------

export function WindowSelector({
  value,
  onValue,
  dateFrom,
  dateTo,
  onDateFrom,
  onDateTo,
}: {
  value: JobWindow;
  onValue: (w: JobWindow) => void;
  dateFrom: string;
  dateTo: string;
  onDateFrom: (v: string) => void;
  onDateTo: (v: string) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="inline-flex overflow-hidden rounded-lg border border-line">
        {JOB_WINDOWS.map((w) => (
          <button
            key={w}
            onClick={() => onValue(w)}
            className={`px-3 py-1.5 text-xs font-semibold transition ${
              value === w ? "bg-brand-600 text-white" : "bg-surface text-muted hover:bg-hover"
            }`}
          >
            {windowLabel(w)}
          </button>
        ))}
      </div>
      {value === "custom" && (
        <div className="flex flex-wrap items-center gap-2">
          <Input
            type="date"
            value={dateFrom}
            onChange={(e) => onDateFrom(e.target.value)}
            aria-label="From date"
            className="!py-1.5"
          />
          <span className="text-xs text-faint">to</span>
          <Input
            type="date"
            value={dateTo}
            onChange={(e) => onDateTo(e.target.value)}
            aria-label="To date"
            className="!py-1.5"
          />
        </div>
      )}
    </div>
  );
}

export function SectionHeading({ children }: { children: ReactNode }) {
  return (
    <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted">{children}</h2>
  );
}

export function StatCard({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: "green" | "red" | "amber";
}) {
  const valueColor =
    tone === "red"
      ? "text-red-600"
      : tone === "amber"
        ? "text-amber-600"
        : tone === "green"
          ? "text-emerald-600"
          : "text-ink";
  return (
    <Card>
      <p className="text-sm font-medium text-muted">{label}</p>
      <div className={`mt-1 text-2xl font-semibold ${valueColor}`}>{value}</div>
      {sub && <div className="mt-1.5">{sub}</div>}
    </Card>
  );
}

/** A masked reference chip (used for related links + short ids). */
export function RefChip({ label, id }: { label: string; id: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface-2 px-2.5 py-1 text-xs">
      <Icon name="link" className="h-3.5 w-3.5 text-faint" />
      <span className="capitalize text-muted">{label}</span>
      <span className="font-mono text-faint">{shortId(id)}</span>
    </span>
  );
}
