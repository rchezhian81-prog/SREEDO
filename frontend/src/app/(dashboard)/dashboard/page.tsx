"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api, ApiError } from "@/lib/api";
import { cx, Badge, EmptyState, ErrorNote, PageHeader, Spinner } from "@/components/ui";
import { Icon, type IconName } from "@/components/icons";
import { useAuthStore } from "@/stores/auth-store";
import { usePermissions } from "@/lib/use-permissions";
import { useTerms, type TermSet } from "@/lib/terms";
import type { DashboardSummary } from "@/types";

const inr = (n: number) => "₹" + Math.round(n).toLocaleString("en-IN");

const TONES: Record<string, string> = {
  blue: "bg-brand-500/12 text-brand-600 dark:text-brand-300",
  green: "bg-emerald-500/12 text-emerald-600 dark:text-emerald-400",
  amber: "bg-amber-500/12 text-amber-600 dark:text-amber-400",
  red: "bg-red-500/12 text-red-600 dark:text-red-400",
  violet: "bg-violet-500/12 text-violet-600 dark:text-violet-300",
};

// Needs-attention signals → a terminology-aware message, icon, tone and a link
// to fix it. The backend only emits keys/counts (data), keeping wording here.
const ATTENTION: Record<
  string,
  { icon: IconName; label: (t: TermSet, n?: number) => string; href: string }
> = {
  no_academic_year: { icon: "calendar", label: () => "No academic year is set", href: "/settings" },
  no_classes: { icon: "school", label: (t) => `No ${t.klassPlural.toLowerCase()} configured yet`, href: "/classes" },
  no_programs: { icon: "layers", label: (t) => `No ${t.klassPlural.toLowerCase()} configured yet`, href: "/college/programs" },
  no_sections: { icon: "school", label: (t) => `No ${t.sectionPlural.toLowerCase()} configured yet`, href: "/classes" },
  no_batches: { icon: "layers", label: (t) => `No ${t.sectionPlural.toLowerCase()} configured yet`, href: "/college/programs" },
  no_students: { icon: "cap", label: () => "No active students enrolled yet", href: "/students" },
  attendance_not_marked: { icon: "calcheck", label: () => "Attendance isn't marked for today", href: "/attendance" },
  overdue_fees: { icon: "receipt", label: (_t, n) => `${n} overdue fee invoice${n === 1 ? "" : "s"}`, href: "/fees" },
  failed_comms: { icon: "alert", label: (_t, n) => `${n} failed communication${n === 1 ? "" : "s"}`, href: "/communication" },
};

const SEVERITY_TONE: Record<string, keyof typeof TONES> = {
  danger: "red",
  warning: "amber",
  info: "blue",
};

function StatCard({
  icon,
  tone,
  label,
  value,
  hint,
  href,
}: {
  icon: IconName;
  tone: keyof typeof TONES;
  label: string;
  value: string | number;
  hint?: string;
  href?: string;
}) {
  const inner = (
    <>
      <div className="flex items-center gap-3.5">
        <div className={cx("grid h-[52px] w-[52px] shrink-0 place-items-center rounded-2xl", TONES[tone])}>
          <Icon name={icon} className="h-6 w-6" />
        </div>
        <div className="min-w-0">
          <div className="text-[12.5px] font-semibold text-muted">{label}</div>
          <div
            data-numeric
            className="mt-0.5 text-[26px] font-extrabold leading-none tracking-tight text-ink"
          >
            {value}
          </div>
        </div>
      </div>
      {hint && <div className="mt-3 text-[12.5px] font-medium text-muted">{hint}</div>}
    </>
  );
  // `db-stat` is an inert page-local UI-v2 hook (styled only under `.ui-v2`);
  // off-flag it carries no rules, so the legacy card is byte-identical.
  const cls = "db-stat block rounded-2xl border border-line bg-surface p-5 shadow-card";
  return href ? (
    <Link href={href} className={cx(cls, "transition hover:bg-surface-2")}>
      {inner}
    </Link>
  ) : (
    <div className={cls}>{inner}</div>
  );
}

function Panel({
  title,
  action,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="db-panel overflow-hidden rounded-2xl border border-line bg-surface shadow-card">
      <div className="flex items-center justify-between border-b border-line px-5 py-4">
        <h3 className="text-[15px] font-bold text-ink">{title}</h3>
        {action}
      </div>
      {children}
    </div>
  );
}

