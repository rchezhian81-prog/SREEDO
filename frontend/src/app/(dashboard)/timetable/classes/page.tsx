"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { useAuthStore } from "@/stores/auth-store";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorNote,
  Field,
  PageHeader,
  Select,
  Spinner,
} from "@/components/ui";
import type {
  Paginated,
  Period,
  Room,
  SchoolClass,
  Subject,
  Teacher,
  TimetableEntry,
} from "@/types";
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

interface SectionOption {
  id: string;
  label: string;
}

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

export default function ClassTimetablePage() {
  const term = useTerms();
  const role = useAuthStore((state) => state.user?.role);
  const isAdmin = role === "admin";
  const canExport = role === "admin" || role === "teacher";

  const [sections, setSections] = useState<SectionOption[]>([]);
  const [sectionId, setSectionId] = useState("");
  const [periods, setPeriods] = useState<Period[]>([]);
  const [entries, setEntries] = useState<TimetableEntry[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);

  const [loading, setLoading] = useState(true);
  const [gridLoading, setGridLoading] = useState(false);

  // Editing state for the clicked cell.
  const [editing, setEditing] = useState<{
    dayOfWeek: number;
    period: Period;
    entry: TimetableEntry | null;
  } | null>(null);
  const [formSubjectId, setFormSubjectId] = useState("");
  const [formTeacherId, setFormTeacherId] = useState("");
  const [formRoomId, setFormRoomId] = useState("");
  const [saving, setSaving] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);

  // Load the masters (sections, subjects, teachers, rooms) once.
  useEffect(() => {
    Promise.all([
      api.get<SchoolClass[]>("/classes"),
      api.get<Subject[]>("/subjects"),
      api.get<Paginated<Teacher>>("/teachers?limit=100"),
      api.get<Room[]>("/timetable/rooms"),
      api.get<Period[]>("/timetable/periods"),
    ])
      .then(([classes, subj, teacherPage, roomList, periodList]) => {
        const options = classes.flatMap((schoolClass) =>
          schoolClass.sections.map((section) => ({
            id: section.id,
            label: `${schoolClass.name} - ${section.name}`,
          }))
        );
        setSections(options);
        if (options[0]) setSectionId(options[0].id);
        setSubjects(subj);
        setTeachers(teacherPage.data);
        setRooms(roomList);
        setPeriods([...periodList].sort((a, b) => a.sortOrder - b.sortOrder));
      })
      .catch(() => undefined)
      .finally(() => setLoading(false));
  }, []);

  const loadEntries = useCallback(async () => {
    if (!sectionId) {
      setEntries([]);
      return;
    }
    setGridLoading(true);
    try {
      setEntries(
        await api.get<TimetableEntry[]>(
          `/timetable/entries?sectionId=${sectionId}`
        )
      );
    } finally {
      setGridLoading(false);
    }
  }, [sectionId]);

  useEffect(() => {
    loadEntries().catch(() => setGridLoading(false));
  }, [loadEntries]);

  // Fast lookup keyed by "day:periodId".
  const cellMap = useMemo(() => {
    const map = new Map<string, TimetableEntry>();
    for (const entry of entries) {
      map.set(`${entry.dayOfWeek}:${entry.periodId}`, entry);
    }
    return map;
  }, [entries]);

  const openCell = (dayOfWeek: number, period: Period) => {
    if (!isAdmin) return;
    const entry = cellMap.get(`${dayOfWeek}:${period.id}`) ?? null;
    setEditing({ dayOfWeek, period, entry });
    setFormSubjectId(entry?.subjectId ?? subjects[0]?.id ?? "");
    setFormTeacherId(entry?.teacherId ?? "");
    setFormRoomId(entry?.roomId ?? "");
    setModalError(null);
  };

  const closeModal = () => {
    setEditing(null);
    setModalError(null);
  };

  const saveEntry = async () => {
    if (!editing) return;
    if (!formSubjectId) {
      setModalError("Subject is required");
      return;
    }
    setSaving(true);
    setModalError(null);
    const body = {
      sectionId,
      dayOfWeek: editing.dayOfWeek,
      periodId: editing.period.id,
      subjectId: formSubjectId,
      teacherId: formTeacherId || undefined,
      roomId: formRoomId || undefined,
    };
    try {
      if (editing.entry) {
        await api.patch(`/timetable/entries/${editing.entry.id}`, body);
      } else {
        await api.post("/timetable/entries", body);
      }
      closeModal();
      await loadEntries();
    } catch (err) {
      // 409 conflict (teacher/room/section double-booked) lands here.
      setModalError(
        err instanceof ApiError ? err.message : "Failed to save entry"
      );
    } finally {
      setSaving(false);
    }
  };

  const deleteEntry = async () => {
    if (!editing?.entry) return;
    if (!confirm("Remove this timetable entry?")) return;
    setSaving(true);
    setModalError(null);
    try {
      await api.delete(`/timetable/entries/${editing.entry.id}`);
      closeModal();
      await loadEntries();
    } catch (err) {
      setModalError(
        err instanceof ApiError ? err.message : "Failed to delete entry"
      );
    } finally {
      setSaving(false);
    }
  };

  const selectedSection = sections.find((s) => s.id === sectionId);

  if (loading) {
    return (
      <>
        <PageHeader title="Class timetable" subtitle="Weekly schedule by section" />
        <Spinner />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Class timetable"
        subtitle="Weekly schedule by section"
        action={
          canExport && sectionId ? (
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => window.print()}>
                Print
              </Button>
              <Button
                variant="secondary"
                onClick={() =>
                  downloadCsv(
                    `sectionId=${sectionId}`,
                    `timetable-${selectedSection?.label ?? "section"}.csv`
                  )
                }
              >
                Export CSV
              </Button>
            </div>
          ) : undefined
        }
      />

      {sections.length === 0 ? (
        <EmptyState message="Add classes and sections first (Classes page)." />
      ) : (
        <>
          <div className="mb-4 max-w-xs">
            <Field label={term.section}>
              <Select
                value={sectionId}
                onChange={(event) => setSectionId(event.target.value)}
              >
                {sections.map((section) => (
                  <option key={section.id} value={section.id}>
                    {section.label}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          {periods.length === 0 ? (
            <EmptyState message="No periods defined yet — set them up first." />
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
                        {period.isBreak && (
                          <Badge tone="amber">Break</Badge>
                        )}
                      </td>
                      {DAYS.map((day) => {
                        const entry = cellMap.get(`${day.value}:${period.id}`);
                        return (
                          <td
                            key={day.value}
                            onClick={() => openCell(day.value, period)}
                            className={`px-3 py-3 ${
                              isAdmin
                                ? "cursor-pointer hover:bg-brand-50"
                                : ""
                            }`}
                          >
                            {entry ? (
                              <div>
                                <div className="font-semibold text-slate-900">
                                  {entry.subjectName}
                                </div>
                                {entry.teacherName && (
                                  <div className="text-xs text-slate-600">
                                    {entry.teacherName}
                                  </div>
                                )}
                                {entry.roomName && (
                                  <div className="text-xs text-slate-400">
                                    {entry.roomName}
                                  </div>
                                )}
                              </div>
                            ) : (
                              <div className="text-xs text-slate-300">
                                {isAdmin ? "+ add" : "—"}
                              </div>
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

      {/* Cell editor (admin only). Modal is not used here because the cell's
          day+period are fixed and we want the inline conflict note. */}
      {editing && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 print:hidden"
          onClick={closeModal}
        >
          <div
            className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl bg-white p-6 shadow-xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-slate-900">
                {editing.entry ? "Edit slot" : "Add slot"}
              </h2>
              <button
                onClick={closeModal}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                aria-label="Close"
              >
                ✕
              </button>
            </div>
            <p className="mb-4 text-sm text-slate-500">
              {DAYS.find((d) => d.value === editing.dayOfWeek)?.label} ·{" "}
              {editing.period.name} ({hhmm(editing.period.startTime)}–
              {hhmm(editing.period.endTime)})
            </p>

            <div className="space-y-4">
              <Field label={term.subject}>
                <Select
                  value={formSubjectId}
                  onChange={(event) => setFormSubjectId(event.target.value)}
                >
                  <option value="">— select subject —</option>
                  {subjects.map((subject) => (
                    <option key={subject.id} value={subject.id}>
                      {subject.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={term.teacher}>
                <Select
                  value={formTeacherId}
                  onChange={(event) => setFormTeacherId(event.target.value)}
                >
                  <option value="">— none —</option>
                  {teachers.map((teacher) => (
                    <option key={teacher.id} value={teacher.id}>
                      {teacher.firstName} {teacher.lastName}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Room">
                <Select
                  value={formRoomId}
                  onChange={(event) => setFormRoomId(event.target.value)}
                >
                  <option value="">— none —</option>
                  {rooms.map((room) => (
                    <option key={room.id} value={room.id}>
                      {room.name}
                    </option>
                  ))}
                </Select>
              </Field>

              <ErrorNote message={modalError} />

              <div className="flex items-center justify-between gap-2">
                <div>
                  {editing.entry && (
                    <Button
                      type="button"
                      variant="danger"
                      onClick={deleteEntry}
                      disabled={saving}
                    >
                      Delete
                    </Button>
                  )}
                </div>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={closeModal}
                  >
                    Cancel
                  </Button>
                  <Button type="button" onClick={saveEntry} disabled={saving}>
                    {saving ? "Saving…" : "Save"}
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
