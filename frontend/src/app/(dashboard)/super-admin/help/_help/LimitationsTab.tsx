"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { api, ApiError } from "@/lib/api";
import { Badge, Card, EmptyState, ErrorNote, Select, Spinner } from "@/components/ui";
import { Icon } from "@/components/icons";
import type { HelpLimitationsResponse, Limitation } from "@/types";
import { ExportButtons } from "./primitives";
import {
  LIMITATION_STATUSES,
  SEVERITIES,
  formatDate,
  limitationStatusTone,
  severityTone,
  titleCase,
} from "./taxonomy";

export function LimitationsTab({ reloadKey }: { reloadKey: number }) {
  const [severity, setSeverity] = useState("");
  const [status, setStatus] = useState("");
  const [data, setData] = useState<Limitation[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const query = useMemo(() => {
    const p = new URLSearchParams();
    if (severity) p.set("severity", severity);
    if (status) p.set("status", status);
    return p.toString();
  }, [severity, status]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get<HelpLimitationsResponse>(`/help/limitations?${query}`);
      setData(res.limitations);
    } catch (err) {
      setData(null);
      setError(err instanceof ApiError ? err.message : "Failed to load limitations");
    } finally {
      setLoading(false);
    }
  }, [query]);

  useEffect(() => {
    load();
  }, [load, reloadKey]);

  return (
    <section className="space-y-4">
      <Card className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Icon name="filter" className="h-4 w-4 text-faint" />
          <Select
            value={severity}
            onChange={(e) => setSeverity(e.target.value)}
            aria-label="Filter by severity"
            className="!py-2"
          >
            <option value="">All severities</option>
            {SEVERITIES.map((s) => (
              <option key={s} value={s}>
                {titleCase(s)}
              </option>
            ))}
          </Select>
          <Select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            aria-label="Filter by status"
            className="!py-2"
          >
            <option value="">All statuses</option>
            {LIMITATION_STATUSES.map((s) => (
              <option key={s} value={s}>
                {titleCase(s)}
              </option>
            ))}
          </Select>
          {data && <span className="text-sm text-muted">{data.length} limitations</span>}
        </div>
        <ExportButtons kind="limitations" filenameBase="help-limitations-snapshot" />
      </Card>

      <ErrorNote message={error} />

      {loading ? (
        <Spinner />
      ) : !data ? (
        !error && <EmptyState message="No limitations recorded." />
      ) : data.length === 0 ? (
        <EmptyState message="No limitations match these filters. Nothing is hidden — future work is simply not marked complete." />
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-line bg-surface">
          <table className="w-full min-w-[880px] text-left text-sm">
            <thead className="border-b border-line bg-surface-2 text-xs uppercase text-muted">
              <tr>
                <th className="px-4 py-3">Limitation</th>
                <th className="px-4 py-3">Severity</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Impact</th>
                <th className="px-4 py-3">Workaround</th>
                <th className="px-4 py-3">Owner</th>
                <th className="px-4 py-3">Target</th>
                <th className="px-4 py-3">Updated</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {data.map((l) => (
                <tr key={l.id} className="align-top hover:bg-hover">
                  <td className="px-4 py-3">
                    <p className="font-medium text-ink">{l.title}</p>
                    <span className="text-xs text-faint">{l.module}</span>
                    {l.link && (
                      <Link
                        href={l.link}
                        className="ml-1 inline-flex items-center text-xs font-medium text-brand-600 hover:underline"
                      >
                        <Icon name="link" className="h-3 w-3" />
                      </Link>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <Badge tone={severityTone(l.severity)}>{titleCase(l.severity)}</Badge>
                  </td>
                  <td className="px-4 py-3">
                    <Badge tone={limitationStatusTone(l.status)}>{titleCase(l.status)}</Badge>
                  </td>
                  <td className="max-w-[16rem] px-4 py-3 text-muted">{l.impact}</td>
                  <td className="max-w-[16rem] px-4 py-3 text-muted">{l.workaround}</td>
                  <td className="px-4 py-3 text-muted">{l.ownerRole}</td>
                  <td className="px-4 py-3 text-muted">{l.targetPhase ?? "—"}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-faint">{formatDate(l.lastUpdated)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
