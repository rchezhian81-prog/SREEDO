"use client";

import { useCallback, useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { api, ApiError } from "@/lib/api";
import {
  Badge,
  Button,
  EmptyState,
  ErrorNote,
  Field,
  Input,
  Modal,
  PageHeader,
  Spinner,
} from "@/components/ui";
import type { Paginated, Teacher } from "@/types";

const teacherSchema = z.object({
  firstName: z.string().min(1, "Required"),
  lastName: z.string().min(1, "Required"),
  email: z.string().email("Enter a valid email").optional().or(z.literal("")),
  phone: z.string().optional(),
  qualification: z.string().optional(),
  specialization: z.string().optional(),
});

type TeacherForm = z.infer<typeof teacherSchema>;

export default function TeachersPage() {
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api.get<Paginated<Teacher>>("/teachers?limit=50");
      setTeachers(result.data);
      setTotal(result.meta.total);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load().catch(() => setLoading(false));
  }, [load]);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<TeacherForm>({ resolver: zodResolver(teacherSchema) });

  const onSubmit = async (values: TeacherForm) => {
    setServerError(null);
    try {
      await api.post("/teachers", {
        ...values,
        email: values.email || undefined,
      });
      setModalOpen(false);
      reset();
      await load();
    } catch (err) {
      setServerError(
        err instanceof ApiError ? err.message : "Failed to save teacher"
      );
    }
  };

  const removeTeacher = async (teacher: Teacher) => {
    if (!confirm(`Remove ${teacher.firstName} ${teacher.lastName}?`)) return;
    await api.delete(`/teachers/${teacher.id}`);
    await load();
  };

  return (
    <>
      <PageHeader
        title="Teachers"
        subtitle={`${total} on staff`}
        action={
          <Button onClick={() => setModalOpen(true)}>+ Add teacher</Button>
        }
      />

      {loading ? (
        <Spinner />
      ) : teachers.length === 0 ? (
        <EmptyState message="No teachers yet" />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-line bg-surface">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-line bg-surface-2 text-xs uppercase text-muted">
              <tr>
                <th className="px-4 py-3">Employee No</th>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Contact</th>
                <th className="px-4 py-3">Specialization</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {teachers.map((teacher) => (
                <tr key={teacher.id} className="hover:bg-surface-2">
                  <td className="px-4 py-3 font-mono text-xs">
                    {teacher.employeeNo}
                  </td>
                  <td className="px-4 py-3 font-medium text-ink">
                    {teacher.firstName} {teacher.lastName}
                  </td>
                  <td className="px-4 py-3">
                    {teacher.email ?? "—"}
                    {teacher.phone && (
                      <span className="block text-xs text-faint">
                        {teacher.phone}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">{teacher.specialization ?? "—"}</td>
                  <td className="px-4 py-3">
                    <Badge tone={teacher.isActive ? "green" : "slate"}>
                      {teacher.isActive ? "active" : "inactive"}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => removeTeacher(teacher)}
                      className="text-xs font-medium text-red-600 hover:text-red-700"
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal
        title="Add teacher"
        open={modalOpen}
        onClose={() => setModalOpen(false)}
      >
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label="First name" error={errors.firstName?.message}>
              <Input {...register("firstName")} />
            </Field>
            <Field label="Last name" error={errors.lastName?.message}>
              <Input {...register("lastName")} />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Email" error={errors.email?.message}>
              <Input type="email" {...register("email")} />
            </Field>
            <Field label="Phone">
              <Input {...register("phone")} />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Qualification">
              <Input placeholder="B.Ed, M.Sc…" {...register("qualification")} />
            </Field>
            <Field label="Specialization">
              <Input placeholder="Mathematics…" {...register("specialization")} />
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
              {isSubmitting ? "Saving…" : "Save teacher"}
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
