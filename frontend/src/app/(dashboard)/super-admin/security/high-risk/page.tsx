"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { api, ApiError } from "@/lib/api";
import {
  Badge,
  Button,
  EmptyState,
  ErrorNote,
  Input,
  PageHeader,
  Select,
  Spinner,
} from "@/components/ui";
import { Icon } from "@/components/icons";
import { usePlatformGuard } from "../../platform/_guard";
import {
  HIGH_RISK_CATEGORIES,
  actionLabel,
  downloadSecurityExport,
  formatDateTime,
  roleLabel,
  type HighRiskRow,
  type Paged,
} from "../_security";

export default function HighRiskPage() {
  const { ready, gate } = usePlatformGuard(
    "High-risk actions",
    "Sensitive platform actions across every module"
  );

  const [data, setData] = useState<Paged<HighRiskRow>>({
    rows: [],
    total: 0,
    page: 1,
    pageSize: 25,
  });
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [category, setCategory] = useState("all");
  const [actorId, setActorId] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [exporting, setExporting] = useState(false);

  // Deep-link ?category= / ?actorId= (client-only).
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    const cat = sp.get("category");
    if (cat && HIGH_RISK_CATEGORIES.some((c) => c.value === cat)) setCategory(cat);
    const aid = sp.get("actorId");
    if (aid) setActorId(aid);
  }, []);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 400);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    setPage(1);
  }, [debounced, category, actorId, dateFrom, dateTo]);

  const filterParams = useMemo(() => {
    const p = new URLSearchParams();
    if (debounced.trim()) p.set("q", debounced.trim());
    if (category !== "all") p.set("category", category);
    if (actorId) p.set("actorId", actorId);
    if (dateFrom) p.set("dateFrom", dateFrom);
    if (dateTo) p.set("dateTo", dateTo);
    return p;
  }, [debounced, category, actorId, dateFrom, dateTo]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setForbidden(false);
    try {
      const p = new URLSearchParams(filterParams);
      p.set("page", String(page));
      p.set("pageSize", "25");
      setData(
        await api.get<Paged<HighRiskRow>>(`/platform/security/high-risk?${p.toString()}`)
      );
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) setForbidden(true);
      else setError(err instanceof ApiError ? err.message : "Failed to load feed");
    } finally {
      setLoading(false);
    }
  }, [filterParams, page]);

  useEffect(() => {
    if (ready) load();
  }, [ready, load]);

  const doExport = async (format: "csv" | "xlsx") => {
    setExporting(true);
    try {
      const p = new URLSearchParams(filterParams);
      p.set("format", format);
      await downloadSecurityExport(
        `/platform/security/high-risk/export?${p.toString()}`,
        `high-risk-actions.${format}`
      );
    } catch {
      setError("Export failed");
    } finally {
      setExporting(false);
    }
  };

  const hasFilters =
    !!debounced || category !== "all" || !!actorId || !!dateFrom || !!dateTo;
  const totalPages = Math.max(1, Math.ceil(data.total / (data.pageSize || 25)));

  if (!ready) return gate;

  if (forbidden) {
    return (
      <>
        <PageHeader title="High-risk actions" subtitle="Sensitive platform actions across every module" />
        <EmptyState message="You don't have permission to view this." />
      </>
    );
  }

  return (
    <>
      <nav className="mb-2 text-xs text-faint">
        <Link href="/super-admin/security" className="hover:text-muted">
          Security Center
        </Link>{" "}
        / <span className="text-muted">High-risk actions</span>
      </nav>
      <PageHeader
        title="High-risk actions"
        subtitle="Sensitive platform actions across every module"
        action={
          <div className="flex items-center gap-2">
            <Link href="/super-admin/platform/audit">
              <Button variant="secondary">
                <Icon name="file" className="h-4 w-4" />
                Platform audit
              </Button>
            </Link>
            <Button variant="secondary" disabled={exporting} onClick={() => doExport("csv")}>
              {exporting ? "Exporting…" : "Export CSV"}
            </Button>
            <Button variant="secondary" disabled={exporting} onClick={() => doExport("xlsx")}>
              Export XLSX
            </Button>
          </div>
        }
      />

      {actorId && (
        <div className="mb-3 flex items-center gap-2 text-sm text-muted">
          <span>
            Filtered by actor{" "}
            <span className="font-mono text-xs text-ink">{actorId}</span>
          </span>
          <Button variant="ghost" onClick={() => setActorId("")}>
            Clear
          </Button>
        </div>
      )}

      {/* Filters */}
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="min-w-[12rem] flex-1">
          <label className="mb-1.5 block text-sm font-medium text-ink">Search</label>
          <Input
            placeholder="Action or actor email…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="w-52">
          <label className="mb-1.5 block text-sm font-medium text-ink">Category</label>
          <Select value={category} onChange={(e) => setCategory(e.target.value)}>
            {HIGH_RISK_CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </Select>
        </div>
        <div className="w-40">
          <label className="mb-1.5 block text-sm font-medium text-ink">From</label>
          <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
        </div>
        <div className="w-40">
          <label className="mb-1.5 block text-sm font-medium text-ink">To</label>
          <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
        </div>
        {hasFilters && (
          <Button
            variant="ghost"
            onClick={() => {
              setSearch("");
              setCategory("all");
              setActorId("");
              setDateFrom("");
              setDateTo("");
            }}
          >
            Clear
          </Button>
        )}
      </div>

      <ErrorNote message={error} />

      {loading ? (
        <Spinner />
      ) : data.rows.length === 0 ? (
        <EmptyState message="No high-risk actions match these filters." />
      ) : (
        <>
          <div className="overflow-x-auto rounded-xl border border-line bg-surface">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-line bg-surface-2 text-xs uppercase text-muted">
                <tr>
                  <th className="px-4 py-3">Time</th>
                  <th className="px-4 py-3">Action</th>
                  <th className="px-4 py-3">Actor</th>
                  <th className="px-4 py-3">Target</th>
                  <th className="px-4 py-3">IP</th>
                  <th className="px-4 py-3">Reason</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {data.rows.map((r) => (
                  <tr key={r.id} className="align-top hover:bg-surface-2">
                    <td className="whitespace-nowrap px-4 py-3 text-muted">
                      {formatDateTime(r.createdAt)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="font-medium text-ink">
                          {actionLabel(r.action)}
                        </span>
                        {r.failed && <Badge tone="red">blocked / failed</Badge>}
                      </div>
                      <span className="block font-mono text-[11px] text-faint">
                        {r.action}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="block text-ink">{r.actorEmail ?? "—"}</span>
                      <span className="block text-xs text-faint">
                        {roleLabel(r.actorRole)}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {r.targetType ? (
                        <span className="text-muted">
                          {r.targetType}
                          {r.targetId && (
                            <span className="block font-mono text-[11px] text-faint">
                              {r.targetId}
                            </span>
                          )}
                        </span>
                      ) : (
                        <span className="text-faint">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-muted">
                      {r.ip ?? "—"}
                    </td>
                    <td className="max-w-xs px-4 py-3 text-muted">
                      {r.reason ? (
                        <span className="block break-words">{r.reason}</span>
                      ) : (
                        <span className="text-faint">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-4 flex items-center justify-between text-sm text-muted">
            <span>
              {data.total} action{data.total === 1 ? "" : "s"}
            </span>
            <div className="flex items-center gap-2">
              <Button
                variant="secondary"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
              >
                ← Prev
              </Button>
              <span>
                Page {data.page} of {totalPages}
              </span>
              <Button
                variant="secondary"
                onClick={() => setPage((p) => p + 1)}
                disabled={page >= totalPages}
              >
                Next →
              </Button>
            </div>
          </div>
        </>
      )}
    </>
  );
}
