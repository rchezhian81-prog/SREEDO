"use client";

import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { Badge, Card, EmptyState, ErrorNote, Spinner } from "@/components/ui";
import type { OpsPerformance, OpsRouteStat } from "@/types";
import { formatNumber } from "../../platform/_utils";
import { StatCard } from "./OverviewTab";
import { statusClassTone } from "./taxonomy";

/** Defensive numeric read — treat a missing field as 0. */
function num(v: number | null | undefined): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

export function PerformanceTab({ reloadKey }: { reloadKey: number }) {
  const [data, setData] = useState<OpsPerformance | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await api.get<OpsPerformance>("/observability/performance"));
    } catch (err) {
      setData(null);
      setError(err instanceof ApiError ? err.message : "Failed to load performance");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load, reloadKey]);

  const byStatus = data ? Object.entries(data.requests.byStatusClass ?? {}) : [];

  return (
    <div className="space-y-5">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Performance</h2>
      <ErrorNote message={error} />

      {loading ? (
        <Spinner />
      ) : data ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="Requests" value={formatNumber(data.requests.total)} />
            <StatCard
              label="Errors"
              value={formatNumber(data.requests.errors)}
              tone={data.requests.errors > 0 ? "amber" : undefined}
            />
            <StatCard label="Error rate" value={`${data.requests.errorRatePct}%`} />
            <StatCard label="Avg response" value={`${formatNumber(data.requests.avgResponseMs)} ms`} />
          </div>

          {byStatus.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {byStatus.map(([cls, count]) => (
                <div key={cls} className="rounded-lg border border-line bg-surface-2 px-3 py-2">
                  <Badge tone={statusClassTone(cls)}>{cls}</Badge>
                  <p className="mt-1 text-lg font-semibold text-ink">{formatNumber(count)}</p>
                </div>
              ))}
            </div>
          )}

          <RouteTable title="Slowest routes" rows={data.slowRoutes} emptyMessage="No route traffic recorded yet." />
          <RouteTable title="Per-route" rows={data.perRoute} emptyMessage="No per-route stats yet." />

          {data.note && <p className="text-xs text-faint">{data.note}</p>}
        </>
      ) : (
        !error && <EmptyState message="No performance data available." />
      )}
    </div>
  );
}

function RouteTable({
  title,
  rows,
  emptyMessage,
}: {
  title: string;
  rows: OpsRouteStat[];
  emptyMessage: string;
}) {
  return (
    <Card className="p-0">
      <div className="border-b border-line px-5 py-3">
        <p className="text-sm font-semibold text-ink">{title}</p>
      </div>
      {rows.length === 0 ? (
        <p className="px-5 py-4 text-sm text-muted">{emptyMessage}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-line bg-surface-2 text-xs uppercase text-muted">
              <tr>
                <th className="px-4 py-3">Route</th>
                <th className="px-4 py-3 text-right">Requests</th>
                <th className="px-4 py-3 text-right">Avg</th>
                <th className="px-4 py-3 text-right">p95</th>
                <th className="px-4 py-3 text-right">Errors</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((r, i) => (
                <tr key={`${r.route}-${i}`} className="hover:bg-hover">
                  <td className="max-w-md px-4 py-3">
                    <span className="block truncate font-mono text-xs text-ink" title={r.route}>
                      {r.route}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right text-muted">
                    {formatNumber(num(r.count))}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right text-muted">
                    {formatNumber(num(r.avgMs))} ms
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right text-muted">
                    {formatNumber(num(r.p95Ms))} ms
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right">
                    <span className={num(r.errors) > 0 ? "text-amber-600" : "text-muted"}>
                      {formatNumber(num(r.errors))}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
