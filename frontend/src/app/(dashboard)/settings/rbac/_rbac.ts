// Shared types + helpers for the tenant Roles & Permissions console
// (Settings → RBAC). Mirrors the fixed `/tenant-rbac/*` backend response shapes.
// Self-contained: does NOT import from the platform (super-admin) RBAC console.

// ---- Applicability (School / College edition an entity belongs to) ----
export type AppliesTo = "school" | "college" | "both";

// ---- Badge tone (matches the ui.tsx `Badge` tones) ----
export type Tone = "slate" | "green" | "amber" | "red" | "blue";

/** Metadata for a built-in tenant role. */
export interface RoleMeta {
  key: string;
  name: string;
  description: string;
  appliesTo: AppliesTo;
  builtIn: true;
  management?: boolean;
  restricted?: boolean;
}

/** A role row from GET /tenant-rbac/roles — adds effective/override counts. */
export interface RoleListItem extends RoleMeta {
  effectiveCount: number;
  overriddenCount: number;
}

/** GET /tenant-rbac/roles */
export interface RolesListResponse {
  roles: RoleListItem[];
}

/**
 * A finer job-role from GET /tenant-rbac/job-roles. Job-roles layer on top of a
 * coarse base role (admin/teacher/accountant) and are viewed/edited through the
 * SAME role-detail endpoints as coarse roles, keyed by their `key`
 * (e.g. `jr_fees_officer`).
 */
export interface JobRoleListItem {
  key: string;
  name: string;
  description: string;
  appliesTo: AppliesTo;
  baseRole: "admin" | "teacher" | "accountant";
  builtIn: true;
  effectiveCount: number;
  overriddenCount: number;
}

/** GET /tenant-rbac/job-roles */
export interface JobRolesListResponse {
  roles: JobRoleListItem[];
}

/** A permission as it appears in the registry / matrix groups. */
export interface RegistryPermission {
  key: string;
  label: string;
  highRisk?: boolean;
  appliesTo?: AppliesTo;
}

/** A registry / matrix permission group. */
export interface RegistryGroup {
  key: string;
  title: string;
  appliesTo: AppliesTo;
  permissions: RegistryPermission[];
}

/** GET /tenant-rbac/registry */
export interface RbacRegistry {
  roles: RoleMeta[];
  groups: RegistryGroup[];
  highRiskKeys: string[];
}

/** The per-tenant override state on a permission ("grant" / "deny" / none). */
export type PermissionOverride = "grant" | "deny" | null;

/** A permission inside a role detail — carries the effective + override state. */
export interface RoleDetailPermission {
  key: string;
  label: string;
  highRisk: boolean;
  appliesTo: AppliesTo;
  granted: boolean;
  isDefault: boolean;
  override: PermissionOverride;
}

/** A group inside a role detail. */
export interface RoleDetailGroup {
  key: string;
  title: string;
  appliesTo: AppliesTo;
  permissions: RoleDetailPermission[];
}

/**
 * GET /tenant-rbac/roles/:role — also the shape returned by
 * PUT /tenant-rbac/roles/:role and POST /tenant-rbac/roles/:role/reset.
 */
export interface RoleDetail {
  role: RoleMeta;
  groups: RoleDetailGroup[];
}

/** GET /tenant-rbac/matrix */
export interface RbacMatrix {
  roles: RoleMeta[];
  groups: RegistryGroup[];
  effective: Record<string, string[]>;
}

/** A user assigned to a role (GET /tenant-rbac/roles/:role/users). */
export interface RoleUser {
  id: string;
  email: string;
  fullName: string;
  isActive: boolean;
}

/** GET /tenant-rbac/roles/:role/users */
export interface RoleUsersResponse {
  role: string;
  users: RoleUser[];
}

/** A tenant RBAC audit row (GET /tenant-rbac/audit). */
export interface TenantRbacAuditRow {
  id: string;
  actorEmail: string | null;
  action: string;
  targetRole: string;
  before: unknown;
  after: unknown;
  reason: string | null;
  createdAt: string;
}

/** GET /tenant-rbac/audit?page=&limit= */
export interface TenantRbacAuditResponse {
  data: TenantRbacAuditRow[];
  total: number;
}

// ---- Helpers ----

/** Every permission key currently granted in a role detail. */
export function flattenGranted(detail: RoleDetail): string[] {
  return detail.groups.flatMap((g) =>
    g.permissions.filter((p) => p.granted).map((p) => p.key)
  );
}

/** Added / removed keys between a saved baseline and the desired selection. */
export function diffKeys(
  baseline: Set<string>,
  desired: Set<string>
): { added: string[]; removed: string[] } {
  const added = [...desired].filter((k) => !baseline.has(k)).sort();
  const removed = [...baseline].filter((k) => !desired.has(k)).sort();
  return { added, removed };
}

/** Badge tone for the "High-risk" marker. */
export const highRiskBadge = (): Tone => "amber";

/** Human label for an applicability value. */
export function appliesToLabel(appliesTo: AppliesTo): string {
  return appliesTo === "school"
    ? "School"
    : appliesTo === "college"
      ? "College"
      : "Both";
}
