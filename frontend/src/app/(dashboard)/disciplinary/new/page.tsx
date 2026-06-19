"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { api, ApiError } from "@/lib/api";
import { usePermissions } from "@/lib/use-permissions";
import {
  Button,
  EmptyState,
  ErrorNote,
  Field,
  Input,
  PageHeader,
  Select,
  Spinner,
  Textarea,
} from "@/components/ui";
import type { DisciplinaryRecord, Paginated, Student } from "@/types";

const recordSchema = z.object({
  studentId: z.string().min(1, "Select a student"),
  incidentDate: z.string().min(1, "Required"),
  category: z.string().min(1, "Required"),
  severity: z.enum(["low", "medium", "high", "critical"]),
  description: z.string().optional(),
  reportedBy: z.string().optional(),
  involvedStaff: z.string().optional(),
  followUpDate: z.string().optional(),
  remarks: z.string().optional(),
});

type RecordForm = z.infer<typeof recordSchema>;

export default function NewDisciplinaryPage() {
  const router = useRouter();
  const { can, loading: permsLoading } = usePermissions();
  const canCreate = can("disciplinary:create");

  const [students, setStudents] = useState<Student[]>([]);
  const [serverError, setServerError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<RecordForm>({
    resolver: zodResolver(recordSchema),
    defaultValues: { severity: "low" },
  });

  useEffect(() => {
    if (permsLoading || !canCreate) return;
    api
      .get<Paginated<Student>>("/students?limit=500")
      .then((result) => setStudents(result.data))
      .catch(() => undefined);
  }, [permsLoading, canCreate]);

  const onSubmit = async (values: RecordForm) => {
    setServerError(null);
    try {
      const created = await api.post<DisciplinaryRecord>("/disciplinary", {
        studentId: values.studentId,
        incidentDate: values.incidentDate,
        category: values.category,
        severity: values.severity,
        description: values.description || undefined,
        reportedBy: values.reportedBy || undefined,
        involvedStaff: values.involvedStaff || undefined,
        followUpDate: values.followUpDate || undefined,
        remarks: values.remarks || undefined,
      });
      router.push(`/disciplinary/${created.id}`);
    } catch (err) {
      setServerError(
        err instanceof ApiError ? err.message : "Failed to log incident"
      );
    }
  };

  if (permsLoading) {
    return (
      <>
        <PageHeader title="Log incident" subtitle="Record a new incident" />
        <Spinner />
      </>
    );
  }

  if (!canCreate) {
    return (
      <>
        <PageHeader title="Log incident" subtitle="Record a new incident" />
        <EmptyState message="You don't have access to disciplinary records." />
      </>
    );
  }

  return (
    <>
      <PageHeader title="Log incident" subtitle="Record a new incident" />

      <div className="mb-4">
        <Link
          href="/disciplinary"
          className="text-sm font-medium text-brand-600 hover:text-brand-700"
        >
          ← Back to Disciplinary
        </Link>
      </div>

      <form
        onSubmit={handleSubmit(onSubmit)}
        className="max-w-2xl space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
      >
        <Field label="Student" error={errors.studentId?.message}>
          <Select {...register("studentId")}>
            <option value="">Select a student…</option>
            {students.map((student) => (
              <option key={student.id} value={student.id}>
                {student.firstName} {student.lastName} ({student.admissionNo})
              </option>
            ))}
          </Select>
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Incident date" error={errors.incidentDate?.message}>
            <Input type="date" {...register("incidentDate")} />
          </Field>
          <Field label="Severity" error={errors.severity?.message}>
            <Select {...register("severity")}>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="critical">Critical</option>
            </Select>
          </Field>
        </div>

        <Field label="Category" error={errors.category?.message}>
          <Input
            placeholder="e.g. Misconduct, Bullying, Attendance…"
            {...register("category")}
          />
        </Field>

        <Field label="Description" error={errors.description?.message}>
          <Textarea rows={3} {...register("description")} />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Reported by" error={errors.reportedBy?.message}>
            <Input {...register("reportedBy")} />
          </Field>
          <Field label="Involved staff" error={errors.involvedStaff?.message}>
            <Input {...register("involvedStaff")} />
          </Field>
        </div>

        <Field label="Follow-up date" error={errors.followUpDate?.message}>
          <Input type="date" {...register("followUpDate")} />
        </Field>

        <Field label="Remarks" error={errors.remarks?.message}>
          <Textarea rows={2} {...register("remarks")} />
        </Field>

        <ErrorNote message={serverError} />

        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="secondary"
            onClick={() => router.push("/disciplinary")}
          >
            Cancel
          </Button>
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? "Saving…" : "Log incident"}
          </Button>
        </div>
      </form>
    </>
  );
}