export default function DashboardPage() {
  const user = useAuthStore((s) => s.user);
  const { can } = usePermissions();
  const term = useTerms();
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setSummary(await api.get<DashboardSummary>("/dashboard/summary"));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load the dashboard");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) return <Spinner />;
  if (error || !summary) {
    return (
      <div className="space-y-4">
        <ErrorNote message={error ?? "Dashboard unavailable"} />
        <button
          onClick={load}
          className="inline-flex items-center gap-2 rounded-xl border border-line bg-surface px-4 py-2.5 text-sm font-semibold text-ink transition hover:bg-hover"
        >
          <Icon name="history" className="h-4 w-4" /> Retry
        </button>
      </div>
    );
  }

  const { institution: inst, academic, operations: ops, finance, communication } = summary;
  const isCollege = inst.type === "college";
  const firstName = user?.fullName?.split(" ")[0] ?? "there";
  const att = ops.attendanceToday;
  const attRate = att.marked > 0 && att.rate !== null ? Math.round(att.rate * 100) : null;

  return (
    <>
      {/* Page-local UI-v2 header accent wrapper. The shared PageHeader is NOT
          edited or restyled globally; a violet→indigo accent band is drawn by a
          `.ui-v2 .db-header::before` pseudo-element. Off-flag the wrapper is a
          bare div, so legacy + every other PageHeader stays pixel-identical. */}
      <div className="db-header">
        <PageHeader
          title="Dashboard"
          subtitle={`Welcome back, ${firstName}! Here's your institution at a glance.`}
        />
      </div>

      <div className="space-y-5">
        {/* Needs attention */}
        {summary.needsAttention.length > 0 && (
          <div className="db-attention">
            <Panel title="Needs attention">
              <ul className="divide-y divide-line">
                {summary.needsAttention.map((a) => {
                  const meta = ATTENTION[a.key];
                  if (!meta) return null;
                  const tone = SEVERITY_TONE[a.severity] ?? "blue";
                  return (
                    <li key={a.key}>
                      <Link
                        href={meta.href}
                        className="flex items-center gap-3 px-5 py-3.5 transition hover:bg-surface-2"
                      >
                        <span className={cx("grid h-9 w-9 shrink-0 place-items-center rounded-xl", TONES[tone])}>
                          <Icon name={meta.icon} className="h-[18px] w-[18px]" />
                        </span>
                        <span className="flex-1 text-sm font-semibold text-ink">
                          {meta.label(term, a.count)}
                        </span>
                        <Icon name="chevronRight" className="h-[17px] w-[17px] text-faint" />
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </Panel>
          </div>
        )}

        {/* Institution snapshot */}
        <div className="db-snapshot rounded-2xl border border-line bg-surface p-5 shadow-card">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3.5">
              <div className={cx("grid h-[52px] w-[52px] shrink-0 place-items-center rounded-2xl", isCollege ? TONES.violet : TONES.blue)}>
                <Icon name="building" className="h-6 w-6" />
              </div>
              <div className="min-w-0">
                <div className="truncate text-lg font-extrabold text-ink">{inst.name}</div>
                <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[12.5px] text-muted">
                  <Badge tone="blue">{isCollege ? "College" : "School"}</Badge>
                  <span>·</span>
                  <span>{inst.currentAcademicYear?.name ?? "No academic year"}</span>
                  <span>·</span>
                  <Badge tone={inst.isActive ? "green" : "red"}>{inst.isActive ? "Active" : "Inactive"}</Badge>
                </div>
              </div>
            </div>
            {can("academic_years:manage") && !inst.currentAcademicYear && (
              <Link
                href="/settings"
                className="inline-flex items-center gap-2 rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-700"
              >
                <Icon name="calendar" className="h-4 w-4" /> Set academic year
              </Link>
            )}
          </div>
        </div>

        {/* Academic summary */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard icon="cap" tone="blue" label="Active Students" value={academic.activeStudents.toLocaleString("en-IN")} href="/students" />
          <StatCard icon="board" tone="green" label={term.teachers} value={academic.activeStaff.toLocaleString("en-IN")} href="/teachers" />
          {isCollege ? (
            <>
              <StatCard icon="layers" tone="violet" label={term.klassPlural} value={academic.programs} hint={`${academic.departments} departments`} href="/college/programs" />
              <StatCard icon="bookOpen" tone="amber" label={term.subjectPlural} value={academic.subjects} hint={`${academic.semesters} semesters · ${academic.batches} ${term.sectionPlural.toLowerCase()}`} href="/college/subjects" />
            </>
          ) : (
            <>
              <StatCard icon="school" tone="blue" label={term.klassPlural} value={academic.classes} hint={`${academic.sections} ${term.sectionPlural.toLowerCase()}`} href="/classes" />
              <StatCard icon="bookOpen" tone="amber" label={term.subjectPlural} value={academic.subjects} href="/classes" />
            </>
          )}
        </div>

        {/* Operations */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            icon="calcheck"
            tone="amber"
            label="Attendance Today"
            value={attRate === null ? "—" : `${attRate}%`}
            hint={att.marked > 0 ? `${att.present} of ${att.marked} present` : "Not marked yet"}
            href="/attendance"
          />
          {ops.pendingAdmissions !== null && (
            <StatCard icon="userPlus" tone="blue" label="Pending Admissions" value={ops.pendingAdmissions} hint="Enquiries & applications" href="/admissions" />
          )}
          <StatCard icon="file" tone="violet" label="Upcoming Exams" value={ops.upcomingExams} href="/exams" />
          <StatCard icon="board" tone="green" label="Homework Due" value={ops.homeworkDue} hint="Assignments not past due" href="/homework" />
        </div>

        <div className="grid items-start gap-5 lg:grid-cols-2">
          {/* Finance — only present when the caller has fees:read */}
          {finance ? (
            <Panel
              title="Fees"
              action={<Link href="/fees" className="text-[12.5px] font-bold text-brand-600 hover:underline dark:text-brand-300">Open fees</Link>}
            >
              <div className="grid grid-cols-2 gap-px bg-line">
                <FinanceCell label="Collected today" value={inr(finance.collectedToday)} tone="green" />
                <FinanceCell label="Outstanding" value={inr(finance.outstanding)} tone="amber" />
                <FinanceCell label="Pending invoices" value={String(finance.pendingInvoices)} />
                <FinanceCell label="Overdue invoices" value={String(finance.overdueInvoices)} tone={finance.overdueInvoices > 0 ? "red" : undefined} />
              </div>
            </Panel>
          ) : (
            <Panel title="Fees">
              <div className="p-5">
                <EmptyState message="You don't have access to fee figures" />
              </div>
            </Panel>
          )}

          {/* Communication */}
          <Panel
            title="Recent announcements"
            action={<Link href="/announcements" className="text-[12.5px] font-bold text-brand-600 hover:underline dark:text-brand-300">View all</Link>}
          >
            {communication.recentAnnouncements.length === 0 ? (
              <div className="p-5">
                <EmptyState message="No announcements yet" />
              </div>
            ) : (
              <ul>
                {communication.recentAnnouncements.map((a) => (
                  <li
                    key={a.id}
                    className={cx(
                      "flex items-start gap-3 border-b border-line px-5 py-3.5 last:border-0",
                      a.isPinned && "db-ann--pinned"
                    )}
                  >
                    <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-brand-500/12 text-brand-600 dark:text-brand-300">
                      <Icon name="megaphone" className="h-[17px] w-[17px]" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <h4 className="truncate text-sm font-bold text-ink">{a.title}</h4>
                        {a.isPinned && <Badge tone="amber">Pinned</Badge>}
                      </div>
                      <p className="db-ann-date mt-0.5 text-[11px] text-faint">
                        {new Date(a.publishedAt).toLocaleDateString()}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {communication.failedComms !== null && communication.failedComms > 0 && (
              <div className="border-t border-line px-5 py-3 text-[12.5px] font-semibold text-red-600 dark:text-red-400">
                {communication.failedComms} failed communication{communication.failedComms === 1 ? "" : "s"} — check delivery logs
              </div>
            )}
          </Panel>
        </div>
      </div>
    </>
  );
}

function FinanceCell({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "green" | "amber" | "red";
}) {
  const toneCls =
    tone === "green"
      ? "text-emerald-600 dark:text-emerald-400"
      : tone === "amber"
      ? "text-amber-600 dark:text-amber-400"
      : tone === "red"
      ? "text-red-600 dark:text-red-400"
      : "text-ink";
  return (
    <div className="db-finance-cell bg-surface p-5">
      <div className="text-[12px] font-semibold text-muted">{label}</div>
      <div data-numeric className={cx("mt-1 text-[20px] font-extrabold tracking-tight", toneCls)}>{value}</div>
    </div>
  );
}
