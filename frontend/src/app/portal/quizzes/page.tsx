"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { portalApi } from "@/lib/portal-api";
import { usePortalStore } from "@/stores/portal-store";
import { Card, EmptyState, ErrorNote, PageHeader, Spinner } from "@/components/ui";
import { useI18n } from "@/i18n/I18nProvider";

interface QuizRow {
  id: string;
  title: string;
  description: string | null;
  className: string | null;
  subjectName: string | null;
  questionCount: number;
  totalMarks: number;
  attempted: boolean;
  score: number | null;
  total: number | null;
}

export default function PortalQuizzesPage() {
  const { t } = useI18n();
  const studentId = usePortalStore((state) => state.selectedStudentId);
  const [rows, setRows] = useState<QuizRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!studentId) {
      setRows([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    portalApi
      .get<QuizRow[]>(`/portal/students/${studentId}/quizzes`)
      .then(setRows)
      .catch(() => setError("Could not load quizzes."))
      .finally(() => setLoading(false));
  }, [studentId]);

  return (
    <div>
      <PageHeader title={t("portalNav.quizzes")} subtitle="Quizzes & assessments from your teachers" />

      {loading ? (
        <Spinner />
      ) : error ? (
        <ErrorNote message={error} />
      ) : rows.length === 0 ? (
        <EmptyState message="No quizzes are available right now." />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {rows.map((q) => (
            <Card key={q.id} className="flex flex-col gap-2">
              <div>
                <h3 className="font-semibold text-slate-900">{q.title}</h3>
                <p className="text-xs text-slate-500">
                  {q.subjectName ? `${q.subjectName} · ` : ""}
                  {q.className ?? "School-wide"} · {q.questionCount} questions · {q.totalMarks} marks
                </p>
              </div>
              {q.attempted ? (
                <div className="mt-auto flex items-center justify-between">
                  <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
                    Score: {q.score} / {q.total}
                  </span>
                  <Link
                    href={`/portal/quizzes/${q.id}`}
                    className="text-sm font-medium text-brand-600 hover:underline"
                  >
                    Review →
                  </Link>
                </div>
              ) : (
                <Link
                  href={`/portal/quizzes/${q.id}`}
                  className="mt-auto inline-block text-sm font-medium text-brand-600 hover:underline"
                >
                  Take quiz →
                </Link>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
