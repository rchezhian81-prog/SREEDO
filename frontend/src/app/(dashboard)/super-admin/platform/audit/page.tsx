"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api, ApiError } from "@/lib/api";
import {
  Badge,
  Button,
  EmptyState,
  ErrorNote,
  PageHeader,
  Select,
  Spinner,
} from "@/components/ui";
import { Icon, type IconName } from "@/components/icons";
import type {
  AuditCategoriesRef,
  AuditSummary,
  PlatformAuditRow,
  PlatformInstitution,
} from "@/types";
import { usePlatformGuard } from "../_guard";
import { compactDetail, formatNumber } from "../_utils";
import { AlertsFeed } from "./_audit/AlertsFeed";
import { DetailDrawer } from "./_audit/DetailDrawer";
import { ExportModal } from "./_audit/ExportModal";
import { Filters } from "./_audit/Filters";
import { IntegrityCard } from "./_audit/IntegrityCard";
import { RetentionCard } from "./_audit/RetentionCard";
import { SavedFilters } from "./_audit/SavedFilters";
import { SummaryCards } from "./_audit/SummaryCards";
import {
  appendFilters,
  EMPTY_FILTERS,
  FILTER_KEYS,
  formatDateTime,
  resultLabel,
  resultTone,
  severityLabel,
  severityTone,
  type AuditFilterState,
} from "./_audit/taxonomy";

interface Paged {
  rows: PlatformAuditRow[];
  total: number;
  page: number;
  pageSize: number;
}
type SortKey = "createdAt" | "action" | "actorEmail" | "severity";
type Tab = "overview" | "events" | "governance";
type Win = AuditSummary["window"];

const TABS: { value: Tab; label: string; icon: IconName }[] = [
  { value: "overview", label: "Overview", icon: "grid" },
  { value: "events", label: "Events", icon: "file" },
  { value: "governance", label: "Governance", icon: "shield" },
];

