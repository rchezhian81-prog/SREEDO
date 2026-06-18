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
import type {
  CollegeProgram,
  CollegeProgramSubject,
  CollegeSemester,
  Subject,
} from "@/types";

const mappingSchema = z.object({
  subjectId: z.string().min(1, "Required"),
  semesterId: z.string().optional(),
  credits: z.string().optional(),
});

type MappingForm = z.infer<typeof mappingSchema>;

export default function CollegeSubjectsPage() {
  const role = useAuthStore((state) => state.user?.role);
  const isAdmin = role === "admin";

  const [programs, setPrograms] = useState<CollegeProgram[]>([]);
  const [semesters, setSemesters] = useState<CollegeSemester[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [mappings, setMappings] = useState<CollegeProgramSubject[]>([]);

  const [programFilter, setProgramFilter] = useState("");
  const [semesterFilter, setSemesterFilter] = useState("");

  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<CollegeProgram[]>("/college/programs")
      .then(setPrograms)
      .catch(() => undefined);
    api
      .get<Subject[]>("/subjects")
      .then(setSubjects)
      .catch(() => undefined);
  }, []);

  // Load semesters when the program filter changes (dependent dropdown).
  useEffect(() => {
    setSemesterFilter("");
    if (!programFilter) {
      setSemesters([]);
      return;
    }
    api
      .get<CollegeSemester[]>(
        `/college/semesters?programId=${encodeURIComponent(programFilter)}`
      )
      .then(setSemesters)
      .catch(() => setSemesters([]));
  }, [programFilter]);

  const load = useCallback(async () => {
    if (!programFilter) {
      setMappings([]);
      return;
    }
    setLoading(true);
    setLoadError(null);
    try {
      const params = new URLSearchParams({ programId: programFilter });
      if (semesterFilter) params.set("semesterId", semesterFilter);
      setMappings(
        await api.get<CollegeProgramSubject[]>(
          `/college/program-subjects?${params.toString()}`
        )
      );
    } catch (err) {
      setLoadError(
        err instanceof ApiError ? err.message : "Failed to load subjects"
      );
    } finally {
      setLoading(false);
    }
  }, [programFilter, semesterFilter]);

  useEffect(() => {
    load();
  }, [load]);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<MappingForm>({ resolver: zodResolver(mappingSchema) });

  const openCreate = () => {
    setServerError(null);
    reset({
      subjectId: "",
      semesterId: semesterFilter || "",
      credits: "",
    });
    setModalOpen(true);
  };

  const onSubmit = async (values: MappingForm) => {
    setServerError(null);
    try {
      await api.post("/college/program-subjects", {
        programId: programFilter,
        subjectId: values.subjectId,
        semesterId: values.semesterId || undefined,
        credits: values.credits ? Number(values.credits) : undefined,
      });
      setModalOpen(false);
      reset();
      await load();
    } catch (err) {
      setServerError(
        err instanceof ApiError ? err.message : "Failed to add subject"
      );
    }
  };

  const removeMapping = async (mapping: CollegeProgramSubject) => {
    if (!confirm(`Remove "${mapping.subjectName ?? "subject"}" from program?`))
      return;
    try {
      await api.delete(`/college/program-subjects/${mapping.id}`);
      await load();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : "Failed to remove subject");
    }
  };

  return (
    <>
      <PageHeader
        title="Semester Subjects"
        subtitle="Subjects mapped to programs & semesters"
        action={
          isAdmin ? (
            <Button onClick={openCreate} disabled={!programFilter}>
              + Add subject
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
            {semesters.map((semester) => (
              <option key={semester.id} value={semester.id}>
                {semester.name}
              </option>
            ))}
          </Select>
        </div>
      </div>

      {!programFilter ? (
        <EmptyState message="Select a program to view its subjects" />
      ) : loading ? (
        <Spinner />
      ) : loadError ? (
        <ErrorNote message={loadError} />
      ) : mappings.length === 0 ? (
        <EmptyState message="No subjects mapped for this selection" />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3">Subject</th>
                <th className="px-4 py-3">Semester</th>
                <th className="px-4 py-3">Credits</th>
                {isAdmin && <th className="px-4 py-3" />}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {mappings.map((mapping) => (
                <tr key={mapping.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium text-slate-900">
                    {mapping.subjectName ?? "—"}
                  </td>
                  <td className="px-4 py-3">{mapping.semesterName ?? "—"}</td>
                  <td className="px-4 py-3">{mapping.credits ?? "—"}</td>
                  {isAdmin && (
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => removeMapping(mapping)}
                        className="text-xs font-medium text-red-600 hover:text-red-700"
                      >
                        Remove
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal
        title="Add subject to program"
        open={modalOpen}
        onClose={() => setModalOpen(false)}
      >
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <Field label="Subject" error={errors.subjectId?.message}>
            <Select {...register("subjectId")}>
              <option value="">Select a subject…</option>
              {subjects.map((subject) => (
                <option key={subject.id} value={subject.id}>
                  {subject.name}
                  {subject.code ? ` (${subject.code})` : ""}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Semester" error={errors.semesterId?.message}>
            <Select {...register("semesterId")}>
              <option value="">— Unassigned —</option>
              {semesters.map((semester) => (
                <option key={semester.id} value={semester.id}>
                  {semester.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Credits" error={errors.credits?.message}>
            <Input type="number" placeholder="4" {...register("credits")} />
          </Field>
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
              {isSubmitting ? "Saving…" : "Add subject"}
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
