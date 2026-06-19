"use client";

import Link from "next/link";
import { usePermissions } from "@/lib/use-permissions";
import { EmptyState, PageHeader, Spinner } from "@/components/ui";
import ScheduleForm from "../_form";

export default function NewScheduledReportPage() {
  const { can, loading } = usePermissions();

  if (loading) {
    return (
      <>
        <PageHeader
          title="New schedule"
          subtitle="Schedule a saved report"
        />
        <Spinner />
      </>
    );
  }

  if (!can("scheduled_reports:create")) {
    return (
      <>
        <PageHeader
          title="New schedule"
          subtitle="Schedule a saved report"
        />
        <EmptyState message="You don't have permission to create scheduled reports." />
      </>
    );
  }

  return (
    <>
      <PageHeader title="New schedule" subtitle="Schedule a saved report" />
      <div className="mb-4">
        <Link
          href="/scheduled-reports"
          className="text-sm font-medium text-brand-600 hover:text-brand-700"
        >
          ← Back to Scheduled Reports
        </Link>
      </div>
      <ScheduleForm />
    </>
  );
}
