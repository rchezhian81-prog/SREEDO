"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import { usePermissions } from "@/lib/use-permissions";
import { EmptyState, ErrorNote, PageHeader, Spinner } from "@/components/ui";
import type { CustomReport } from "@/types";
import ReportBuilderForm from "../../_builder";

export default function EditReportPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const { can, loading: permsLoading } = usePermissions();

  const [definition, setDefinition] = useState<CustomReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setLoadError(null);
    api
      .get<CustomReport>(`/custom-reports/${id}`)
      .then(setDefinition)
      .catch((err) =>
        setLoadError(
          err instanceof ApiError ? err.message : "Failed to load report"
        )
      )
      .finally(() => setLoading(false));
  }, [id]);

  if (permsLoading || loading) {
    return (
      <>
        <PageHeader title="Edit report" subtitle="Update a custom report" />
        <Spinner />
      </>
    );
  }

  if (!can("custom_reports:update")) {
    return (
      <>
        <PageHeader title="Edit report" subtitle="Update a custom report" />
        <EmptyState message="You don't have permission to edit reports." />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Edit report"
        subtitle={definition?.name ?? "Update a custom report"}
      />
      <div className="mb-4">
        <Link
          href="/report-builder"
          className="text-sm font-medium text-brand-600 hover:text-brand-700"
        >
          ← Back to Report Builder
        </Link>
      </div>
      {loadError ? (
        <ErrorNote message={loadError} />
      ) : definition ? (
        <ReportBuilderForm existing={definition} />
      ) : null}
    </>
  );
}
