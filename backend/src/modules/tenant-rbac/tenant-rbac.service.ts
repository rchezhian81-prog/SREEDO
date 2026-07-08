import { query, withTransaction } from "../../db/postgres";
import { ApiError } from "../../utils/api-error";
import type { UserRole } from "../../types";
import {
  effectivePermissions,
  invalidateTenantOverrideCache,
  tenantRolePermissions,
} from "../../middleware/permissions";
import {
  ADMIN_PROTECTED_KEYS,
  ALL_TENANT_PERMISSION_KEYS,
  HIGH_RISK_KEYS,
  RESTRICTED_ROLE_KEYS,
  TENANT_PERMISSION_GROUPS,
  TENANT_ROLES,
  TENANT_ROLE_KEYS,
  type TenantRoleMeta,
} from "./tenant-rbac.registry";

// PR-T2 — Tenant RBAC v2 service. Reads/writes per-tenant role permission
// overrides (tenant_role_permissions) with safety rails, and records an audit
// trail (tenant_rbac_audit). Enforcement itself lives in requirePermission,
// which merges these overrides for tenant users.

export interface ActorContext {
  userId: string;
  email: string;
  role: UserRole;
  institutionId: string;
  ip?: string | null;
  userAgent?: string | null;
}

function roleMeta(role: string): TenantRoleMeta {
  const meta = TENANT_ROLES.find((r) => r.key === role);
  if (!meta) throw ApiError.notFound("Unknown tenant role");
  return meta;
}

/** The tenant permission registry (groups + roles + high-risk keys). */
export function getRegistry() {
  return {
    roles: TENANT_ROLES,
    groups: TENANT_PERMISSION_GROUPS,
    highRiskKeys: [...HIGH_RISK_KEYS],
  };
}

/** The five tenant roles with their effective/overridden counts for a tenant. */
export async function listRoles(institutionId: string) {
  const roles = await Promise.all(
    TENANT_ROLES.map(async (meta) => {
      const p = await tenantRolePermissions(institutionId, meta.key as UserRole);
      // Only count registry-visible keys so the numbers match the matrix UI.
      const effective = p.effective.filter((k) => ALL_TENANT_PERMISSION_KEYS.has(k));
      const overridden = new Set([...p.grants, ...p.denies]).size;
      return {
        ...meta,
        effectiveCount: effective.length,
        overriddenCount: overridden,
      };
    })
  );
  return { roles };
}

/** One role's registry, annotated with effective / default / override state. */
export async function getRole(institutionId: string, role: string) {
  const meta = roleMeta(role);
  const p = await tenantRolePermissions(institutionId, role as UserRole);
  const effective = new Set(p.effective);
  const defaults = new Set(p.defaults);
  const grants = new Set(p.grants);
  const denies = new Set(p.denies);

  const groups = TENANT_PERMISSION_GROUPS.map((g) => ({
    key: g.key,
    title: g.title,
    appliesTo: g.appliesTo,
    permissions: g.permissions.map((perm) => ({
      key: perm.key,
      label: perm.label,
      highRisk: Boolean(perm.highRisk),
      appliesTo: perm.appliesTo ?? g.appliesTo,
      granted: effective.has(perm.key),
      isDefault: defaults.has(perm.key),
      override: grants.has(perm.key) ? "grant" : denies.has(perm.key) ? "deny" : null,
    })),
  }));

  return { role: meta, groups };
}

/** Roles × registry effective matrix for a tenant. */
export async function getMatrix(institutionId: string) {
  const effective: Record<string, string[]> = {};
  for (const meta of TENANT_ROLES) {
    const p = await tenantRolePermissions(institutionId, meta.key as UserRole);
    effective[meta.key] = p.effective.filter((k) => ALL_TENANT_PERMISSION_KEYS.has(k));
  }
  return { roles: TENANT_ROLES, groups: TENANT_PERMISSION_GROUPS, effective };
}

/** Users holding a given role within the tenant (for "users in role"). */
export async function usersInRole(institutionId: string, role: string) {
  roleMeta(role);
  const { rows } = await query<{
    id: string;
    email: string;
    fullName: string;
    isActive: boolean;
  }>(
    `SELECT id, email, full_name AS "fullName", is_active AS "isActive"
     FROM users
     WHERE institution_id = $1 AND role = $2
     ORDER BY full_name`,
    [institutionId, role]
  );
  return { role, users: rows };
}

/** Effective permissions for the calling user (console bootstrap). */
export async function effectiveForUser(user: {
  id: string;
  role: UserRole;
  institutionId?: string | null;
}) {
  return {
    role: user.role,
    isAdmin: user.role === "admin",
    permissions: await effectivePermissions(user),
  };
}

