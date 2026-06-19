"use client";

import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorNote,
  PageHeader,
  Spinner,
} from "@/components/ui";
import type { ObservabilityHealth, ObservabilityOverview } from "@/types";
import { usePlatformGuard } from "../platform/_guard";
import { compactDetail, formatNumber, formatUptime } from "../platform/_utils";

function KpiCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string | number;
  hint?: string;
}) {
  return (
    <Card>
      <p className="text-sm font-medium text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-slate-900">{value}</p>
      {hint && <p className="mt-1 text-xs text-slate-400">{hint}</p>}
    </Card>
  );
}

function HealthChip({ label, ok }: { label: string; ok: boolean }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2">
      <span className="text-sm font-medium text-slate-600">{label}</span>
      <Badge tone={ok ? "green" : "red"}>{ok ? "online" : "offline"}</Badge>
    </div>
  );
}

function InfoChip({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600">
      {label} <span className="font-medium text-slate-900">{value}</span>
    </div>
  );
}

/** Stable display order for known status-ish keys; unknowns sort after, alpha. */
const STATUS_ORDER = [
  "2xx",
  "3xx",
  "4xx",
  "5xx",
  "pending",
  "running",
  "success",
  "failed",
  "retried",
  "cancelled",
  "skipped",
];

function sortedEntries(record: Record<string, number>): [string, number][] {
  return Object.entries(record ?? {}).sort(([a], [b]) => {
    const ia = STATUS_ORDER.indexOf(a);
    const ib = STATUS_ORDER.indexOf(b);
    if (ia !== -1 && ib !== -1) return ia - ib;
    if (ia !== -1) return -1;
    if (ib !== -1) return 1;
    return a.localeCompare(b);
  });
}

function CountByStatus({ record }: { record: Record<string, number> }) {
  const entries = sortedEntries(record);
  if (entries.length === 0) {
    return <p className="text-sm text-slate-400">No data yet.</p>;
  }
  return (
    <div className="flex flex-wrap gap-2">
      {entries.map(([key, count]) => (
        <div
          key={key}
          className="rounded-lg border border-slate-200 bg-white px-3 py-2"
        >
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
            {key}
          </p>
          <p className="mt-0.5 text-lg font-semibold text-slate-900">
            {formatNumber(count)}
          </p>
        </div>
      ))}
    </div>
  );
}

function SectionHeading({ children }: { children: string }) {
  return (
    <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
      {children}
    </h2>
  );
}

function formatTimestamp(value: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleString();
}

