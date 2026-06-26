"use client";

import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { Button, ErrorNote, Field, Modal, Select, Spinner } from "@/components/ui";
import { useModeStore } from "@/stores/mode-store";
import { useTerms } from "@/lib/terms";
import type {
  CollegeEnrollment,
  CollegeSemester,
  Paginated,
  SchoolClass,
  Student,
} from "@/types";

type Option = { id: string; label: string };
type Person = { id: string; name: string };

/**
 * Bulk student promotion / year rollover. School: move a source section's
 * students to a target section. College: advance a source semester's enrolled
 * students to a target semester. "Graduate" marks the selected students
 * graduated instead of moving them. Mode-aware via the terminology engine.
 */
export function PromoteStudentsModal({
  open,
  onClose,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const mode = useModeStore((s) => s.mode);
  const term = useTerms();
  const isCollege = mode === "college";

  const [options, setOptions] = useState<Option[]>([]);
  const [sourceId, setSourceId] = useState("");
  const [targetId, setTargetId] = useState("");
  const [people, setPeople] = useState<Person[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [graduate, setGraduate] = useState(false);
  const [loadingList, setLoadingList] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Placement options load when the modal opens.
  useEffect(() => {
    if (!open) return;
    setError(null);
    if (isCollege) {
      api
        .get<CollegeSemester[]>("/college/semesters")
        .then((rows) =>
          setOptions(
            rows.map((s) => ({
              id: s.id,
              label: `${s.programName ? s.programName + " — " : ""}${s.name}`,
            }))
          )
        )
        .catch(() => undefined);
    } else {
      api
        .get<SchoolClass[]>("/classes")
        .then((classes) =>
          setOptions(
            classes.flatMap((c) =>
              c.sections.map((sec) => ({
                id: sec.id,
                label: `${c.name} — ${sec.name}`,
              }))
            )
          )
        )
        .catch(() => undefined);
    }
  }, [open, isCollege]);

  // Students in the chosen source — default all selected.
  const loadPeople = useCallback(async () => {
    if (!sourceId) {
      setPeople([]);
      setSelected(new Set());
      return;
    }
    setLoadingList(true);
    try {
      let list: Person[] = [];
      if (isCollege) {
        const rows = await api.get<CollegeEnrollment[]>(
          `/college/enrollments?semesterId=${sourceId}`
        );
        list = rows.map((e) => ({ id: e.studentId, name: e.studentName }));
      } else {
        const res = await api.get<Paginated<Student>>(
          `/students?sectionId=${sourceId}&limit=500`
        );
        list = res.data.map((s) => ({
          id: s.id,
          name: `${s.firstName} ${s.lastName}`,
        }));
      }
      setPeople(list);
      setSelected(new Set(list.map((p) => p.id)));
    } finally {
      setLoadingList(false);
    }
  }, [sourceId, isCollege]);

  useEffect(() => {
    loadPeople().catch(() => setLoadingList(false));
  }, [loadPeople]);

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const submit = async () => {
    setError(null);
    const studentIds = [...selected];
    if (studentIds.length === 0) {
      setError("Select at least one student");
      return;
    }
    if (!graduate && !targetId) {
      setError(
        `Choose a target ${(isCollege ? term.term : term.section).toLowerCase()}`
      );
      return;
    }
    setSubmitting(true);
    try {
      await api.post("/students/promote", {
        studentIds,
        graduate: graduate || undefined,
        toSectionId: !graduate && !isCollege ? targetId : undefined,
        toSemesterId: !graduate && isCollege ? targetId : undefined,
      });
      setSourceId("");
      setTargetId("");
      setPeople([]);
      setSelected(new Set());
      setGraduate(false);
      onDone();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Promotion failed");
    } finally {
      setSubmitting(false);
    }
  };

  const unit = isCollege ? term.term.toLowerCase() : term.section.toLowerCase();

  return (
    <Modal title="Promote students" open={open} onClose={onClose}>
      <div className="space-y-4">
        <Field label={`From ${unit}`}>
          <Select value={sourceId} onChange={(e) => setSourceId(e.target.value)}>
            <option value="">Select…</option>
            {options.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </Select>
        </Field>

        {sourceId && (
          <div className="rounded-xl border border-line">
            <div className="flex items-center justify-between border-b border-line px-3 py-2 text-xs font-semibold text-muted">
              <span>
                {selected.size} of {people.length} selected
              </span>
              <button
                type="button"
                className="text-brand-600 hover:underline dark:text-brand-300"
                onClick={() =>
                  setSelected(
                    selected.size === people.length
                      ? new Set()
                      : new Set(people.map((p) => p.id))
                  )
                }
              >
                {selected.size === people.length ? "Clear all" : "Select all"}
              </button>
            </div>
            <div className="max-h-48 overflow-y-auto p-2">
              {loadingList ? (
                <Spinner />
              ) : people.length === 0 ? (
                <p className="py-4 text-center text-sm text-muted">
                  No students here
                </p>
              ) : (
                people.map((p) => (
                  <label
                    key={p.id}
                    className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-hover"
                  >
                    <input
                      type="checkbox"
                      checked={selected.has(p.id)}
                      onChange={() => toggle(p.id)}
                    />
                    {p.name}
                  </label>
                ))
              )}
            </div>
          </div>
        )}

        <label className="flex items-center gap-2 text-sm text-ink">
          <input
            type="checkbox"
            checked={graduate}
            onChange={(e) => setGraduate(e.target.checked)}
          />
          Mark as graduated (final {isCollege ? unit : "class"})
        </label>

        {!graduate && (
          <Field label={`Promote to ${unit}`}>
            <Select value={targetId} onChange={(e) => setTargetId(e.target.value)}>
              <option value="">Select…</option>
              {options
                .filter((o) => o.id !== sourceId)
                .map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))}
            </Select>
          </Field>
        )}

        <ErrorNote message={error} />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" onClick={submit} disabled={submitting}>
            {submitting ? "Promoting…" : graduate ? "Graduate" : "Promote"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
