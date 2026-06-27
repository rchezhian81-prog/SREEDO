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
  Card,
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
  CollegeBatch,
  CollegeDepartment,
  CollegeProgram,
} from "@/types";

const programSchema = z.object({
  departmentId: z.string().min(1, "Required"),
  name: z.string().min(1, "Required"),
  code: z.string().min(1, "Required"),
  durationSemesters: z.string().optional(),
});

type ProgramForm = z.infer<typeof programSchema>;

const batchSchema = z.object({
  name: z.string().min(1, "Required"),
  startYear: z.string().optional(),
});

type BatchForm = z.infer<typeof batchSchema>;

export default function CollegeProgramsPage() {
  const role = useAuthStore((state) => state.user?.role);
  const isAdmin = role === "admin";

  const [departments, setDepartments] = useState<CollegeDepartment[]>([]);
  const [programs, setPrograms] = useState<CollegeProgram[]>([]);
  const [departmentFilter, setDepartmentFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<CollegeProgram | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);

  // Batches manager
  const [batchProgramId, setBatchProgramId] = useState("");
  const [batches, setBatches] = useState<CollegeBatch[]>([]);
  const [batchesLoading, setBatchesLoading] = useState(false);
  const [batchError, setBatchError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<CollegeDepartment[]>("/college/departments")
      .then(setDepartments)
      .catch(() => undefined);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const qs = departmentFilter
        ? `?departmentId=${encodeURIComponent(departmentFilter)}`
        : "";
      setPrograms(await api.get<CollegeProgram[]>(`/college/programs${qs}`));
    } catch (err) {
      setLoadError(
        err instanceof ApiError ? err.message : "Failed to load programs"
      );
    } finally {
      setLoading(false);
    }
  }, [departmentFilter]);

  useEffect(() => {
    load();
  }, [load]);

  const loadBatches = useCallback(async (programId: string) => {
    if (!programId) {
      setBatches([]);
      return;
    }
    setBatchesLoading(true);
    setBatchError(null);
    try {
      setBatches(
        await api.get<CollegeBatch[]>(
          `/college/batches?programId=${encodeURIComponent(programId)}`
        )
      );
    } catch (err) {
      setBatchError(
        err instanceof ApiError ? err.message : "Failed to load batches"
      );
    } finally {
      setBatchesLoading(false);
    }
  }, []);

  useEffect(() => {
    loadBatches(batchProgramId);
  }, [batchProgramId, loadBatches]);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<ProgramForm>({ resolver: zodResolver(programSchema) });

  const openCreate = () => {
    setEditing(null);
    setServerError(null);
    reset({
      departmentId: departmentFilter || "",
      name: "",
      code: "",
      durationSemesters: "",
    });
    setModalOpen(true);
  };

  const openEdit = (program: CollegeProgram) => {
    setEditing(program);
    setServerError(null);
    reset({
      departmentId: program.departmentId,
      name: program.name,
      code: program.code,
      durationSemesters:
        program.durationSemesters != null
          ? String(program.durationSemesters)
          : "",
    });
    setModalOpen(true);
  };

  const onSubmit = async (values: ProgramForm) => {
    setServerError(null);
    const duration = values.durationSemesters
      ? Number(values.durationSemesters)
      : undefined;
    try {
      if (editing) {
        await api.patch(`/college/programs/${editing.id}`, {
          name: values.name,
          code: values.code,
          durationSemesters: duration,
        });
      } else {
        await api.post("/college/programs", {
          departmentId: values.departmentId,
          name: values.name,
          code: values.code,
          durationSemesters: duration,
        });
      }
      setModalOpen(false);
      reset();
      await load();
    } catch (err) {
      setServerError(
        err instanceof ApiError ? err.message : "Failed to save program"
      );
    }
  };

  const removeProgram = async (program: CollegeProgram) => {
    if (!confirm(`Delete program "${program.name}"?`)) return;
    try {
      await api.delete(`/college/programs/${program.id}`);
      if (batchProgramId === program.id) setBatchProgramId("");
      await load();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : "Failed to delete program");
    }
  };

  // Batch form
  const {
    register: registerBatch,
    handleSubmit: handleBatchSubmit,
    reset: resetBatch,
    formState: { errors: batchErrors, isSubmitting: batchSubmitting },
  } = useForm<BatchForm>({ resolver: zodResolver(batchSchema) });

  const onBatchSubmit = async (values: BatchForm) => {
    setBatchError(null);
    try {
      await api.post("/college/batches", {
        programId: batchProgramId,
        name: values.name,
        startYear: values.startYear ? Number(values.startYear) : undefined,
      });
      resetBatch({ name: "", startYear: "" });
      await loadBatches(batchProgramId);
    } catch (err) {
      setBatchError(
        err instanceof ApiError ? err.message : "Failed to create batch"
      );
    }
  };

  const removeBatch = async (batch: CollegeBatch) => {
    if (!confirm(`Delete batch "${batch.name}"?`)) return;
    try {
      await api.delete(`/college/batches/${batch.id}`);
      await loadBatches(batchProgramId);
    } catch (err) {
      setBatchError(
        err instanceof ApiError ? err.message : "Failed to delete batch"
      );
    }
  };

  return (
    <>
      <PageHeader
        title="Programs"
        subtitle="Degree programs & admission batches"
        action={
          isAdmin ? (
            <Button onClick={openCreate} disabled={departments.length === 0}>
              + Add program
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
          Department
        </span>
        <Select
          value={departmentFilter}
          onChange={(event) => setDepartmentFilter(event.target.value)}
        >
          <option value="">All departments</option>
          {departments.map((department) => (
            <option key={department.id} value={department.id}>
              {department.name}
            </option>
          ))}
        </Select>
      </div>

      {loading ? (
        <Spinner />
      ) : loadError ? (
        <ErrorNote message={loadError} />
      ) : programs.length === 0 ? (
        <EmptyState message="No programs found" />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3">Code</th>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Department</th>
                <th className="px-4 py-3">Semesters</th>
                {isAdmin && <th className="px-4 py-3" />}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {programs.map((program) => (
                <tr key={program.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-mono text-xs">{program.code}</td>
                  <td className="px-4 py-3 font-medium text-slate-900">
                    {program.name}
                  </td>
                  <td className="px-4 py-3">{program.departmentName ?? "—"}</td>
                  <td className="px-4 py-3">
                    {program.durationSemesters ?? "—"}
                  </td>
                  {isAdmin && (
                    <td className="px-4 py-3 text-right">
                      <div className="flex justify-end gap-3">
                        <button
                          onClick={() => openEdit(program)}
                          className="text-xs font-medium text-brand-600 hover:text-brand-700"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => removeProgram(program)}
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

      {/* Batches manager */}
      <Card className="mt-8">
        <h2 className="text-lg font-semibold text-slate-900">Batches</h2>
        <p className="mt-1 text-sm text-slate-500">
          Admission batches belong to a program. Pick a program to manage its
          batches.
        </p>

        <div className="mt-4 w-64">
          <span className="mb-1 block text-sm font-medium text-slate-700">
            Program
          </span>
          <Select
            value={batchProgramId}
            onChange={(event) => setBatchProgramId(event.target.value)}
          >
            <option value="">Select a program…</option>
            {programs.map((program) => (
              <option key={program.id} value={program.id}>
                {program.name}
              </option>
            ))}
          </Select>
        </div>

        {isAdmin && batchProgramId && (
          <form
            onSubmit={handleBatchSubmit(onBatchSubmit)}
            className="mt-4 flex flex-wrap items-end gap-3"
          >
            <div className="w-56">
              <Field label="Batch name" error={batchErrors.name?.message}>
                <Input placeholder="2024–2028" {...registerBatch("name")} />
              </Field>
            </div>
            <div className="w-40">
              <Field label="Start year" error={batchErrors.startYear?.message}>
                <Input
                  type="number"
                  placeholder="2024"
                  {...registerBatch("startYear")}
                />
              </Field>
            </div>
            <Button type="submit" disabled={batchSubmitting}>
              {batchSubmitting ? "Adding…" : "+ Add batch"}
            </Button>
          </form>
        )}

        <div className="mt-3">
          <ErrorNote message={batchError} />
        </div>

        {batchProgramId ? (
          batchesLoading ? (
            <Spinner />
          ) : batches.length === 0 ? (
            <div className="mt-4">
              <EmptyState message="No batches for this program" />
            </div>
          ) : (
            <div className="mt-4 overflow-x-auto rounded-xl border border-slate-200">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-4 py-3">Name</th>
                    <th className="px-4 py-3">Start year</th>
                    {isAdmin && <th className="px-4 py-3" />}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {batches.map((batch) => (
                    <tr key={batch.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3 font-medium text-slate-900">
                        {batch.name}
                      </td>
                      <td className="px-4 py-3">{batch.startYear ?? "—"}</td>
                      {isAdmin && (
                        <td className="px-4 py-3 text-right">
                          <button
                            onClick={() => removeBatch(batch)}
                            className="text-xs font-medium text-red-600 hover:text-red-700"
                          >
                            Delete
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        ) : (
          <p className="mt-4 text-sm text-slate-400">
            Select a program above to view its batches.
          </p>
        )}
      </Card>

      <Modal
        title={editing ? "Edit program" : "Add program"}
        open={modalOpen}
        onClose={() => setModalOpen(false)}
      >
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <Field label="Department" error={errors.departmentId?.message}>
            <Select {...register("departmentId")} disabled={!!editing}>
              <option value="">Select a department…</option>
              {departments.map((department) => (
                <option key={department.id} value={department.id}>
                  {department.name}
                </option>
              ))}
            </Select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Name" error={errors.name?.message}>
              <Input placeholder="B.Tech CSE" {...register("name")} />
            </Field>
            <Field label="Code" error={errors.code?.message}>
              <Input placeholder="BTECH-CSE" {...register("code")} />
            </Field>
          </div>
          <Field
            label="Duration (semesters)"
            error={errors.durationSemesters?.message}
          >
            <Input
              type="number"
              placeholder="8"
              {...register("durationSemesters")}
            />
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
              {isSubmitting ? "Saving…" : "Save program"}
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