async function recordAudit(
  actor: ActorContext,
  action: string,
  targetRole: string | null,
  before: unknown,
  after: unknown,
  reason: string | null
): Promise<void> {
  await query(
    `INSERT INTO tenant_rbac_audit
       (institution_id, actor_user_id, actor_email, action, target_role, before, after, reason, ip, user_agent)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [
      actor.institutionId,
      actor.userId,
      actor.email,
      action,
      targetRole,
      before === null ? null : JSON.stringify(before),
      after === null ? null : JSON.stringify(after),
      reason,
      actor.ip ?? null,
      actor.userAgent ?? null,
    ]
  );
}

/**
 * Replace a role's registry-key permission set with `desiredKeys`, storing the
 * diff vs the global defaults as per-tenant grant/deny overrides. Enforces the
 * safety rails (restricted roles, admin last-owner, self-lockout, high-risk
 * reason) and audits the before/after.
 */
export async function updateRole(
  institutionId: string,
  role: string,
  desiredKeys: string[],
  reason: string | null,
  actor: ActorContext
) {
  const meta = roleMeta(role);

  // Consider only real registry keys; ignore anything unknown in the payload.
  const desired = new Set(desiredKeys.filter((k) => ALL_TENANT_PERMISSION_KEYS.has(k)));

  const current = await tenantRolePermissions(institutionId, role as UserRole);
  const defaults = new Set(current.defaults);
  const beforeEffective = new Set(
    current.effective.filter((k) => ALL_TENANT_PERMISSION_KEYS.has(k))
  );

  // Compute the per-registry-key deltas vs the global default.
  const toGrant: string[] = []; // desired && !default
  const toDeny: string[] = []; // !desired && default
  const changed: string[] = []; // any key whose effective state flips
  for (const key of ALL_TENANT_PERMISSION_KEYS) {
    const want = desired.has(key);
    const def = defaults.has(key);
    if (want && !def) toGrant.push(key);
    else if (!want && def) toDeny.push(key);
    if (want !== beforeEffective.has(key)) changed.push(key);
  }

  if (changed.length === 0) {
    return getRole(institutionId, role);
  }

  // --- Safety rails --------------------------------------------------------
  // Portal roles (student/parent) can never GAIN an admin permission.
  if (RESTRICTED_ROLE_KEYS.has(role) && toGrant.length > 0) {
    throw ApiError.badRequest(
      `The ${meta.name} role is portal-only and cannot be granted admin permissions.`
    );
  }
  // The admin/management role must always retain its core management keys, or
  // no one could ever manage RBAC or users again (last-owner protection).
  if (meta.management) {
    for (const key of ADMIN_PROTECTED_KEYS) {
      if (!desired.has(key)) {
        throw ApiError.badRequest(
          "The admin role must keep RBAC and user-management access — this change would lock every administrator out."
        );
      }
    }
  }
  // Self-lockout: an editor cannot strip RBAC-manage from their own role.
  if (actor.role === role && !desired.has("tenant_rbac:manage")) {
    throw ApiError.badRequest(
      "You cannot remove RBAC management from your own role (self-lockout prevented)."
    );
  }
  // High-risk changes require a reason.
  const highRiskChanged = changed.filter((k) => HIGH_RISK_KEYS.has(k));
  if (highRiskChanged.length > 0 && !reason?.trim()) {
    throw ApiError.badRequest(
      "A reason is required to change high-risk permissions.",
      { highRisk: highRiskChanged }
    );
  }

  // --- Persist the overrides atomically ------------------------------------
  await withTransaction(async (client) => {
    // Drop existing overrides for this role, then insert the new grant/deny set.
    await client.query(
      "DELETE FROM tenant_role_permissions WHERE institution_id = $1 AND role = $2",
      [institutionId, role]
    );
    const rows: [string, string][] = [
      ...toGrant.map((k) => [k, "grant"] as [string, string]),
      ...toDeny.map((k) => [k, "deny"] as [string, string]),
    ];
    for (const [key, effect] of rows) {
      await client.query(
        `INSERT INTO tenant_role_permissions
           (institution_id, role, permission_key, effect, created_by, created_by_email, updated_by, updated_by_email)
         VALUES ($1,$2,$3,$4,$5,$6,$5,$6)`,
        [institutionId, role, key, effect, actor.userId, actor.email]
      );
    }
  });

  invalidateTenantOverrideCache(institutionId);

  await recordAudit(
    actor,
    "role.permissions.updated",
    role,
    { effective: [...beforeEffective] },
    { effective: [...desired], reason: reason ?? null, highRisk: highRiskChanged },
    reason ?? null
  );

  return getRole(institutionId, role);
}

/** Reset a role to its global defaults by removing every per-tenant override. */
export async function resetRole(institutionId: string, role: string, actor: ActorContext) {
  const meta = roleMeta(role);
  const before = await tenantRolePermissions(institutionId, role as UserRole);
  const hadOverrides = before.grants.length + before.denies.length > 0;

  await query(
    "DELETE FROM tenant_role_permissions WHERE institution_id = $1 AND role = $2",
    [institutionId, role]
  );
  invalidateTenantOverrideCache(institutionId);

  if (hadOverrides) {
    await recordAudit(
      actor,
      "role.permissions.reset",
      role,
      { grants: before.grants, denies: before.denies },
      { effective: before.defaults.filter((k) => ALL_TENANT_PERMISSION_KEYS.has(k)) },
      null
    );
  }
  void meta;
  return getRole(institutionId, role);
}

/** Paginated tenant RBAC audit trail. */
export async function listAudit(
  institutionId: string,
  opts: { limit: number; offset: number }
) {
  const { rows } = await query(
    `SELECT id, actor_email AS "actorEmail", action, target_role AS "targetRole",
            before, after, reason, created_at AS "createdAt"
     FROM tenant_rbac_audit
     WHERE institution_id = $1
     ORDER BY created_at DESC
     LIMIT $2 OFFSET $3`,
    [institutionId, opts.limit, opts.offset]
  );
  const { rows: countRows } = await query<{ count: string }>(
    "SELECT count(*)::text AS count FROM tenant_rbac_audit WHERE institution_id = $1",
    [institutionId]
  );
  return { data: rows, total: Number(countRows[0]?.count ?? 0) };
}

export { TENANT_ROLE_KEYS };
