// Shared types, constants and helpers for the Super Admin P — Security &
// Compliance Center. Mirrors the fixed backend response shapes in
// backend/src/modules/platform/security.{routes,service,schema}.ts.

import { useAuthStore } from "@/stores/auth-store";

const API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api/v1";

// ---- Common ----
export type Tone = "slate" | "green" | "amber" | "red" | "blue";

/** Coarse time window shared by the dashboard, feed and reports. */
export type SecurityWindow = "today" | "7d" | "30d";

export const WINDOW_OPTIONS: { value: SecurityWindow; label: string }[] = [
  { value: "today", label: "Today" },
  { value: "7d", label: "7 days" },
  { value: "30d", label: "30 days" },
];

export interface Paged<T> {
  rows: T[];
  total: number;
  page: number;
  pageSize: number;
}

// ---- A. Dashboard summary + alerts ----
export interface SecuritySummary {
  window: string;
  platformAdminsTotal: number;
  platformAdminsWithout2fa: number;
  disabledPlatformAdmins: number;
  lockedAccounts: number;
  ownersWithout2fa: number;
  activePlatformSessions: number;
  failedLoginsToday: number;
  failedLoginsWeek: number;
  suspiciousLoginAttempts: number;
  activeSupportSessions: number;
  recentHighRiskRbac: number;
  recentHighRiskAudit: number;
  recent2faResets: number;
  recentSessionRevocations: number;
  lastExportAt: string | null;
  apiTokensActive: number;
}

export type AlertSeverity = "critical" | "warning" | "info";
export interface SecurityAlert {
  key: string;
  severity: AlertSeverity;
  title: string;
  detail: string;
  count: number;
  link: string;
}

// ---- B. 2FA enforcement ----
export type RoleKind = "built_in" | "custom";

export interface TwoFaPolicyRole {
  roleKey: string;
  name: string;
  kind: RoleKind;
  isOwner: boolean;
  require2fa: boolean;
  graceUntil: string | null;
  updatedByEmail: string | null;
  updatedAt: string | null;
  usersInRole: number;
  usersWithout2fa: number;
}
export interface TwoFaPolicy {
  forcePlatform: boolean;
  roles: TwoFaPolicyRole[];
}

export type ComplianceState = "compliant" | "grace" | "non_compliant" | "exempt";
export const COMPLIANCE_STATUSES: { value: string; label: string }[] = [
  { value: "all", label: "All states" },
  { value: "compliant", label: "Compliant" },
  { value: "non_compliant", label: "Non-compliant" },
  { value: "grace", label: "In grace" },
];

export interface ComplianceRow {
  id: string;
  fullName: string;
  email: string;
  platformRole: string | null;
  twoFactorEnabled: boolean;
  isOwner: boolean;
  required: boolean;
  graceUntil: string | null;
  state: ComplianceState;
}

// ---- C. Sessions ----
export interface SessionRow {
  id: string;
  userId: string;
  userName: string;
  email: string;
  platformRole: string | null;
  userAgent: string | null;
  ip: string | null;
  createdAt: string;
  lastUsedAt: string | null;
}

// ---- D. Login history + failed-login monitoring ----
export interface LoginHistoryRow {
  id: string;
  action: string;
  actorId: string | null;
  actorEmail: string | null;
  actorRole: string | null;
  ip: string | null;
  userAgent: string | null;
  reason: string | null;
  success: boolean;
  createdAt: string;
}
export interface FailedSummaryRow {
  key: string;
  attempts: number;
  distinctIps: number;
  lastAttemptAt: string | null;
}
export interface FailedSummary {
  by: "email" | "ip" | "day";
  window: string;
  rows: FailedSummaryRow[];
}

// ---- E. Locked accounts ----
export interface LockedAccount {
  id: string;
  fullName: string;
  email: string;
  platformRole: string | null;
  lockedUntil: string | null;
  failedLoginAttempts: number;
  manualLock: boolean;
  lastLoginAt: string | null;
  lockReason: string;
}

// ---- F. Password policy ----
export interface PasswordPolicy {
  minLength: number;
  requireComplexity: boolean;
  expiryDays: number | null;
  enforced: {
    minLength: number;
    passwordResetTtlMinutes: number;
    accessTokenTtl: string;
    refreshTokenTtlDays: number;
    lockout: { maxFailedAttempts: number; lockoutMinutes: number };
  };
}

// ---- G. IP allowlist ----
export interface IpAllowlistEntry {
  id: string;
  cidr: string;
  label: string;
  createdByEmail: string | null;
  createdAt: string;
}
export interface IpAllowlistState {
  enabled: boolean;
  currentIp: string | null;
  currentAllowed: boolean;
  entries: IpAllowlistEntry[];
}

// ---- H. API tokens ----
export type TokenStatus = "active" | "expired" | "revoked";
export interface ApiToken {
  id: string;
  name: string;
  description: string;
  tokenPrefix: string;
  scopes: string[];
  createdByEmail: string | null;
  expiresAt: string | null;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  status: TokenStatus;
}
/** The ONE-TIME reveal returned by create/rotate. `token` is shown once, never stored. */
export interface TokenReveal {
  id: string;
  token: string;
  tokenPrefix: string;
}

// ---- I. High-risk feed ----
export interface HighRiskRow {
  id: string;
  action: string;
  actorId: string | null;
  actorEmail: string | null;
  actorRole: string | null;
  targetType: string | null;
  targetId: string | null;
  ip: string | null;
  reason: string | null;
  detail: Record<string, unknown> | null;
  failed: boolean;
  createdAt: string;
}

