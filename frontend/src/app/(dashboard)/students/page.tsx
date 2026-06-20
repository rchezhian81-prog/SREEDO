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
  Select,
  Spinner,
} from "@/components/ui";
import type { Paginated, SchoolClass, Student } from "@/types";
import { useI18n } from "@/i18n/I18nProvider";

const studentSchema = z.object({
  firstName: z.string().min(1, "Required"),
  lastName: z.string().min(1, "Required"),
  gender: z.enum(["male", "female", "other"]).optional(),
  dateOfBirth: z.string().optional(),
  sectionId: z.string().optional(),
  guardianName: z.string().optional(),
  guardianPhone: z.string().optional(),
  guardianEmail: z
    .string()
    .email("Enter a valid email")
    .optional()
    .or(z.literal("")),
});

type StudentForm = z.infer<typeof studentSchema>;

interface SectionOption {
  id: string;
  label: string;
}

export default function StudentsPage() {
  const { t } = useI18n();
  const [students, setStudents] = useState<Student[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [sections, setSections] = useState<SectionOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const limit = 10;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page),
        limit: String(limit),
      });
      if (search) params.set("search", search);
      const result = await api.get<Paginated<Student>>(
        `/students?${params.toString()}`
      );
      setStudents(result.data);
      setTotal(result.meta.total);
    } finally {
      setLoading(false);
    }
  }, [page, search]);

  useEffect(() => {
    load().catch(() => setLoading(false));
  }, [load]);

  useEffect(() => {
    api
      .get<SchoolClass[]>("/classes")
      .then((classes) =>
        setSections(
          classes.flatMap((schoolClass) =>
            schoolClass.sections.map((section) => ({
              id: section.id,
              label: `${schoolClass.name} — ${section.name}`,
            }))
          )
        )
      )
      .catch(() => undefined);
  }, []);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<StudentForm>({ resolver: zodResolver(studentSchema) });

  const onSubmit = async (values: StudentForm) => {
    setServerError(null);
    try {
      await api.post("/students", {
        ...values,
        gender: values.gender || undefined,
        dateOfBirth: values.dateOfBirth || undefined,
        sectionId: values.sectionId || undefined,
        guardianEmail: values.guardianEmail || undefined,
      });
      setModalOpen(false);
      reset();
      await load();
    } catch (err) {
      setServerError(
        err instanceof ApiError ? err.message : "Failed to save student"
      );
    }
  };

  const removeStudent = async (student: Student) => {
    if (!confirm(`Delete ${student.firstName} ${student.lastName}?`)) return;
    await api.delete(`/students/${student.id}`);
    await load();
  };

  const totalPages = Math.max(1, Math.ceil(total / limit));

  return (
    <>
      <PageHeader
        title={t("pages.students.title")}
        subtitle={t("pages.students.subtitle")}
        action={
          <Button onClick={() => setModalOpen(true)}>+ Add student</Button>
        }
      />

      <div className="mb-4 max-w-xs">
        <Input
          placeholder="Search by name or admission no…"
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setPage(1);
          }}
        />
      </div>

      {loading ? (
        <Spinner />
      ) : students.length === 0 ? (
        <EmptyState message="No students found" />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3">Admission No</th>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Class</th>
                <th className="px-4 py-3">Guardian</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {students.map((student) => (
                <tr key={student.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-mono text-xs">
                    {student.admissionNo}
                  </td>
                  <td className="px-4 py-3 font-medium text-slate-900">
                    {student.firstName} {student.lastName}
                  </td>
                  <td className="px-4 py-3">
                    {student.className
                      ? `${student.className} — ${student.sectionName}`
                      : "Unassigned"}
                  </td>
                  <td className="px-4 py-3">
                    {student.guardianName ?? "—"}
                    {student.guardianPhone && (
                      <span className="block text-xs text-slate-400">
                        {student.guardianPhone}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <Badge tone={student.status === "active" ? "green" : "slate"}>
                      {student.status}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => removeStudent(student)}
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

      {totalPages > 1 && (
        <div className="mt-4 flex items-center justify-end gap-2 text-sm">
          <Button
            variant="secondary"
            disabled={page <= 1}
            onClick={() => setPage(page - 1)}
          >
            Previous
          </Button>
          <span className="text-slate-500">
            Page {page} of {totalPages}
          </span>
          <Button
            variant="secondary"
            disabled={page >= totalPages}
            onClick={() => setPage(page + 1)}
          >
            Next
          </Button>
        </div>
      )}

      <Modal
        title="Add student"
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
            <Field label="Gender">
              <Select {...register("gender")}>
                <option value="">—</option>
                <option value="male">Male</option>
                <option value="female">Female</option>
                <option value="other">Other</option>
              </Select>
            </Field>
            <Field label="Date of birth">
              <Input type="date" {...register("dateOfBirth")} />
            </Field>
          </div>
          <Field label="Section">
            <Select {...register("sectionId")}>
              <option value="">Unassigned</option>
              {sections.map((section) => (
                <option key={section.id} value={section.id}>
                  {section.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Guardian name">
            <Input {...register("guardianName")} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Guardian phone">
              <Input {...register("guardianPhone")} />
            </Field>
            <Field label="Guardian email" error={errors.guardianEmail?.message}>
              <Input type="email" {...register("guardianEmail")} />
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
              {isSubmitting ? "Saving…" : "Save student"}
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
