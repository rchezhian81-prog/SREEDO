"use client";

import Link from "next/link";
import { usePermissions } from "@/lib/use-permissions";
import { EmptyState, PageHeader, Spinner } from "@/components/ui";
import ReportBuilderForm from "../_builder";

export default function NewReportPage() {
  const { can, loading } = usePermissions();

  if (loading) {
    return (
      <>
        <PageHeader title="New report" subtitle="Build a custom report" />
        <Spinner />
      </>
    );
  }

  if (!can("custom_reports:create")) {
    return (
      <>
        <PageHeader title="New report" subtitle="Build a custom report" />
        <EmptyState message="You don't have permission to create reports." />
      </>
    );
  }

  return (
    <>
      <PageHeader title="New report" subtitle="Build a custom report" />
      <div className="mb-4">
        <Link
          href="/report-builder"
          className="text-sm font-medium text-brand-600 hover:text-brand-700"
        >
          ← Back to Report Builder
        </Link>
      </div>
      <ReportBuilderForm />
    </>
  );
}
