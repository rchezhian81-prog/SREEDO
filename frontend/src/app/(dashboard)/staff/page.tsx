"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api, ApiError } from "@/lib/api";
import { usePermissions } from "@/lib/use-permissions";
import {
  Button,
  Card,
  EmptyState,
  ErrorNote,
  Input,
  PageHeader,
  Spinner,
} from "@/components/ui";
import type { StaffAttendanceSummary } from "@/types";

const SUB_PAGES: {
  href: string;
  label: string;
  icon: string;
  desc: string;
}[] = [
  {
    href: "/staff/attendance",
    label: "Daily marking",
    icon: "✅",
    desc: "Mark staff attendance for a date",
  },
  {
    href: "/staff/history",
    label: "History & summary",
    icon: "📅",
    desc: "Monthly summary and day-by-day rows",
  },
  {
    href: "/staff/reports",
    label: "Reports",
    icon: "📈",
    desc: "Attendance, leave & payroll reports",
  },
];

function currentMonth(): string {
  return new Date().toISOString().slice(0, 7);
}

export default function StaffHubPage() {
  const { can, loading: permsLoading } = usePermissions();

  const [month, setMonth] = useState(currentMonth);
  const [rows, setRows] = useState<StaffAttendanceSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async (selectedMonth: string) => {
    setLoading(true);
    setLoadError(null);
    try {
      setRows(
        await api.get<StaffAttendanceSummary[]>(
          `/staff/attendance/summary?month=${selectedMonth}`
        )
      );
    } catch (err) {
      setLoadError(
        err instanceof ApiError ? err.message : "Failed to load summary"
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (permsLoading || !can("staff_attendance:read")) return;
    load(month);
  }, [permsLoading, can, load, month]);

  const totals = rows.reduce(
    (acc, row) => ({
      present: acc.present + row.present,
      absent: acc.absent + row.absent,
      leave: acc.leave + row.leave,
      late: acc.late + row.lateCount,
    }),
    { present: 0, absent: 0, leave: 0, late: 0 }
  );

  const stats = [
    { label: "Staff tracked", value: rows.length },
    { label: "Present (sum)", value: totals.present },
    { label: "Absent (sum)", value: totals.absent },
    { label: "On leave (sum)", value: totals.leave },
    { label: "Late marks", value: totals.late },
  ];

  if (permsLoading) {
    return (
      <>
        <PageHeader title="Staff Attendance" subtitle="Marking, history & reports" />
        <Spinner />
      </>
    );
  }

  if (!can("staff_attendance:read")) {
    return (
      <>
        <PageHeader title="Staff Attendance" subtitle="Marking, history & reports" />
        <EmptyState message="You do not have access to staff attendance." />
      </>
    );
  }

  return (
    <>
      <PageHeader title="Staff Attendance" subtitle="Marking, history & reports" />

      <div className="space-y-6">
        <Card>
          <div className="mb-4 flex flex-wrap items-end gap-3">
            <div className="w-44">
              <span className="mb-1 block text-sm font-medium text-slate-700">
                Month
              </span>
              <Input
                type="month"
                value={month}
                onChange={(event) => setMonth(event.target.value)}
              />
            </div>
            <Button
              variant="secondary"
              onClick={() => load(month)}
              disabled={loading}
            >
              {loading ? "Loading…" : "Refresh"}
            </Button>
          </div>

          <ErrorNote message={loadError} />

          {loading ? (
            <Spinner />
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
              {stats.map((stat) => (
                <div
                  key={stat.label}
                  className="rounded-xl border border-slate-200 p-4"
                >
                  <p className="text-sm font-medium text-slate-500">
                    {stat.label}
                  </p>
                  <p className="mt-2 text-2xl font-semibold text-slate-900">
                    {stat.value}
                  </p>
                </div>
              ))}
            </div>
          )}
        </Card>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {SUB_PAGES.filter(
            (page) => page.href !== "/staff/reports" || can("leave:reports")
          ).map((page) => (
            <Link key={page.href} href={page.href} className="block">
              <Card className="h-full transition hover:border-brand-300 hover:shadow-md">
                <div className="flex items-start gap-3">
                  <span className="text-2xl" aria-hidden>
                    {page.icon}
                  </span>
                  <div>
                    <h3 className="font-semibold text-slate-900">
                      {page.label}
                    </h3>
                    <p className="mt-1 text-sm text-slate-500">{page.desc}</p>
                  </div>
                </div>
              </Card>
            </Link>
          ))}
        </div>
      </div>
    </>
  );
}
