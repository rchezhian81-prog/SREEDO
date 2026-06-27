import type { ScheduledReportRunStatus } from "@/types";

export function runStatusTone(
  status: ScheduledReportRunStatus
): "slate" | "green" | "amber" | "red" | "blue" {
  switch (status) {
    case "success":
      return "green";
    case "failed":
      return "red";
    case "running":
    case "pending":
    case "skipped":
      return "amber";
    default:
      return "slate";
  }
}

export function formatDateTime(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}
