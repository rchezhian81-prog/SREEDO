"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
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
  PageHeader,
  Select,
  Spinner,
  Textarea,
} from "@/components/ui";

interface Question {
  id: string;
  questionText: string;
  optionA: string;
  optionB: string;
  optionC: string | null;
  optionD: string | null;
  correctOption: "A" | "B" | "C" | "D";
  marks: number;
}

interface Quiz {
  id: string;
  title: string;
  description: string | null;
  className: string | null;
  subjectName: string | null;
  isPublished: boolean;
  questionCount: number;
  totalMarks: number;
  questions: Question[];
}

const questionSchema = z
  .object({
    questionText: z.string().min(1, "Required"),
    optionA: z.string().min(1, "Required"),
    optionB: z.string().min(1, "Required"),
    optionC: z.string().optional(),
    optionD: z.string().optional(),
    correctOption: z.enum(["A", "B", "C", "D"]),
    marks: z.coerce.number().int().positive().max(100),
  })
  .refine(
    (q) =>
      (q.correctOption !== "C" || !!q.optionC) && (q.correctOption !== "D" || !!q.optionD),
    { message: "Correct option must have text", path: ["correctOption"] }
  );
type QuestionForm = z.infer<typeof questionSchema>;

export default function QuizDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;

  const [quiz, setQuiz] = useState<Quiz | null>(null);
  const [loading, setLoading] = useState(true);
  const [serverError, setServerError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setQuiz(await api.get<Quiz>(`/quizzes/${id}`));
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Failed to load quiz");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<QuestionForm>({
    resolver: zodResolver(questionSchema),
    defaultValues: { correctOption: "A", marks: 1 },
  });

  const addQuestion = async (values: QuestionForm) => {
    setServerError(null);
    try {
      await api.post(`/quizzes/${id}/questions`, {
        ...values,
        optionC: values.optionC || undefined,
        optionD: values.optionD || undefined,
      });
      reset({ correctOption: "A", marks: 1, questionText: "", optionA: "", optionB: "", optionC: "", optionD: "" });
      await load();
    } catch (err) {
      setServerError(err instanceof ApiError ? err.message : "Failed to add question");
    }
  };

  const togglePublish = async () => {
    if (!quiz) return;
    setActionError(null);
    try {
      await api.patch(`/quizzes/${id}`, { isPublished: !quiz.isPublished });
      await load();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Failed to update");
    }
  };

  const removeQuestion = async (qid: string) => {
    if (!confirm("Delete this question?")) return;
    setActionError(null);
    try {
      await api.delete(`/quizzes/questions/${qid}`);
      await load();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Failed to delete");
    }
  };

  if (loading) return <Spinner />;
  if (!quiz) return <ErrorNote message={actionError ?? "Quiz not found"} />;

  const optionLabel = (q: Question, key: "A" | "B" | "C" | "D", text: string | null) =>
    text ? (
      <li className={q.correctOption === key ? "font-medium text-green-700" : "text-muted"}>
        {key}. {text} {q.correctOption === key ? "✓" : ""}
      </li>
    ) : null;

  return (
    <>
      <div className="mb-2">
        <Link href="/quizzes" className="text-sm text-brand-600 hover:underline">
          ← Back to quizzes
        </Link>
      </div>
      <PageHeader
        title={quiz.title}
        subtitle={`${quiz.className ?? "School-wide"}${quiz.subjectName ? ` · ${quiz.subjectName}` : ""} · ${quiz.questionCount} questions · ${quiz.totalMarks} marks`}
        action={
          <Button variant={quiz.isPublished ? "secondary" : "primary"} onClick={togglePublish}>
            {quiz.isPublished ? "Unpublish" : "Publish"}
          </Button>
        }
      />

      <ErrorNote message={actionError} />

      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <div className="space-y-3">
          {quiz.questions.length === 0 ? (
            <EmptyState message="No questions yet — add the first one." />
          ) : (
            quiz.questions.map((q, i) => (
              <div key={q.id} className="rounded-xl border border-line bg-surface p-4">
                <div className="flex items-start justify-between gap-3">
                  <p className="font-medium text-ink">
                    {i + 1}. {q.questionText}{" "}
                    <span className="text-xs text-muted">({q.marks} marks)</span>
                  </p>
                  <button
                    onClick={() => removeQuestion(q.id)}
                    className="shrink-0 text-xs font-medium text-red-600 hover:text-red-700"
                  >
                    Delete
                  </button>
                </div>
                <ul className="mt-2 space-y-1 text-sm">
                  {optionLabel(q, "A", q.optionA)}
                  {optionLabel(q, "B", q.optionB)}
                  {optionLabel(q, "C", q.optionC)}
                  {optionLabel(q, "D", q.optionD)}
                </ul>
              </div>
            ))
          )}
        </div>

        <div className="rounded-xl border border-line bg-surface p-4">
          <h2 className="mb-3 font-semibold text-ink">Add question</h2>
          <form onSubmit={handleSubmit(addQuestion)} className="space-y-3">
            <Field label="Question" error={errors.questionText?.message}>
              <Textarea rows={2} {...register("questionText")} />
            </Field>
            <Field label="Option A" error={errors.optionA?.message}>
              <Input {...register("optionA")} />
            </Field>
            <Field label="Option B" error={errors.optionB?.message}>
              <Input {...register("optionB")} />
            </Field>
            <Field label="Option C">
              <Input {...register("optionC")} />
            </Field>
            <Field label="Option D">
              <Input {...register("optionD")} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Correct" error={errors.correctOption?.message}>
                <Select {...register("correctOption")}>
                  <option value="A">A</option>
                  <option value="B">B</option>
                  <option value="C">C</option>
                  <option value="D">D</option>
                </Select>
              </Field>
              <Field label="Marks" error={errors.marks?.message}>
                <Input type="number" {...register("marks")} />
              </Field>
            </div>
            <ErrorNote message={serverError} />
            <Button type="submit" disabled={isSubmitting} className="w-full">
              {isSubmitting ? "Adding…" : "Add question"}
            </Button>
          </form>
        </div>
      </div>
    </>
  );
}
