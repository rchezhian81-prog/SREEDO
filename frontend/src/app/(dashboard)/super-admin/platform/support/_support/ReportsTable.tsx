"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { Badge, Card, EmptyState, ErrorNote, Input, Select, Spinner } from "@/components/ui";
import type {
  PlatformInstitution,
  SupportReport,
  SupportReportGroup,
  SupportReportType,
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

const STATUSES: SupportStatus[] = ["active", "ended", "expired", "revoked", "failed"];

const REPORT_TYPES: { value: SupportReportType; label: string }[] = [
  { value: "all", label: "All sessions" },
  { value: "active", label: "Active" },
  { value: "expired", label: "Expired" },
  { value: "revoked", label: "Revoked" },
  { value: "long-running", label: "Long-running (> 60 min)" },
  { value: "high-risk", label: "High-risk" },
  { value: "tenant-wise", label: "By tenant" },
  { value: "operator-wise", label: "By operator" },
  { value: "reason-wise", label: "By reason template" },
  { value: "scope-wise", label: "By scope" },
];

// Grouped types render an aggregate table; the rest render masked session rows.
const GROUPED = new Set<SupportReportType>([
  "tenant-wise",
  "operator-wise",
  "reason-wise",
  "scope-wise",
]);

interface FilterState {
  dateFrom: string;
  dateTo: string;
  institutionId: string;
  operatorId: string;
  status: string;
  scope: string;
  reasonTemplate: string;
}

const EMPTY: FilterState = {
  dateFrom: "",
  dateTo: "",
  institutionId: "",
  operatorId: "",
  status: "",
  scope: "",
  reasonTemplate: "",
};

export function ReportsTable({
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
  const [type, setType] = useState<SupportReportType>("all");
  const [filters, setFilters] = useState<FilterState>(EMPTY);
  const [applied, setApplied] = useState<FilterState>(EMPTY);
  const [data, setData] = useState<SupportReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const scopes = templates?.scopes ?? ["read_only", "write_enabled", "module_limited"];

  // Debounce filter edits into the applied set (the type applies immediately).
  useEffect(() => {
    const t = setTimeout(() => setApplied(filters), 300);
    return () => clearTimeout(t);
  }, [filters]);

  // Only the active (non-empty) filters, as a plain string record — shared by the
  // fetch query and the export links so they can never diverge.
  const activeParams = useMemo(() => {
    const p: Record<string, string> = { type };
    for (const [k, v] of Object.entries(applied)) if (v.trim()) p[k] = v.trim();
    return p;
  }, [type, applied]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const q = new URLSearchParams(activeParams).toString();
      setData(await api.get<SupportReport>(`/platform/support/reports?${q}`));
    } catch (err) {
      setData(null);
      setError(err instanceof ApiError ? err.message : "Failed to load report");
    } finally {
      setLoading(false);
    }
  }, [activeParams]);

  useEffect(() => {
    load();
  }, [load, reloadKey]);

  const patch = (p: Partial<FilterState>) => setFilters((prev) => ({ ...prev, ...p }));
  const active = Object.values(filters).some((v) => v.trim() !== "");
  const grouped = GROUPED.has(type);
  const totals = data?.totals;

  return (
    <div className="space-y-4">
      {/* Report type + shared filters */}
      <div className="space-y-3 rounded-2xl border border-line bg-surface p-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-muted">Report</span>
            <Select
              value={type}
              onChange={(e) => setType(e.target.value as SupportReportType)}
              className="min-w-56"
              aria-label="Report type"
            >
              {REPORT_TYPES.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </Select>
          </label>
          <ExportControls
            endpoint="/platform/support/reports/export"
            params={activeParams}
            filename={`support-report-${type}`}
          />
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
            <button
              onClick={() => setFilters(EMPTY)}
              className="text-sm font-medium text-muted hover:text-ink"
            >
              Clear all filters
            </button>
          </div>
        )}
      </div>

      {/* Totals strip (stable across report types for one filter) */}
      {totals && (
        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-7">
          <Total label="Sessions" value={formatNumber(totals.sessionCount)} />
          <Total label="Avg duration" value={formatDuration(Math.round(totals.avgDurationMinutes))} />
          <Total label="Active" value={formatNumber(totals.activeCount)} tone={totals.activeCount > 0 ? "green" : undefined} />
          <Total label="Revoked" value={formatNumber(totals.revokedCount)} tone={totals.revokedCount > 0 ? "red" : undefined} />
          <Total label="Expired" value={formatNumber(totals.expiredCount)} tone={totals.expiredCount > 0 ? "amber" : undefined} />
          <Total label="Notified sent" value={formatNumber(totals.notificationSentCount)} tone={totals.notificationSentCount > 0 ? "green" : undefined} />
          <Total label="Notify failed" value={formatNumber(totals.notificationFailedCount)} tone={totals.notificationFailedCount > 0 ? "red" : undefined} />
        </div>
      )}

      <ErrorNote message={error} />

      {loading ? (
        <Spinner />
      ) : !data ? (
        !error && <EmptyState message="No report available." />
      ) : grouped ? (
        <GroupTable type={type} groups={data.groups ?? []} />
      ) : (
        <RowTable rows={data.rows ?? []} onOpenSession={onOpenSession} />
      )}
    </div>
  );
}

