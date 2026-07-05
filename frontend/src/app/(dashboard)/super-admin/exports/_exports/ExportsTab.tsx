"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { Badge, Button, EmptyState, ErrorNote, Input, Select, Spinner } from "@/components/ui";
import { Icon } from "@/components/icons";
import type { ExportPage, PlatformExport } from "@/types";
import { formatBytes, formatNumber } from "../../platform/_utils";
import {
  APPROVAL_STATUSES,
  approvalLabel,
  approvalTone,
  CREATE_SCOPES,
  EXPORT_FORMATS,
  EXPORT_STATUSES,
  exportStatusTone,
  formatDateTime,
  formatLabel,
  isNearingExpiry,
  scopeLabel,
} from "./taxonomy";
import { CreateExportModal } from "./CreateExportModal";
import { ExportDetailModal } from "./ExportDetailModal";

type SortKey = "createdAt" | "status" | "sizeBytes" | "expiresAt";

interface FilterState {
  dateFrom: string;
  dateTo: string;
  status: string;
  scope: string;
  format: string;
  createdBy: string;
  sensitive: string;
  approvalStatus: string;
  search: string;
}

const EMPTY: FilterState = {
  dateFrom: "",
  dateTo: "",
  status: "",
  scope: "",
  format: "",
  createdBy: "",
  sensitive: "",
  approvalStatus: "",
  search: "",
};

