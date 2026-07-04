"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { api, ApiError } from "@/lib/api";
import {
  Button,
  Card,
  EmptyState,
  ErrorNote,
  Field,
  Input,
  PageHeader,
  Select,
  Spinner,
  Textarea,
} from "@/components/ui";
import { usePlatformGuard } from "../../platform/_guard";
import {
  COMPLIANCE_REPORTS,
  WINDOW_OPTIONS,
  downloadSecurityExport,
  reportCell,
  type ComplianceReport,
  type SecurityWindow,
} from "../_security";

interface RoleOption {
  key: string;
  name: string;
}

const PAGE_SIZE = 50;

export default function ReportsPage() {
  const { ready, gate } = usePlatformGuard(
    "Compliance reports",
    "Run & export audit and compliance reports"
  );

  const [report, setReport] = useState(COMPLIANCE_REPORTS[0].value);
  const [windowSel, setWindowSel] = useState<SecurityWindow>("30d");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [role, setRole] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);

  const [roles, setRoles] = useState<RoleOption[]>([]);
  const [data, setData] = useState<ComplianceReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportReason, setExportReason] = useState("");

  useEffect(() => {
    if (!ready) return;
    api
      .get<RoleOption[]>("/platform/rbac/roles?status=active")
      .then((rs) => setRoles(rs.map((r) => ({ key: r.key, name: r.name }))))
      .catch(() => setRoles([]));
  }, [ready]);

  useEffect(() => {
    setPage(1);
  }, [report, windowSel, dateFrom, dateTo, role, status]);

  const filterParams = useMemo(() => {
    const p = new URLSearchParams();
    p.set("report", report);
    p.set("window", windowSel);
    if (dateFrom) p.set("dateFrom", dateFrom);
    if (dateTo) p.set("dateTo", dateTo);
    if (role) p.set("role", role);
    if (status.trim()) p.set("status", status.trim());
    return p;
  }, [report, windowSel, dateFrom, dateTo, role, status]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setForbidden(false);
    try {
      const p = new URLSearchParams(filterParams);
      p.set("page", String(page));
      p.set("pageSize", String(PAGE_SIZE));
      setData(
        await api.get<ComplianceReport>(`/platform/security/reports?${p.toString()}`)
      );
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) setForbidden(true);
      else setError(err instanceof ApiError ? err.message : "Failed to run report");
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
      if (exportReason.trim()) p.set("reason", exportReason.trim());
      await downloadSecurityExport(
        `/platform/security/reports/export?${p.toString()}`,
        `compliance-${report}.${format}`
      );
    } catch {
      setError("Export failed");
    } finally {
      setExporting(false);
    }
  };

  const activeReport = COMPLIANCE_REPORTS.find((r) => r.value === report);
  const totalPages = Math.max(1, Math.ceil((data?.total ?? 0) / PAGE_SIZE));

  if (!ready) return gate;

  if (forbidden) {
    return (
      <>
        <PageHeader title="Compliance reports" subtitle="Run & export audit and compliance reports" />
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
        / <span className="text-muted">Compliance reports</span>
      </nav>
      <PageHeader
        title="Compliance reports"
        subtitle="Run & export audit and compliance reports"
      />

      {/* Controls */}
      <Card className="mb-6">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Report" hint={activeReport?.hint}>
            <Select value={report} onChange={(e) => setReport(e.target.value)}>
              {COMPLIANCE_REPORTS.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Window">
            <Select
              value={windowSel}
              onChange={(e) => setWindowSel(e.target.value as SecurityWindow)}
            >
              {WINDOW_OPTIONS.map((w) => (
                <option key={w.value} value={w.value}>
                  {w.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Role" hint="Filters reports that carry a role.">
            <Select value={role} onChange={(e) => setRole(e.target.value)}>
              <option value="">All roles</option>
              {roles.map((r) => (
                <option key={r.key} value={r.key}>
                  {r.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="From">
            <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
          </Field>
          <Field label="To">
            <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
          </Field>
          <Field label="Status" hint="e.g. active, compliant, non_compliant, ended.">
            <Input
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              placeholder="Any status"
            />
          </Field>
        </div>

        <div className="mt-4 flex flex-wrap items-end justify-between gap-3 border-t border-line pt-4">
          <div className="min-w-[16rem] flex-1">
            <Field label="Export reason (optional — audited)">
              <Textarea
                rows={2}
                value={exportReason}
                onChange={(e) => setExportReason(e.target.value)}
                placeholder="Why is this report being exported?"
              />
            </Field>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="secondary" disabled={exporting} onClick={() => doExport("csv")}>
              {exporting ? "Exporting…" : "Export CSV"}
            </Button>
            <Button variant="secondary" disabled={exporting} onClick={() => doExport("xlsx")}>
              Export XLSX
            </Button>
          </div>
        </div>
      </Card>

      <ErrorNote message={error} />

      {loading ? (
        <Spinner />
      ) : !data || data.rows.length === 0 ? (
        <EmptyState message="No rows for this report and filters." />
      ) : (
        <>
          <div className="overflow-x-auto rounded-xl border border-line bg-surface">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-line bg-surface-2 text-xs uppercase text-muted">
                <tr>
                  {data.columns.map((c) => (
                    <th key={c.key} className="px-4 py-3">
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {data.rows.map((row, i) => (
                  <tr key={i} className="align-top hover:bg-surface-2">
                    {data.columns.map((c) => (
                      <td key={c.key} className="px-4 py-3 text-muted">
                        {reportCell(row[c.key])}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-4 flex items-center justify-between text-sm text-muted">
            <span>
              {data.total} row{data.total === 1 ? "" : "s"}
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
