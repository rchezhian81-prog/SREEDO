"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
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

const QUICK_LINKS = [
  { href: "/portal/profile", label: "Profile", icon: "🪪" },
  { href: "/portal/attendance", label: "Attendance", icon: "🗓️" },
  { href: "/portal/timetable", label: "Timetable", icon: "📅" },
  { href: "/portal/fees", label: "Fees", icon: "💳" },
  { href: "/portal/announcements", label: "Notices", icon: "📣" },
];

export default function PortalDashboardPage() {
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
      .catch(() => setError("Could not load this student's summary."))
      .finally(() => setLoading(false));
  }, [studentId]);

  if (!studentId) {
    return (
      <>
        <PageHeader title={t("portalPages.dashboard.title")} />
        <EmptyState message="No student linked to your account yet." />
      </>
    );
  }

  if (loading) return <Spinner />;

  const profile = summary?.profile;
  const attendance = summary?.attendance;
  const fees = summary?.fees;
  const ratePct =
    attendance && attendance.rate !== null
      ? `${Math.round(attendance.rate * 100)}%`
      : "—";

  return (
    <>
      <PageHeader
        title={
          profile
            ? `${profile.firstName} ${profile.lastName}`
            : t("portalPages.dashboard.title")
        }
        subtitle={
          profile
            ? [profile.className, profile.sectionName]
                .filter(Boolean)
                .join(" · ") || undefined
            : undefined
        }
      />

      <ErrorNote message={error} />

      {summary && (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              label="Attendance rate"
              value={ratePct}
              hint={
                attendance ? `${attendance.total} days recorded` : undefined
              }
            />
            <StatCard
              label="Present / Absent"
              value={`${attendance?.present ?? 0} / ${attendance?.absent ?? 0}`}
              hint={
                attendance
                  ? `${attendance.late} late · ${attendance.excused} excused`
                  : undefined
              }
            />
            <StatCard
              label="Fees outstanding"
              value={(fees?.outstanding ?? 0).toLocaleString()}
              hint={`Paid ${(fees?.totalPaid ?? 0).toLocaleString()} of ${(
                fees?.totalDue ?? 0
              ).toLocaleString()}`}
            />
            <StatCard
              label="Pending invoices"
              value={fees?.pendingInvoices ?? 0}
            />
          </div>

          <h2 className="mb-3 mt-8 text-lg font-semibold text-slate-900">
            Quick links
          </h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            {QUICK_LINKS.map((link) => (
              <Link key={link.href} href={link.href}>
                <Card className="transition hover:border-brand-300 hover:shadow">
                  <p className="text-2xl" aria-hidden>
                    {link.icon}
                  </p>
                  <p className="mt-2 text-sm font-medium text-slate-900">
                    {link.label}
                  </p>
                </Card>
              </Link>
            ))}
          </div>
        </>
      )}
    </>
  );
}
