"use client";

import { useCallback, useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import Link from "next/link";
import { api, ApiError } from "@/lib/api";
import { useAuthStore } from "@/stores/auth-store";
import {
  Badge,
  Button,
  EmptyState,
  ErrorNote,
  Field,
  Modal,
  PageHeader,
  Select,
  Spinner,
} from "@/components/ui";
import type {
  CollegeBatch,
  CollegeEnrollment,
  CollegeProgram,
  CollegeSemester,
  Paginated,
  Student,
} from "@/types";

const STATUS_OPTIONS = ["active", "completed", "dropped", "suspended"];

function statusTone(
  status: string
): "green" | "slate" | "red" | "amber" | "blue" {
  if (status === "active") return "green";
  if (status === "completed") return "blue";
  if (status === "dropped") return "red";
  if (status === "suspended") return "amber";
  return "slate";
}

const enrollSchema = z.object({
  studentId: z.string().min(1, "Required"),
  programId: z.string().min(1, "Required"),
  semesterId: z.string().optional(),
  batchId: z.string().optional(),
  status: z.string().optional(),
});

type EnrollForm = z.infer<typeof enrollSchema>;

const editSchema = z.object({
  semesterId: z.string().optional(),
  batchId: z.string().optional(),
  status: z.string().optional(),
});

type EditForm = z.infer<typeof editSchema>;

export default function CollegeEnrollmentsPage() {
  const role = useAuthStore((state) => state.user?.role);
  const isAdmin = role === "admin";

  const [programs, setPrograms] = useState<CollegeProgram[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [enrollments, setEnrollments] = useState<CollegeEnrollment[]>([]);

  const [programFilter, setProgramFilter] = useState("");
  const [semesterFilter, setSemesterFilter] = useState("");
  const [filterSemesters, setFilterSemesters] = useState<CollegeSemester[]>([]);

  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Create modal: semesters & batches depend on chosen program.
  const [createOpen, setCreateOpen] = useState(false);
  const [createSemesters, setCreateSemesters] = useState<CollegeSemester[]>([]);
  const [createBatches, setCreateBatches] = useState<CollegeBatch[]>([]);
  const [createError, setCreateError] = useState<string | null>(null);

  // Edit modal.
  const [editing, setEditing] = useState<CollegeEnrollment | null>(null);
  const [editSemesters, setEditSemesters] = useState<CollegeSemester[]>([]);
  const [editBatches, setEditBatches] = useState<CollegeBatch[]>([]);
  const [editError, setEditError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<CollegeProgram[]>("/college/programs")
      .then(setPrograms)
      .catch(() => undefined);
    api
      .get<Paginated<Student>>("/students?limit=500")
      .then((result) => setStudents(result.data))
      .catch(() => undefined);
  }, []);

  // Filter semesters depend on filter program.
  useEffect(() => {
    setSemesterFilter("");
    if (!programFilter) {
      setFilterSemesters([]);
      return;
    }
    api
      .get<CollegeSemester[]>(
        `/college/semesters?programId=${encodeURIComponent(programFilter)}`
      )
      .then(setFilterSemesters)
      .catch(() => setFilterSemesters([]));
  }, [programFilter]);

  const load = useCallback(async () => {
    if (!programFilter) {
      setEnrollments([]);
      return;
    }
    setLoading(true);
    setLoadError(null);
    try {
      const params = new URLSearchParams({ programId: programFilter });
      if (semesterFilter) params.set("semesterId", semesterFilter);
      setEnrollments(
        await api.get<CollegeEnrollment[]>(
          `/college/enrollments?${params.toString()}`
        )
      );
    } catch (err) {
      setLoadError(
        err instanceof ApiError ? err.message : "Failed to load enrollments"
      );
    } finally {
      setLoading(false);
    }
  }, [programFilter, semesterFilter]);

  useEffect(() => {
    load();
  }, [load]);

  // --- Create ---
  const {
    register: registerCreate,
    handleSubmit: handleCreateSubmit,
    reset: resetCreate,
    watch: watchCreate,
    formState: { errors: createErrors, isSubmitting: createSubmitting },
  } = useForm<EnrollForm>({ resolver: zodResolver(enrollSchema) });

  const createProgramId = watchCreate("programId");

  // Load dependent semesters/batches for the create modal's chosen program.
  useEffect(() => {
    if (!createOpen || !createProgramId) {
      setCreateSemesters([]);
      setCreateBatches([]);
      return;
    }
    api
      .get<CollegeSemester[]>(
        `/college/semesters?programId=${encodeURIComponent(createProgramId)}`
      )
      .then(setCreateSemesters)
      .catch(() => setCreateSemesters([]));
    api
      .get<CollegeBatch[]>(
        `/college/batches?programId=${encodeURIComponent(createProgramId)}`
      )
      .then(setCreateBatches)
      .catch(() => setCreateBatches([]));
  }, [createOpen, createProgramId]);

  const openCreate = () => {
    setCreateError(null);
    resetCreate({
      studentId: "",
      programId: programFilter || "",
      semesterId: "",
      batchId: "",
      status: "active",
    });
    setCreateOpen(true);
  };

  const onCreate = async (values: EnrollForm) => {
    setCreateError(null);
    try {
      await api.post("/college/enrollments", {
        studentId: values.studentId,
        programId: values.programId,
        semesterId: values.semesterId || undefined,
        batchId: values.batchId || undefined,
        status: values.status || undefined,
      });
      setCreateOpen(false);
      resetCreate();
      await load();
    } catch (err) {
      setCreateError(
        err instanceof ApiError ? err.message : "Failed to enroll student"
      );
    }
  };

  // --- Edit ---
  const {
    register: registerEdit,
    handleSubmit: handleEditSubmit,
    reset: resetEdit,
    formState: { errors: editErrors, isSubmitting: editSubmitting },
  } = useForm<EditForm>({ resolver: zodResolver(editSchema) });

  const openEdit = (enrollment: CollegeEnrollment) => {
    setEditing(enrollment);
    setEditError(null);
    resetEdit({
      semesterId: enrollment.semesterId ?? "",
      batchId: enrollment.batchId ?? "",
      status: enrollment.status,
    });
    api
      .get<CollegeSemester[]>(
        `/college/semesters?programId=${encodeURIComponent(enrollment.programId)}`
      )
      .then(setEditSemesters)
      .catch(() => setEditSemesters([]));
    api
      .get<CollegeBatch[]>(
        `/college/batches?programId=${encodeURIComponent(enrollment.programId)}`
      )
      .then(setEditBatches)
      .catch(() => setEditBatches([]));
  };

  const onEdit = async (values: EditForm) => {
    if (!editing) return;
    setEditError(null);
    try {
      await api.patch(`/college/enrollments/${editing.id}`, {
        semesterId: values.semesterId || undefined,
        batchId: values.batchId || undefined,
        status: values.status || undefined,
      });
      setEditing(null);
      await load();
    } catch (err) {
      setEditError(
        err instanceof ApiError ? err.message : "Failed to update enrollment"
      );
    }
  };

  const removeEnrollment = async (enrollment: CollegeEnrollment) => {
    if (!confirm(`Remove enrollment for ${enrollment.studentName}?`)) return;
    try {
      await api.delete(`/college/enrollments/${enrollment.id}`);
      await load();
    } catch (err) {
      alert(
        err instanceof ApiError ? err.message : "Failed to remove enrollment"
      );
    }
  };

  return (
    <>
      <PageHeader
        title="Enrollments"
        subtitle="Enroll students into programs & semesters"
        action={
          isAdmin ? (
            <Button onClick={openCreate} disabled={programs.length === 0}>
              + Enroll student
            </Button>
          ) : undefined
        }
      />

      <div className="mb-4">
        <Link
          href="/college"
          className="text-sm font-medium text-brand-600 hover:text-brand-700"
        >
          ← Back to College
        </Link>
      </div>

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="w-64">
          <span className="mb-1 block text-sm font-medium text-slate-700">
            Program
          </span>
          <Select
            value={programFilter}
            onChange={(event) => setProgramFilter(event.target.value)}
          >
            <option value="">Select a program…</option>
            {programs.map((program) => (
              <option key={program.id} value={program.id}>
                {program.name}
              </option>
            ))}
          </Select>
        </div>
        <div className="w-64">
          <span className="mb-1 block text-sm font-medium text-slate-700">
            Semester
          </span>
          <Select
            value={semesterFilter}
            onChange={(event) => setSemesterFilter(event.target.value)}
            disabled={!programFilter}
          >
            <option value="">All semesters</option>
            {filterSemesters.map((semester) => (
              <option key={semester.id} value={semester.id}>
                {semester.name}
              </option>
            ))}
          </Select>
        </div>
      </div>

      {!programFilter ? (
        <EmptyState message="Select a program to view enrollments" />
      ) : loading ? (
        <Spinner />
      ) : loadError ? (
        <ErrorNote message={loadError} />
      ) : enrollments.length === 0 ? (
        <EmptyState message="No enrollments for this selection" />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3">Admission No</th>
                <th className="px-4 py-3">Student</th>
                <th className="px-4 py-3">Semester</th>
                <th className="px-4 py-3">Status</th>
                {isAdmin && <th className="px-4 py-3" />}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {enrollments.map((enrollment) => (
                <tr key={enrollment.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-mono text-xs">
                    {enrollment.admissionNo}
                  </td>
                  <td className="px-4 py-3 font-medium text-slate-900">
                    {enrollment.studentName}
                  </td>
                  <td className="px-4 py-3">
                    {enrollment.semesterName ?? "—"}
                  </td>
                  <td className="px-4 py-3">
                    <Badge tone={statusTone(enrollment.status)}>
                      {enrollment.status}
                    </Badge>
                  </td>
                  {isAdmin && (
                    <td className="px-4 py-3 text-right">
                      <div className="flex justify-end gap-3">
                        <button
                          onClick={() => openEdit(enrollment)}
                          className="text-xs font-medium text-brand-600 hover:text-brand-700"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => removeEnrollment(enrollment)}
                          className="text-xs font-medium text-red-600 hover:text-red-700"
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Enroll modal */}
      <Modal
        title="Enroll student"
        open={createOpen}
        onClose={() => setCreateOpen(false)}
      >
        <form onSubmit={handleCreateSubmit(onCreate)} className="space-y-4">
          <Field label="Student" error={createErrors.studentId?.message}>
            <Select {...registerCreate("studentId")}>
              <option value="">Select a student…</option>
              {students.map((student) => (
                <option key={student.id} value={student.id}>
                  {student.firstName} {student.lastName} ({student.admissionNo})
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Program" error={createErrors.programId?.message}>
            <Select {...registerCreate("programId")}>
              <option value="">Select a program…</option>
              {programs.map((program) => (
                <option key={program.id} value={program.id}>
                  {program.name}
                </option>
              ))}
            </Select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Semester" error={createErrors.semesterId?.message}>
              <Select {...registerCreate("semesterId")} disabled={!createProgramId}>
                <option value="">— None —</option>
                {createSemesters.map((semester) => (
                  <option key={semester.id} value={semester.id}>
                    {semester.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Batch" error={createErrors.batchId?.message}>
              <Select {...registerCreate("batchId")} disabled={!createProgramId}>
                <option value="">— None —</option>
                {createBatches.map((batch) => (
                  <option key={batch.id} value={batch.id}>
                    {batch.name}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <Field label="Status" error={createErrors.status?.message}>
            <Select {...registerCreate("status")}>
              {STATUS_OPTIONS.map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </Select>
          </Field>
          <ErrorNote message={createError} />
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setCreateOpen(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={createSubmitting}>
              {createSubmitting ? "Enrolling…" : "Enroll student"}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Edit modal */}
      <Modal
        title={
          editing ? `Edit enrollment — ${editing.studentName}` : "Edit enrollment"
        }
        open={!!editing}
        onClose={() => setEditing(null)}
      >
        <form onSubmit={handleEditSubmit(onEdit)} className="space-y-4">
          <Field label="Semester" error={editErrors.semesterId?.message}>
            <Select {...registerEdit("semesterId")}>
              <option value="">— None —</option>
              {editSemesters.map((semester) => (
                <option key={semester.id} value={semester.id}>
                  {semester.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Batch" error={editErrors.batchId?.message}>
            <Select {...registerEdit("batchId")}>
              <option value="">— None —</option>
              {editBatches.map((batch) => (
                <option key={batch.id} value={batch.id}>
                  {batch.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Status" error={editErrors.status?.message}>
            <Select {...registerEdit("status")}>
              {STATUS_OPTIONS.map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </Select>
          </Field>
          <ErrorNote message={editError} />
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setEditing(null)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={editSubmitting}>
              {editSubmitting ? "Saving…" : "Save changes"}
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
