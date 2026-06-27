"use client";

import { useCallback, useEffect, useState } from "react";
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
  Paginated,
  StaffAttendance,
  StaffAttendanceStatus,
  StaffAttendanceSummary,
  Teacher,
} from "@/types";

const STATUS_TONE: Record<
  StaffAttendanceStatus,
  "green" | "red" | "blue" | "amber" | "slate"
> = {
  present: "green",
  absent: "red",
  leave: "blue",
  half_day: "amber",
  holiday: "slate",
};

const STATUS_LABEL: Record<StaffAttendanceStatus, string> = {
  present: "present",
  absent: "absent",
  half_day: "half-day",
  leave: "leave",
  holiday: "holiday",
};

function currentMonth(): string {
  return new Date().toISOString().slice(0, 7);
}

export default function StaffHistoryPage() {
  const { can, loading: permsLoading } = usePermissions();
  // Teachers cannot read the teacher roster (own-only); admins/HR can.
  const canPickStaff = can("staff_attendance:create");

  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [teacherId, setTeacherId] = useState("");
  const [month, setMonth] = useState(currentMonth);

  const [summary, setSummary] = useState<StaffAttendanceSummary[]>([]);
  const [days, setDays] = useState<StaffAttendance[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (permsLoading || !canPickStaff) return;
    api
      .get<Paginated<Teacher>>("/teachers?limit=200")
      .then((page) => setTeachers(page.data))
      .catch(() => undefined);
  }, [permsLoading, canPickStaff]);

  const load = useCallback(
    async (selectedMonth: string, selectedTeacher: string) => {
      setLoading(true);
      setLoadError(null);
      try {
        const teacherQs = selectedTeacher
          ? `&teacherId=${selectedTeacher}`
          : "";
        const [summaryRows, dayRows] = await Promise.all([
          api.get<StaffAttendanceSummary[]>(
            `/staff/attendance/summary?month=${selectedMonth}${teacherQs}`
          ),
          api.get<StaffAttendance[]>(
            `/staff/attendance?month=${selectedMonth}${teacherQs}`
          ),
        ]);
        setSummary(summaryRows);
        setDays(dayRows);
      } catch (err) {
        setLoadError(
          err instanceof ApiError ? err.message : "Failed to load history"
        );
      } finally {
        setLoading(false);
      }
    },
    []
  );

  useEffect(() => {
    if (permsLoading || !can("staff_attendance:read")) return;
    load(month, teacherId);
  }, [permsLoading, can, load, month, teacherId]);

  if (permsLoading) {
    return (
      <>
        <PageHeader title="Staff history" subtitle="Monthly summary & day rows" />
        <Spinner />
      </>
    );
  }

  if (!can("staff_attendance:read")) {
    return (
      <>
        <PageHeader title="Staff history" subtitle="Monthly summary & day rows" />
        <EmptyState message="You do not have access to staff attendance." />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Staff history"
        subtitle="Monthly summary & day-by-day rows"
      />

      <div className="mb-4">
        <Link
          href="/staff"
          className="text-sm font-medium text-brand-600 hover:text-brand-700"
        >
          ← Back to Staff Attendance
        </Link>
      </div>

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
        {canPickStaff && (
          <div className="w-64">
            <span className="mb-1 block text-sm font-medium text-slate-700">
              Staff
            </span>
            <Select
              value={teacherId}
              onChange={(event) => setTeacherId(event.target.value)}
            >
              <option value="">All staff</option>
              {teachers.map((teacher) => (
                <option key={teacher.id} value={teacher.id}>
                  {teacher.firstName} {teacher.lastName} ({teacher.employeeNo})
                </option>
              ))}
            </Select>
          </div>
        )}
        <Button
          variant="secondary"
          onClick={() => load(month, teacherId)}
          disabled={loading}
        >
          {loading ? "Loading…" : "Refresh"}
        </Button>
      </div>

      <ErrorNote message={loadError} />

      {loading ? (
        <Spinner />
      ) : (
        <div className="space-y-6">
          <Card>
            <h2 className="mb-3 text-lg font-semibold text-slate-900">
              Monthly summary
            </h2>
            {summary.length === 0 ? (
              <EmptyState message="No summary for this month" />
            ) : (
              <div className="overflow-x-auto rounded-xl border border-slate-200">
                <table className="w-full text-left text-sm">
                  <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
                    <tr>
                      <th className="px-4 py-3">Employee No</th>
                      <th className="px-4 py-3">Staff</th>
                      <th className="px-4 py-3">Present</th>
                      <th className="px-4 py-3">Absent</th>
                      <th className="px-4 py-3">Half-day</th>
                      <th className="px-4 py-3">Leave</th>
                      <th className="px-4 py-3">Holiday</th>
                      <th className="px-4 py-3">Late</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {summary.map((row) => (
                      <tr key={row.teacherId} className="hover:bg-slate-50">
                        <td className="px-4 py-3 font-mono text-xs">
                          {row.employeeNo}
                        </td>
                        <td className="px-4 py-3 font-medium text-slate-900">
                          {row.name}
                        </td>
                        <td className="px-4 py-3">{row.present}</td>
                        <td className="px-4 py-3">{row.absent}</td>
                        <td className="px-4 py-3">{row.halfDay}</td>
                        <td className="px-4 py-3">{row.leave}</td>
                        <td className="px-4 py-3">{row.holiday}</td>
                        <td className="px-4 py-3">{row.lateCount}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <Card>
            <h2 className="mb-3 text-lg font-semibold text-slate-900">
              Day-by-day
            </h2>
            {days.length === 0 ? (
              <EmptyState message="No attendance rows for this month" />
            ) : (
              <div className="overflow-x-auto rounded-xl border border-slate-200">
                <table className="w-full text-left text-sm">
                  <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
                    <tr>
                      <th className="px-4 py-3">Date</th>
                      <th className="px-4 py-3">Staff</th>
                      <th className="px-4 py-3">Status</th>
                      <th className="px-4 py-3">In</th>
                      <th className="px-4 py-3">Out</th>
                      <th className="px-4 py-3">Late</th>
                      <th className="px-4 py-3">Remarks</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {days.map((row) => (
                      <tr key={row.id} className="hover:bg-slate-50">
                        <td className="px-4 py-3 whitespace-nowrap">
                          {row.date}
                        </td>
                        <td className="px-4 py-3 font-medium text-slate-900">
                          {row.teacherName}
                        </td>
                        <td className="px-4 py-3">
                          <Badge tone={STATUS_TONE[row.status]}>
                            {STATUS_LABEL[row.status]}
                          </Badge>
                        </td>
                        <td className="px-4 py-3">{row.checkIn ?? "—"}</td>
                        <td className="px-4 py-3">{row.checkOut ?? "—"}</td>
                        <td className="px-4 py-3">{row.late ? "Yes" : "—"}</td>
                        <td className="px-4 py-3">{row.remarks ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>
      )}
    </>
  );
}
