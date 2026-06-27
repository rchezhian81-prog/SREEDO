"use client";

import { useEffect, useState } from "react";
import { portalApi } from "@/lib/portal-api";
import { usePortalStore } from "@/stores/portal-store";
import {
  Card,
  EmptyState,
  ErrorNote,
  PageHeader,
  Spinner,
} from "@/components/ui";
import type { StudentSummary } from "@/types";
import { useI18n } from "@/i18n/I18nProvider";

function StatCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string | number;
  hint?: string;
}) {
  return (
    <Card>
      <p className="text-sm text-slate-500">{label}</p>
      <p className="mt-1 text-3xl font-semibold text-slate-900">{value}</p>
      {hint && <p className="mt-1 text-xs text-slate-400">{hint}</p>}
    </Card>
  );
}

export default function PortalAttendancePage() {
  const { t } = useI18n();
  const studentId = usePortalStore((state) => state.selectedStudentId);
  const [summary, setSummary] = useState<StudentSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!studentId) {
      setSummary(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    portalApi
      .get<StudentSummary>(`/portal/students/${studentId}/summary`)
      .then(setSummary)
      .catch(() => setError("Could not load attendance."))
      .finally(() => setLoading(false));
  }, [studentId]);

  if (!studentId) {
    return (
      <>
        <PageHeader title={t("portalPages.attendance.title")} />
        <EmptyState message="No student linked to your account yet." />
      </>
    );
  }

  if (loading) return <Spinner />;

  const a = summary?.attendance;
  const ratePct =
    a && a.rate !== null ? `${Math.round(a.rate * 100)}%` : "—";

  return (
    <>
      <PageHeader
        title={t("portalPages.attendance.title")}
        subtitle="Recorded across the academic year"
      />
      <ErrorNote message={error} />
      {a && (
        <>
          <div className="mb-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <StatCard
              label="Attendance rate"
              value={ratePct}
              hint={`${a.total} days recorded`}
            />
            <StatCard label="Present" value={a.present} />
            <StatCard label="Absent" value={a.absent} />
          </div>
          <Card>
            <table className="w-full text-left text-sm">
              <tbody className="divide-y divide-slate-100">
                {[
                  ["Present", a.present],
                  ["Absent", a.absent],
                  ["Late", a.late],
                  ["Excused", a.excused],
                  ["Total", a.total],
                ].map(([label, value]) => (
                  <tr key={label}>
                    <td className="py-2 text-slate-600">{label}</td>
                    <td className="py-2 text-right font-medium text-slate-900">
                      {value}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </>
      )}
    </>
  );
}
