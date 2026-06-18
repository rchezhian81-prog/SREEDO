"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { api, ApiError } from "@/lib/api";
import { useAuthStore } from "@/stores/auth-store";
import {
  Badge,
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
  AcademicYear,
  Exam,
  ExamResultRow,
  Paginated,
  SchoolClass,
  Student,
  Subject,
} from "@/types";

const examSchema = z.object({
  name: z.string().min(1, "Required"),
  academicYearId: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
});

type ExamForm = z.infer<typeof examSchema>;

interface SectionOption {
  id: string;
  label: string;
}

export default function ExamsPage() {
  const role = useAuthStore((state) => state.user?.role);
  const canCreate = role === "admin";
  const canEnter = role === "admin" || role === "teacher";

  const [exams, setExams] = useState<Exam[]>([]);
  const [academicYears, setAcademicYears] = useState<AcademicYear[]>([]);
  const [sections, setSections] = useState<SectionOption[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const [selectedExamId, setSelectedExamId] = useState<string>("");
  const [sectionId, setSectionId] = useState("");
  const [subjectId, setSubjectId] = useState("");
  const [maxMarks, setMaxMarks] = useState("100");
  const [roster, setRoster] = useState<Student[]>([]);
  const [results, setResults] = useState<ExamResultRow[]>([]);
  const [marks, setMarks] = useState<Record<string, string>>({});
  const [gridLoading, setGridLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selectedExam = exams.find((exam) => exam.id === selectedExamId) ?? null;
  const selectedSubject = subjects.find((s) => s.id === subjectId) ?? null;

  const loadExams = useCallback(async () => {
    setLoading(true);
    try {
      setExams(await api.get<Exam[]>("/exams"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadExams().catch(() => setLoading(false));
  }, [loadExams]);

  useEffect(() => {
    api
      .get<AcademicYear[]>("/academic-years")
      .then(setAcademicYears)
      .catch(() => undefined);
    api
      .get<Subject[]>("/subjects")
      .then((data) => {
        setSubjects(data);
        if (data[0]) setSubjectId(data[0].id);
      })
      .catch(() => undefined);
    api
      .get<SchoolClass[]>("/classes")
      .then((classes) => {
        const options = classes.flatMap((schoolClass) =>
          schoolClass.sections.map((section) => ({
            id: section.id,
            label: `${schoolClass.name} — ${section.name}`,
          }))
        );
        setSections(options);
        if (options[0]) setSectionId(options[0].id);
      })
      .catch(() => undefined);
  }, []);

  // Load the section roster and any existing results for the selected exam.
  const loadGrid = useCallback(async () => {
    if (!selectedExamId || !sectionId) {
      setRoster([]);
      setResults([]);
      return;
    }
    setGridLoading(true);
    setMessage(null);
    try {
      const [students, examResults] = await Promise.all([
        api.get<Paginated<Student>>(
          `/students?sectionId=${sectionId}&limit=100`
        ),
        api.get<ExamResultRow[]>(
          `/exams/${selectedExamId}/results?sectionId=${sectionId}`
        ),
      ]);
      setRoster(students.data);
      setResults(examResults);
    } finally {
      setGridLoading(false);
    }
  }, [selectedExamId, sectionId]);

  useEffect(() => {
    loadGrid().catch(() => setGridLoading(false));
  }, [loadGrid]);

  // Prefill mark inputs from existing results for the chosen subject.
  useEffect(() => {
    if (!selectedSubject) return;
    const prefilled: Record<string, string> = {};
    for (const row of results) {
      if (row.subjectName === selectedSubject.name) {
        prefilled[row.studentId] = String(row.marksObtained);
      }
    }
    setMarks(prefilled);
  }, [results, selectedSubject]);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<ExamForm>({ resolver: zodResolver(examSchema) });

  const onCreateExam = async (values: ExamForm) => {
    setServerError(null);
    try {
      await api.post("/exams", {
        name: values.name,
        academicYearId: values.academicYearId || undefined,
        startDate: values.startDate || undefined,
        endDate: values.endDate || undefined,
      });
      setModalOpen(false);
      reset();
      await loadExams();
    } catch (err) {
      setServerError(
        err instanceof ApiError ? err.message : "Failed to create exam"
      );
    }
  };

  const saveMarks = async () => {
    if (!selectedExamId || !subjectId) {
      setError("Select an exam and subject first");
      return;
    }
    const max = Number(maxMarks) || 100;
    const payload = roster
      .filter((student) => (marks[student.id] ?? "").trim() !== "")
      .map((student) => ({
        studentId: student.id,
        subjectId,
        marksObtained: Number(marks[student.id]),
        maxMarks: max,
      }));
    if (payload.length === 0) {
      setError("Enter at least one mark");
      return;
    }
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const result = await api.post<{ upserted: number }>(
        `/exams/${selectedExamId}/results`,
        { results: payload }
      );
      setMessage(`Saved ${result.upserted} marks`);
      await loadGrid();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to save marks");
    } finally {
      setSaving(false);
    }
  };

  const formatDate = (value: string | null) =>
    value ? new Date(value).toLocaleDateString() : "—";

  const sortedResults = useMemo(
    () =>
      [...results].sort(
        (a, b) =>
          a.firstName.localeCompare(b.firstName) ||
          a.subjectName.localeCompare(b.subjectName)
      ),
    [results]
  );

  return (
    <>
      <PageHeader
        title="Exams & Results"
        subtitle={`${exams.length} exam${exams.length === 1 ? "" : "s"}`}
        action={
          canCreate ? (
            <Button onClick={() => setModalOpen(true)}>+ Add exam</Button>
          ) : undefined
        }
      />

      {loading ? (
        <Spinner />
      ) : exams.length === 0 ? (
        <EmptyState message="No exams yet" />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3">Exam</th>
                <th className="px-4 py-3">Academic year</th>
                <th className="px-4 py-3">Dates</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {exams.map((exam) => (
                <tr
                  key={exam.id}
                  className={
                    exam.id === selectedExamId ? "bg-brand-50" : "hover:bg-slate-50"
                  }
                >
                  <td className="px-4 py-3 font-medium text-slate-900">
                    {exam.name}
                  </td>
                  <td className="px-4 py-3">{exam.academicYearName ?? "—"}</td>
                  <td className="px-4 py-3 text-slate-500">
                    {formatDate(exam.startDate)} – {formatDate(exam.endDate)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Button
                      variant={exam.id === selectedExamId ? "primary" : "secondary"}
                      onClick={() => {
                        setSelectedExamId(exam.id);
                        setMessage(null);
                        setError(null);
                      }}
                    >
                      {exam.id === selectedExamId ? "Selected" : "Open"}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selectedExam && (
        <Card className="mt-6">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-semibold text-slate-900">
              {selectedExam.name} — mark entry
            </h2>
            <Badge tone="blue">
              {selectedExam.academicYearName ?? "No academic year"}
            </Badge>
          </div>

          {sections.length === 0 || subjects.length === 0 ? (
            <EmptyState message="Add classes/sections and subjects first (Classes page)." />
          ) : (
            <>
              <div className="mb-4 flex flex-wrap items-end gap-3">
                <div className="w-56">
                  <span className="mb-1 block text-sm font-medium text-slate-700">
                    Section
                  </span>
                  <Select
                    value={sectionId}
                    onChange={(event) => setSectionId(event.target.value)}
                  >
                    {sections.map((section) => (
                      <option key={section.id} value={section.id}>
                        {section.label}
                      </option>
                    ))}
                  </Select>
                </div>
                <div className="w-48">
                  <span className="mb-1 block text-sm font-medium text-slate-700">
                    Subject
                  </span>
                  <Select
                    value={subjectId}
                    onChange={(event) => setSubjectId(event.target.value)}
                  >
                    {subjects.map((subject) => (
                      <option key={subject.id} value={subject.id}>
                        {subject.name}
                      </option>
                    ))}
                  </Select>
                </div>
                <div className="w-28">
                  <span className="mb-1 block text-sm font-medium text-slate-700">
                    Max marks
                  </span>
                  <Input
                    type="number"
                    min={1}
                    value={maxMarks}
                    onChange={(event) => setMaxMarks(event.target.value)}
                  />
                </div>
                {canEnter && (
                  <Button onClick={saveMarks} disabled={saving || gridLoading}>
                    {saving ? "Saving…" : "Save marks"}
                  </Button>
                )}
              </div>

              {message && (
                <p className="mb-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
                  {message}
                </p>
              )}
              <ErrorNote message={error} />

              {gridLoading ? (
                <Spinner />
              ) : roster.length === 0 ? (
                <EmptyState message="No students in this section" />
              ) : (
                <div className="overflow-x-auto rounded-xl border border-slate-200">
                  <table className="w-full text-left text-sm">
                    <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
                      <tr>
                        <th className="px-4 py-3">Student</th>
                        <th className="px-4 py-3">Admission No</th>
                        <th className="px-4 py-3 w-40">
                          Marks ({selectedSubject?.name ?? "subject"})
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {roster.map((student) => (
                        <tr key={student.id}>
                          <td className="px-4 py-3 font-medium text-slate-900">
                            {student.firstName} {student.lastName}
                          </td>
                          <td className="px-4 py-3 font-mono text-xs">
                            {student.admissionNo}
                          </td>
                          <td className="px-4 py-3">
                            <Input
                              type="number"
                              min={0}
                              max={Number(maxMarks) || undefined}
                              disabled={!canEnter}
                              value={marks[student.id] ?? ""}
                              onChange={(event) =>
                                setMarks((current) => ({
                                  ...current,
                                  [student.id]: event.target.value,
                                }))
                              }
                              placeholder="—"
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {sortedResults.length > 0 && (
                <div className="mt-6">
                  <h3 className="mb-2 text-sm font-semibold text-slate-700">
                    Recorded results for this section
                  </h3>
                  <div className="overflow-x-auto rounded-xl border border-slate-200">
                    <table className="w-full text-left text-sm">
                      <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
                        <tr>
                          <th className="px-4 py-3">Student</th>
                          <th className="px-4 py-3">Subject</th>
                          <th className="px-4 py-3">Marks</th>
                          <th className="px-4 py-3">Grade</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {sortedResults.map((row) => (
                          <tr key={`${row.studentId}-${row.subjectName}`}>
                            <td className="px-4 py-3">
                              {row.firstName} {row.lastName}
                            </td>
                            <td className="px-4 py-3">{row.subjectName}</td>
                            <td className="px-4 py-3">
                              {row.marksObtained} / {row.maxMarks}
                            </td>
                            <td className="px-4 py-3">{row.grade ?? "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </>
          )}
        </Card>
      )}

      <Modal title="Add exam" open={modalOpen} onClose={() => setModalOpen(false)}>
        <form onSubmit={handleSubmit(onCreateExam)} className="space-y-4">
          <Field label="Exam name" error={errors.name?.message}>
            <Input placeholder="e.g. Mid-term 2026" {...register("name")} />
          </Field>
          <Field label="Academic year">
            <Select {...register("academicYearId")}>
              <option value="">—</option>
              {academicYears.map((year) => (
                <option key={year.id} value={year.id}>
                  {year.name}
                </option>
              ))}
            </Select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Start date">
              <Input type="date" {...register("startDate")} />
            </Field>
            <Field label="End date">
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
              {isSubmitting ? "Saving…" : "Create exam"}
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