export default function ObservabilityPage() {
  const { ready, gate } = usePlatformGuard(
    "Observability",
    "Platform health, metrics & queue"
  );

  const [overview, setOverview] = useState<ObservabilityOverview | null>(null);
  const [health, setHealth] = useState<ObservabilityHealth | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [o, h] = await Promise.all([
        api
          .get<ObservabilityOverview>("/observability/overview")
          .catch(() => null),
        api.get<ObservabilityHealth>("/observability/health").catch(() => null),
      ]);
      setOverview(o);
      setHealth(h);
      if (!o && !h) {
        setError("Failed to load observability data");
      }
    } catch (err) {
      setOverview(null);
      setHealth(null);
      setError(
        err instanceof ApiError
          ? err.message
          : "Failed to load observability data"
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (ready) load();
  }, [ready, load]);

  if (!ready) return gate;

  return (
    <>
      <PageHeader
        title="Observability"
        subtitle="Platform health, metrics & queue"
        action={
          <Button variant="secondary" onClick={load} disabled={loading}>
            {loading ? "Refreshing…" : "Refresh"}
          </Button>
        }
      />

      {loading ? (
        <Spinner />
      ) : error ? (
        <ErrorNote message={error} />
      ) : !overview && !health ? (
        <EmptyState message="No observability data is available." />
      ) : (
        <div className="space-y-8">
          {health && (
            <div>
              <SectionHeading>System health</SectionHeading>
              <div className="flex flex-wrap items-center gap-2">
                <HealthChip label="PostgreSQL" ok={health.postgres} />
                <HealthChip label="MongoDB" ok={health.mongo} />
                <InfoChip
                  label="Status"
                  value={health.status || "unknown"}
                />
                <InfoChip
                  label="Migrations"
                  value={formatNumber(health.migrations)}
                />
                <InfoChip
                  label="Uptime"
                  value={formatUptime(health.uptimeSeconds)}
                />
                <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2">
                  <span className="text-sm font-medium text-slate-600">
                    Job worker
                  </span>
                  <Badge tone={health.jobWorkerEnabled ? "green" : "slate"}>
                    {health.jobWorkerEnabled ? "enabled" : "disabled"}
                  </Badge>
                </div>
                <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2">
                  <span className="text-sm font-medium text-slate-600">
                    Storage
                  </span>
                  <Badge tone={health.storageConfigured ? "green" : "slate"}>
                    {health.storageConfigured ? "configured" : "off"}
                  </Badge>
                </div>
              </div>
            </div>
          )}

          {overview && (
            <>
              <div>
                <SectionHeading>Requests</SectionHeading>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  <KpiCard
                    label="Total requests"
                    value={formatNumber(overview.requests.total)}
                  />
                  <KpiCard
                    label="Errors"
                    value={formatNumber(overview.requests.errors)}
                  />
                  <KpiCard
                    label="Avg duration"
                    value={`${formatNumber(
                      Math.round(overview.requests.avgDurationMs)
                    )} ms`}
                  />
                  <KpiCard
                    label="Worker interval"
                    value={`${formatNumber(overview.worker.intervalMs)} ms`}
                    hint={
                      overview.worker.enabled
                        ? "worker enabled"
                        : "worker disabled"
                    }
                  />
                </div>
                <div className="mt-3">
                  <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-400">
                    By status class
                  </p>
                  <CountByStatus record={overview.requests.byStatusClass} />
                </div>
              </div>

              <div>
                <SectionHeading>Jobs</SectionHeading>
                <div className="grid gap-4 sm:grid-cols-3">
                  <KpiCard
                    label="Success"
                    value={formatNumber(overview.jobs.success)}
                  />
                  <KpiCard
                    label="Failed"
                    value={formatNumber(overview.jobs.failed)}
                  />
                  <KpiCard
                    label="Retried"
                    value={formatNumber(overview.jobs.retried)}
                  />
                </div>
                <div className="mt-3">
                  <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-400">
                    Queue depth by status
                  </p>
                  <CountByStatus record={overview.jobs.queue} />
                </div>
              </div>

              <div>
                <SectionHeading>Scheduled report delivery</SectionHeading>
                <CountByStatus record={overview.scheduledReports} />
              </div>

              <div>
                <SectionHeading>Recent failures</SectionHeading>
                {overview.recentFailures.length === 0 ? (
                  <EmptyState message="No recent job failures. 🎉" />
                ) : (
                  <Card className="overflow-x-auto p-0">
                    <table className="w-full text-left text-sm">
                      <thead>
                        <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                          <th className="px-4 py-3 font-medium">Type</th>
                          <th className="px-4 py-3 font-medium">Error</th>
                          <th className="px-4 py-3 font-medium">Institution</th>
                          <th className="px-4 py-3 font-medium">Completed</th>
                        </tr>
                      </thead>
                      <tbody>
                        {overview.recentFailures.map((failure) => (
                          <tr
                            key={failure.id}
                            className="border-b border-slate-100 last:border-0"
                          >
                            <td className="px-4 py-3 font-medium text-slate-900">
                              {failure.type}
                            </td>
                            <td className="max-w-md px-4 py-3 text-slate-600">
                              <span
                                className="block truncate"
                                title={
                                  failure.error
                                    ? compactDetail(failure.error)
                                    : undefined
                                }
                              >
                                {failure.error
                                  ? compactDetail(failure.error)
                                  : "—"}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-slate-600">
                              {failure.institutionId ?? "—"}
                            </td>
                            <td className="px-4 py-3 text-slate-600">
                              {formatTimestamp(failure.completedAt)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </Card>
                )}
              </div>

              <p className="text-xs text-slate-400">
                Prometheus metrics are available at{" "}
                <code className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-600">
                  GET /observability/metrics
                </code>{" "}
                for scrapers.
              </p>
            </>
          )}
        </div>
      )}
    </>
  );
}
