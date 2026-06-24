"use client";

import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import {
  Button,
  EmptyState,
  ErrorNote,
  Field,
  Modal,
  Select,
  Spinner,
} from "@/components/ui";
import type {
  ClassSubject,
  Paginated,
  Section,
  Subject,
  Teacher,
} from "@/types";

/**
 * Manage which subjects are taught in a section, and which teacher takes each.
 * Backed by the class_subjects endpoints under /sections/:id/subjects and
 * /class-subjects/:id.
 */
export function SectionSubjectsModal({
  section,
  classLabel,
  onClose,
}: {
  section: Section | null;
  classLabel: string | null;
  onClose: () => void;
}) {
  const [assignments, setAssignments] = useState<ClassSubject[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [subjectId, setSubjectId] = useState("");
  const [teacherId, setTeacherId] = useState("");
  const [saving, setSaving] = useState(false);

  const sectionId = section?.id;

  const load = useCallback(async () => {
    if (!sectionId) return;
    setLoading(true);
    setError(null);
    try {
      const [rows, subjectList, teacherPage] = await Promise.all([
        api.get<ClassSubject[]>(`/sections/${sectionId}/subjects`),
        api.get<Subject[]>("/subjects"),
        api.get<Paginated<Teacher>>("/teachers?limit=100"),
      ]);
      setAssignments(rows);
      setSubjects(subjectList);
      setTeachers(teacherPage.data);
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Failed to load subjects"
      );
    } finally {
      setLoading(false);
    }
  }, [sectionId]);

  useEffect(() => {
    if (sectionId) {
      setSubjectId("");
      setTeacherId("");
      load();
    }
  }, [sectionId, load]);

  const assigned = new Set(assignments.map((a) => a.subjectId));
  const available = subjects.filter((s) => !assigned.has(s.id));

  const assign = async () => {
    if (!sectionId || !subjectId) return;
    setSaving(true);
    setError(null);
    try {
      await api.post(`/sections/${sectionId}/subjects`, {
        subjectId,
        teacherId: teacherId || null,
      });
      setSubjectId("");
      setTeacherId("");
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to assign subject");
    } finally {
      setSaving(false);
    }
  };

  const reassign = async (cs: ClassSubject, nextTeacherId: string) => {
    setError(null);
    try {
      await api.patch(`/class-subjects/${cs.id}`, {
        teacherId: nextTeacherId || null,
      });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to update teacher");
    }
  };

  const remove = async (cs: ClassSubject) => {
    if (!confirm(`Remove ${cs.subjectName} from this section?`)) return;
    setError(null);
    try {
      await api.delete(`/class-subjects/${cs.id}`);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to remove subject");
    }
  };

  return (
    <Modal
      title={
        section
          ? `Subjects · ${classLabel ?? "Class"} ${section.name}`
          : "Subjects"
      }
      open={section !== null}
      onClose={onClose}
    >
      {loading ? (
        <Spinner />
      ) : (
        <div className="space-y-4">
          {assignments.length === 0 ? (
            <EmptyState message="No subjects assigned yet" />
          ) : (
            <ul className="divide-y divide-line rounded-lg border border-line">
              {assignments.map((cs) => (
                <li
                  key={cs.id}
                  className="flex items-center justify-between gap-3 px-3 py-2"
                >
                  <div className="min-w-0">
                    <span className="font-medium text-ink">{cs.subjectName}</span>
                    <span className="ml-2 text-xs text-faint">{cs.subjectCode}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Select
                      value={cs.teacherId ?? ""}
                      onChange={(e) => reassign(cs, e.target.value)}
                      className="w-44"
                      aria-label={`Teacher for ${cs.subjectName}`}
                    >
                      <option value="">Unassigned</option>
                      {teachers.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.firstName} {t.lastName}
                        </option>
                      ))}
                    </Select>
                    <button
                      onClick={() => remove(cs)}
                      className="text-xs font-medium text-red-600 hover:text-red-700"
                    >
                      Remove
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}

          <div className="rounded-lg border border-line bg-surface-2 p-3">
            <p className="mb-2 text-sm font-medium text-ink">Assign a subject</p>
            {available.length === 0 ? (
              <p className="text-sm text-faint">
                Every subject is already assigned.
              </p>
            ) : (
              <div className="flex flex-wrap items-end gap-2">
                <div className="min-w-40 flex-1">
                  <Field label="Subject">
                    <Select
                      value={subjectId}
                      onChange={(e) => setSubjectId(e.target.value)}
                    >
                      <option value="">Select…</option>
                      {available.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name} ({s.code})
                        </option>
                      ))}
                    </Select>
                  </Field>
                </div>
                <div className="min-w-40 flex-1">
                  <Field label="Teacher (optional)">
                    <Select
                      value={teacherId}
                      onChange={(e) => setTeacherId(e.target.value)}
                    >
                      <option value="">Unassigned</option>
                      {teachers.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.firstName} {t.lastName}
                        </option>
                      ))}
                    </Select>
                  </Field>
                </div>
                <Button onClick={assign} disabled={!subjectId || saving}>
                  {saving ? "Adding…" : "Add"}
                </Button>
              </div>
            )}
          </div>

          <ErrorNote message={error} />
        </div>
      )}
    </Modal>
  );
}