export const HIGH_RISK_CATEGORIES: { value: string; label: string }[] = [
  { value: "all", label: "All categories" },
  { value: "rbac", label: "RBAC" },
  { value: "admins", label: "Platform admins" },
  { value: "impersonation", label: "Impersonation" },
  { value: "backups", label: "Backups / restore" },
  { value: "billing", label: "Billing" },
  { value: "settings", label: "Settings / security" },
  { value: "exports", label: "Exports" },
];

// ---- J. Compliance reports ----
export interface ReportColumn {
  key: string;
  label: string;
}
export interface ComplianceReport {
  report: string;
  columns: ReportColumn[];
  rows: Record<string, unknown>[];
  total: number;
  page: number;
  pageSize: number;
}

export const COMPLIANCE_REPORTS: { value: string; label: string; hint: string }[] =
  [
    {
      value: "platform_admin_access",
      label: "Platform admin access",
      hint: "Every platform admin, their role, status and 2FA.",
    },
    {
      value: "rbac_permissions",
      label: "RBAC permissions",
      hint: "Roles mapped to their granted permissions.",
    },
    {
      value: "twofa_compliance",
      label: "2FA compliance",
      hint: "Per-user two-factor compliance state.",
    },
    {
      value: "login_security",
      label: "Login security",
      hint: "Login successes/failures and distinct IPs per user.",
    },
    {
      value: "support_access",
      label: "Support access",
      hint: "Support / impersonation sessions and their targets.",
    },
    {
      value: "audit_activity",
      label: "Audit activity",
      hint: "High-risk audit events over the window.",
    },
    {
      value: "sessions",
      label: "Sessions",
      hint: "Platform-admin sessions with device and status.",
    },
    {
      value: "data_export",
      label: "Data export",
      hint: "Audit/data export events over the window.",
    },
    {
      value: "backup_restore",
      label: "Backup / restore",
      hint: "Backup and restore activity over the window.",
    },
  ];

// ---- Role labels (platform built-in roles) ----
const ROLE_LABELS: Record<string, string> = {
  owner: "Owner",
  platform_admin: "Platform Admin",
  support_operator: "Support Operator",
  billing_admin: "Billing Admin",
  auditor: "Auditor",
  technical_admin: "Technical Admin",
};

/** Human label for a platform role ("platform_admin" → "Platform Admin"). */
export function roleLabel(role: string | null | undefined): string {
  if (!role) return "—";
  return ROLE_LABELS[role] ?? role.replace(/_/g, " ");
}

/** Owner stands out (brand); every other role reads as neutral. */
export function roleTone(role: string | null | undefined): Tone {
  return role === "owner" ? "blue" : "slate";
}

// ---- Badge tone / label helpers ----
export function complianceTone(state: ComplianceState): Tone {
  switch (state) {
    case "compliant":
      return "green";
    case "grace":
      return "amber";
    case "non_compliant":
      return "red";
    default:
      return "slate";
  }
}

export function complianceLabel(state: ComplianceState): string {
  switch (state) {
    case "compliant":
      return "Compliant";
    case "grace":
      return "In grace";
    case "non_compliant":
      return "Non-compliant";
    default:
      return "Exempt";
  }
}

export function tokenStatusTone(status: TokenStatus): Tone {
  return status === "active" ? "green" : status === "expired" ? "amber" : "slate";
}

export function alertTone(severity: AlertSeverity): Tone {
  return severity === "critical" ? "red" : severity === "warning" ? "amber" : "blue";
}

/** A humanised label for a platform audit action key ("rbac.role_created" → "Rbac role created"). */
export function actionLabel(action: string): string {
  const spaced = action.replace(/[._]/g, " ").trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

// ---- Date helpers ----
/** Render an ISO timestamp as a locale date+time, or "—" when absent/invalid. */
export function formatDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString();
}

/** Render an ISO timestamp as a locale date, or "—" when absent/invalid. */
export function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString();
}

/** Today's date as yyyy-mm-dd (for date inputs). */
export function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Condense a raw user-agent string down to something readable in a table. */
export function shortUserAgent(ua: string | null | undefined): string {
  if (!ua) return "Unknown device";
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /OPR\/|Opera/.test(ua)
      ? "Opera"
      : /Chrome\//.test(ua)
        ? "Chrome"
        : /Firefox\//.test(ua)
          ? "Firefox"
          : /Safari\//.test(ua)
            ? "Safari"
            : null;
  const os = /Windows/.test(ua)
    ? "Windows"
    : /Mac OS X|Macintosh/.test(ua)
      ? "macOS"
      : /Android/.test(ua)
        ? "Android"
        : /iPhone|iPad|iOS/.test(ua)
          ? "iOS"
          : /Linux/.test(ua)
            ? "Linux"
            : null;
  if (browser && os) return `${browser} · ${os}`;
  if (browser) return browser;
  if (os) return os;
  return ua.length > 40 ? `${ua.slice(0, 40)}…` : ua;
}

/** Stringify an arbitrary cell value returned by a dynamic compliance report. */
export function reportCell(value: unknown): string {
  if (value == null || value === "") return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
}

// ---- Authenticated file download (CSV/XLSX export) ----
/**
 * Bearer-token blob download — mirrors the rbac/invoices export pattern. Streams
 * the file into an anchor click so the browser saves it.
 */
export async function downloadSecurityExport(
  path: string,
  filename: string
): Promise<void> {
  const token = useAuthStore.getState().accessToken;
  const res = await fetch(`${API_URL}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new Error("Export failed");
  const blob = await res.blob();
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 60_000);
}
