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
import type { CollegeDepartment, Paginated, Teacher } from "@/types";

const departmentSchema = z.object({
  name: z.string().min(1, "Required"),
  code: z.string().min(1, "Required"),
  headTeacherId: z.string().optional(),
});

type DepartmentForm = z.infer<typeof departmentSchema>;

export default function CollegeDepartmentsPage() {
  const role = useAuthStore((state) => state.user?.role);
  const isAdmin = role === "admin";

  const [departments, setDepartments] = useState<CollegeDepartment[]>([]);
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<CollegeDepartment | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      setDepartments(await api.get<CollegeDepartment[]>("/college/departments"));
    } catch (err) {
      setLoadError(
        err instanceof ApiError ? err.message : "Failed to load departments"
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    api
      .get<Paginated<Teacher>>("/teachers?limit=200")
      .then((result) => setTeachers(result.data))
      .catch(() => undefined);
  }, []);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<DepartmentForm>({ resolver: zodResolver(departmentSchema) });

  const openCreate = () => {
    setEditing(null);
    setServerError(null);
    reset({ name: "", code: "", headTeacherId: "" });
    setModalOpen(true);
  };

  const openEdit = (department: CollegeDepartment) => {
    setEditing(department);
    setServerError(null);
    reset({
      name: department.name,
      code: department.code,
      headTeacherId: department.headTeacherId ?? "",
    });
    setModalOpen(true);
  };

  const onSubmit = async (values: DepartmentForm) => {
    setServerError(null);
    const body = {
      name: values.name,
      code: values.code,
      headTeacherId: values.headTeacherId || undefined,
    };
    try {
      if (editing) {
        await api.patch(`/college/departments/${editing.id}`, body);
      } else {
        await api.post("/college/departments", body);
      }
      setModalOpen(false);
      reset();
      await load();
    } catch (err) {
      setServerError(
        err instanceof ApiError ? err.message : "Failed to save department"
      );
    }
  };

  const removeDepartment = async (department: CollegeDepartment) => {
    if (!confirm(`Delete department "${department.name}"?`)) return;
    try {
      await api.delete(`/college/departments/${department.id}`);
      await load();
    } catch (err) {
      alert(
        err instanceof ApiError ? err.message : "Failed to delete department"
      );
    }
  };

  return (
    <>
      <PageHeader
        title="Departments"
        subtitle="Academic departments"
        action={
          isAdmin ? (
            <Button onClick={openCreate}>+ Add department</Button>
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

      {loading ? (
        <Spinner />
      ) : loadError ? (
        <ErrorNote message={loadError} />
      ) : departments.length === 0 ? (
        <EmptyState message="No departments yet" />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3">Code</th>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Head</th>
                <th className="px-4 py-3">Programs</th>
                {isAdmin && <th className="px-4 py-3" />}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {departments.map((department) => (
                <tr key={department.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-mono text-xs">
                    {department.code}
                  </td>
                  <td className="px-4 py-3 font-medium text-slate-900">
                    {department.name}
                  </td>
                  <td className="px-4 py-3">
                    {department.headTeacherName ?? "—"}
                  </td>
                  <td className="px-4 py-3">{department.programCount}</td>
                  {isAdmin && (
                    <td className="px-4 py-3 text-right">
                      <div className="flex justify-end gap-3">
                        <button
                          onClick={() => openEdit(department)}
                          className="text-xs font-medium text-brand-600 hover:text-brand-700"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => removeDepartment(department)}
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
        title={editing ? "Edit department" : "Add department"}
        open={modalOpen}
        onClose={() => setModalOpen(false)}
      >
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <Field label="Name" error={errors.name?.message}>
            <Input placeholder="Computer Science" {...register("name")} />
          </Field>
          <Field label="Code" error={errors.code?.message}>
            <Input placeholder="CSE" {...register("code")} />
          </Field>
          <Field label="Head teacher" error={errors.headTeacherId?.message}>
            <Select {...register("headTeacherId")}>
              <option value="">— None —</option>
              {teachers.map((teacher) => (
                <option key={teacher.id} value={teacher.id}>
                  {teacher.firstName} {teacher.lastName}
                </option>
              ))}
            </Select>
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
              {isSubmitting ? "Saving…" : "Save department"}
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
