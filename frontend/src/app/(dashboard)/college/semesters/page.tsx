"use client";

import { useCallback, useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import Link from "next/link";
import { api, ApiError } from "@/lib/api";
import { useAuthStore } from "@/stores/auth-store";
import {
  Button,
  EmptyState,
  ErrorNote,
  Field,
  Input,
  Modal,
  PageHeader,
  Select,
  Spinner,
} from "@/components/ui";
import type { AcademicYear, CollegeProgram, CollegeSemester } from "@/types";

const semesterSchema = z.object({
  programId: z.string().min(1, "Required"),
  name: z.string().min(1, "Required"),
  number: z.string().min(1, "Required"),
  academicYearId: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
});

type SemesterForm = z.infer<typeof semesterSchema>;

export default function CollegeSemestersPage() {
  const role = useAuthStore((state) => state.user?.role);
  const isAdmin = role === "admin";

  const [programs, setPrograms] = useState<CollegeProgram[]>([]);
  const [academicYears, setAcademicYears] = useState<AcademicYear[]>([]);
  const [semesters, setSemesters] = useState<CollegeSemester[]>([]);
  const [programFilter, setProgramFilter] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<CollegeSemester | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<CollegeProgram[]>("/college/programs")
      .then(setPrograms)
      .catch(() => undefined);
    api
      .get<AcademicYear[]>("/academic-years")
      .then(setAcademicYears)
      .catch(() => undefined);
  }, []);

  const load = useCallback(async () => {
    if (!programFilter) {
      setSemesters([]);
      return;
    }
    setLoading(true);
    setLoadError(null);
    try {
      setSemesters(
        await api.get<CollegeSemester[]>(
          `/college/semesters?programId=${encodeURIComponent(programFilter)}`
        )
      );
    } catch (err) {
      setLoadError(
        err instanceof ApiError ? err.message : "Failed to load semesters"
      );
    } finally {
      setLoading(false);
    }
  }, [programFilter]);

  useEffect(() => {
    load();
  }, [load]);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<SemesterForm>({ resolver: zodResolver(semesterSchema) });

  const openCreate = () => {
    setEditing(null);
    setServerError(null);
    reset({
      programId: programFilter || "",
      name: "",
      number: "",
      academicYearId: "",
      startDate: "",
      endDate: "",
    });
    setModalOpen(true);
  };

  const openEdit = (semester: CollegeSemester) => {
    setEditing(semester);
    setServerError(null);
    reset({
      programId: semester.programId,
      name: semester.name,
      number: String(semester.number),
      academicYearId: semester.academicYearId ?? "",
      startDate: semester.startDate ?? "",
      endDate: semester.endDate ?? "",
    });
    setModalOpen(true);
  };

  const onSubmit = async (values: SemesterForm) => {
    setServerError(null);
    try {
      if (editing) {
        await api.patch(`/college/semesters/${editing.id}`, {
          name: values.name,
          number: Number(values.number),
          startDate: values.startDate || undefined,
          endDate: values.endDate || undefined,
        });
      } else {
        await api.post("/college/semesters", {
          programId: values.programId,
          name: values.name,
          number: Number(values.number),
          academicYearId: values.academicYearId || undefined,
          startDate: values.startDate || undefined,
          endDate: values.endDate || undefined,
        });
      }
      setModalOpen(false);
      reset();
      await load();
    } catch (err) {
      setServerError(
        err instanceof ApiError ? err.message : "Failed to save semester"
      );
    }
  };

  const removeSemester = async (semester: CollegeSemester) => {
    if (!confirm(`Delete semester "${semester.name}"?`)) return;
    try {
      await api.delete(`/college/semesters/${semester.id}`);
      await load();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : "Failed to delete semester");
    }
  };

  return (
    <>
      <PageHeader
        title="Semesters"
        subtitle="Semesters within each program"
        action={
          isAdmin ? (
            <Button onClick={openCreate} disabled={!programFilter}>
              + Add semester
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

      <div className="mb-4 w-64">
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

      {!programFilter ? (
        <EmptyState message="Select a program to view its semesters" />
      ) : loading ? (
        <Spinner />
      ) : loadError ? (
        <ErrorNote message={loadError} />
      ) : semesters.length === 0 ? (
        <EmptyState message="No semesters for this program" />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3">#</th>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Start</th>
                <th className="px-4 py-3">End</th>
                {isAdmin && <th className="px-4 py-3" />}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {semesters.map((semester) => (
                <tr key={semester.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-mono text-xs">
                    {semester.number}
                  </td>
                  <td className="px-4 py-3 font-medium text-slate-900">
                    {semester.name}
                  </td>
                  <td className="px-4 py-3">{semester.startDate ?? "—"}</td>
                  <td className="px-4 py-3">{semester.endDate ?? "—"}</td>
                  {isAdmin && (
                    <td className="px-4 py-3 text-right">
                      <div className="flex justify-end gap-3">
                        <button
                          onClick={() => openEdit(semester)}
                          className="text-xs font-medium text-brand-600 hover:text-brand-700"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => removeSemester(semester)}
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

      <Modal
        title={editing ? "Edit semester" : "Add semester"}
        open={modalOpen}
        onClose={() => setModalOpen(false)}
      >
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <Field label="Program" error={errors.programId?.message}>
            <Select {...register("programId")} disabled={!!editing}>
              <option value="">Select a program…</option>
              {programs.map((program) => (
                <option key={program.id} value={program.id}>
                  {program.name}
                </option>
              ))}
            </Select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Name" error={errors.name?.message}>
              <Input placeholder="Semester 1" {...register("name")} />
            </Field>
            <Field label="Number" error={errors.number?.message}>
              <Input type="number" placeholder="1" {...register("number")} />
            </Field>
          </div>
          {!editing && (
            <Field label="Academic year" error={errors.academicYearId?.message}>
              <Select {...register("academicYearId")}>
                <option value="">— None —</option>
                {academicYears.map((year) => (
                  <option key={year.id} value={year.id}>
                    {year.name}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          <div className="grid grid-cols-2 gap-3">
            <Field label="Start date" error={errors.startDate?.message}>
              <Input type="date" {...register("startDate")} />
            </Field>
            <Field label="End date" error={errors.endDate?.message}>
              <Input type="date" {...register("endDate")} />
            </Field>
          </div>
          <ErrorNote message={serverError} />
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setModalOpen(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Saving…" : "Save semester"}
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
