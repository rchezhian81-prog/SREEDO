// Presentation surface for the Health & Observability console (Super Admin L):
// status → Badge tone + human labels, the enum registries (mirroring the backend
// CHECK constraints) and the shared date / id formatters + reason-gated download
// helper. No JSX, so every tab component can import these. Byte / number / uptime
// formatting lives in the shared platform `_utils`.

import { ApiError } from "@/lib/api";
import { useAuthStore } from "@/stores/auth-store";
import type {
  AlertRuleType,
  AlertStatus,
  ErrorTriageStatus,
  IncidentSeverity,
  IncidentStatus,
  IncidentType,
  ServiceStatus,
} from "@/types";

/** Badge tones the shared UI supports. */
export type Tone = "slate" | "green" | "amber" | "red" | "blue";

// ---- service status → tone -------------------------------------------------
// healthy→green, degraded→amber, down→red, unknown→slate.
export function serviceStatusTone(status: ServiceStatus | string | null | undefined): Tone {
  switch (status) {
    case "healthy":
      return "green";
    case "degraded":
      return "amber";
    case "down":
      return "red";
    default:
      return "slate";
  }
}

// ---- severity (incidents + alerts) → tone ----------------------------------
// critical→red, major→amber, minor→blue, info→slate.
export function severityTone(severity: IncidentSeverity | string | null | undefined): Tone {
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

// ---- incident status → tone ------------------------------------------------
export function incidentStatusTone(status: IncidentStatus | string | null | undefined): Tone {
  switch (status) {
    case "open":
      return "red";
    case "investigating":
      return "amber";
    case "monitoring":
      return "blue";
    case "resolved":
      return "green";
    case "closed":
    default:
      return "slate";
  }
}

// ---- alert status → tone ---------------------------------------------------
export function alertStatusTone(status: AlertStatus | string | null | undefined): Tone {
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

// ---- error triage status → tone --------------------------------------------
export function errorStatusTone(status: ErrorTriageStatus | string | null | undefined): Tone {
  switch (status) {
    case "new":
      return "red";
    case "investigating":
      return "amber";
    case "resolved":
      return "green";
    case "ignored":
    default:
      return "slate";
  }
}

// ---- incident-timeline kind → tone -----------------------------------------
export function timelineKindTone(kind: string | null | undefined): Tone {
  switch (kind) {
    case "resolved":
      return "green";
    case "reopened":
    case "severity_change":
      return "amber";
    case "created":
    case "status_change":
    case "assigned":
      return "blue";
    default:
      return "slate";
  }
}

// ---- HTTP status class → tone ----------------------------------------------
export function statusClassTone(cls: string | null | undefined): Tone {
  if (!cls) return "slate";
  if (cls.startsWith("5")) return "red";
  if (cls.startsWith("4")) return "amber";
  if (cls.startsWith("2")) return "green";
  return "blue";
}

// ---- enum registries (mirror the backend schema) ---------------------------

export const INCIDENT_SEVERITIES: IncidentSeverity[] = ["info", "minor", "major", "critical"];
export const INCIDENT_STATUSES: IncidentStatus[] = [
  "open",
  "investigating",
  "monitoring",
  "resolved",
  "closed",
];
export const INCIDENT_TYPES: IncidentType[] = [
  "api",
  "database",
  "frontend",
  "worker",
  "email",
  "storage",
  "backup",
  "payment",
  "security",
  "other",
];
export const ALERT_RULE_TYPES: AlertRuleType[] = [
  "api_down",
  "db_down",
  "mongo_down",
  "worker_down",
  "scheduler_stalled",
  "queue_depth_high",
  "job_failure_spike",
  "error_rate_high",
  "latency_high",
  "smtp_failures",
  "storage_high",
  "backup_failed",
  "gateway_degraded",
  "disk_low",
  "memory_high",
  "security_event",
];
export const ALERT_STATUSES: AlertStatus[] = [
  "triggered",
  "acknowledged",
  "resolved",
  "suppressed",
];
export const ERROR_TRIAGE_STATUSES: ErrorTriageStatus[] = [
  "new",
  "investigating",
  "resolved",
  "ignored",
];

const INCIDENT_TYPE_LABELS: Record<string, string> = {
  api: "API",
  database: "Database",
  frontend: "Frontend",
  worker: "Worker",
  email: "Email",
  storage: "Storage",
  backup: "Backup",
  payment: "Payment",
  security: "Security",
  other: "Other",
};

const ALERT_RULE_TYPE_LABELS: Record<string, string> = {
  api_down: "API down",
  db_down: "Database down",
  mongo_down: "MongoDB down",
  worker_down: "Worker down",
  scheduler_stalled: "Scheduler stalled",
  queue_depth_high: "Queue depth high",
  job_failure_spike: "Job failure spike",
  error_rate_high: "Error rate high",
  latency_high: "Latency high",
  smtp_failures: "SMTP failures",
  storage_high: "Storage high",
  backup_failed: "Backup failed",
  gateway_degraded: "Gateway degraded",
  disk_low: "Disk low",
  memory_high: "Memory high",
  security_event: "Security event",
};

export function incidentTypeLabel(type: string | null | undefined): string {
  return (type && INCIDENT_TYPE_LABELS[type]) || humanizeToken(type);
}

export function alertRuleTypeLabel(type: string | null | undefined): string {
  return (type && ALERT_RULE_TYPE_LABELS[type]) || humanizeToken(type);
}

// ---- formatters ------------------------------------------------------------

/** Humanise a snake_case token, capitalising the first word ("api_down" → "Api down"). */
export function humanizeToken(token: string | null | undefined): string {
  if (!token) return "—";
  const s = token.replace(/_/g, " ").trim();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : "—";
}

/** Capitalise a single-word status token. */
export function titleCase(value: string | null | undefined): string {
  if (!value) return "—";
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/** Render an ISO timestamp as a locale date+time, or "—" when absent/invalid. */
export function formatDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString();
}

/** Milliseconds → short label ("—" when null). */
export function formatMs(value: number | null | undefined): string {
  if (value == null) return "—";
  return `${Math.round(value).toLocaleString()} ms`;
}

/** A uptime/usage percentage → "98.5%" ("—" when null). */
export function formatPct(value: number | null | undefined): string {
  if (value == null) return "—";
  return `${value}%`;
}

/** Short 8-char prefix of a UUID for compact display. */
export function shortId(id: string | null | undefined): string {
  return id ? id.slice(0, 8) : "—";
}

/** Friendly label for a `super-admin` route the backend hints at. Maps the
 *  bare backend links to the real console routes. Security lives at
 *  /super-admin/security (not /platform/security). */
export function superAdminHref(backendPath: string | null | undefined): string {
  switch (backendPath) {
    case "/backups":
      return "/super-admin/backups";
    case "/exports":
      return "/super-admin/exports";
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

// ---- reason-gated file download (alerts + logs exports) --------------------

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api/v1";

/** File extension for an export format. */
export function formatExt(format: string): string {
  return format === "xlsx" ? "xlsx" : "csv";
}

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
