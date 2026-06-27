"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { portalApi } from "@/lib/portal-api";
import { usePortalStore } from "@/stores/portal-store";
import { Button, Card, ErrorNote, Spinner } from "@/components/ui";

type Opt = "A" | "B" | "C" | "D";

interface Question {
  id: string;
  questionText: string;
  optionA: string;
  optionB: string;
  optionC: string | null;
  optionD: string | null;
  marks: number;
  correctOption?: Opt;
}

interface QuizView {
  id: string;
  title: string;
  description: string | null;
  className: string | null;
  subjectName: string | null;
  attempted: boolean;
  result: { score: number; total: number; answers: Record<string, Opt> } | null;
  questions: Question[];
}

export default function PortalTakeQuizPage() {
  const params = useParams<{ id: string }>();
  const quizId = params.id;
  const studentId = usePortalStore((state) => state.selectedStudentId);

  const [quiz, setQuiz] = useState<QuizView | null>(null);
  const [answers, setAnswers] = useState<Record<string, Opt>>({});
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!studentId) return;
    setLoading(true);
    setError(null);
    try {
      setQuiz(await portalApi.get<QuizView>(`/portal/students/${studentId}/quizzes/${quizId}`));
    } catch {
      setError("Could not load this quiz.");
    } finally {
      setLoading(false);
    }
  }, [studentId, quizId]);

  useEffect(() => {
    load();
  }, [load]);

  const submit = async () => {
    if (!studentId || !quiz) return;
    if (Object.keys(answers).length < quiz.questions.length) {
      if (!confirm("You haven't answered every question. Submit anyway?")) return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await portalApi.post(`/portal/students/${studentId}/quizzes/${quizId}/attempt`, { answers });
      await load();
    } catch {
      setError("Could not submit your attempt. You may have already taken this quiz.");
      await load();
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <Spinner />;
  if (!quiz) return <ErrorNote message={error ?? "Quiz not found"} />;

  const reviewing = quiz.attempted;
  const opts = (q: Question): { key: Opt; text: string | null }[] => [
    { key: "A", text: q.optionA },
    { key: "B", text: q.optionB },
    { key: "C", text: q.optionC },
    { key: "D", text: q.optionD },
  ];

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-2">
        <Link href="/portal/quizzes" className="text-sm text-brand-600 hover:underline">
          ← Back to quizzes
        </Link>
      </div>
      <h1 className="text-2xl font-semibold text-slate-900">{quiz.title}</h1>
      <p className="mb-4 text-sm text-slate-500">
        {quiz.subjectName ? `${quiz.subjectName} · ` : ""}
        {quiz.className ?? "School-wide"}
      </p>

      {reviewing && quiz.result ? (
        <div className="mb-4 rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-green-800">
          You scored <span className="font-semibold">{quiz.result.score}</span> out of{" "}
          <span className="font-semibold">{quiz.result.total}</span>.
        </div>
      ) : null}

      <ErrorNote message={error} />

      <div className="space-y-4">
        {quiz.questions.map((q, i) => {
          const chosen = reviewing ? quiz.result?.answers?.[q.id] : answers[q.id];
          return (
            <Card key={q.id}>
              <p className="font-medium text-slate-900">
                {i + 1}. {q.questionText}{" "}
                <span className="text-xs text-slate-400">({q.marks} marks)</span>
              </p>
              <div className="mt-3 space-y-2">
                {opts(q).map(({ key, text }) =>
                  text ? (
                    <label
                      key={key}
                      className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm ${
                        reviewing && q.correctOption === key
                          ? "border-green-400 bg-green-50 text-green-800"
                          : reviewing && chosen === key
                            ? "border-red-300 bg-red-50 text-red-700"
                            : chosen === key
                              ? "border-brand-400 bg-brand-50"
                              : "border-slate-200"
                      }`}
                    >
                      <input
                        type="radio"
                        name={q.id}
                        value={key}
                        disabled={reviewing}
                        checked={chosen === key}
                        onChange={() => setAnswers((a) => ({ ...a, [q.id]: key }))}
                      />
                      <span>
                        {key}. {text}
                      </span>
                      {reviewing && q.correctOption === key ? <span className="ml-auto">✓</span> : null}
                    </label>
                  ) : null
                )}
              </div>
            </Card>
          );
        })}
      </div>

      {!reviewing ? (
        <div className="mt-6 flex justify-end">
          <Button onClick={submit} disabled={submitting || quiz.questions.length === 0}>
            {submitting ? "Submitting…" : "Submit quiz"}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
