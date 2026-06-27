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
import { ImportCsvModal, type ImportColumn } from "@/components/ImportCsvModal";
import { useTerms } from "@/lib/terms";

const teacherSchema = z.object({
  firstName: z.string().min(1, "Required"),
  lastName: z.string().min(1, "Required"),
  email: z.string().email("Enter a valid email").optional().or(z.literal("")),
  phone: z.string().optional(),
  qualification: z.string().optional(),
  specialization: z.string().optional(),
});

type TeacherForm = z.infer<typeof teacherSchema>;

const IMPORT_COLUMNS: ImportColumn[] = [
  { key: "firstName", label: "First name", required: true },
  { key: "lastName", label: "Last name", required: true },
  { key: "email", label: "Email" },
  { key: "phone", label: "Phone" },
  { key: "qualification", label: "Qualification" },
  { key: "specialization", label: "Specialization" },
  { key: "joiningDate", label: "Joining date (YYYY-MM-DD)" },
  { key: "employeeNo", label: "Employee no (auto if blank)" },
];

const IMPORT_SAMPLE: Record<string, string> = {
  firstName: "Meena",
  lastName: "Iyer",
  email: "meena@example.com",
  phone: "9000000001",
  qualification: "M.Sc, B.Ed",
  specialization: "Mathematics",
  joiningDate: "2024-06-01",
  employeeNo: "",
};

export default function TeachersPage() {
  const term = useTerms();
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
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
        err instanceof ApiError
          ? err.message
          : `Failed to save ${term.teacher.toLowerCase()}`
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
        title={term.teachers}
        subtitle={`${total} ${term.teachers.toLowerCase()}`}
        action={
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setImportOpen(true)}>
              Import CSV
            </Button>
            <Button onClick={() => setModalOpen(true)}>
              + Add {term.teacher.toLowerCase()}
            </Button>
          </div>
        }
      />

      {loading ? (
        <Spinner />
      ) : teachers.length === 0 ? (
        <EmptyState message={`No ${term.teachers.toLowerCase()} yet`} />
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
        title={`Add ${term.teacher.toLowerCase()}`}
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
              {isSubmitting ? "Saving…" : `Save ${term.teacher.toLowerCase()}`}
            </Button>
          </div>
        </form>
      </Modal>

      <ImportCsvModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        title={`Import ${term.teachers.toLowerCase()} from CSV`}
        endpoint="/teachers/import"
        columns={IMPORT_COLUMNS}
        sample={IMPORT_SAMPLE}
        templateName="teachers-template.csv"
        onImported={load}
      />
    </>
  );
}
