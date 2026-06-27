"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { cx, EmptyState, PageHeader, Spinner } from "@/components/ui";
import { Icon, type IconName } from "@/components/icons";
import { useAuthStore } from "@/stores/auth-store";
import type { Announcement, DashboardStats, Paginated } from "@/types";
import { useI18n } from "@/i18n/I18nProvider";

const inr = (n: number | undefined) => "₹" + (n ?? 0).toLocaleString("en-IN");

const TONES: Record<string, string> = {
  blue: "bg-brand-500/12 text-brand-600 dark:text-brand-300",
  green: "bg-emerald-500/12 text-emerald-600 dark:text-emerald-400",
  amber: "bg-amber-500/12 text-amber-600 dark:text-amber-400",
  red: "bg-red-500/12 text-red-600 dark:text-red-400",
};

function StatCard({
  icon,
  tone,
  label,
  value,
  hint,
}: {
  icon: IconName;
  tone: keyof typeof TONES | string;
  label: string;
  value: string | number;
  hint?: string;
}) {
  return (
    <div className="flex flex-col gap-4 rounded-2xl border border-line bg-surface p-5 shadow-card">
      <div className="flex items-center gap-3.5">
        <div
          className={cx(
            "grid h-[52px] w-[52px] shrink-0 place-items-center rounded-2xl",
            TONES[tone] ?? TONES.blue
          )}
        >
          <Icon name={icon} className="h-6 w-6" />
        </div>
        <div className="min-w-0">
          <div className="text-[12.5px] font-semibold text-muted">{label}</div>
          <div className="mt-0.5 text-[26px] font-extrabold leading-none tracking-tight text-ink">
            {value}
          </div>
        </div>
      </div>
      {hint && (
        <div className="text-[12.5px] font-medium text-muted">{hint}</div>
      )}
    </div>
  );
}

function Panel({
  title,
  action,
  children,
  className,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cx(
        "overflow-hidden rounded-2xl border border-line bg-surface shadow-card",
        className
      )}
    >
      <div className="flex items-center justify-between border-b border-line px-5 py-4">
        <h3 className="text-[15px] font-bold text-ink">{title}</h3>
        {action}
      </div>
      {children}
    </div>
  );
}

function Donut({
  segments,
  size = 150,
  center,
}: {
  segments: { value: number; color: string }[];
  size?: number;
  center: React.ReactNode;
}) {
  const total = segments.reduce((sum, s) => sum + s.value, 0) || 1;
  let acc = 0;
  const stops = segments
    .map((s) => {
      const start = (acc / total) * 100;
      acc += s.value;
      const end = (acc / total) * 100;
      return `${s.color} ${start}% ${end}%`;
    })
    .join(", ");
  const hole = Math.round(size * 0.64);
  return (
    <div
      className="relative grid shrink-0 place-items-center rounded-full"
      style={{ width: size, height: size, background: `conic-gradient(${stops})` }}
    >
      <div
        className="absolute rounded-full bg-surface"
        style={{ width: hole, height: hole }}
      />
      <div className="relative text-center">{center}</div>
    </div>
  );
}

const QUICK_ACTIONS: { label: string; sub: string; icon: IconName; href: string }[] =
  [
    { label: "Add Student", sub: "Register a new student", icon: "userPlus", href: "/students" },
    { label: "Collect Fees", sub: "Record a fee payment", icon: "card", href: "/fees" },
    { label: "Mark Attendance", sub: "Today's attendance", icon: "calcheck", href: "/attendance" },
    { label: "New Announcement", sub: "Notify staff & parents", icon: "megaphone", href: "/announcements" },
    { label: "Manage Exams", sub: "Schedule & results", icon: "file", href: "/exams" },
  ];

