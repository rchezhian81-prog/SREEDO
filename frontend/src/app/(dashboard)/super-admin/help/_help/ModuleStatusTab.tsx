"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { api, ApiError } from "@/lib/api";
import { Badge, Card, EmptyState, ErrorNote, Select, Spinner } from "@/components/ui";
import { Icon } from "@/components/icons";
import type { HelpModulesResponse, ModuleStatusEntry } from "@/types";
import { ExportButtons, SectionHeading, StatusBadge } from "./primitives";
import { MODULE_STATUSES, formatDate, moduleStatusLabel, refOrDash } from "./taxonomy";

export function ModuleStatusTab({ reloadKey }: { reloadKey: number }) {
  const [rows, setRows] = useState<ModuleStatusEntry[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get<HelpModulesResponse>("/help/modules");
      setRows(res.modules);
    } catch (err) {
      setRows(null);
      setError(err instanceof ApiError ? err.message : "Failed to load module status");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load, reloadKey]);

  const filtered = useMemo(
    () => (rows ?? []).filter((m) => !status || m.status === status),
    [rows, status]
  );

  return (
    <section className="space-y-4">
      <Card className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Icon name="filter" className="h-4 w-4 text-faint" />
          <Select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            aria-label="Filter by status"
            className="!py-2"
          >
            <option value="">All statuses</option>
            {MODULE_STATUSES.map((s) => (
              <option key={s} value={s}>
                {moduleStatusLabel(s)}
              </option>
            ))}
          </Select>
          {rows && (
            <span className="text-sm text-muted">
              {filtered.length} of {rows.length} modules
            </span>
          )}
        </div>
        <ExportButtons kind="modules" filenameBase="help-module-status-snapshot" />
      </Card>

      <ErrorNote message={error} />

      {loading ? (
        <Spinner />
      ) : !rows ? (
        !error && <EmptyState message="No module status data available." />
      ) : filtered.length === 0 ? (
        <EmptyState message="No modules match this filter." />
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-line bg-surface">
          <table className="w-full min-w-[860px] text-left text-sm">
            <thead className="border-b border-line bg-surface-2 text-xs uppercase text-muted">
              <tr>
                <th className="px-4 py-3">Module</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">PR</th>
                <th className="px-4 py-3">Commit</th>
                <th className="px-4 py-3">Deploy</th>
                <th className="px-4 py-3">Owner</th>
                <th className="px-4 py-3 text-right">Limitations</th>
                <th className="px-4 py-3">Updated</th>
                <th className="px-4 py-3 text-right">Links</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {filtered.map((m) => (
                <tr key={m.key} className="hover:bg-hover">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      {m.letter && (
                        <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-brand-500/12 text-xs font-bold text-brand-600">
                          {m.letter}
                        </span>
                      )}
                      <span className="font-medium text-ink">{m.name}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={m.status} />
                  </td>
                  <td className="px-4 py-3 text-muted">
                    {m.prNumber !== null ? `#${m.prNumber}` : "—"}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-faint">
                    {m.prCommit ? m.prCommit.slice(0, 9) : "—"}
                  </td>
                  <td className="px-4 py-3 text-muted">{refOrDash(m.deployNumber)}</td>
                  <td className="px-4 py-3 text-muted">{m.ownerRole}</td>
                  <td className="px-4 py-3 text-right">
                    {m.knownLimitationsCount > 0 ? (
                      <Badge tone="amber">{m.knownLimitationsCount}</Badge>
                    ) : (
                      <span className="text-faint">0</span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-faint">
                    {formatDate(m.lastUpdated)}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap justify-end gap-1.5">
                      {m.route && (
                        <Link
                          href={m.route}
                          className="inline-flex items-center gap-1 rounded-lg border border-line px-2 py-1 text-xs font-medium text-brand-600 hover:bg-hover"
                        >
                          <Icon name="arrowRight" className="h-3.5 w-3.5" />
                          Open
                        </Link>
                      )}
                      {m.docLink && (
                        <Link
                          href={m.docLink}
                          className="inline-flex items-center gap-1 rounded-lg border border-line px-2 py-1 text-xs font-medium text-muted hover:bg-hover"
                        >
                          <Icon name="file" className="h-3.5 w-3.5" />
                          Docs
                        </Link>
                      )}
                      {!m.route && !m.docLink && <span className="text-xs text-faint">—</span>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {rows && filtered.length > 0 && (
        <div>
          <SectionHeading>Legend</SectionHeading>
          <div className="flex flex-wrap gap-2">
            {MODULE_STATUSES.map((s) => (
              <StatusBadge key={s} status={s} />
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
