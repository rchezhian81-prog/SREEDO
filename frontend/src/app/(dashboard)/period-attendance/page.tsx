"use client";

import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import {
  Button,
  cx,
  EmptyState,
  ErrorNote,
  Input,
  PageHeader,
  Select,
  Spinner,
} from "@/components/ui";
import type { SchoolClass } from "@/types";

const STATUSES = ["present", "absent", "late", "excused"] as const;
type Status = (typeof STATUSES)[number];

const STATUS_STYLES: Record<Status, string> = {
  present: "bg-emerald-600 text-white",
  absent: "bg-red-600 text-white",
  late: "bg-amber-500 text-white",
  excused: "bg-blue-600 text-white",
};

interface SectionOption { id: string; label: string }
interface Period { id: string; name: string }
interface RosterRow { studentId: string; name: string; admissionNo: string | null; status: Status | null }

export default function PeriodAttendancePage() {
  const [sections, setSections] = useState<SectionOption[]>([]);
  const [periods, setPeriods] = useState<Period[]>([]);
  const [sectionId, setSectionId] = useState("");
  const [periodId, setPeriodId] = useState("");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [rows, setRows] = useState<RosterRow[]>([]);
  const [marks, setMarks] = useState<Record<string, Status>>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<SchoolClass[]>("/classes")
      .then((classes) => {
        const opts = classes.flatMap((c) =>
          c.sections.map((s) => ({ id: s.id, label: `${c.name} — ${s.name}` }))
        );
        setSections(opts);
        if (opts[0]) setSectionId(opts[0].id);
      })
      .catch(() => undefined);
    api
      .get<Period[]>("/timetable/periods")
      .then((p) => {
        setPeriods(p);
        if (p[0]) setPeriodId(p[0].id);
      })
      .catch(() => undefined);
  }, []);

  const load = useCallback(async () => {
    if (!sectionId || !periodId) return;
    setLoading(true);
    setMessage(null);
    setError(null);
    try {
      const result = await api.get<{ records: RosterRow[] }>(
        `/period-attendance/roster?sectionId=${sectionId}&date=${date}&periodId=${periodId}`
      );
      setRows(result.records);
      // Default unmarked students to "present" for fast marking of absentees.
      const next: Record<string, Status> = {};
      for (const r of result.records) next[r.studentId] = r.status ?? "present";
      setMarks(next);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load roster");
    } finally {
      setLoading(false);
    }
  }, [sectionId, periodId, date]);

  useEffect(() => {
    load();
  }, [load]);

  const save = async () => {
    setSaving(true);
    setMessage(null);
    setError(null);
    try {
      const entries = rows.map((r) => ({ studentId: r.studentId, status: marks[r.studentId] }));
      const res = await api.post<{ marked: number }>("/period-attendance", { date, periodId, entries });
      setMessage(`Saved attendance for ${res.marked} student${res.marked === 1 ? "" : "s"}.`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <PageHeader title="Period Attendance" subtitle="Mark attendance per class period" />

      <div className="mb-4 flex flex-wrap gap-3">
        <div className="w-56">
          <Select value={sectionId} onChange={(e) => setSectionId(e.target.value)}>
            {sections.map((s) => (
              <option key={s.id} value={s.id}>{s.label}</option>
            ))}
          </Select>
        </div>
        <div className="w-40">
          <Select value={periodId} onChange={(e) => setPeriodId(e.target.value)}>
            {periods.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </Select>
        </div>
        <div className="w-40">
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
      </div>

      <ErrorNote message={error} />
      {message ? (
        <div className="mb-4 rounded-lg border border-green-200 bg-green-50 px-4 py-2 text-sm text-green-700">
          {message}
        </div>
      ) : null}

      {loading ? (
        <Spinner />
      ) : rows.length === 0 ? (
        <EmptyState message="No students in this section (or no period selected)" />
      ) : (
        <>
          <div className="overflow-x-auto rounded-xl border border-line bg-surface">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-line bg-surface-2 text-xs uppercase text-muted">
                <tr>
                  <th className="px-4 py-3">Student</th>
                  <th className="px-4 py-3">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((r) => (
                  <tr key={r.studentId} className="hover:bg-surface-2">
                    <td className="px-4 py-3">
                      <span className="font-medium text-ink">{r.name}</span>
                      {r.admissionNo ? <span className="ml-2 text-xs text-muted">{r.admissionNo}</span> : null}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1.5">
                        {STATUSES.map((s) => (
                          <button
                            key={s}
                            onClick={() => setMarks((m) => ({ ...m, [r.studentId]: s }))}
                            className={cx(
                              "rounded-md px-2.5 py-1 text-xs font-medium capitalize transition",
                              marks[r.studentId] === s
                                ? STATUS_STYLES[s]
                                : "bg-surface-2 text-muted hover:bg-hover"
                            )}
                          >
                            {s}
                          </button>
                        ))}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-4 flex justify-end">
            <Button onClick={save} disabled={saving}>
              {saving ? "Saving…" : "Save attendance"}
            </Button>
          </div>
        </>
      )}
    </>
  );
}