export default function DashboardPage() {
  const { t } = useI18n();
  const user = useAuthStore((s) => s.user);
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      api.get<DashboardStats>("/dashboard/stats"),
      api.get<Paginated<Announcement>>("/announcements?limit=5"),
    ])
      .then(([statsData, announcementsData]) => {
        setStats(statsData);
        setAnnouncements(announcementsData.data);
      })
      .catch(() => undefined)
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <Spinner />;

  const attendance = stats?.attendanceToday;
  const marked = attendance?.marked ?? 0;
  const present = attendance?.present ?? 0;
  const absent = Math.max(0, marked - present);
  const ratePct =
    marked > 0 ? Math.round((attendance?.rate ?? 0) * 100) : null;

  const collected = stats?.fees.totalCollected ?? 0;
  const invoiced = stats?.fees.totalInvoiced ?? 0;
  const outstanding = Math.max(0, invoiced - collected);
  const collectedPct = invoiced > 0 ? Math.round((collected / invoiced) * 100) : 0;

  const firstName = user?.fullName?.split(" ")[0] ?? "there";

  return (
    <>
      <PageHeader
        title={t("pages.dashboard.title")}
        subtitle={`Welcome back, ${firstName}! Here's what's happening today.`}
        action={
          <Link
            href="/students"
            className="inline-flex items-center gap-2 rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white shadow-[0_8px_18px_rgb(37_99_235_/_0.32)] transition hover:bg-brand-700"
          >
            <Icon name="plus" className="h-4 w-4" />
            Add Student
          </Link>
        }
      />

      <div className="grid items-start gap-5 xl:grid-cols-[1fr_304px]">
        {/* Main column */}
        <div className="flex flex-col gap-5">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              icon="users"
              tone="blue"
              label="Active Students"
              value={(stats?.activeStudents ?? 0).toLocaleString("en-IN")}
              hint={`Across ${stats?.classes ?? 0} classes`}
            />
            <StatCard
              icon="board"
              tone="green"
              label="Teachers"
              value={(stats?.activeTeachers ?? 0).toLocaleString("en-IN")}
              hint="Active faculty members"
            />
            <StatCard
              icon="calcheck"
              tone="amber"
              label="Attendance Today"
              value={ratePct === null ? "—" : `${ratePct}%`}
              hint={
                marked > 0
                  ? `${present} of ${marked} marked present`
                  : "Not marked yet"
              }
            />
            <StatCard
              icon="wallet"
              tone="red"
              label="Fees Collected"
              value={inr(collected)}
              hint={`${collectedPct}% of ${inr(invoiced)} billed`}
            />
          </div>

          <div className="grid gap-5 lg:grid-cols-2">
            <Panel title="Fees Collection">
              <div className="flex items-center gap-5 p-5">
                <Donut
                  segments={[
                    { value: collected, color: "#2563eb" },
                    { value: outstanding, color: "#f59e0b" },
                  ]}
                  center={
                    <>
                      <div className="text-[20px] font-extrabold tracking-tight text-ink">
                        {collectedPct}%
                      </div>
                      <div className="text-[11.5px] font-semibold text-muted">
                        Collected
                      </div>
                    </>
                  }
                />
                <div className="flex-1 space-y-3">
                  <LegendRow color="#2563eb" name="Collected" value={inr(collected)} />
                  <LegendRow color="#f59e0b" name="Outstanding" value={inr(outstanding)} />
                  <div className="border-t border-line pt-3">
                    <LegendRow
                      name="Pending invoices"
                      value={String(stats?.fees.pendingInvoices ?? 0)}
                    />
                  </div>
                </div>
              </div>
            </Panel>

            <Panel title="Attendance Today">
              {marked > 0 ? (
                <div className="flex items-center gap-5 p-5">
                  <Donut
                    segments={[
                      { value: present, color: "#10b981" },
                      { value: absent, color: "#ef4444" },
                    ]}
                    center={
                      <>
                        <div className="text-[20px] font-extrabold tracking-tight text-ink">
                          {ratePct}%
                        </div>
                        <div className="text-[11.5px] font-semibold text-muted">
                          Present
                        </div>
                      </>
                    }
                  />
                  <div className="flex-1 space-y-3">
                    <LegendRow color="#10b981" name="Present" value={String(present)} />
                    <LegendRow color="#ef4444" name="Absent" value={String(absent)} />
                    <div className="border-t border-line pt-3">
                      <LegendRow name="Total marked" value={String(marked)} />
                    </div>
                  </div>
                </div>
              ) : (
                <div className="p-5">
                  <EmptyState message="Attendance has not been marked yet today" />
                </div>
              )}
            </Panel>
          </div>

          <Panel
            title="Recent Announcements"
            action={
              <Link
                href="/announcements"
                className="text-[12.5px] font-bold text-brand-600 hover:underline dark:text-brand-300"
              >
                View All
              </Link>
            }
          >
            {announcements.length === 0 ? (
              <div className="p-5">
                <EmptyState message="No announcements yet" />
              </div>
            ) : (
              <ul>
                {announcements.map((a) => (
                  <li
                    key={a.id}
                    className="flex items-start gap-3 border-b border-line px-5 py-4 last:border-0"
                  >
                    <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-brand-500/12 text-brand-600 dark:text-brand-300">
                      <Icon name="megaphone" className="h-[18px] w-[18px]" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <h4 className="truncate text-sm font-bold text-ink">
                          {a.title}
                        </h4>
                        {a.isPinned && (
                          <span className="rounded-full bg-amber-500/12 px-2 py-0.5 text-[10px] font-bold text-amber-600 dark:text-amber-400">
                            Pinned
                          </span>
                        )}
                      </div>
                      <p className="mt-0.5 line-clamp-1 text-[13px] text-muted">
                        {a.body}
                      </p>
                      <p className="mt-1 text-[11px] text-faint">
                        {new Date(a.publishedAt).toLocaleDateString()} ·{" "}
                        {a.createdByName ?? "System"}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>

        {/* Right rail */}
        <div className="flex flex-col gap-5">
          <Panel title="Quick Actions">
            {QUICK_ACTIONS.map((qa) => (
              <Link
                key={qa.href}
                href={qa.href}
                className="flex items-center gap-3 border-b border-line px-5 py-3.5 transition last:border-0 hover:bg-surface-2"
              >
                <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-500/12 text-brand-600 dark:text-brand-300">
                  <Icon name={qa.icon} className="h-[19px] w-[19px]" />
                </div>
                <div className="min-w-0">
                  <div className="text-[13.5px] font-bold text-ink">
                    {qa.label}
                  </div>
                  <div className="text-[11.5px] text-muted">{qa.sub}</div>
                </div>
                <Icon
                  name="chevronRight"
                  className="ml-auto h-[17px] w-[17px] text-faint"
                />
              </Link>
            ))}
          </Panel>

          <Panel title="Notifications">
            {announcements.length === 0 ? (
              <div className="p-5">
                <EmptyState message="You're all caught up" />
              </div>
            ) : (
              announcements.slice(0, 4).map((a) => (
                <div
                  key={a.id}
                  className="flex gap-3 border-b border-line px-5 py-4 last:border-0"
                >
                  <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-brand-500/12 text-brand-600 dark:text-brand-300">
                    <Icon name="bell" className="h-[17px] w-[17px]" />
                  </div>
                  <div className="min-w-0">
                    <div className="line-clamp-2 text-[12.5px] font-semibold text-ink">
                      {a.title}
                    </div>
                    <div className="mt-1 text-[11px] text-faint">
                      {new Date(a.publishedAt).toLocaleDateString()}
                    </div>
                  </div>
                </div>
              ))
            )}
          </Panel>

          <div className="rounded-2xl border border-line bg-surface p-5 text-center shadow-card">
            <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-2xl bg-brand-500/12 text-brand-600 dark:text-brand-300">
              <Icon name="help" className="h-6 w-6" />
            </div>
            <div className="text-[14.5px] font-bold text-ink">Need Help?</div>
            <p className="mx-auto mt-1.5 max-w-[220px] text-[12.5px] text-muted">
              Read the guide to learn how to manage your school on GoCampus.
            </p>
            <button className="mt-3.5 inline-flex w-full items-center justify-center gap-2 rounded-xl border border-line bg-surface-2 px-4 py-2.5 text-[12.5px] font-bold text-ink transition hover:bg-hover">
              <Icon name="file" className="h-[15px] w-[15px]" />
              View Help Guide
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

function LegendRow({
  color,
  name,
  value,
}: {
  color?: string;
  name: string;
  value: string;
}) {
  return (
    <div className="flex items-center gap-2.5 text-[13px]">
      {color && (
        <span
          className="h-2.5 w-2.5 shrink-0 rounded"
          style={{ background: color }}
        />
      )}
      <span className="font-medium text-ink">{name}</span>
      <span className="ml-auto font-bold text-muted">{value}</span>
    </div>
  );
}
