// Shared types, constants and helpers for the Super Admin → RBAC governance
// console. Mirrors the fixed backend response shapes in
// backend/src/modules/platform/rbac.{routes,service,schema}.ts.

import { useAuthStore } from "@/stores/auth-store";

const API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api/v1";

// ---- Response shapes ----
export type RoleKind = "built_in" | "custom";
export type RoleStatus = "active" | "disabled" | "archived";

/** A platform RBAC role (from GET /platform/rbac/roles + /roles/:key). */
export interface Role {
  key: string;
  name: string;
  description: string;
  kind: RoleKind;
  status: RoleStatus;
  isOwner: boolean;
  isSystem: boolean;
  permissionCount: number;
  userCount: number;
  createdByEmail: string | null;
  updatedByEmail: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Role detail carries its granted permission keys. */
export interface RoleDetail extends Role {
  permissions: string[];
}

/** A single permission in the registry, with the roles that hold it. */
export interface RegistryPermission {
  key: string;
  description: string;
  highRisk: boolean;
  roles: string[];
}

/** Permission registry grouped by module (GET /platform/rbac/registry). */
export interface RegistryGroup {
  group: string;
  permissions: RegistryPermission[];
}

/** A roles × permissions matrix row (GET /platform/rbac/matrix). Owner = "*". */
export interface MatrixEntry {
  key: string;
  name: string;
  kind: RoleKind;
  status: RoleStatus;
  isOwner: boolean;
  permissions: "*" | string[];
}

/** The caller's effective platform role + permissions (GET /platform/rbac/me). */
export interface RbacMe {
  role: string;
  isOwner: boolean;
  permissions: string[];
}

/** A platform admin assigned to a role (GET /platform/rbac/roles/:key/users). */
export interface RoleUser {
  id: string;
  fullName: string;
  email: string;
  isActive: boolean;
  lastLoginAt: string | null;
}

/** The `detail` payload shapes we render from RBAC audit rows. */
export interface RbacAuditDetail {
  reason?: string | null;
  added?: string[];
  removed?: string[];
  from?: string | null;
  to?: string | null;
  role?: string;
  key?: string;
  name?: string;
  email?: string;
  changes?: Record<string, unknown>;
  copyFrom?: string | null;
  format?: string;
  [k: string]: unknown;
}

/** A single RBAC audit-log row (GET /platform/rbac/audit). */
export interface RbacAuditRow {
  id: string;
  action: string;
  actorEmail: string | null;
  targetType: string | null;
  targetId: string | null;
  detail: RbacAuditDetail | null;
  ip: string | null;
  createdAt: string;
}

export interface Paged<T> {
  rows: T[];
  total: number;
  page: number;
  pageSize: number;
}

// ---- Badge tone helper ----
export type Tone = "slate" | "green" | "amber" | "red" | "blue";

// ---- High-risk permissions (grant/revoke needs an audited reason) ----
export const HIGH_RISK_KEYS = new Set<string>([
  "platform:manage_admins",
  "platform:rbac_manage",
  "platform:permissions_manage",
  "platform:manage_subscriptions",
  "platform:manage_institutions",
  "platform:settings_manage",
  "platform:impersonate",
  "platform:audit_read",
  "backup:restore",
  "backup:manage",
]);

export const isHighRisk = (key: string): boolean => HIGH_RISK_KEYS.has(key);

// ---- Filter option constants ----
export const ROLE_STATUSES: RoleStatus[] = ["active", "disabled", "archived"];
export const ROLE_KINDS: RoleKind[] = ["built_in", "custom"];

// ---- Badge tone / label helpers ----
export function statusTone(status: RoleStatus): Tone {
  return status === "active" ? "green" : status === "disabled" ? "amber" : "slate";
}

export function statusLabel(status: RoleStatus): string {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

export function kindTone(kind: RoleKind): Tone {
  return kind === "built_in" ? "blue" : "slate";
}

export function kindLabel(kind: RoleKind): string {
  return kind === "built_in" ? "Built-in" : "Custom";
}

// ---- RBAC audit actions ----
export const AUDIT_ACTIONS: { value: string; label: string }[] = [
  { value: "", label: "All actions" },
  { value: "rbac.role_created", label: "Role created" },
  { value: "rbac.role_updated", label: "Role updated" },
  { value: "rbac.role_archived", label: "Role archived" },
  { value: "rbac.matrix_saved", label: "Permissions saved" },
  { value: "rbac.role_assigned", label: "Role assigned" },
  { value: "rbac.matrix_exported", label: "Matrix exported" },
];

export function auditActionLabel(action: string): string {
  const found = AUDIT_ACTIONS.find((a) => a.value === action);
  if (found?.value) return found.label;
  return action.replace(/^rbac\./, "").replace(/_/g, " ");
}

export function auditActionTone(action: string): Tone {
  switch (action) {
    case "rbac.role_created":
      return "green";
    case "rbac.role_archived":
      return "red";
    case "rbac.matrix_saved":
    case "rbac.role_assigned":
      return "blue";
    case "rbac.role_updated":
    case "rbac.matrix_exported":
      return "amber";
    default:
      return "slate";
  }
}

// ---- Date helper ----
/** Render an ISO timestamp as a locale date+time, or "—" when absent/invalid. */
export function formatDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString();
}

/** Short human label for a permission key ("platform:rbac_manage" → "rbac manage"). */
export function permissionShortLabel(key: string): string {
  const suffix = key.includes(":") ? key.slice(key.indexOf(":") + 1) : key;
  return suffix.replace(/_/g, " ");
}

// ---- Authenticated file download (matrix CSV/XLSX export) ----
/**
 * Bearer-token blob download — mirrors the invoices/subscriptions export
 * pattern. Streams the file into an anchor click so the browser saves it.
 */
export async function downloadRbacExport(
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
