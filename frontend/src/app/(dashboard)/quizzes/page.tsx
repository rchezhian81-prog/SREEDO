"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { api, ApiError } from "@/lib/api";
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
  Textarea,
} from "@/components/ui";
import type { Paginated, SchoolClass, Subject } from "@/types";

interface Quiz {
  id: string;
  title: string;
  className: string | null;
  subjectName: string | null;
  isPublished: boolean;
  questionCount: number;
  totalMarks: number;
}

const quizSchema = z.object({
  title: z.string().min(1, "Required"),
  description: z.string().optional(),
  classId: z.string().optional(),
  subjectId: z.string().optional(),
});
type QuizForm = z.infer<typeof quizSchema>;

export default function QuizzesPage() {
  const [rows, setRows] = useState<Quiz[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [classes, setClasses] = useState<SchoolClass[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);

  const limit = 10;

  useEffect(() => {
    Promise.all([
      api.get<SchoolClass[]>("/classes").catch(() => []),
      api.get<Subject[]>("/subjects").catch(() => []),
    ]).then(([c, s]) => {
      setClasses(c);
      setSubjects(s);
    });
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setRowError(null);
    try {
      const result = await api.get<Paginated<Quiz>>(
        `/quizzes?page=${page}&limit=${limit}`
      );
      setRows(result.data);
      setTotal(result.meta.total);
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => {
    load().catch(() => setLoading(false));
  }, [load]);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<QuizForm>({ resolver: zodResolver(quizSchema) });

  const onSubmit = async (values: QuizForm) => {
    setServerError(null);
    try {
      await api.post("/quizzes", {
        title: values.title,
        description: values.description || undefined,
        classId: values.classId || null,
        subjectId: values.subjectId || null,
      });
      setModalOpen(false);
      reset();
      await load();
    } catch (err) {
      setServerError(err instanceof ApiError ? err.message : "Failed to save");
    }
  };

  const removeQuiz = async (q: Quiz) => {
    if (!confirm(`Delete quiz "${q.title}" and all its questions?`)) return;
    setRowError(null);
    try {
      await api.delete(`/quizzes/${q.id}`);
      await load();
    } catch (err) {
      setRowError(err instanceof ApiError ? err.message : "Failed to delete");
    }
  };

  const totalPages = Math.max(1, Math.ceil(total / limit));

  return (
    <>
      <PageHeader
        title="Quizzes"
        subtitle="Online quizzes & assessments"
        action={<Button onClick={() => setModalOpen(true)}>+ New quiz</Button>}
      />

      <ErrorNote message={rowError} />

      {loading ? (
        <Spinner />
      ) : rows.length === 0 ? (
        <EmptyState message="No quizzes yet" />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-line bg-surface">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-line bg-surface-2 text-xs uppercase text-muted">
              <tr>
                <th className="px-4 py-3">Title</th>
                <th className="px-4 py-3">Class</th>
                <th className="px-4 py-3">Subject</th>
                <th className="px-4 py-3">Questions</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((q) => (
                <tr key={q.id} className="hover:bg-surface-2">
                  <td className="px-4 py-3 font-medium text-ink">{q.title}</td>
                  <td className="px-4 py-3 text-muted">{q.className ?? "School-wide"}</td>
                  <td className="px-4 py-3 text-muted">{q.subjectName ?? "—"}</td>
                  <td className="px-4 py-3 text-muted">
                    {q.questionCount} · {q.totalMarks} marks
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={
                        q.isPublished
                          ? "rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700"
                          : "rounded-full bg-surface-2 px-2 py-0.5 text-xs font-medium text-muted"
                      }
                    >
                      {q.isPublished ? "Published" : "Draft"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex justify-end gap-3">
                      <Link
                        href={`/quizzes/${q.id}`}
                        className="text-xs font-medium text-brand-600 hover:underline"
                      >
                        Manage
                      </Link>
                      <button
                        onClick={() => removeQuiz(q)}
                        className="text-xs font-medium text-red-600 hover:text-red-700"
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {totalPages > 1 && (
        <div className="mt-4 flex items-center justify-end gap-2 text-sm">
          <Button variant="secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>
            Previous
          </Button>
          <span className="text-muted">Page {page} of {totalPages}</span>
          <Button variant="secondary" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>
            Next
          </Button>
        </div>
      )}

      <Modal title="New quiz" open={modalOpen} onClose={() => setModalOpen(false)}>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <Field label="Title" error={errors.title?.message}>
            <Input {...register("title")} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Class">
              <Select {...register("classId")}>
                <option value="">School-wide</option>
                {classes.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Subject">
              <Select {...register("subjectId")}>
                <option value="">None</option>
                {subjects.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <Field label="Description">
            <Textarea rows={2} {...register("description")} />
          </Field>
          <ErrorNote message={serverError} />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setModalOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Saving…" : "Create"}
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
