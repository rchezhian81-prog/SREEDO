"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api, ApiError } from "@/lib/api";
import { usePermissions } from "@/lib/use-permissions";
import { currentMonth } from "@/lib/payroll";
import {
  Button,
  Card,
  cx,
  EmptyState,
  ErrorNote,
  Input,
  PageHeader,
  Spinner,
} from "@/components/ui";
import type { ReportData } from "@/types";

const REPORTS: { key: string; title: string; month: boolean }[] = [
  { key: "payroll_register", title: "Payroll register", month: true },
  { key: "payroll_salary", title: "Staff-wise salary", month: false },
  { key: "payroll_deductions", title: "Deductions", month: true },
  { key: "payslip_status", title: "Payslip status", month: true },
  { key: "attendance_vs_payroll", title: "Attendance vs payroll", month: true },
  {
    key: "unpaid_leave_deduction",
    title: "Unpaid leave deduction",
    month: true,
  },
];

function renderCell(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export default function PayrollReportsPage() {
  const { can, loading: permsLoading } = usePermissions();
  const canReports = can("payroll:reports");

  const [selectedKey, setSelectedKey] = useState(REPORTS[0].key);
  const [month, setMonth] = useState(currentMonth);

  const [data, setData] = useState<ReportData | null>(null);
  const [dataLoading, setDataLoading] = useState(false);
  const [dataError, setDataError] = useState<string | null>(null);

  const selected = REPORTS.find((report) => report.key === selectedKey)!;

  const runReport = useCallback(
    async (key: string, selectedMonth: string) => {
      setDataLoading(true);
      setDataError(null);
      try {
        const report = REPORTS.find((item) => item.key === key);
        const params = new URLSearchParams();
        if (report?.month && selectedMonth) params.set("month", selectedMonth);
        const qs = params.toString();
        setData(
          await api.get<ReportData>(
            `/report-center/${key}${qs ? `?${qs}` : ""}`
          )
        );
      } catch (err) {
        setData(null);
        setDataError(
          err instanceof ApiError ? err.message : "Failed to load report"
        );
      } finally {
        setDataLoading(false);
      }
    },
    []
  );

  useEffect(() => {
    if (permsLoading || !canReports) return;
    runReport(selectedKey, month);
  }, [permsLoading, canReports, selectedKey, month, runReport]);

  if (permsLoading) {
    return (
      <>
        <PageHeader title="Payroll reports" />
        <Spinner />
      </>
    );
  }

  if (!canReports) {
    return (
      <>
        <PageHeader title="Payroll reports" />
        <EmptyState message="You do not have permission to view payroll reports." />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Payroll reports"
        subtitle="Register, deductions & more"
      />

      <div className="mb-4">
        <Link
          href="/payroll"
          className="text-sm font-medium text-brand-600 hover:text-brand-700"
        >
          ← Back to Payroll
        </Link>
      </div>

      <div className="space-y-6">
        <div className="flex flex-wrap gap-2">
          {REPORTS.map((report) => (
            <button
              key={report.key}
              onClick={() => setSelectedKey(report.key)}
              className={cx(
                "rounded-lg border px-3 py-2 text-sm font-medium transition",
                report.key === selectedKey
                  ? "border-brand-500 bg-brand-50 text-brand-700"
                  : "border-line text-ink hover:bg-hover"
              )}
            >
              {report.title}
            </button>
          ))}
        </div>

        <Card>
          <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
            <h2 className="text-lg font-semibold text-ink">
              {data?.title ?? selected.title}
            </h2>
            <div className="flex flex-wrap items-end gap-3">
              {selected.month && (
                <div className="w-44">
                  <span className="mb-1 block text-sm font-medium text-ink">
                    Month
                  </span>
                  <Input
                    type="month"
                    value={month}
                    onChange={(event) => setMonth(event.target.value)}
                  />
                </div>
              )}
              <Button
                variant="secondary"
                onClick={() => runReport(selectedKey, month)}
                disabled={dataLoading}
              >
                {dataLoading ? "Running…" : "Refresh"}
              </Button>
            </div>
          </div>

          <ErrorNote message={dataError} />

          {dataLoading ? (
            <Spinner />
          ) : data && data.rows.length > 0 ? (
            <>
              <div className="overflow-x-auto rounded-xl border border-line">
                <table className="w-full text-left text-sm">
                  <thead className="border-b border-line bg-surface-2 text-xs uppercase text-muted">
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
                  <tbody className="divide-y divide-line">
                    {data.rows.map((row, rowIndex) => (
                      <tr key={rowIndex}>
                        {data.columns.map((col) => (
                          <td
                            key={col.key}
                            className="whitespace-nowrap px-4 py-3 text-muted"
                          >
                            {renderCell(row[col.key])}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-3 text-sm text-muted">
                {data.rows.length} {data.rows.length === 1 ? "row" : "rows"}
              </p>
            </>
          ) : !dataError ? (
            <EmptyState message="No rows for this report" />
          ) : null}
        </Card>
      </div>
    </>
  );
}
