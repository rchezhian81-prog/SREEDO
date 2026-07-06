// Presentation surface for the Background Jobs console (Super Admin M): status /
// attempt / worker / schedule / severity → Badge tone + human labels, the enum
// registries (mirroring the backend jobsops.schema CHECK sets) and the shared
// date / id / duration formatters + the reason-gated download helper. No JSX, so
// every tab component can import these. Number formatting lives in the shared
// platform `_utils`.

import { ApiError } from "@/lib/api";
import { useAuthStore } from "@/stores/auth-store";
import type {
  JobAlertSeverity,
  JobAlertStatus,
  JobAttemptStatus,
  JobFilterStatus,
  JobOpsStatus,
  JobWindow,
  ScheduleSource,
  SourceModule,
  WorkerStatus,
} from "@/types";

/** Badge tones the shared UI supports. */
export type Tone = "slate" | "green" | "amber" | "red" | "blue";

// ---- job status → tone -----------------------------------------------------
export function jobStatusTone(status: JobFilterStatus | string | null | undefined): Tone {
  switch (status) {
    case "running":
      return "blue";
    case "success":
      return "green";
    case "failed":
    case "dead_letter":
      return "red";
    case "stuck":
      return "amber";
    case "pending":
    case "cancelled":
    default:
      return "slate";
  }
}

// ---- attempt status → tone -------------------------------------------------
export function attemptStatusTone(status: JobAttemptStatus | string | null | undefined): Tone {
  switch (status) {
    case "running":
      return "blue";
    case "success":
      return "green";
    case "failed":
    case "dead_letter":
      return "red";
    case "retry":
      return "amber";
    case "cancelled":
    default:
      return "slate";
  }
}

// ---- worker liveness → tone ------------------------------------------------
export function workerStatusTone(status: WorkerStatus | string | null | undefined): Tone {
  switch (status) {
    case "online":
      return "green";
    case "degraded":
      return "amber";
    case "offline":
      return "red";
    default:
      return "slate";
  }
}

// ---- schedule status → tone ------------------------------------------------
export function scheduleStatusTone(status: string | null | undefined): Tone {
  switch (status) {
    case "active":
      return "green";
    case "paused":
      return "slate";
    default:
      return "slate";
  }
}

// ---- last-run status → tone (success/completed vs failed) ------------------
export function runStatusTone(status: string | null | undefined): Tone {
  if (!status) return "slate";
  const s = status.toLowerCase();
  if (["success", "completed", "ok"].includes(s)) return "green";
  if (["failed", "error", "dead_letter"].includes(s)) return "red";
  if (["running", "pending", "queued"].includes(s)) return "blue";
  return "slate";
}

// ---- alert severity → tone -------------------------------------------------
export function severityTone(severity: JobAlertSeverity | string | null | undefined): Tone {
  switch (severity) {
    case "critical":
      return "red";
    case "major":
      return "amber";
    case "minor":
      return "blue";
    default:
      return "slate";
  }
}

// ---- alert status → tone ---------------------------------------------------
export function alertStatusTone(status: JobAlertStatus | string | null | undefined): Tone {
  switch (status) {
    case "triggered":
      return "red";
    case "acknowledged":
      return "amber";
    case "resolved":
      return "green";
    case "suppressed":
    default:
      return "slate";
  }
}

// ---- enum registries (mirror the backend schema) ---------------------------

export const JOB_STATUSES: JobOpsStatus[] = [
  "pending",
  "running",
  "success",
  "failed",
  "cancelled",
  "dead_letter",
];
export const JOB_FILTER_STATUSES: JobFilterStatus[] = [...JOB_STATUSES, "stuck"];
export const SOURCE_MODULES: SourceModule[] = [
  "Reports",
  "Communication",
  "Backup",
  "Export",
  "Integrations",
  "Observability",
  "System",
  "Other",
];
export const JOB_SORTS = ["created_at", "started_at", "completed_at", "status", "attempts"] as const;
export type JobSort = (typeof JOB_SORTS)[number];
export const ALERT_STATUSES: JobAlertStatus[] = [
  "triggered",
  "acknowledged",
  "resolved",
  "suppressed",
];
export const ALERT_SEVERITIES: JobAlertSeverity[] = ["info", "minor", "major", "critical"];
export const JOB_WINDOWS: JobWindow[] = ["today", "24h", "7d", "30d", "custom"];
export const SCHEDULE_SOURCES: ScheduleSource[] = ["reports", "backup", "export", "system"];

