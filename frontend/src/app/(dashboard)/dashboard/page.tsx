"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import {
  Badge,
  Card,
  EmptyState,
  PageHeader,
  Spinner,
} from "@/components/ui";
import type { Announcement, DashboardStats, Paginated } from "@/types";

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

export default function DashboardPage() {
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
  const attendanceLabel =
    attendance && attendance.marked > 0
      ? `${Math.round((attendance.rate ?? 0) * 100)}%`
      : "—";

  return (
    <>
      <PageHeader
        title="Dashboard"
        subtitle="A live overview of the school today"
      />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Active students" value={stats?.activeStudents ?? 0} />
        <StatCard label="Teachers" value={stats?.activeTeachers ?? 0} />
        <StatCard
          label="Attendance today"
          value={attendanceLabel}
          hint={
            attendance && attendance.marked > 0
              ? `${attendance.present} of ${attendance.marked} marked present`
              : "Not marked yet"
          }
        />
        <StatCard
          label="Pending invoices"
          value={stats?.fees.pendingInvoices ?? 0}
          hint={`Collected ${stats?.fees.totalCollected.toLocaleString() ?? 0} of ${stats?.fees.totalInvoiced.toLocaleString() ?? 0}`}
        />
      </div>

      <h2 className="mb-3 mt-8 text-lg font-semibold text-slate-900">
        Recent announcements
      </h2>
      {announcements.length === 0 ? (
        <EmptyState message="No announcements yet" />
      ) : (
        <div className="space-y-3">
          {announcements.map((announcement) => (
            <Card key={announcement.id}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="font-medium text-slate-900">
                    {announcement.title}
                  </h3>
                  <p className="mt-1 line-clamp-2 text-sm text-slate-600">
                    {announcement.body}
                  </p>
                </div>
                {announcement.isPinned && <Badge tone="amber">Pinned</Badge>}
              </div>
              <p className="mt-2 text-xs text-slate-400">
                {new Date(announcement.publishedAt).toLocaleDateString()} ·{" "}
                {announcement.createdByName ?? "System"}
              </p>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
