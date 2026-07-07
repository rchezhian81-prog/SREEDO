"use client";

import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { Badge, EmptyState, ErrorNote, Spinner } from "@/components/ui";
import { Icon } from "@/components/icons";
import type { WorkersResult } from "@/types";
import { formatNumber } from "../../platform/_utils";
import { formatDateTime, formatDuration, shortId, titleCase, workerStatusTone } from "./taxonomy";

export function WorkersTab({ reloadKey }: { reloadKey: number }) {
  const [data, setData] = useState<WorkersResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await api.get<WorkersResult>("/jobs-ops/workers"));
    } catch (err) {
      setData(null);
      setError(err instanceof ApiError ? err.message : "Failed to load workers");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load, reloadKey]);

  const workers = data?.workers ?? [];

  return (
    <section className="space-y-4">
      <div className="flex items-center gap-2 text-sm text-muted">
        <Icon name="network" className="h-4 w-4" />
        <h2 className="text-sm font-semibold uppercase tracking-wide">Worker heartbeats</h2>
      </div>

      {data?.note && (
        <p className="rounded-lg border border-line bg-surface-2 px-3 py-2 text-xs text-muted">{data.note}</p>
      )}

      <ErrorNote message={error} />

      {loading ? (
        <Spinner />
      ) : workers.length === 0 ? (
        <EmptyState message="No worker has reported a heartbeat yet (the queue worker is on-demand)." />
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-line bg-surface">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-line bg-surface-2 text-xs uppercase text-muted">
              <tr>
                <th className="px-4 py-3">Worker</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Last heartbeat</th>
                <th className="px-4 py-3">Current job</th>
                <th className="px-4 py-3 text-right">Processed</th>
                <th className="px-4 py-3 text-right">Failed</th>
                <th className="px-4 py-3">Host / version</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {workers.map((w) => (
                <tr key={w.workerId} className="hover:bg-hover">
                  <td className="px-4 py-3">
                    <span className="block font-mono text-xs text-ink">{w.workerId}</span>
                    {w.queue && <span className="block text-xs text-faint">{w.queue}</span>}
                  </td>
                  <td className="px-4 py-3">
                    <Badge tone={workerStatusTone(w.status)}>{titleCase(w.status)}</Badge>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-faint">
                    <span className="block text-muted">{formatDateTime(w.lastHeartbeatAt)}</span>
                    <span className="block text-xs">{formatDuration(w.lastHeartbeatAgeMs)} ago</span>
                  </td>
                  <td className="px-4 py-3 text-muted">
                    {w.currentJobId ? <span className="font-mono text-xs">{shortId(w.currentJobId)}</span> : "Idle"}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right text-muted">{formatNumber(w.jobsProcessed)}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-right">
                    <span className={w.jobsFailed > 0 ? "text-amber-600" : "text-muted"}>
                      {formatNumber(w.jobsFailed)}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-faint">
                    {w.hostname ?? "—"}
                    {w.version ? ` · ${w.version}` : ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
