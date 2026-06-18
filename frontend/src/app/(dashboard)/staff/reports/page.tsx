"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api, ApiError } from "@/lib/api";
import { usePermissions } from "@/lib/use-permissions";
import {
  Button,
  Card,
  cx,
  EmptyState,
  ErrorNote,
  Input,
  PageHeader,
  Select,
  Spinner,
} from "@/components/ui";
import type { ReportData } from "@/types";

type FilterKind = "date" | "month" | "dateRange" | "status";

const REPORTS: { key: string; title: string; filter?: FilterKind }[] = [
  { key: "staff_attendance_daily", title: "Daily staff attendance", filter: "date" },
  {
    key: "staff_attendance_monthly",
    title: "Monthly staff attendance",
    filter: "month",
  },
  {
    key: "staff_attendance_summary",
    title: "Attendance summary",
    filter: "dateRange",
  },
  { key: "leave_register", title: "Leave register", filter: "status" },
  { key: "leave_balance", title: "Leave balance" },
  { key: "leave_pending", title: "Pending leave" },
  {
    key: "payroll_attendance_summary",
    title: "Payroll attendance summary",
    filter: "month",
  },
];

const STATUS_OPTIONS = [
  { value: "", label: "All statuses" },
  { value: "pending", label: "Pending" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
  { value: "cancelled", label: "Cancelled" },
];

function renderCell(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

interface Filters {
  date: string;
  month: string;
  dateFrom: string;
  dateTo: string;
  status: string;
}

export default function StaffReportsPage() {
  const { can, loading: permsLoading } = usePermissions();
  const canReports = can("leave:reports");

  const [selectedKey, setSelectedKey] = useState(REPORTS[0].key);
  const [filters, setFilters] = useState<Filters>(() => ({
    date: new Date().toISOString().slice(0, 10),
    month: new Date().toISOString().slice(0, 7),
    dateFrom: "",
    dateTo: "",
    status: "",
  }));

  const [data, setData] = useState<ReportData | null>(null);
  const [dataLoading, setDataLoading] = useState(false);
  const [dataError, setDataError] = useState<string | null>(null);

  const selected = REPORTS.find((report) => report.key === selectedKey)!;

  const runReport = useCallback(
    async (key: string, current: Filters) => {
      setDataLoading(true);
      setDataError(null);
      try {
        const report = REPORTS.find((item) => item.key === key);
        const params = new URLSearchParams();
        if (report?.filter === "date" && current.date) {
          params.set("dateFrom", current.date);
        }
        if (report?.filter === "month" && current.month) {
          params.set("month", current.month);
        }
        if (report?.filter === "dateRange") {
          if (current.dateFrom) params.set("dateFrom", current.dateFrom);
          if (current.dateTo) params.set("dateTo", current.dateTo);
        }
        if (report?.filter === "status" && current.status) {
          params.set("status", current.status);
        }
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
    runReport(selectedKey, filters);
  }, [permsLoading, canReports, selectedKey, filters, runReport]);

  if (permsLoading) {
    return (
      <>
        <PageHeader title="Staff & leave reports" />
        <Spinner />
      </>
    );
  }

  if (!canReports) {
    return (
      <>
        <PageHeader title="Staff & leave reports" />
        <EmptyState message="You do not have permission to view these reports." />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Staff & leave reports"
        subtitle="Attendance, leave & payroll"
      />

      <div className="mb-4">
        <Link
          href="/staff"
          className="text-sm font-medium text-brand-600 hover:text-brand-700"
        >
          ← Back to Staff Attendance
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
                  : "border-slate-200 text-slate-700 hover:bg-slate-50"
              )}
            >
              {report.title}
            </button>
          ))}
        </div>

        <Card>
          <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
            <h2 className="text-lg font-semibold text-slate-900">
              {data?.title ?? selected.title}
            </h2>
            <div className="flex flex-wrap items-end gap-3">
              {selected.filter === "date" && (
                <div className="w-44">
                  <span className="mb-1 block text-sm font-medium text-slate-700">
                    Date
                  </span>
                  <Input
                    type="date"
                    value={filters.date}
                    onChange={(event) =>
                      setFilters((f) => ({ ...f, date: event.target.value }))
                    }
                  />
                </div>
              )}
              {selected.filter === "month" && (
                <div className="w-44">
                  <span className="mb-1 block text-sm font-medium text-slate-700">
                    Month
                  </span>
                  <Input
                    type="month"
                    value={filters.month}
                    onChange={(event) =>
                      setFilters((f) => ({ ...f, month: event.target.value }))
                    }
                  />
                </div>
              )}
              {selected.filter === "dateRange" && (
                <>
                  <div className="w-40">
                    <span className="mb-1 block text-sm font-medium text-slate-700">
                      From
                    </span>
                    <Input
                      type="date"
                      value={filters.dateFrom}
                      onChange={(event) =>
                        setFilters((f) => ({
                          ...f,
                          dateFrom: event.target.value,
                        }))
                      }
                    />
                  </div>
                  <div className="w-40">
                    <span className="mb-1 block text-sm font-medium text-slate-700">
                      To
                    </span>
                    <Input
                      type="date"
                      value={filters.dateTo}
                      onChange={(event) =>
                        setFilters((f) => ({
                          ...f,
                          dateTo: event.target.value,
                        }))
                      }
                    />
                  </div>
                </>
              )}
              {selected.filter === "status" && (
                <div className="w-44">
                  <span className="mb-1 block text-sm font-medium text-slate-700">
                    Status
                  </span>
                  <Select
                    value={filters.status}
                    onChange={(event) =>
                      setFilters((f) => ({ ...f, status: event.target.value }))
                    }
                  >
                    {STATUS_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </Select>
                </div>
              )}
              <Button
                variant="secondary"
                onClick={() => runReport(selectedKey, filters)}
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
      </div>
    </>
  );
}
