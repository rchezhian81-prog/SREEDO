// Presentation surface for the Data Export Center: status / approval → Badge tone
// + label, the scope registry (mirrors the backend SCOPE_SOURCES metadata) and the
// shared date / id formatters. No JSX so every console component can import these.
// Byte / number formatting lives in the shared platform `_utils`.

import type {
  ExportApprovalStatus,
  ExportFormat,
  ExportScope,
  ExportStatus,
  PlatformExport,
} from "@/types";

/** Badge tones the shared UI supports. */
export type Tone = "slate" | "green" | "amber" | "red" | "blue";

// ---- export status → tone / label ----
// completed→green, running/pending→amber, failed→red, expired/cancelled→slate.
export function exportStatusTone(status: ExportStatus | string | null | undefined): Tone {
  switch (status) {
    case "completed":
      return "green";
    case "running":
    case "pending":
      return "amber";
    case "failed":
      return "red";
    case "expired":
    case "cancelled":
    default:
      return "slate";
  }
}

// ---- approval status → tone / label ----
// pending→amber, approved→green, rejected→red, rest→slate.
export function approvalTone(status: ExportApprovalStatus | string | null | undefined): Tone {
  switch (status) {
    case "pending":
      return "amber";
    case "approved":
      return "green";
    case "rejected":
      return "red";
    case "not_required":
    case "cancelled":
    case "expired":
    default:
      return "slate";
  }
}

export function approvalLabel(status: ExportApprovalStatus | string | null | undefined): string {
  switch (status) {
    case "not_required":
      return "Not required";
    case "pending":
      return "Pending approval";
    case "approved":
      return "Approved";
    case "rejected":
      return "Rejected";
    case "cancelled":
      return "Cancelled";
    case "expired":
      return "Expired";
    default:
      return "—";
  }
}

// ---- scope registry ----
// Mirrors backend SCOPE_SOURCES: which scopes are sensitive (reason required),
// which always require a second-admin approval, and which cannot be produced as a
// standalone platform export (only per-tenant, via the Data Portability Pack).

export interface ScopeMeta {
  value: ExportScope;
  label: string;
  /** Personal / security / broad data — a reason is required. */
  sensitive: boolean;
  /** Always needs a second super-admin's approval before generating. */
  approval: boolean;
  /** Cannot be exported standalone — only per-tenant via the Portability Pack. */
  unavailable: boolean;
}

const SCOPES: ScopeMeta[] = [
  { value: "institutions", label: "Institutions", sensitive: false, approval: false, unavailable: false },
  { value: "platform_admins", label: "Platform admins", sensitive: true, approval: true, unavailable: false },
  { value: "tenant_users", label: "Tenant users", sensitive: true, approval: false, unavailable: false },
  { value: "invoices", label: "Invoices", sensitive: false, approval: false, unavailable: false },
  { value: "subscriptions", label: "Subscriptions", sensitive: false, approval: false, unavailable: false },
  { value: "packages", label: "Subscription packages", sensitive: false, approval: false, unavailable: false },
  { value: "coupons", label: "Coupons", sensitive: false, approval: false, unavailable: false },
  { value: "payments", label: "Payments", sensitive: true, approval: false, unavailable: false },
  { value: "audit_logs", label: "Audit logs", sensitive: true, approval: true, unavailable: false },
  { value: "security_reports", label: "Security reports", sensitive: true, approval: true, unavailable: false },
  { value: "support_history", label: "Support access history", sensitive: true, approval: true, unavailable: false },
  { value: "backup_metadata", label: "Backup metadata", sensitive: true, approval: true, unavailable: false },
  { value: "documents_metadata", label: "Document metadata", sensitive: false, approval: false, unavailable: false },
  { value: "students", label: "Students", sensitive: true, approval: false, unavailable: true },
  { value: "staff", label: "Staff", sensitive: true, approval: false, unavailable: true },
  { value: "fees", label: "Fees", sensitive: false, approval: false, unavailable: true },
  { value: "attendance", label: "Attendance", sensitive: false, approval: false, unavailable: true },
  { value: "exams", label: "Exams", sensitive: false, approval: false, unavailable: true },
  { value: "portability_pack", label: "Portability pack", sensitive: true, approval: false, unavailable: false },
];

export const SCOPE_LIST: ScopeMeta[] = SCOPES;

const SCOPE_BY_VALUE: Record<string, ScopeMeta> = Object.fromEntries(
  SCOPES.map((s) => [s.value, s])
);

export function scopeMeta(scope: ExportScope | string | null | undefined): ScopeMeta | undefined {
  return scope ? SCOPE_BY_VALUE[scope] : undefined;
}

export function scopeLabel(scope: ExportScope | string | null | undefined): string {
  return scopeMeta(scope)?.label ?? humanizeToken(scope);
}

/** Scopes that can be created as a standalone export (excludes portability_pack). */
export const CREATE_SCOPES = SCOPES.filter((s) => s.value !== "portability_pack");

/** Scopes valid for a recurring schedule (standalone + available only). */
export const SCHEDULE_SCOPES = SCOPES.filter((s) => !s.unavailable && s.value !== "portability_pack");

export const EXPORT_FORMATS: ExportFormat[] = ["csv", "xlsx", "json", "zip"];

export const EXPORT_STATUSES: ExportStatus[] = [
  "pending",
  "running",
  "completed",
  "failed",
  "expired",
  "cancelled",
];

export const APPROVAL_STATUSES: ExportApprovalStatus[] = [
  "not_required",
  "pending",
  "approved",
  "rejected",
  "cancelled",
  "expired",
];

export function formatLabel(format: ExportFormat | string | null | undefined): string {
  return format ? String(format).toUpperCase() : "—";
}

/** Humanise a snake_case token, capitalising the first word ("audit_logs" → "Audit logs"). */
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

/** Friendly label for an `export.*` audit action ("export.portability_generated" → "Portability generated"). */
export function actionLabel(action: string | null | undefined): string {
  if (!action) return "—";
  return humanizeToken(action.replace(/^export\./, ""));
}

/** Render an ISO timestamp as a locale date+time, or "—" when absent/invalid. */
export function formatDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString();
}

/** Short 8-char prefix of a UUID for compact display. */
export function shortId(id: string | null | undefined): string {
  return id ? id.slice(0, 8) : "—";
}

/** File extension for an export format (matches the backend FORMAT_META). */
export function formatExt(format: ExportFormat | string | null | undefined): string {
  switch (format) {
    case "xlsx":
      return "xlsx";
    case "json":
      return "json";
    case "zip":
      return "zip";
    default:
      return "csv";
  }
}

/** True when a completed export is within ~24h of its retention expiry. */
export function isNearingExpiry(row: Pick<PlatformExport, "status" | "expiresAt">): boolean {
  if (row.status !== "completed" || !row.expiresAt) return false;
  const expires = new Date(row.expiresAt).getTime();
  if (Number.isNaN(expires)) return false;
  return expires < Date.now() + 24 * 60 * 60 * 1000;
}

/** A completed, un-archived, un-expired export with a stored artifact is downloadable. */
export function isDownloadable(row: PlatformExport): boolean {
  if (row.status !== "completed" || !row.hasArtifact || row.archivedAt) return false;
  if (row.expiresAt && new Date(row.expiresAt).getTime() < Date.now()) return false;
  return true;
}
