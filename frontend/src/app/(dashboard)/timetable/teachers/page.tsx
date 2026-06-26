"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { useAuthStore } from "@/stores/auth-store";
import {
  Badge,
  Button,
  EmptyState,
  Field,
  PageHeader,
  Select,
  Spinner,
} from "@/components/ui";
import type { Paginated, Period, Teacher, TimetableEntry } from "@/types";
import { useTerms } from "@/lib/terms";

const DAYS = [
  { value: 1, label: "Monday" },
  { value: 2, label: "Tuesday" },
  { value: 3, label: "Wednesday" },
  { value: 4, label: "Thursday" },
  { value: 5, label: "Friday" },
  { value: 6, label: "Saturday" },
];

const hhmm = (value: string) => value.slice(0, 5);

async function downloadCsv(qs: string, filename: string) {
  const base = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api/v1";
  const token = useAuthStore.getState().accessToken;
  const res = await fetch(`${base}/timetable/export?${qs}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) return;
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function TeacherTimetablePage() {
  const term = useTerms();
  const role = useAuthStore((state) => state.user?.role);
  const canExport = role === "admin" || role === "teacher";

  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [teacherId, setTeacherId] = useState("");
  const [periods, setPeriods] = useState<Period[]>([]);
  const [entries, setEntries] = useState<TimetableEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [gridLoading, setGridLoading] = useState(false);

  useEffect(() => {
    Promise.all([
      api.get<Paginated<Teacher>>("/teachers?limit=100"),
      api.get<Period[]>("/timetable/periods"),
    ])
      .then(([teacherPage, periodList]) => {
        setTeachers(teacherPage.data);
        if (teacherPage.data[0]) setTeacherId(teacherPage.data[0].id);
        setPeriods([...periodList].sort((a, b) => a.sortOrder - b.sortOrder));
      })
      .catch(() => undefined)
      .finally(() => setLoading(false));
  }, []);

  const loadEntries = useCallback(async () => {
    if (!teacherId) {
      setEntries([]);
      return;
    }
    setGridLoading(true);
    try {
      setEntries(
        await api.get<TimetableEntry[]>(
          `/timetable/entries?teacherId=${teacherId}`
        )
      );
    } finally {
      setGridLoading(false);
    }
  }, [teacherId]);

  useEffect(() => {
    loadEntries().catch(() => setGridLoading(false));
  }, [loadEntries]);

  const cellMap = useMemo(() => {
    const map = new Map<string, TimetableEntry>();
    for (const entry of entries) {
      map.set(`${entry.dayOfWeek}:${entry.periodId}`, entry);
    }
    return map;
  }, [entries]);

  const selectedTeacher = teachers.find((t) => t.id === teacherId);

  if (loading) {
    return (
      <>
        <PageHeader title="Teacher timetable" subtitle="Weekly schedule by teacher" />
        <Spinner />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Teacher timetable"
        subtitle="Weekly schedule by teacher"
        action={
          canExport && teacherId ? (
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => window.print()}>
                Print
              </Button>
              <Button
                variant="secondary"
                onClick={() =>
                  downloadCsv(
                    `teacherId=${teacherId}`,
                    `timetable-${
                      selectedTeacher
                        ? `${selectedTeacher.firstName}-${selectedTeacher.lastName}`
                        : "teacher"
                    }.csv`
                  )
                }
              >
                Export CSV
              </Button>
            </div>
          ) : undefined
        }
      />

      {teachers.length === 0 ? (
        <EmptyState message="No teachers yet (Teachers page)." />
      ) : (
        <>
          <div className="mb-4 max-w-xs">
            <Field label={term.teacher}>
              <Select
                value={teacherId}
                onChange={(event) => setTeacherId(event.target.value)}
              >
                {teachers.map((teacher) => (
                  <option key={teacher.id} value={teacher.id}>
                    {teacher.firstName} {teacher.lastName}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          {periods.length === 0 ? (
            <EmptyState message="No periods defined yet." />
          ) : gridLoading ? (
            <Spinner />
          ) : (
            <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white print:block">
              <table className="w-full border-collapse text-left text-sm">
                <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
                  <tr>
                    <th className="w-40 px-4 py-3">Period</th>
                    {DAYS.map((day) => (
                      <th key={day.value} className="px-4 py-3">
                        {day.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {periods.map((period) => (
                    <tr key={period.id} className="align-top">
                      <td className="px-4 py-3">
                        <div className="font-medium text-slate-900">
                          {period.name}
                        </div>
                        <div className="text-xs text-slate-500">
                          {hhmm(period.startTime)}–{hhmm(period.endTime)}
                        </div>
                        {period.isBreak && <Badge tone="amber">Break</Badge>}
                      </td>
                      {DAYS.map((day) => {
                        const entry = cellMap.get(`${day.value}:${period.id}`);
                        return (
                          <td key={day.value} className="px-3 py-3">
                            {entry ? (
                              <div>
                                <div className="text-xs font-medium text-slate-500">
                                  {entry.className} {entry.sectionName}
                                </div>
                                <div className="font-semibold text-slate-900">
                                  {entry.subjectName}
                                </div>
                                {entry.roomName && (
                                  <div className="text-xs text-slate-400">
                                    {entry.roomName}
                                  </div>
                                )}
                              </div>
                            ) : (
                              <div className="text-xs text-slate-300">—</div>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </>
  );
}
