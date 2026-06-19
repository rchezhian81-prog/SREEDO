"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import { usePermissions } from "@/lib/use-permissions";
import { EmptyState, ErrorNote, PageHeader, Spinner } from "@/components/ui";
import type { ScheduledReport } from "@/types";
import ScheduleForm from "../../_form";

export default function EditScheduledReportPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const { can, loading: permsLoading } = usePermissions();
  const canUpdate = can("scheduled_reports:update");

  const [schedule, setSchedule] = useState<ScheduledReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (permsLoading) return;
    if (!canUpdate) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setLoadError(null);
    api
      .get<ScheduledReport>(`/scheduled-reports/${id}`)
      .then(setSchedule)
      .catch((err) =>
        setLoadError(
          err instanceof ApiError ? err.message : "Failed to load schedule"
        )
      )
      .finally(() => setLoading(false));
  }, [id, permsLoading, canUpdate]);

  if (permsLoading || loading) {
    return (
      <>
        <PageHeader
          title="Edit schedule"
          subtitle="Update a scheduled report"
        />
        <Spinner />
      </>
    );
  }

  if (!canUpdate) {
    return (
      <>
        <PageHeader
          title="Edit schedule"
          subtitle="Update a scheduled report"
        />
        <EmptyState message="You don't have permission to edit scheduled reports." />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Edit schedule"
        subtitle={schedule?.name ?? "Update a scheduled report"}
      />
      <div className="mb-4">
        <Link
          href="/scheduled-reports"
          className="text-sm font-medium text-brand-600 hover:text-brand-700"
        >
          ← Back to Scheduled Reports
        </Link>
      </div>
      {loadError ? (
        <ErrorNote message={loadError} />
      ) : schedule ? (
        <ScheduleForm existing={schedule} />
      ) : null}
    </>
  );
}
