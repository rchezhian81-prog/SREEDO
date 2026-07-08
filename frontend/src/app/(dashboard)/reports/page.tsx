"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { api, ApiError } from "@/lib/api";
import { useAuthStore } from "@/stores/auth-store";
import {
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  ErrorNote,
  Field,
  Input,
  Modal,
  PageHeader,
  Select,
  Spinner,
} from "@/components/ui";
import { toast } from "@/components/toast";
import type {
  Exam,
  GradeBand,
  Paginated,
  SchoolClass,
  Student,
} from "@/types";
import { useTerms } from "@/lib/terms";

const bandSchema = z.object({
  grade: z.string().min(1, "Required"),
  minPercent: z.coerce.number().min(0).max(100),
  maxPercent: z.coerce.number().min(0).max(100),
  remark: z.string().optional(),
  sortOrder: z.coerce.number().int().optional(),
});

type BandForm = z.infer<typeof bandSchema>;

interface SectionOption {
  id: string;
  label: string;
}

async function downloadPdf(path: string, filename: string) {
  const base =
    process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api/v1";
  const token = useAuthStore.getState().accessToken;
  const res = await fetch(`${base}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) {
    let msg = res.statusText;
    try {
      const d = await res.json();
      if (typeof d.error === "string") msg = d.error;
    } catch {
      // non-JSON error body — keep statusText
    }
    throw new ApiError(res.status, msg);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function ReportsPage() {
  const term = useTerms();
  const role = useAuthStore((state) => state.user?.role);
  const canManage = role === "admin" || role === "teacher";

  const [bands, setBands] = useState<GradeBand[]>([]);
  const [exams, setExams] = useState<Exam[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [sections, setSections] = useState<SectionOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<GradeBand | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [deletingBand, setDeletingBand] = useState<GradeBand | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  // Report card download state.
  const [rcExamId, setRcExamId] = useState("");
  const [rcStudentId, setRcStudentId] = useState("");
  const [rcLoading, setRcLoading] = useState(false);
  const [rcError, setRcError] = useState<string | null>(null);

  // Mark sheet download state.
  const [msExamId, setMsExamId] = useState("");
  const [msSectionId, setMsSectionId] = useState("");
  const [msLoading, setMsLoading] = useState(false);
  const [msError, setMsError] = useState<string | null>(null);

  const loadBands = useCallback(async () => {
    setBands(await api.get<GradeBand[]>("/reports/grade-bands"));
  }, []);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [bandList, examList, studentRes, classes] = await Promise.all([
        api.get<GradeBand[]>("/reports/grade-bands"),
        api.get<Exam[]>("/exams"),
        api.get<Paginated<Student>>("/students?limit=100"),
        api.get<SchoolClass[]>("/classes"),
      ]);
      setBands(bandList);
      setExams(examList);
      setStudents(studentRes.data);
      setSections(
        classes.flatMap((schoolClass) =>
          schoolClass.sections.map((section) => ({
            id: section.id,
            label: `${schoolClass.name} - ${section.name}`,
          }))
        )
      );
    } catch (err) {
      setLoadError(
        err instanceof ApiError ? err.message : "Failed to load reports"
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<BandForm>({ resolver: zodResolver(bandSchema) });

  const openCreate = () => {
    setEditing(null);
    setServerError(null);
    reset({
      grade: "",
      minPercent: 0,
      maxPercent: 100,
      remark: "",
      sortOrder: 0,
    });
    setModalOpen(true);
  };

  const openEdit = (band: GradeBand) => {
    setEditing(band);
    setServerError(null);
    reset({
      grade: band.grade,
      minPercent: Number(band.minPercent),
      maxPercent: Number(band.maxPercent),
      remark: band.remark ?? "",
      sortOrder: band.sortOrder,
    });
    setModalOpen(true);
  };

  const onSubmit = async (values: BandForm) => {
    setServerError(null);
    const payload = {
      grade: values.grade,
      minPercent: values.minPercent,
      maxPercent: values.maxPercent,
      remark: values.remark || undefined,
      sortOrder: values.sortOrder,
    };
    try {
      if (editing) {
        await api.patch(`/reports/grade-bands/${editing.id}`, payload);
      } else {
        await api.post("/reports/grade-bands", payload);
      }
      setModalOpen(false);
      reset();
      await loadBands();
    } catch (err) {
      setServerError(
        err instanceof ApiError ? err.message : "Failed to save grade band"
      );
    }
  };

  const removeBand = (band: GradeBand) => {
    setDeletingBand(band);
  };

  const confirmRemoveBand = async () => {
    if (!deletingBand) return;
    setDeleteBusy(true);
    try {
      await api.delete(`/reports/grade-bands/${deletingBand.id}`);
      setDeletingBand(null);
      await loadBands();
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : "Failed to delete band"
      );
    } finally {
      setDeleteBusy(false);
    }
  };

  const downloadReportCard = async () => {
    if (!rcExamId || !rcStudentId) {
      setRcError("Select an exam and a student first");
      return;
    }
    setRcLoading(true);
    setRcError(null);
    try {
      await downloadPdf(
        `/reports/report-card?examId=${rcExamId}&studentId=${rcStudentId}`,
        "report-card.pdf"
      );
    } catch (err) {
      setRcError(
        err instanceof ApiError ? err.message : "Failed to download report card"
      );
    } finally {
      setRcLoading(false);
    }
  };

  const exportMarkSheet = async () => {
    if (!msExamId || !msSectionId) {
      setMsError("Select an exam and a section first");
      return;
    }
    setMsLoading(true);
    setMsError(null);
    try {
      await downloadPdf(
        `/reports/mark-sheet?examId=${msExamId}&sectionId=${msSectionId}`,
        "mark-sheet.pdf"
      );
    } catch (err) {
      setMsError(
        err instanceof ApiError ? err.message : "Failed to export mark sheet"
      );
    } finally {
      setMsLoading(false);
    }
  };

  const sortedBands = useMemo(
    () => [...bands].sort((a, b) => a.sortOrder - b.sortOrder),
    [bands]
  );

  return (
    <>
      <PageHeader
        title={`${term.reportCard}s`}
        subtitle="Grade scale, report cards & mark sheets"
      />

      {loading ? (
        <Spinner />
      ) : loadError ? (
        <div className="space-y-4">
          <ErrorNote message={loadError} />
          <Button variant="secondary" onClick={loadAll}>
            Retry
          </Button>
        </div>
      ) : (
        <div className="space-y-6">
          <Card>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-lg font-semibold text-ink">
                Grade scale
              </h2>
              {canManage && (
                <Button onClick={openCreate}>+ Add grade</Button>
              )}
            </div>
            {sortedBands.length === 0 ? (
              <EmptyState message="No grade bands yet" />
            ) : (
              <div className="overflow-x-auto rounded-xl border border-line">
                <table className="w-full text-left text-sm">
                  <thead className="border-b border-line bg-surface-2 text-xs uppercase text-muted">
                    <tr>
                      <th className="px-4 py-3">Grade</th>
                      <th className="px-4 py-3">Range</th>
                      <th className="px-4 py-3">Remark</th>
                      {canManage && <th className="px-4 py-3" />}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {sortedBands.map((band) => (
                      <tr key={band.id}>
                        <td className="px-4 py-3 font-medium text-ink">
                          {band.grade}
                        </td>
                        <td className="px-4 py-3 text-muted">
                          {band.minPercent}–{band.maxPercent}%
                        </td>
                        <td className="px-4 py-3 text-muted">
                          {band.remark ?? "—"}
                        </td>
                        {canManage && (
                          <td className="px-4 py-3 text-right">
                            <div className="flex justify-end gap-3">
                              <button
                                onClick={() => openEdit(band)}
                                className="text-xs font-medium text-brand-600 hover:text-brand-700"
                              >
                                Edit
                              </button>
                              <button
                                onClick={() => removeBand(band)}
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
          </Card>

          <Card>
            <h2 className="mb-4 text-lg font-semibold text-ink">
              Report card
            </h2>
            <div className="flex flex-wrap items-end gap-3">
              <div className="w-56">
                <span className="mb-1 block text-sm font-medium text-muted">
                  Exam
                </span>
                <Select
                  value={rcExamId}
                  onChange={(event) => setRcExamId(event.target.value)}
                >
                  <option value="">Select exam…</option>
                  {exams.map((exam) => (
                    <option key={exam.id} value={exam.id}>
                      {exam.name}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="w-72">
                <span className="mb-1 block text-sm font-medium text-muted">
                  Student
                </span>
                <Select
                  value={rcStudentId}
                  onChange={(event) => setRcStudentId(event.target.value)}
                >
                  <option value="">Select student…</option>
                  {students.map((student) => (
                    <option key={student.id} value={student.id}>
                      {student.firstName} {student.lastName} (
                      {student.admissionNo})
                    </option>
                  ))}
                </Select>
              </div>
              <Button onClick={downloadReportCard} disabled={rcLoading}>
                {rcLoading ? "Downloading…" : "Download report card"}
              </Button>
            </div>
            <div className="mt-3">
              <ErrorNote message={rcError} />
            </div>
          </Card>

          <Card>
            <h2 className="mb-4 text-lg font-semibold text-ink">
              Mark sheet
            </h2>
            <div className="flex flex-wrap items-end gap-3">
              <div className="w-56">
                <span className="mb-1 block text-sm font-medium text-muted">
                  Exam
                </span>
                <Select
                  value={msExamId}
                  onChange={(event) => setMsExamId(event.target.value)}
                >
                  <option value="">Select exam…</option>
                  {exams.map((exam) => (
                    <option key={exam.id} value={exam.id}>
                      {exam.name}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="w-56">
                <span className="mb-1 block text-sm font-medium text-muted">
                  {term.section}
                </span>
                <Select
                  value={msSectionId}
                  onChange={(event) => setMsSectionId(event.target.value)}
                >
                  <option value="">{`Select ${term.section.toLowerCase()}…`}</option>
                  {sections.map((section) => (
                    <option key={section.id} value={section.id}>
                      {section.label}
                    </option>
                  ))}
                </Select>
              </div>
              <Button onClick={exportMarkSheet} disabled={msLoading}>
                {msLoading ? "Exporting…" : "Export mark sheet"}
              </Button>
            </div>
            <div className="mt-3">
              <ErrorNote message={msError} />
            </div>
          </Card>
        </div>
      )}

      <Modal
        title={editing ? "Edit grade" : "Add grade"}
        open={modalOpen}
        onClose={() => setModalOpen(false)}
      >
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <Field label="Grade" error={errors.grade?.message}>
            <Input placeholder="e.g. A+" {...register("grade")} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Min percent" error={errors.minPercent?.message}>
              <Input
                type="number"
                min={0}
                max={100}
                step="0.01"
                {...register("minPercent")}
              />
            </Field>
            <Field label="Max percent" error={errors.maxPercent?.message}>
              <Input
                type="number"
                min={0}
                max={100}
                step="0.01"
                {...register("maxPercent")}
              />
            </Field>
          </div>
          <Field label="Remark" error={errors.remark?.message}>
            <Input placeholder="e.g. Excellent" {...register("remark")} />
          </Field>
          <Field label="Sort order" error={errors.sortOrder?.message}>
            <Input type="number" {...register("sortOrder")} />
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
              {isSubmitting ? "Saving…" : "Save grade"}
            </Button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        open={deletingBand !== null}
        title="Delete grade"
        message={
          deletingBand ? `Delete grade band "${deletingBand.grade}"?` : ""
        }
        confirmLabel="Delete"
        cancelLabel="Cancel"
        tone="danger"
        busy={deleteBusy}
        onConfirm={confirmRemoveBand}
        onClose={() => setDeletingBand(null)}
      />
    </>
  );
}
