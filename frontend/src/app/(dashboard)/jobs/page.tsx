"use client";

import { usePermissions } from "@/lib/use-permissions";
import { EmptyState, PageHeader, Spinner } from "@/components/ui";
import { JobsConsole } from "../_jobs/JobsConsole";

export default function JobsPage() {
  const { can, loading } = usePermissions();

  if (loading) {
    return (
      <>
        <PageHeader
          title="Background Jobs"
          subtitle="Queued tasks, scheduling & processing"
        />
        <Spinner />
      </>
    );
  }

  if (!can("jobs:read")) {
    return (
      <>
        <PageHeader
          title="Background Jobs"
          subtitle="Queued tasks, scheduling & processing"
        />
        <EmptyState message="You don't have access to background jobs." />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Background Jobs"
        subtitle="Queued tasks, scheduling & processing"
      />
      <JobsConsole />
    </>
  );
}
