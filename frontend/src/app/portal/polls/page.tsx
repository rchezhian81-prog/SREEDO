"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { portalApi } from "@/lib/portal-api";
import { usePortalStore } from "@/stores/portal-store";
import { Card, EmptyState, ErrorNote, PageHeader, Spinner } from "@/components/ui";
import { useI18n } from "@/i18n/I18nProvider";

interface PollRow {
  id: string;
  question: string;
  description: string | null;
  className: string | null;
  closesAt: string | null;
  totalVotes: number;
  voted: boolean;
}

export default function PortalPollsPage() {
  const { t } = useI18n();
  const studentId = usePortalStore((state) => state.selectedStudentId);
  const [rows, setRows] = useState<PollRow[]>([]);
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
      .get<PollRow[]>(`/portal/students/${studentId}/polls`)
      .then(setRows)
      .catch(() => setError("Could not load polls."))
      .finally(() => setLoading(false));
  }, [studentId]);

  return (
    <div>
      <PageHeader title={t("portalNav.polls")} subtitle="Have your say" />

      {loading ? (
        <Spinner />
      ) : error ? (
        <ErrorNote message={error} />
      ) : rows.length === 0 ? (
        <EmptyState message="No polls are open right now." />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {rows.map((p) => (
            <Card key={p.id} className="flex flex-col gap-2">
              <div>
                <h3 className="font-semibold text-slate-900">{p.question}</h3>
                <p className="text-xs text-slate-500">
                  {p.className ?? "School-wide"} · {p.totalVotes} vote{p.totalVotes === 1 ? "" : "s"}
                </p>
              </div>
              <Link
                href={`/portal/polls/${p.id}`}
                className="mt-auto inline-block text-sm font-medium text-brand-600 hover:underline"
              >
                {p.voted ? "View results →" : "Vote →"}
              </Link>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
