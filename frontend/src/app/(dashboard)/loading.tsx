import { Spinner } from "@/components/ui";

/** Route-level loading fallback for the tenant dashboard (PR-T4). */
export default function DashboardLoading() {
  return (
    <div className="grid min-h-[50vh] place-items-center">
      <Spinner />
    </div>
  );
}
