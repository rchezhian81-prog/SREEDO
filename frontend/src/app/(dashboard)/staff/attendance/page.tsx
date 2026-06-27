"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api, ApiError } from "@/lib/api";
import { usePermissions } from "@/lib/use-permissions";
import {
  Button,
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
  Teacher,
} from "@/types";

const STATUSES: StaffAttendanceStatus[] = [
  "present",
  "absent",
  "half_day",
  "leave",
  "holiday",
];

const STATUS_LABELS: Record<StaffAttendanceStatus, string> = {
  present: "Present",
  absent: "Absent",
  half_day: "Half-day",
  leave: "Leave",
  holiday: "Holiday",
};

interface RosterRow {
  teacherId: string;
  employeeNo: string;
  name: string;
  status: StaffAttendanceStatus;
  checkIn: string;
  checkOut: string;
  late: boolean;
  earlyOut: boolean;
  remarks: string;
}

export default function StaffAttendanceMarkPage() {
  const { can, loading: permsLoading } = usePermissions();
  const canMark = can("staff_attendance:create");

  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [rows, setRows] = useState<RosterRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (selectedDate: string) => {
      setLoading(true);
      setLoadError(null);
      setMessage(null);
      try {
        const [teacherPage, marks] = await Promise.all([
          api.get<Paginated<Teacher>>("/teachers?limit=200"),
          api.get<StaffAttendance[]>(
            `/staff/attendance?date=${selectedDate}`
          ),
        ]);
        const byTeacher = new Map(marks.map((m) => [m.teacherId, m]));
        // Teachers (own-only readers) may get an empty /teachers list; fall
        // back to whatever marks the backend already scoped to them.
        const source: RosterRow[] = teacherPage.data.length
          ? teacherPage.data.map((teacher) => {
              const existing = byTeacher.get(teacher.id);
              return {
                teacherId: teacher.id,
                employeeNo: teacher.employeeNo,
                name: `${teacher.firstName} ${teacher.lastName}`,
                status: existing?.status ?? "present",
                checkIn: existing?.checkIn ?? "",
                checkOut: existing?.checkOut ?? "",
                late: existing?.late ?? false,
                earlyOut: existing?.earlyOut ?? false,
                remarks: existing?.remarks ?? "",
              };
            })
          : marks.map((m) => ({
              teacherId: m.teacherId,
              employeeNo: m.employeeNo,
              name: m.teacherName,
              status: m.status,
              checkIn: m.checkIn ?? "",
              checkOut: m.checkOut ?? "",
              late: m.late,
              earlyOut: m.earlyOut,
              remarks: m.remarks ?? "",
            }));
        setRows(source);
      } catch (err) {
        setLoadError(
          err instanceof ApiError ? err.message : "Failed to load roster"
        );
        setRows([]);
      } finally {
        setLoading(false);
      }
    },
    []
  );

  useEffect(() => {
    if (permsLoading || !can("staff_attendance:read")) return;
    load(date);
  }, [permsLoading, can, load, date]);

  const update = (teacherId: string, patch: Partial<RosterRow>) => {
    setRows((current) =>
      current.map((row) =>
        row.teacherId === teacherId ? { ...row, ...patch } : row
      )
    );
  };

  const markAll = (status: StaffAttendanceStatus) => {
    setRows((current) => current.map((row) => ({ ...row, status })));
  };

  const save = async () => {
    if (rows.length === 0) {
      setError("No staff to mark");
      return;
    }
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const result = await api.post<{ date: string; marked: number }>(
        "/staff/attendance",
        {
          date,
          entries: rows.map((row) => ({
            teacherId: row.teacherId,
            status: row.status,
            checkIn: row.checkIn || undefined,
            checkOut: row.checkOut || undefined,
            late: row.late,
            earlyOut: row.earlyOut,
            remarks: row.remarks || undefined,
          })),
        }
      );
      setMessage(`Saved attendance for ${result.marked} staff`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  if (permsLoading) {
    return (
      <>
        <PageHeader title="Staff attendance" subtitle="Daily / bulk marking" />
        <Spinner />
      </>
    );
  }

  if (!can("staff_attendance:read")) {
    return (
      <>
        <PageHeader title="Staff attendance" subtitle="Daily / bulk marking" />
        <EmptyState message="You do not have access to staff attendance." />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Staff attendance"
        subtitle={canMark ? "Daily / bulk marking" : "Daily view"}
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
            Date
          </span>
          <Input
            type="date"
            value={date}
            onChange={(event) => setDate(event.target.value)}
          />
        </div>
        {canMark && (
          <>
            <Button variant="secondary" onClick={() => markAll("present")}>
              All present
            </Button>
            <Button variant="secondary" onClick={() => markAll("holiday")}>
              All holiday
            </Button>
            <Button onClick={save} disabled={saving || rows.length === 0}>
              {saving ? "Saving…" : "Save attendance"}
            </Button>
          </>
        )}
      </div>

      {message && (
        <p className="mb-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          {message}
        </p>
      )}
      <div className="space-y-2">
        <ErrorNote message={error} />
        <ErrorNote message={loadError} />
      </div>

      {loading ? (
        <Spinner />
      ) : rows.length === 0 ? (
        <EmptyState message="No staff to mark for this date" />
      ) : (
        <div className="mt-3 overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3">Staff</th>
                <th className="px-4 py-3">Employee No</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">In</th>
                <th className="px-4 py-3">Out</th>
                <th className="px-4 py-3">Late</th>
                <th className="px-4 py-3">Remarks</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((row) => (
                <tr key={row.teacherId}>
                  <td className="px-4 py-3 font-medium text-slate-900">
                    {row.name}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs">
                    {row.employeeNo}
                  </td>
                  <td className="px-4 py-3">
                    <Select
                      value={row.status}
                      disabled={!canMark}
                      onChange={(event) =>
                        update(row.teacherId, {
                          status: event.target.value as StaffAttendanceStatus,
                        })
                      }
                      className="w-32"
                    >
                      {STATUSES.map((status) => (
                        <option key={status} value={status}>
                          {STATUS_LABELS[status]}
                        </option>
                      ))}
                    </Select>
                  </td>
                  <td className="px-4 py-3">
                    <Input
                      type="time"
                      value={row.checkIn}
                      disabled={!canMark}
                      onChange={(event) =>
                        update(row.teacherId, { checkIn: event.target.value })
                      }
                      className="w-28"
                    />
                  </td>
                  <td className="px-4 py-3">
                    <Input
                      type="time"
                      value={row.checkOut}
                      disabled={!canMark}
                      onChange={(event) =>
                        update(row.teacherId, { checkOut: event.target.value })
                      }
                      className="w-28"
                    />
                  </td>
                  <td className="px-4 py-3">
                    <input
                      type="checkbox"
                      checked={row.late}
                      disabled={!canMark}
                      onChange={(event) =>
                        update(row.teacherId, { late: event.target.checked })
                      }
                      className="h-4 w-4 rounded border-slate-300"
                    />
                  </td>
                  <td className="px-4 py-3">
                    <Input
                      value={row.remarks}
                      disabled={!canMark}
                      placeholder="—"
                      onChange={(event) =>
                        update(row.teacherId, { remarks: event.target.value })
                      }
                      className="w-44"
                    />
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