export default function AuditConsolePage() {
  const { ready, gate } = usePlatformGuard(
    "Audit Console",
    "One consolidated, governed view of every platform action"
  );

  // Reference data for the filter dropdowns.
  const [institutions, setInstitutions] = useState<PlatformInstitution[]>([]);
  const [categoriesRef, setCategoriesRef] = useState<AuditCategoriesRef | null>(null);

  // Console-wide UI state.
  const [tab, setTab] = useState<Tab>("overview");
  const [exportOpen, setExportOpen] = useState(false);
  const [openEventId, setOpenEventId] = useState<string | null>(null);

  // Summary/alerts window (shared by the Overview cards + alerts feed).
  const [win, setWin] = useState<Win>("7d");
  const [winFrom, setWinFrom] = useState("");
  const [winTo, setWinTo] = useState("");

  // Filters (immediate) → applied (debounced, drives the query).
  const [filters, setFilters] = useState<AuditFilterState>(EMPTY_FILTERS);
  const [applied, setApplied] = useState<AuditFilterState>(EMPTY_FILTERS);
  const [seeded, setSeeded] = useState(false);
  const [enableAutoDefault, setEnableAutoDefault] = useState(false);

  // Paging + sort for the events table.
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [sort, setSort] = useState<SortKey>("createdAt");
  const [order, setOrder] = useState<"asc" | "desc">("desc");

  // List result.
  const [data, setData] = useState<Paged | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Seed filters from a deep link (?institutionId=, ?category=, …) once on mount.
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    const seed: AuditFilterState = { ...EMPTY_FILTERS };
    let any = false;
    for (const k of FILTER_KEYS) {
      const v = sp.get(k);
      if (v) {
        seed[k] = v;
        any = true;
      }
    }
    if (any) {
      setFilters(seed);
      setApplied(seed);
      setTab("events");
    } else {
      setEnableAutoDefault(true);
    }
    setSeeded(true);
  }, []);

  // Debounce filter edits into the applied set used by the query.
  useEffect(() => {
    const t = setTimeout(() => setApplied(filters), 300);
    return () => clearTimeout(t);
  }, [filters]);

  // Reset to page 1 whenever the applied filters change.
  useEffect(() => {
    setPage(1);
  }, [applied]);

  // Load reference data once.
  useEffect(() => {
    if (!ready) return;
    api
      .get<{ rows: PlatformInstitution[] }>(
        "/platform/institutions?pageSize=100&sort=name&order=asc"
      )
      .then((d) => setInstitutions(d.rows))
      .catch(() => undefined);
    api
      .get<AuditCategoriesRef>("/platform/audit/categories")
      .then(setCategoriesRef)
      .catch(() => undefined);
  }, [ready]);

  const buildQuery = useCallback(() => {
    const p = new URLSearchParams();
    appendFilters(p, applied);
    p.set("page", String(page));
    p.set("pageSize", String(pageSize));
    p.set("sort", sort);
    p.set("order", order);
    return p;
  }, [applied, page, pageSize, sort, order]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await api.get<Paged>(`/platform/audit?${buildQuery().toString()}`));
    } catch (err) {
      setData(null);
      setError(err instanceof ApiError ? err.message : "Failed to load audit trail");
    } finally {
      setLoading(false);
    }
  }, [buildQuery]);

  // Only fetch the (potentially large) list while the Events tab is active.
  useEffect(() => {
    if (ready && seeded && tab === "events") load();
  }, [ready, seeded, tab, load]);

  const patchFilters = (patch: Partial<AuditFilterState>) =>
    setFilters((prev) => ({ ...prev, ...patch }));

  const filterByActor = (actorId: string) => {
    setFilters((prev) => ({ ...prev, actorId }));
    setOpenEventId(null);
    setTab("events");
  };

  const onSummaryActorClick = (field: keyof AuditFilterState, value: string) => {
    setFilters((prev) => ({ ...prev, [field]: value }));
    setTab("events");
  };

  const toggleSort = (key: SortKey) => {
    if (sort === key) setOrder((o) => (o === "asc" ? "desc" : "asc"));
    else {
      setSort(key);
      setOrder("desc");
    }
    setPage(1);
  };

  if (!ready) return gate;

  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const sortArrow = (key: SortKey) => (sort === key ? (order === "asc" ? " ↑" : " ↓") : "");
  const sortableTh = "cursor-pointer select-none px-4 py-3 hover:text-slate-700";

  return (
    <>
      <nav className="mb-2 text-xs text-slate-400">
        <Link href="/super-admin/platform" className="hover:text-slate-600">
          Platform
        </Link>{" "}
        / <span className="text-slate-600">Audit Console</span>
      </nav>

      <PageHeader
        title="Audit Console"
        subtitle="One consolidated, governed view of every platform action"
        action={
          <Button variant="secondary" onClick={() => setExportOpen(true)}>
            <Icon name="package" className="h-4 w-4" />
            Export
          </Button>
        }
      />

      {/* Tab strip */}
      <div className="mb-6 inline-flex rounded-xl border border-slate-200 bg-white p-1">
        {TABS.map((t) => (
          <button
            key={t.value}
            onClick={() => setTab(t.value)}
            className={`inline-flex items-center gap-2 rounded-lg px-3.5 py-2 text-sm font-semibold transition ${
              tab === t.value
                ? "bg-brand-600 text-white"
                : "text-slate-600 hover:bg-slate-50"
            }`}
          >
            <Icon name={t.icon} className="h-4 w-4" />
            {t.label}
          </button>
        ))}
      </div>

      {tab === "overview" && (
        <div className="space-y-8">
          <SummaryCards
            window={win}
            from={winFrom}
            to={winTo}
            onWindowChange={setWin}
            onCustomChange={(f, t) => {
              setWinFrom(f);
              setWinTo(t);
            }}
            onActorClick={onSummaryActorClick}
            onOpenEvent={setOpenEventId}
          />
          <AlertsFeed window={win} from={winFrom} to={winTo} onOpenEvent={setOpenEventId} />
        </div>
      )}

      {tab === "events" && (
        <div className="space-y-4">
          <Filters
            filters={filters}
            onChange={patchFilters}
            onReset={() => setFilters(EMPTY_FILTERS)}
            institutions={institutions}
            categoriesRef={categoriesRef}
          />
          <SavedFilters
            currentFilters={filters}
            onApply={setFilters}
            enableAutoDefault={enableAutoDefault}
          />

          <ErrorNote message={error} />

          {loading ? (
            <Spinner />
          ) : rows.length === 0 ? (
            <EmptyState message="No audit entries for these filters." />
          ) : (
            <>
              <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
                <table className="w-full text-left text-sm">
                  <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
                    <tr>
                      <th className={sortableTh} onClick={() => toggleSort("createdAt")}>
                        Time{sortArrow("createdAt")}
                      </th>
                      <th className={sortableTh} onClick={() => toggleSort("severity")}>
                        Severity{sortArrow("severity")}
                      </th>
                      <th className="px-4 py-3">Category</th>
                      <th className={sortableTh} onClick={() => toggleSort("action")}>
                        Action{sortArrow("action")}
                      </th>
                      <th className="px-4 py-3">Result</th>
                      <th className="px-4 py-3">Institution</th>
                      <th className={sortableTh} onClick={() => toggleSort("actorEmail")}>
                        Actor{sortArrow("actorEmail")}
                      </th>
                      <th className="px-4 py-3">IP</th>
                      <th className="px-4 py-3">Detail</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {rows.map((row) => (
                      <tr
                        key={row.id}
                        className="cursor-pointer align-top hover:bg-slate-50"
                        onClick={() => setOpenEventId(row.id)}
                      >
                        <td className="whitespace-nowrap px-4 py-3 text-slate-600">
                          {formatDateTime(row.createdAt)}
                        </td>
                        <td className="px-4 py-3">
                          <Badge tone={severityTone(row.severity)}>
                            {severityLabel(row.severity)}
                          </Badge>
                        </td>
                        <td className="px-4 py-3 text-xs text-slate-500">
                          {row.category ?? "—"}
                        </td>
                        <td className="px-4 py-3 font-mono text-xs text-slate-700">
                          {row.action}
                        </td>
                        <td className="px-4 py-3">
                          <Badge tone={resultTone(row.result)}>
                            {resultLabel(row.result)}
                          </Badge>
                        </td>
                        <td className="px-4 py-3 text-slate-600">
                          {row.institutionId ? (
                            <Link
                              href={`/super-admin/platform/tenants/${row.institutionId}`}
                              onClick={(e) => e.stopPropagation()}
                              className="text-brand-600 hover:text-brand-700"
                            >
                              {row.institutionName ?? row.institutionCode ?? "View"}
                            </Link>
                          ) : (
                            <span className="text-slate-400">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-slate-600">
                          {row.actorEmail ?? "—"}
                          {row.actorRole && (
                            <span className="block text-xs capitalize text-slate-400">
                              {row.actorRole.replace(/_/g, " ")}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 font-mono text-xs text-slate-500">
                          {row.ip ?? "—"}
                        </td>
                        <td className="max-w-xs px-4 py-3">
                          <span className="block truncate font-mono text-xs text-slate-500">
                            {compactDetail(row.detail)}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-slate-600">
                <div className="flex items-center gap-2">
                  <span>Rows per page</span>
                  <Select
                    value={String(pageSize)}
                    onChange={(e) => setPageSize(Number(e.target.value))}
                    className="w-20"
                  >
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
                  <Button
                    variant="secondary"
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page <= 1}
                  >
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
      )}

      {tab === "governance" && (
        <div className="grid gap-6 lg:grid-cols-2">
          <RetentionCard />
          <IntegrityCard />
        </div>
      )}

      <ExportModal
        open={exportOpen}
        onClose={() => setExportOpen(false)}
        filters={applied}
        sort={sort}
        order={order}
      />

      <DetailDrawer
        id={openEventId}
        onClose={() => setOpenEventId(null)}
        onFilterActor={filterByActor}
      />
    </>
  );
}