function Total({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "green" | "red" | "amber";
}) {
  const color =
    tone === "red"
      ? "text-red-600"
      : tone === "amber"
        ? "text-amber-600"
        : tone === "green"
          ? "text-emerald-600"
          : "text-ink";
  return (
    <Card className="!p-3.5">
      <p className="text-xs font-medium text-muted">{label}</p>
      <p className={`mt-1 text-xl font-semibold ${color}`}>{value}</p>
    </Card>
  );
}

/** Aggregate table for the four grouped report types. */
function GroupTable({ type, groups }: { type: SupportReportType; groups: SupportReportGroup[] }) {
  if (groups.length === 0) {
    return <EmptyState message="No data matches these filters." />;
  }
  const dimHeader =
    type === "tenant-wise"
      ? "Tenant"
      : type === "operator-wise"
        ? "Operator"
        : type === "reason-wise"
          ? "Reason template"
          : "Scope";

  const dimKey = (g: SupportReportGroup, i: number): string =>
    g.institutionId ?? g.operatorId ?? g.reasonTemplate ?? g.scope ?? `row-${i}`;

  const dimCell = (g: SupportReportGroup) => {
    if (type === "tenant-wise") {
      return (
        <span>
          <span className="text-ink">{g.institutionName ?? "—"}</span>
          {g.institutionCode && <span className="block text-xs text-faint">{g.institutionCode}</span>}
        </span>
      );
    }
    if (type === "operator-wise") {
      return (
        <span>
          <span className="text-ink">{g.operatorEmail ?? "—"}</span>
          {g.operatorName && <span className="block text-xs text-faint">{g.operatorName}</span>}
        </span>
      );
    }
    if (type === "reason-wise") {
      return <span className="text-ink">{templateLabel(g.reasonTemplate)}</span>;
    }
    const scope = g.scope ?? undefined;
    return <Badge tone={scopeTone(scope)}>{scopeLabel(scope)}</Badge>;
  };

  return (
    <div className="overflow-x-auto rounded-2xl border border-line bg-surface">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-line bg-surface-2 text-xs uppercase text-muted">
          <tr>
            <th className="px-4 py-3">{dimHeader}</th>
            <th className="px-4 py-3">Sessions</th>
            <th className="px-4 py-3">Avg duration</th>
            <th className="px-4 py-3">Active</th>
            <th className="px-4 py-3">Revoked</th>
            <th className="px-4 py-3">Expired</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {groups.map((g, i) => (
            <tr key={dimKey(g, i)} className="align-top hover:bg-hover">
              <td className="px-4 py-3">{dimCell(g)}</td>
              <td className="px-4 py-3 font-semibold text-ink">{formatNumber(g.sessions)}</td>
              <td className="px-4 py-3 text-muted">{formatDuration(Math.round(g.avgDurationMinutes))}</td>
              <td className="px-4 py-3 text-muted">{formatNumber(g.activeCount)}</td>
              <td className="px-4 py-3 text-muted">{formatNumber(g.revokedCount)}</td>
              <td className="px-4 py-3 text-muted">{formatNumber(g.expiredCount)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Masked session rows for the six row-based report types. */
function RowTable({
  rows,
  onOpenSession,
}: {
  rows: SupportReport["rows"];
  onOpenSession: (id: string) => void;
}) {
  if (!rows || rows.length === 0) {
    return <EmptyState message="No sessions match these filters." />;
  }
  return (
    <div className="overflow-x-auto rounded-2xl border border-line bg-surface">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-line bg-surface-2 text-xs uppercase text-muted">
          <tr>
            <th className="px-4 py-3">Started</th>
            <th className="px-4 py-3">Target</th>
            <th className="px-4 py-3">Tenant</th>
            <th className="px-4 py-3">Operator</th>
            <th className="px-4 py-3">Scope</th>
            <th className="px-4 py-3">Status</th>
            <th className="px-4 py-3">Notified</th>
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
                <Badge tone={statusTone(s.status)}>{statusLabel(s.status)}</Badge>
              </td>
              <td className="px-4 py-3">
                {s.notifyStatus ? (
                  <Badge tone={notifyTone(s.notifyStatus)}>{notifyLabel(s.notifyStatus)}</Badge>
                ) : (
                  <span className="text-faint">—</span>
                )}
              </td>
              <td className="px-4 py-3 text-muted">{formatDuration(s.durationMinutes)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
