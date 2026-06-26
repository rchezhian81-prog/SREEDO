"use client";

import { useCallback, useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import Link from "next/link";
import { api, ApiError } from "@/lib/api";
import { usePermissions } from "@/lib/use-permissions";
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
import type {
  FeeCategory,
  FeeSchedule,
  FeeSchedulePreview,
  SchoolClass,
  Section,
} from "@/types";
import { useTerms } from "@/lib/terms";

const TERM_TYPES: { value: string; label: string }[] = [
  { value: "one_time", label: "One time" },
  { value: "monthly", label: "Monthly" },
  { value: "quarterly", label: "Quarterly" },
  { value: "term", label: "Term" },
  { value: "annual", label: "Annual" },
];

const scheduleSchema = z.object({
  name: z.string().min(1, "Required"),
  categoryId: z.string().optional(),
  amount: z.coerce.number().positive("Must be positive"),
  termType: z.enum(["one_time", "monthly", "quarterly", "term", "annual"]),
  termLabel: z.string().optional(),
  dueDate: z.string().min(1, "Required"),
  classId: z.string().optional(),
  sectionId: z.string().optional(),
  studentId: z.string().optional(),
});

type ScheduleForm = z.infer<typeof scheduleSchema>;

function termTypeLabel(value: string): string {
  return TERM_TYPES.find((t) => t.value === value)?.label ?? value;
}

export default function FeeSchedulesPage() {
  const term = useTerms();
  const { can, loading: permsLoading } = usePermissions();
  const canCreate = can("fee_schedules:create");
  const canGenerate = can("fee_schedules:generate");

  const [schedules, setSchedules] = useState<FeeSchedule[]>([]);
  const [categories, setCategories] = useState<FeeCategory[]>([]);
  const [classes, setClasses] = useState<SchoolClass[]>([]);
  const [sections, setSections] = useState<Section[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Preview modal state.
  const [previewOpen, setPreviewOpen] = useState(false);
  const [preview, setPreview] = useState<FeeSchedulePreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  // Generate result note.
  const [generatingId, setGeneratingId] = useState<string | null>(null);
  const [resultNote, setResultNote] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      setSchedules(await api.get<FeeSchedule[]>("/fees/schedules"));
    } catch (err) {
      setLoadError(
        err instanceof ApiError ? err.message : "Failed to load schedules"
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
      .get<FeeCategory[]>("/fees/categories")
      .then(setCategories)
      .catch(() => undefined);
    api
      .get<SchoolClass[]>("/classes")
      .then(setClasses)
      .catch(() => undefined);
  }, []);

  const {
    register,
    handleSubmit,
    reset,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<ScheduleForm>({
    resolver: zodResolver(scheduleSchema),
    defaultValues: { termType: "one_time" },
  });

  const selectedClassId = watch("classId");

  useEffect(() => {
    if (!selectedClassId) {
      setSections([]);
      return;
    }
    api
      .get<Section[]>(`/sections?classId=${selectedClassId}`)
      .then(setSections)
      .catch(() => setSections([]));
  }, [selectedClassId]);

  const openCreate = () => {
    setFormError(null);
    reset({
      name: "",
      categoryId: "",
      termType: "one_time",
      termLabel: "",
      dueDate: "",
      classId: "",
      sectionId: "",
      studentId: "",
    });
    setSections([]);
    setModalOpen(true);
  };

  const onSubmit = async (values: ScheduleForm) => {
    setFormError(null);
    const body = {
      name: values.name,
      categoryId: values.categoryId || undefined,
      amount: values.amount,
      termType: values.termType,
      termLabel: values.termLabel || undefined,
      dueDate: values.dueDate,
      classId: values.classId || undefined,
      sectionId: values.sectionId || undefined,
      studentId: values.studentId || undefined,
    };
    try {
      await api.post("/fees/schedules", body);
      setModalOpen(false);
      reset();
      await load();
    } catch (err) {
      setFormError(
        err instanceof ApiError ? err.message : "Failed to save schedule"
      );
    }
  };

  const openPreview = async (schedule: FeeSchedule) => {
    setPreviewOpen(true);
    setPreview(null);
    setPreviewError(null);
    setResultNote(null);
    setActionError(null);
    setPreviewLoading(true);
    try {
      setPreview(
        await api.get<FeeSchedulePreview>(
          `/fees/schedules/${schedule.id}/preview`
        )
      );
    } catch (err) {
      setPreviewError(
        err instanceof ApiError ? err.message : "Failed to load preview"
      );
    } finally {
      setPreviewLoading(false);
    }
  };

  const generate = async (schedule: FeeSchedule) => {
    setResultNote(null);
    setActionError(null);
    setGeneratingId(schedule.id);
    try {
      const res = await api.post<{ created: number }>(
        `/fees/schedules/${schedule.id}/generate`
      );
      setResultNote(
        `Generated ${res.created} invoice${res.created === 1 ? "" : "s"} for "${schedule.name}".`
      );
    } catch (err) {
      setActionError(
        err instanceof ApiError ? err.message : "Failed to generate invoices"
      );
    } finally {
      setGeneratingId(null);
    }
  };

  if (!loading && !can("fee_schedules:read")) {
    return (
      <>
        <PageHeader title="Fee schedules" subtitle="Recurring fee plans" />
        <EmptyState message="You don't have permission to view this page." />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Fee schedules"
        subtitle="Recurring fee plans & invoice generation"
        action={
          canCreate ? (
            <Button onClick={openCreate}>+ New schedule</Button>
          ) : undefined
        }
      />

      <div className="mb-4">
        <Link
          href="/fees/setup"
          className="text-sm font-medium text-brand-600 hover:text-brand-700"
        >
          ← Back to Fee Setup
        </Link>
      </div>

      {resultNote && (
        <p className="mb-4 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          {resultNote}
        </p>
      )}
      {actionError && (
        <div className="mb-4">
          <ErrorNote message={actionError} />
        </div>
      )}

      {loading || permsLoading ? (
        <Spinner />
      ) : loadError ? (
        <ErrorNote message={loadError} />
      ) : schedules.length === 0 ? (
        <EmptyState message="No schedules yet" />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Category</th>
                <th className="px-4 py-3 text-right">Amount</th>
                <th className="px-4 py-3">Term</th>
                <th className="px-4 py-3">Due date</th>
                {canGenerate && <th className="px-4 py-3" />}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {schedules.map((schedule) => (
                <tr key={schedule.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium text-slate-900">
                    {schedule.name}
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    {schedule.categoryName ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {Number(schedule.amount).toLocaleString()}
                  </td>
                  <td className="px-4 py-3">
                    {termTypeLabel(schedule.termType)}
                    {schedule.termLabel ? (
                      <span className="block text-xs text-slate-400">
                        {schedule.termLabel}
                      </span>
                    ) : null}
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    {schedule.dueDate?.slice(0, 10)}
                  </td>
                  {canGenerate && (
                    <td className="px-4 py-3 text-right">
                      <div className="flex justify-end gap-3">
                        <button
                          onClick={() => openPreview(schedule)}
                          className="text-xs font-medium text-brand-600 hover:text-brand-700"
                        >
                          Preview
                        </button>
                        <button
                          onClick={() => generate(schedule)}
                          disabled={generatingId === schedule.id}
                          className="text-xs font-medium text-brand-600 hover:text-brand-700 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {generatingId === schedule.id
                            ? "Generating…"
                            : "Generate"}
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
        title={`Preview — ${preview?.schedule.name ?? ""}`}
        open={previewOpen}
        onClose={() => setPreviewOpen(false)}
      >
        {previewLoading ? (
          <Spinner />
        ) : previewError ? (
          <ErrorNote message={previewError} />
        ) : preview ? (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-lg border border-slate-200 p-3">
                <p className="text-xs text-slate-500">Target students</p>
                <p className="mt-1 text-2xl font-semibold text-slate-900">
                  {preview.targetCount}
                </p>
              </div>
              <div className="rounded-lg border border-slate-200 p-3">
                <p className="text-xs text-slate-500">To generate</p>
                <p className="mt-1 text-2xl font-semibold text-emerald-600">
                  {preview.toGenerate}
                </p>
              </div>
            </div>
            {preview.students.length > 0 ? (
              <div className="max-h-72 overflow-y-auto rounded-xl border border-slate-200">
                <table className="w-full text-left text-sm">
                  <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
                    <tr>
                      <th className="px-4 py-2">Student</th>
                      <th className="px-4 py-2 text-right">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {preview.students.map((student) => (
                      <tr key={student.id}>
                        <td className="px-4 py-2 text-slate-900">
                          {student.name}
                        </td>
                        <td className="px-4 py-2 text-right">
                          {student.alreadyInvoiced ? (
                            <Badge tone="amber">already invoiced</Badge>
                          ) : (
                            <Badge tone="green">new</Badge>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyState message="No matching students" />
            )}
          </div>
        ) : (
          <EmptyState message="No preview available" />
        )}
      </Modal>

      <Modal
        title="New schedule"
        open={modalOpen}
        onClose={() => setModalOpen(false)}
      >
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <Field label="Name" error={errors.name?.message}>
            <Input placeholder="Term 1 Tuition" {...register("name")} />
          </Field>
          <Field label="Category (optional)" error={errors.categoryId?.message}>
            <Select {...register("categoryId")}>
              <option value="">No category</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </Select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Amount" error={errors.amount?.message}>
              <Input type="number" step="0.01" {...register("amount")} />
            </Field>
            <Field label="Due date" error={errors.dueDate?.message}>
              <Input type="date" {...register("dueDate")} />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Term type" error={errors.termType?.message}>
              <Select {...register("termType")}>
                {TERM_TYPES.map((term) => (
                  <option key={term.value} value={term.value}>
                    {term.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Term label (optional)" error={errors.termLabel?.message}>
              <Input placeholder="e.g. Term 1" {...register("termLabel")} />
            </Field>
          </div>
          <div className="rounded-lg border border-slate-200 p-3">
            <p className="mb-2 text-xs font-medium uppercase text-slate-500">
              Target (optional)
            </p>
            <div className="grid grid-cols-2 gap-3">
              <Field label={term.klass} error={errors.classId?.message}>
                <Select {...register("classId")}>
                  <option value="">All classes</option>
                  {classes.map((cls) => (
                    <option key={cls.id} value={cls.id}>
                      {cls.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={term.section} error={errors.sectionId?.message}>
                <Select {...register("sectionId")} disabled={!selectedClassId}>
                  <option value="">All sections</option>
                  {sections.map((section) => (
                    <option key={section.id} value={section.id}>
                      {section.name}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <div className="mt-3">
              <Field label="Student ID (optional)" error={errors.studentId?.message}>
                <Input
                  placeholder="Target a single student by ID"
                  {...register("studentId")}
                />
              </Field>
            </div>
          </div>
          <ErrorNote message={formError} />
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setModalOpen(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Saving…" : "Save schedule"}
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