export function ExportsTab({
  presetRange,
  presetKey,
  reloadKey,
  onChanged,
}: {
  presetRange: { dateFrom: string; dateTo: string } | null;
  presetKey: number;
  reloadKey: number;
  onChanged: () => void;
}) {
  const [filters, setFilters] = useState<FilterState>(EMPTY);
  const [applied, setApplied] = useState<FilterState>(EMPTY);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [sort, setSort] = useState<SortKey>("createdAt");
  const [order, setOrder] = useState<"asc" | "desc">("desc");
  const [data, setData] = useState<ExportPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [localReload, setLocalReload] = useState(0);

  const [detail, setDetail] = useState<PlatformExport | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  // A date range picked from the Overview chips feeds straight into the filters.
  useEffect(() => {
    if (presetKey > 0 && presetRange) {
      setFilters((prev) => ({ ...prev, dateFrom: presetRange.dateFrom, dateTo: presetRange.dateTo }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presetKey]);

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

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await api.get<ExportPage>(`/exports?${query}`));
    } catch (err) {
      setData(null);
      setError(err instanceof ApiError ? err.message : "Failed to load exports");
    } finally {
      setLoading(false);
    }
  }, [query]);

  useEffect(() => {
    load();
  }, [load, reloadKey, localReload]);

  const refreshAll = () => {
    setLocalReload((k) => k + 1);
    onChanged();
  };

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

  // Keep the open detail row in sync with fresh data after a mutation.
  useEffect(() => {
    if (detail && data) {
      const fresh = data.rows.find((row) => row.id === detail.id);
      if (fresh && fresh !== detail) setDetail(fresh);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const arrow = (key: SortKey) => (sort === key ? (order === "asc" ? " ↑" : " ↓") : "");
  const sortableTh = "cursor-pointer select-none px-4 py-3 hover:text-ink";

  return (
    <div className="space-y-4">
      <div className="space-y-3 rounded-2xl border border-line bg-surface p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Export history</h2>
          <Button onClick={() => setCreateOpen(true)}>
            <Icon name="plus" className="h-4 w-4" />
            Create export
          </Button>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Select value={filters.status} onChange={(e) => patch({ status: e.target.value })} aria-label="Status">
            <option value="">All statuses</option>
            {EXPORT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s.charAt(0).toUpperCase() + s.slice(1)}
              </option>
            ))}
          </Select>
          <Select value={filters.scope} onChange={(e) => patch({ scope: e.target.value })} aria-label="Scope">
            <option value="">All scopes</option>
            {CREATE_SCOPES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
            <option value="portability_pack">Portability pack</option>
          </Select>
          <Select value={filters.format} onChange={(e) => patch({ format: e.target.value })} aria-label="Format">
            <option value="">All formats</option>
            {EXPORT_FORMATS.map((f) => (
              <option key={f} value={f}>
                {formatLabel(f)}
              </option>
            ))}
          </Select>
          <Select
            value={filters.approvalStatus}
            onChange={(e) => patch({ approvalStatus: e.target.value })}
            aria-label="Approval status"
          >
            <option value="">All approvals</option>
            {APPROVAL_STATUSES.map((a) => (
              <option key={a} value={a}>
                {approvalLabel(a)}
              </option>
            ))}
          </Select>
          <Select
            value={filters.sensitive}
            onChange={(e) => patch({ sensitive: e.target.value })}
            aria-label="Sensitivity"
          >
            <option value="">All sensitivities</option>
            <option value="true">Sensitive only</option>
          </Select>
          <Input
            placeholder="Created by (user ID)"
            value={filters.createdBy}
            onChange={(e) => patch({ createdBy: e.target.value })}
            aria-label="Created by"
          />
          <Input
            placeholder="Search name or scope…"
            value={filters.search}
            onChange={(e) => patch({ search: e.target.value })}
            aria-label="Search"
          />
          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-muted">From</span>
              <Input type="date" value={filters.dateFrom} onChange={(e) => patch({ dateFrom: e.target.value })} />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-muted">To</span>
              <Input type="date" value={filters.dateTo} onChange={(e) => patch({ dateTo: e.target.value })} />
            </label>
          </div>
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
        <EmptyState message="No exports match these filters." />
      ) : (
        <>
          <div className="overflow-x-auto rounded-2xl border border-line bg-surface">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-line bg-surface-2 text-xs uppercase text-muted">
                <tr>
                  <th className="px-4 py-3">Name</th>
                  <th className="px-4 py-3">Scope</th>
                  <th className="px-4 py-3">Format</th>
                  <th className={sortableTh} onClick={() => toggleSort("status")}>
                    Status{arrow("status")}
                  </th>
                  <th className="px-4 py-3">Approval</th>
                  <th className="px-4 py-3 text-right">Rows</th>
                  <th className={`${sortableTh} text-right`} onClick={() => toggleSort("sizeBytes")}>
                    Size{arrow("sizeBytes")}
                  </th>
                  <th className={sortableTh} onClick={() => toggleSort("expiresAt")}>
                    Expires{arrow("expiresAt")}
                  </th>
                  <th className="px-4 py-3 text-right">Downloads</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((r) => (
                  <tr key={r.id} className="align-top hover:bg-hover">
                    <td className="px-4 py-3">
                      <span className="block font-medium text-ink">{r.name}</span>
                      <span className="block text-xs text-faint">{formatDateTime(r.createdAt)}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-muted">{scopeLabel(r.scope)}</span>
                      {r.sensitive && (
                        <Badge tone="red">
                          <Icon name="shieldAlert" className="h-3 w-3" />
                          Sensitive
                        </Badge>
                      )}
                    </td>
                    <td className="px-4 py-3 text-muted">{formatLabel(r.format)}</td>
                    <td className="px-4 py-3">
                      <Badge tone={exportStatusTone(r.status)}>{r.status}</Badge>
                      {r.status === "failed" && r.error && (
                        <span className="mt-1 block max-w-xs truncate text-xs text-red-600" title={r.error}>
                          {r.error}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone={approvalTone(r.approvalStatus)}>{approvalLabel(r.approvalStatus)}</Badge>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right text-muted">
                      {r.rowCount == null ? "—" : formatNumber(r.rowCount)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right text-muted">
                      {r.sizeBytes == null ? "—" : formatBytes(r.sizeBytes)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      {r.expiresAt ? (
                        <span className={isNearingExpiry(r) ? "font-medium text-amber-600" : "text-muted"}>
                          {formatDateTime(r.expiresAt)}
                          {isNearingExpiry(r) && <span className="block text-xs">Nearing expiry</span>}
                        </span>
                      ) : (
                        <span className="text-faint">—</span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right text-muted">
                      {formatNumber(r.downloadCount)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end">
                        <Button variant="secondary" className="!px-3 !py-1.5" onClick={() => setDetail(r)}>
                          {r.approvalStatus === "pending" ? "Review" : "Manage"}
                        </Button>
                      </div>
                    </td>
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

      <ExportDetailModal row={detail} onClose={() => setDetail(null)} onChanged={refreshAll} />

      <CreateExportModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={() => {
          setCreateOpen(false);
          refreshAll();
        }}
      />
    </div>
  );
}
