"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { api, ApiError } from "@/lib/api";
import { usePermissions } from "@/lib/use-permissions";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorNote,
  Input,
  PageHeader,
  Select,
  Spinner,
} from "@/components/ui";
import type {
  DisciplinaryRecord,
  DisciplinarySettings,
  DisciplinarySeverity,
  DisciplinaryStatus,
} from "@/types";

const STATUS_LABELS: Record<DisciplinaryStatus, string> = {
  open: "Open",
  under_review: "Under review",
  action_taken: "Action taken",
  closed: "Closed",
  cancelled: "Cancelled",
};

function severityTone(
  severity: DisciplinarySeverity
): "red" | "amber" | "slate" {
  if (severity === "critical" || severity === "high") return "red";
  if (severity === "medium") return "amber";
  return "slate";
}

function statusTone(
  status: DisciplinaryStatus
): "slate" | "green" | "amber" | "red" | "blue" {
  switch (status) {
    case "open":
      return "blue";
    case "under_review":
      return "amber";
    case "action_taken":
      return "green";
    case "closed":
      return "slate";
    case "cancelled":
      return "red";
    default:
      return "slate";
  }
}

export default function DisciplinaryPage() {
  const { can, loading: permsLoading } = usePermissions();
  const canRead = can("disciplinary:read");
  const canCreate = can("disciplinary:create");
  const canUpdate = can("disciplinary:update");

  const [records, setRecords] = useState<DisciplinaryRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [status, setStatus] = useState("");
  const [severity, setSeverity] = useState("");
  const [search, setSearch] = useState("");

  const [portalEnabled, setPortalEnabled] = useState<boolean | null>(null);
  const [portalBusy, setPortalBusy] = useState(false);
  const [portalError, setPortalError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const params = new URLSearchParams();
      if (status) params.set("status", status);
      if (severity) params.set("severity", severity);
      if (search) params.set("search", search);
      const qs = params.toString();
      setRecords(
        await api.get<DisciplinaryRecord[]>(
          `/disciplinary${qs ? `?${qs}` : ""}`
        )
      );
    } catch (err) {
      setRecords([]);
      setLoadError(
        err instanceof ApiError ? err.message : "Failed to load records"
      );
    } finally {
      setLoading(false);
    }
  }, [status, severity, search]);

  useEffect(() => {
    if (!permsLoading && canRead) load();
    else if (!permsLoading) setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [permsLoading, canRead, status, severity, search]);

  useEffect(() => {
    if (permsLoading || !canUpdate) return;
    api
      .get<DisciplinarySettings>("/disciplinary/settings")
      .then((s) => setPortalEnabled(s.portalEnabled))
      .catch(() => undefined);
  }, [permsLoading, canUpdate]);

  const togglePortal = async () => {
    if (portalEnabled === null) return;
    setPortalBusy(true);
    setPortalError(null);
    const next = !portalEnabled;
    try {
      const result = await api.patch<DisciplinarySettings>(
        "/disciplinary/settings",
        { portalEnabled: next }
      );
      setPortalEnabled(result.portalEnabled);
    } catch (err) {
      setPortalError(
        err instanceof ApiError ? err.message : "Failed to update setting"
      );
    } finally {
      setPortalBusy(false);
    }
  };

  const kpis = useMemo(() => {
    let open = 0;
    let underReview = 0;
    let highCritical = 0;
    for (const record of records) {
      if (record.status === "open") open += 1;
      if (record.status === "under_review") underReview += 1;
      if (record.severity === "high" || record.severity === "critical")
        highCritical += 1;
    }
    return { open, underReview, highCritical, total: records.length };
  }, [records]);

  if (permsLoading || loading) {
    return (
      <>
        <PageHeader
          title="Disciplinary"
          subtitle="Incident register & follow-up"
        />
        <Spinner />
      </>
    );
  }

  if (!canRead) {
    return (
      <>
        <PageHeader
          title="Disciplinary"
          subtitle="Incident register & follow-up"
        />
        <EmptyState message="You don't have access to disciplinary records." />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Disciplinary"
        subtitle="Incident register & follow-up"
        action={
          <div className="flex flex-wrap items-center gap-2">
            <Link href="/disciplinary/reports">
              <Button variant="secondary">Reports</Button>
            </Link>
            {canCreate && (
              <Link href="/disciplinary/new">
                <Button>+ Log incident</Button>
              </Link>
            )}
          </div>
        }
      />

      {canUpdate && portalEnabled !== null && (
        <Card className="mb-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-slate-900">
                Portal visibility
              </p>
              <p className="text-xs text-slate-500">
                When on, students and parents can view their own disciplinary
                records in the portal.
              </p>
              <ErrorNote message={portalError} />
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={portalEnabled}
              aria-label="Toggle portal visibility"
              disabled={portalBusy}
              onClick={togglePortal}
              className={
                "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition disabled:cursor-not-allowed disabled:opacity-60 " +
                (portalEnabled ? "bg-brand-600" : "bg-slate-300")
              }
            >
              <span
                className={
                  "inline-block h-5 w-5 transform rounded-full bg-white shadow transition " +
                  (portalEnabled ? "translate-x-5" : "translate-x-0.5")
                }
              />
            </button>
          </div>
        </Card>
      )}

      <div className="mb-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <p className="text-sm text-slate-500">Open</p>
          <p className="mt-1 text-3xl font-semibold text-slate-900">
            {kpis.open}
          </p>
        </Card>
        <Card>
          <p className="text-sm text-slate-500">Under review</p>
          <p className="mt-1 text-3xl font-semibold text-slate-900">
            {kpis.underReview}
          </p>
        </Card>
        <Card>
          <p className="text-sm text-slate-500">High / Critical</p>
          <p className="mt-1 text-3xl font-semibold text-slate-900">
            {kpis.highCritical}
          </p>
        </Card>
        <Card>
          <p className="text-sm text-slate-500">Total</p>
          <p className="mt-1 text-3xl font-semibold text-slate-900">
            {kpis.total}
          </p>
        </Card>
      </div>

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="w-48">
          <span className="mb-1 block text-sm font-medium text-slate-700">
            Status
          </span>
          <Select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All statuses</option>
            <option value="open">Open</option>
            <option value="under_review">Under review</option>
            <option value="action_taken">Action taken</option>
            <option value="closed">Closed</option>
            <option value="cancelled">Cancelled</option>
          </Select>
        </div>
        <div className="w-48">
          <span className="mb-1 block text-sm font-medium text-slate-700">
            Severity
          </span>
          <Select
            value={severity}
            onChange={(e) => setSeverity(e.target.value)}
          >
            <option value="">All severities</option>
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
            <option value="critical">Critical</option>
          </Select>
        </div>
        <div className="w-64">
          <span className="mb-1 block text-sm font-medium text-slate-700">
            Search
          </span>
          <Input
            placeholder="Student, category…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {loadError ? (
        <ErrorNote message={loadError} />
      ) : records.length === 0 ? (
        <EmptyState message="No disciplinary records found" />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3">Student</th>
                <th className="px-4 py-3">Class / Program</th>
                <th className="px-4 py-3">Category</th>
                <th className="px-4 py-3">Severity</th>
                <th className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {records.map((record) => (
                <tr key={record.id} className="hover:bg-slate-50">
                  <td className="whitespace-nowrap px-4 py-3 text-slate-600">
                    <Link
                      href={`/disciplinary/${record.id}`}
                      className="font-medium text-brand-600 hover:text-brand-700"
                    >
                      {record.incidentDate}
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    <span className="font-medium text-slate-900">
                      {record.studentName}
                    </span>
                    <span className="block font-mono text-xs text-slate-400">
                      {record.admissionNo}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    {record.className
                      ? `${record.className}${
                          record.sectionName ? ` — ${record.sectionName}` : ""
                        }`
                      : record.programName ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    {record.category}
                  </td>
                  <td className="px-4 py-3">
                    <Badge tone={severityTone(record.severity)}>
                      {record.severity}
                    </Badge>
                  </td>
                  <td className="px-4 py-3">
                    <Badge tone={statusTone(record.status)}>
                      {STATUS_LABELS[record.status]}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
