"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { Badge, Button, EmptyState, ErrorNote, Input, Select, Spinner } from "@/components/ui";
import type {
  PlatformInstitution,
  SupportSessionPage,
  SupportStatus,
  SupportTemplates,
} from "@/types";
import { formatNumber } from "../../_utils";
import {
  formatDateTime,
  formatDuration,
  humanizeRole,
  notifyLabel,
  notifyTone,
  scopeLabel,
  scopeTone,
  statusLabel,
  statusTone,
  templateLabel,
} from "./taxonomy";
import { ExportControls } from "./ExportControls";

type SortKey = "createdAt" | "status" | "scope";
const STATUSES: SupportStatus[] = ["active", "ended", "expired", "revoked", "failed"];

interface FilterState {
  dateFrom: string;
  dateTo: string;
  institutionId: string;
  targetId: string;
  operatorId: string;
  status: string;
  scope: string;
  reasonTemplate: string;
}

const EMPTY: FilterState = {
  dateFrom: "",
  dateTo: "",
  institutionId: "",
  targetId: "",
  operatorId: "",
  status: "",
  scope: "",
  reasonTemplate: "",
};

export function HistoryTable({
  templates,
  institutions,
  reloadKey,
  onOpenSession,
}: {
  templates: SupportTemplates | null;
  institutions: PlatformInstitution[];
  reloadKey: number;
  onOpenSession: (id: string) => void;
}) {
  const [filters, setFilters] = useState<FilterState>(EMPTY);
  const [applied, setApplied] = useState<FilterState>(EMPTY);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [sort, setSort] = useState<SortKey>("createdAt");
  const [order, setOrder] = useState<"asc" | "desc">("desc");
  const [data, setData] = useState<SupportSessionPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const scopes = templates?.scopes ?? ["read_only", "write_enabled", "module_limited"];

  // Debounce filter edits into the applied set; reset to page 1 on change.
  useEffect(() => {
    const t = setTimeout(() => setApplied(filters), 300);
    return () => clearTimeout(t);
  }, [filters]);
  useEffect(() => {
    setPage(1);
  }, [applied]);

  const query = useMemo(() => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(applied)) if (v.trim()) p.set(k, v.trim());
    p.set("page", String(page));
    p.set("pageSize", String(pageSize));
    p.set("sort", sort);
    p.set("order", order);
    return p.toString();
  }, [applied, page, pageSize, sort, order]);

  // The active (non-empty) filters only — the export uses these (no page/sort/order),
  // so a CSV/XLSX download always matches the currently-filtered table.
  const exportParams = useMemo(() => {
    const p: Record<string, string> = {};
    for (const [k, v] of Object.entries(applied)) if (v.trim()) p[k] = v.trim();
    return p;
  }, [applied]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await api.get<SupportSessionPage>(`/platform/support/sessions?${query}`));
    } catch (err) {
      setData(null);
      setError(err instanceof ApiError ? err.message : "Failed to load session history");
    } finally {
      setLoading(false);
    }
  }, [query]);

  useEffect(() => {
    load();
  }, [load, reloadKey]);

  const patch = (p: Partial<FilterState>) => setFilters((prev) => ({ ...prev, ...p }));
  const active = Object.values(filters).some((v) => v.trim() !== "");

  const toggleSort = (key: SortKey) => {
    if (sort === key) setOrder((o) => (o === "asc" ? "desc" : "asc"));
    else {
      setSort(key);
      setOrder("desc");
    }
    setPage(1);
  };

  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const arrow = (key: SortKey) => (sort === key ? (order === "asc" ? " ↑" : " ↓") : "");
  const sortableTh = "cursor-pointer select-none px-4 py-3 hover:text-ink";

  return (
    <div className="space-y-4">
      <div className="space-y-3 rounded-2xl border border-line bg-surface p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Session history</h2>
          <ExportControls endpoint="/platform/support/export" params={exportParams} filename="support-history" />
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Select value={filters.institutionId} onChange={(e) => patch({ institutionId: e.target.value })} aria-label="Tenant">
            <option value="">All tenants</option>
            {institutions.map((i) => (
              <option key={i.id} value={i.id}>
                {i.name} ({i.code})
              </option>
            ))}
          </Select>
          <Select value={filters.status} onChange={(e) => patch({ status: e.target.value })} aria-label="Status">
            <option value="">All statuses</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {statusLabel(s)}
              </option>
            ))}
          </Select>
          <Select value={filters.scope} onChange={(e) => patch({ scope: e.target.value })} aria-label="Scope">
            <option value="">All scopes</option>
            {scopes.map((s) => (
              <option key={s} value={s}>
                {scopeLabel(s)}
              </option>
            ))}
          </Select>
          <Select
            value={filters.reasonTemplate}
            onChange={(e) => patch({ reasonTemplate: e.target.value })}
            aria-label="Reason template"
          >
            <option value="">All reason templates</option>
            {(templates?.templates ?? []).map((t) => (
              <option key={t} value={t}>
                {templateLabel(t)}
              </option>
            ))}
          </Select>
          <Input
            placeholder="Target user ID (uuid)"
            value={filters.targetId}
            onChange={(e) => patch({ targetId: e.target.value })}
            aria-label="Target ID"
          />
          <Input
            placeholder="Operator ID (uuid)"
            value={filters.operatorId}
            onChange={(e) => patch({ operatorId: e.target.value })}
            aria-label="Operator ID"
          />
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-muted">From date</span>
            <Input type="date" value={filters.dateFrom} onChange={(e) => patch({ dateFrom: e.target.value })} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-muted">To date</span>
            <Input type="date" value={filters.dateTo} onChange={(e) => patch({ dateTo: e.target.value })} />
          </label>
        </div>
        {active && (
          <div className="flex justify-end">
            <Button variant="ghost" onClick={() => setFilters(EMPTY)}>
              Clear all filters
            </Button>
          </div>
        )}
      </div>

      <ErrorNote message={error} />

      {loading ? (
        <Spinner />
      ) : rows.length === 0 ? (
        <EmptyState message="No support sessions match these filters." />
      ) : (
        <>
          <div className="overflow-x-auto rounded-2xl border border-line bg-surface">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-line bg-surface-2 text-xs uppercase text-muted">
                <tr>
                  <th className={sortableTh} onClick={() => toggleSort("createdAt")}>
                    Started{arrow("createdAt")}
                  </th>
                  <th className="px-4 py-3">Target</th>
                  <th className="px-4 py-3">Tenant</th>
                  <th className="px-4 py-3">Operator</th>
                  <th className={sortableTh} onClick={() => toggleSort("scope")}>
                    Scope{arrow("scope")}
                  </th>
                  <th className={sortableTh} onClick={() => toggleSort("status")}>
                    Status{arrow("status")}
                  </th>
                  <th className="px-4 py-3">Duration</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((s) => (
                  <tr
                    key={s.id}
                    className="cursor-pointer align-top hover:bg-hover"
                    onClick={() => onOpenSession(s.id)}
                  >
                    <td className="whitespace-nowrap px-4 py-3 text-muted">{formatDateTime(s.startedAt)}</td>
                    <td className="px-4 py-3">
                      <span className="block text-ink">{s.targetEmail}</span>
                      <span className="block text-xs capitalize text-faint">{humanizeRole(s.targetRole)}</span>
                    </td>
                    <td className="px-4 py-3 text-muted">
                      {s.institutionName ?? "—"}
                      {s.institutionCode && <span className="block text-xs text-faint">{s.institutionCode}</span>}
                    </td>
                    <td className="px-4 py-3 text-muted">{s.operatorEmail ?? "—"}</td>
                    <td className="px-4 py-3">
                      <Badge tone={scopeTone(s.scope)}>{scopeLabel(s.scope)}</Badge>
                    </td>
                    <td className="px-4 py-3">
                      <span className="flex flex-col items-start gap-1">
                        <Badge tone={statusTone(s.status)}>{statusLabel(s.status)}</Badge>
                        {s.notifyStatus && (
                          <Badge tone={notifyTone(s.notifyStatus)}>
                            Notified: {notifyLabel(s.notifyStatus)}
                          </Badge>
                        )}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-muted">{formatDuration(s.durationMinutes)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-muted">
            <div className="flex items-center gap-2">
              <span>Rows per page</span>
              <Select value={String(pageSize)} onChange={(e) => setPageSize(Number(e.target.value))} className="w-20">
                {[25, 50, 100, 200].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </Select>
            </div>
            <div className="flex items-center gap-2">
              <span>
                Page {page} of {totalPages} · {formatNumber(total)} total
              </span>
              <Button variant="secondary" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}>
                ← Prev
              </Button>
              <Button
                variant="secondary"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
              >
                Next →
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