const JOB_STATUS_LABELS: Record<string, string> = {
  pending: "Pending",
  running: "Running",
  success: "Completed",
  failed: "Failed",
  cancelled: "Cancelled",
  dead_letter: "Dead-letter",
  stuck: "Stuck",
};
const SORT_LABELS: Record<JobSort, string> = {
  created_at: "Created",
  started_at: "Started",
  completed_at: "Completed",
  status: "Status",
  attempts: "Attempts",
};
const WINDOW_LABELS: Record<JobWindow, string> = {
  today: "Today",
  "24h": "24h",
  "7d": "7d",
  "30d": "30d",
  custom: "Custom",
};

export function jobStatusLabel(status: string | null | undefined): string {
  return (status && JOB_STATUS_LABELS[status]) || humanizeToken(status);
}
export function sortLabel(sort: JobSort): string {
  return SORT_LABELS[sort];
}
export function windowLabel(w: JobWindow): string {
  return WINDOW_LABELS[w];
}

// ---- formatters ------------------------------------------------------------

/** Humanise a snake_case token, capitalising the first word. */
export function humanizeToken(token: string | null | undefined): string {
  if (!token) return "—";
  const s = token.replace(/_/g, " ").trim();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : "—";
}

/** Capitalise a single-word token. */
export function titleCase(value: string | null | undefined): string {
  if (!value) return "—";
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/** ISO timestamp → locale date+time, or "—" when absent/invalid. */
export function formatDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString();
}

/** Exact milliseconds label ("—" when null). */
export function formatMs(value: number | null | undefined): string {
  if (value == null) return "—";
  return `${Math.round(value).toLocaleString()} ms`;
}

/** Human-friendly duration from milliseconds (e.g. "1.4 s", "3m 5s", "2h 1m"). */
export function formatDuration(ms: number | null | undefined): string {
  if (ms == null || Number.isNaN(ms)) return "—";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  const s = Math.round(ms / 100) / 10;
  if (ms < 60_000) return `${s} s`;
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const rem = totalSec % 60;
  if (ms < 3_600_000) return `${m}m ${rem}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

/** Duration between two ISO timestamps, if both present. */
export function durationBetween(
  startedAt: string | null | undefined,
  completedAt: string | null | undefined
): string {
  if (!startedAt || !completedAt) return "—";
  const a = new Date(startedAt).getTime();
  const b = new Date(completedAt).getTime();
  if (Number.isNaN(a) || Number.isNaN(b) || b < a) return "—";
  return formatDuration(b - a);
}

/** Short 8-char prefix of a UUID for compact display. */
export function shortId(id: string | null | undefined): string {
  return id ? id.slice(0, 8) : "—";
}

/** Loose UUID guard so we never send a malformed institution filter (which the
 *  backend rejects with a 400 that would blank the whole list). */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isUuid(value: string | null | undefined): boolean {
  return !!value && UUID_RE.test(value.trim());
}

/** File extension for an export format. */
export function formatExt(format: string): string {
  return format === "xlsx" ? "xlsx" : "csv";
}

/** Map a bare backend link to the real super-admin console route. */
export function superAdminHref(backendPath: string | null | undefined): string {
  switch (backendPath) {
    case "/observability":
      return "/super-admin/observability";
    case "/platform/security":
      return "/super-admin/security";
    case "/platform/audit":
      return "/super-admin/platform/audit";
    case "/jobs":
      return "/super-admin/jobs";
    default:
      return `/super-admin${backendPath ?? ""}`;
  }
}

// ---- reason-gated file download (jobs export) ------------------------------

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api/v1";

/**
 * Reason-gated blob download (the one sanctioned `fetch` exception). Streams the
 * masked CSV/XLSX artifact using the stored access token, then triggers a browser
 * save as `filename`. Throws ApiError on a non-OK response so callers surface it.
 */
export async function downloadFile(path: string, filename: string): Promise<void> {
  const token = useAuthStore.getState().accessToken;
  const res = await fetch(`${API_URL}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) {
    let message = res.statusText;
    try {
      const d = await res.json();
      if (typeof d.error === "string") message = d.error;
    } catch {
      /* non-JSON error body — keep statusText */
    }
    throw new ApiError(res.status, message);
  }
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
