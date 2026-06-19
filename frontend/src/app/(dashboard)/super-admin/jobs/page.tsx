"use client";

import { PageHeader } from "@/components/ui";
import { JobsConsole } from "../../_jobs/JobsConsole";
import { usePlatformGuard } from "../platform/_guard";

export default function SuperAdminJobsPage() {
  const { ready, gate } = usePlatformGuard(
    "Background jobs",
    "Cross-tenant queue, scheduling & processing"
  );

  if (!ready) return gate;

  return (
    <>
      <PageHeader
        title="Background jobs"
        subtitle="Cross-tenant queue, scheduling & processing"
      />
      <JobsConsole />
    </>
  );
}
