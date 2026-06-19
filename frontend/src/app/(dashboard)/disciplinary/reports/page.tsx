"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api, ApiError } from "@/lib/api";
import { useAuthStore } from "@/stores/auth-store";
import { usePermissions } from "@/lib/use-permissions";
import {
  Button,
  Card,
  cx,
  EmptyState,
  ErrorNote,
  PageHeader,
  Spinner,
} from "@/components/ui";
import type { ReportData } from "@/types";

const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api/v1";

/** Download a Bearer-authenticated file (CSV text / PDF binary) as a blob. */
async function downloadFile(path: string, filename: string) {
  const token = useAuthStore.getState().accessToken;
  const res = await fetch(`${BASE}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) {
    let message = res.statusText;
    try {
      const data = await res.json();
      if (typeof data.error === "string") message = data.error;
    } catch {
      // non-JSON error body — keep statusText
    }
    throw new ApiError(res.status, message);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function renderCell(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

const REPORTS: { key: string; title: string }[] = [
  { key: "disciplinary_register", title: "Disciplinary register" },
  { key: "disciplinary_student_history", title: "Student history" },
  { key: "disciplinary_by_category", title: "By category" },
  { key: "disciplinary_by_severity", title: "By severity" },
  { key: "disciplinary_open_pending", title: "Open / pending" },
  { key: "disciplinary_action_taken", title: "Action taken" },
];

export default function DisciplinaryReportsPage() {
  const { can, loading: permsLoading } = usePermissions();
  const canReports = can("disciplinary:reports");

  const [selectedKey, setSelectedKey] = useState<string>(REPORTS[0].key);
  const [data, setData] = useState<ReportData | null>(null);
  const [dataLoading, setDataLoading] = useState(false);
  const [dataError, setDataError] = useState<string | null>(null);

  const [exporting, setExporting] = useState<"csv" | "pdf" | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  const runReport = useCallback(async (key: string) => {
    setDataLoading(true);
    setDataError(null);
    setExportError(null);
    try {
      setData(await api.get<ReportData>(`/report-center/${key}`));
    } catch (err) {
      setData(null);
      setDataError(
        err instanceof ApiError ? err.message : "Failed to load report"
      );
    } finally {
      setDataLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!permsLoading && canReports) runReport(selectedKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [permsLoading, canReports, selectedKey]);

  const onExport = async (format: "csv" | "pdf") => {
    setExporting(format);
    setExportError(null);
    try {
      await downloadFile(
        `/report-center/${selectedKey}/export?format=${format}`,
        `${selectedKey}.${format}`
      );
    } catch (err) {
      setExportError(
        err instanceof ApiError
          ? err.message
          : `Failed to export ${format.toUpperCase()}`
      );
    } finally {
      setExporting(null);
    }
  };

  if (permsLoading) {
    return (
      <>
        <PageHeader
          title="Disciplinary reports"
          subtitle="Run & export disciplinary reports"
        />
        <Spinner />
      </>
    );
  }

  if (!canReports) {
    return (
      <>
        <PageHeader
          title="Disciplinary reports"
          subtitle="Run & export disciplinary reports"
        />
        <EmptyState message="You don't have access to disciplinary reports." />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Disciplinary reports"
        subtitle="Run & export disciplinary reports"
      />

      <div className="mb-4">
        <Link
          href="/disciplinary"
          className="text-sm font-medium text-brand-600 hover:text-brand-700"
        >
          ← Back to Disciplinary
        </Link>
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        {REPORTS.map((report) => (
          <button
            key={report.key}
            onClick={() => setSelectedKey(report.key)}
            className={cx(
              "rounded-lg border px-3 py-2 text-sm font-medium transition",
              report.key === selectedKey
                ? "border-brand-500 bg-brand-50 text-brand-700"
                : "border-slate-200 text-slate-700 hover:bg-slate-50"
            )}
          >
            {report.title}
          </button>
        ))}
      </div>

      <Card>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold text-slate-900">
            {data?.title ??
              REPORTS.find((r) => r.key === selectedKey)?.title ??
              "Report"}
          </h2>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              onClick={() => runReport(selectedKey)}
              disabled={dataLoading}
            >
              {dataLoading ? "Running…" : "Refresh"}
            </Button>
            <Button
              variant="secondary"
              onClick={() => onExport("csv")}
              disabled={exporting !== null}
            >
              {exporting === "csv" ? "Exporting…" : "Export CSV"}
            </Button>
            <Button
              variant="secondary"
              onClick={() => onExport("pdf")}
              disabled={exporting !== null}
            >
              {exporting === "pdf" ? "Exporting…" : "Export PDF"}
            </Button>
          </div>
        </div>

        <div className="space-y-2">
          <ErrorNote message={exportError} />
          <ErrorNote message={dataError} />
        </div>

        {dataLoading ? (
          <Spinner />
        ) : data && data.rows.length > 0 ? (
          <>
            <div className="overflow-x-auto rounded-xl border border-slate-200">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
                  <tr>
                    {data.columns.map((col) => (
                      <th
                        key={col.key}
                        className="whitespace-nowrap px-4 py-3"
                      >
                        {col.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.rows.map((row, rowIndex) => (
                    <tr key={rowIndex}>
                      {data.columns.map((col) => (
                        <td
                          key={col.key}
                          className="whitespace-nowrap px-4 py-3 text-slate-600"
                        >
                          {renderCell(row[col.key])}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-3 text-sm text-slate-500">
              {data.rows.length} {data.rows.length === 1 ? "row" : "rows"}
            </p>
          </>
        ) : !dataError ? (
          <EmptyState message="No rows for this report" />
        ) : null}
      </Card>
    </>
  );
}
