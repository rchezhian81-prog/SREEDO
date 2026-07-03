import type { z } from "zod";
import { query, withTransaction } from "../../db/postgres";
import { ApiError } from "../../utils/api-error";
import {
  invalidatePermissionCache,
  invalidatePlatformRoleCache,
  isFullAccessPlatformUser,
} from "../../middleware/permissions";
import { recordAudit, type Actor } from "./platform.service";
import type {
  archiveRoleSchema,
  assignRoleSchema,
  createRoleSchema,
  listRolesQuerySchema,
  saveMatrixSchema,
  updateRoleSchema,
} from "./rbac.schema";

/**
 * Super Admin H — RBAC governance (platform roles + permission matrix).
 *
 * Roles are stored in rbac_roles; their permission grants live in role_permissions
 * keyed by the role key (also read by the enforcement middleware). Owner is
 * full-access by bypass and is protected: never archived, never emptied, and the
 * last active owner can't be demoted. Every change is audited with a before/after
 * diff. Nothing is hard-deleted (roles archive; grants are revoked, not the
 * catalogue). Reserved user_role names can't be used as custom role keys.
 */

type ListQuery = z.infer<typeof listRolesQuerySchema>;
type CreateInput = z.infer<typeof createRoleSchema>;
type UpdateInput = z.infer<typeof updateRoleSchema>;
type ArchiveInput = z.infer<typeof archiveRoleSchema>;
type SaveMatrixInput = z.infer<typeof saveMatrixSchema>;
type AssignInput = z.infer<typeof assignRoleSchema>;

const RESERVED_KEYS = new Set(["admin", "teacher", "accountant", "student", "parent", "super_admin"]);

/** Permissions whose grant/revoke needs an audited reason. */
const HIGH_RISK = new Set([
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

/** Permissions only an owner (full-access actor) may grant to another role. */
const OWNER_ONLY = new Set([
  "platform:manage_admins",
  "platform:rbac_manage",
  "platform:permissions_manage",
]);

/** Display grouping for the 14 permission groups (falls back to the key prefix). */
const GROUP_OF: Array<[string, (key: string) => boolean]> = [
  ["Platform Dashboard", (k) => ["platform:read", "platform:usage_read", "platform:health_read"].includes(k)],
  ["Tenant Management", (k) => k === "platform:manage_institutions"],
  ["Package / SaaS Billing & Subscriptions", (k) => k === "platform:manage_subscriptions"],
  ["Platform Admin Users", (k) => k === "platform:manage_admins"],
  ["RBAC", (k) => k.startsWith("platform:rbac_") || k.startsWith("platform:permissions_")],
  ["Audit", (k) => k === "platform:audit_read"],
  ["Support Access", (k) => k === "platform:impersonate"],
  ["Settings", (k) => k.startsWith("platform:settings_")],
  ["Backups", (k) => k.startsWith("backup:")],
  ["Jobs / Observability", (k) => k.startsWith("jobs:") || k.startsWith("observability:")],
];
function groupOf(key: string): string {
  for (const [label, pred] of GROUP_OF) if (pred(key)) return label;
  const prefix = key.split(":")[0];
  return prefix.charAt(0).toUpperCase() + prefix.slice(1).replace(/_/g, " ");
}

// ---- Roles ----

const ROLE_COLS = `
  r.key, r.name, r.description, r.kind, r.status,
  r.is_owner AS "isOwner", r.is_system AS "isSystem",
  r.created_by_email AS "createdByEmail", r.updated_by_email AS "updatedByEmail",
  r.created_at AS "createdAt", r.updated_at AS "updatedAt",
  (SELECT count(*)::int FROM role_permissions rp WHERE rp.role = r.key) AS "permissionCount",
  (SELECT count(*)::int FROM users u WHERE u.platform_role = r.key) AS "userCount"`;

export async function listRoles(q: ListQuery) {
  const where: string[] = [];
  const params: unknown[] = [];
  if (q.q) {
    params.push(`%${q.q}%`);
    where.push(`(r.name ILIKE $${params.length} OR r.key ILIKE $${params.length})`);
  }
  if (q.status) {
    params.push(q.status);
    where.push(`r.status = $${params.length}`);
  }
  if (q.kind) {
    params.push(q.kind);
    where.push(`r.kind = $${params.length}`);
  }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const { rows } = await query(
    `SELECT ${ROLE_COLS} FROM rbac_roles r ${whereSql}
     ORDER BY r.is_owner DESC, r.kind ASC, r.name ASC`,
    params
  );
  return rows;
}

async function getRoleRow(key: string) {
  const { rows } = await query<{ key: string; kind: string; status: string; is_owner: boolean; is_system: boolean }>(
    `SELECT key, kind, status, is_owner, is_system FROM rbac_roles WHERE key = $1`,
    [key]
  );
  if (!rows[0]) throw ApiError.notFound("Role not found");
  return rows[0];
}

export async function roleDetail(key: string) {
  const { rows } = await query(`SELECT ${ROLE_COLS} FROM rbac_roles r WHERE r.key = $1`, [key]);
  if (!rows[0]) throw ApiError.notFound("Role not found");
  const perms = await query<{ key: string }>(
    `SELECT p.key FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id
     WHERE rp.role = $1 ORDER BY p.key`,
    [key]
  );
  return { ...rows[0], permissions: perms.rows.map((r) => r.key) };
}

export async function createRole(input: CreateInput, actor: Actor) {
  if (RESERVED_KEYS.has(input.key)) throw ApiError.badRequest("That key is reserved");
  const exists = await query("SELECT 1 FROM rbac_roles WHERE key = $1", [input.key]);
  if (exists.rows[0]) throw ApiError.conflict("A role with this key already exists");

  await withTransaction(async (client) => {
    await client.query(
      `INSERT INTO rbac_roles (key, name, description, kind, is_owner, is_system, created_by, created_by_email, updated_by, updated_by_email)
       VALUES ($1, $2, $3, 'custom', false, false, $4, $5, $4, $5)`,
      [input.key, input.name, input.description ?? "", actor.id, actor.email]
    );
    if (input.copyFrom) {
      await client.query(
        `INSERT INTO role_permissions (role, permission_id)
         SELECT $1, rp.permission_id FROM role_permissions rp WHERE rp.role = $2
         ON CONFLICT (role, permission_id) DO NOTHING`,
        [input.key, input.copyFrom]
      );
    }
  });
  invalidatePermissionCache();
  await recordAudit(actor, {
    action: "rbac.role_created",
    targetType: "rbac_role",
    targetId: null,
    institutionId: null,
    detail: { key: input.key, name: input.name, copyFrom: input.copyFrom ?? null },
  });
  return roleDetail(input.key);
}

export async function updateRole(key: string, input: UpdateInput, actor: Actor) {
  const role = await getRoleRow(key);
  if (role.is_owner && input.status === "disabled") {
    throw ApiError.badRequest("The owner role cannot be disabled");
  }
  await query(
    `UPDATE rbac_roles SET
       name = COALESCE($2, name),
       description = COALESCE($3, description),
       status = COALESCE($4, status),
       updated_by = $5, updated_by_email = $6, updated_at = now()
     WHERE key = $1`,
    [key, input.name ?? null, input.description ?? null, input.status ?? null, actor.id, actor.email]
  );
  await recordAudit(actor, {
    action: "rbac.role_updated",
    targetType: "rbac_role",
    targetId: null,
    institutionId: null,
    detail: { key, changes: input },
  });
  return roleDetail(key);
}

export async function archiveRole(key: string, input: ArchiveInput, actor: Actor) {
  const role = await getRoleRow(key);
  if (role.is_owner) throw ApiError.badRequest("The owner role cannot be archived");
  if (role.is_system) throw ApiError.badRequest("Built-in roles cannot be archived (disable them instead)");
  const assigned = await query<{ n: number }>(
    "SELECT count(*)::int AS n FROM users WHERE platform_role = $1",
    [key]
  );
  if (Number(assigned.rows[0].n) > 0) {
    throw ApiError.badRequest(`Reassign the ${assigned.rows[0].n} user(s) on this role before archiving it`);
  }
  await query(
    `UPDATE rbac_roles SET status = 'archived', updated_by = $2, updated_by_email = $3, updated_at = now() WHERE key = $1`,
    [key, actor.id, actor.email]
  );
  await recordAudit(actor, {
    action: "rbac.role_archived",
    targetType: "rbac_role",
    targetId: null,
    institutionId: null,
    detail: { key, reason: input.reason },
  });
  return roleDetail(key);
}

// ---- Permission registry + matrix ----

export async function permissionRegistry() {
  const { rows } = await query<{ key: string; description: string; roles: string[] | null }>(
    `SELECT p.key, p.description,
            array_agg(rp.role) FILTER (WHERE rp.role IS NOT NULL) AS roles
     FROM permissions p LEFT JOIN role_permissions rp ON rp.permission_id = p.id
     GROUP BY p.key, p.description ORDER BY p.key`
  );
  const groups = new Map<string, Array<Record<string, unknown>>>();
  for (const r of rows) {
    const g = groupOf(r.key);
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g)!.push({
      key: r.key,
      description: r.description,
      highRisk: HIGH_RISK.has(r.key),
      roles: r.roles ?? [],
    });
  }
  return [...groups.entries()].map(([group, permissions]) => ({ group, permissions }));
}

/** All rbac_roles with their granted keys (owner shown as full-access). */
export async function roleMatrix() {
  const roles = await query<{ key: string; name: string; is_owner: boolean; status: string; kind: string }>(
    `SELECT key, name, is_owner, status, kind FROM rbac_roles ORDER BY is_owner DESC, kind, name`
  );
  const grants = await query<{ role: string; key: string }>(
    `SELECT rp.role, p.key FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id`
  );
  const byRole = new Map<string, string[]>();
  for (const g of grants.rows) {
    if (!byRole.has(g.role)) byRole.set(g.role, []);
    byRole.get(g.role)!.push(g.key);
  }
  return roles.rows.map((r) => ({
    key: r.key,
    name: r.name,
    kind: r.kind,
    status: r.status,
    isOwner: r.is_owner,
    permissions: r.is_owner ? "*" : (byRole.get(r.key) ?? []),
  }));
}

export async function saveRolePermissions(key: string, input: SaveMatrixInput, actor: Actor) {
  const role = await getRoleRow(key);
  if (role.is_owner) throw ApiError.badRequest("The owner role has full access; its permissions are not editable");

  const valid = await query<{ id: string; key: string }>(
    "SELECT id, key FROM permissions WHERE key = ANY($1::text[])",
    [input.permissionKeys]
  );
  const validKeys = new Set(valid.rows.map((r) => r.key));
  const requested = new Set(input.permissionKeys.filter((k) => validKeys.has(k)));

  const current = new Set(
    (
      await query<{ key: string }>(
        `SELECT p.key FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id WHERE rp.role = $1`,
        [key]
      )
    ).rows.map((r) => r.key)
  );
  const toAdd = [...requested].filter((k) => !current.has(k));
  const toRemove = [...current].filter((k) => !requested.has(k));
  if (toAdd.length === 0 && toRemove.length === 0) return roleDetail(key);

  const touchesHighRisk = [...toAdd, ...toRemove].some((k) => HIGH_RISK.has(k));
  if (touchesHighRisk && !input.reason) {
    throw ApiError.badRequest("A reason is required when changing high-risk permissions");
  }
  const grantsOwnerOnly = toAdd.some((k) => OWNER_ONLY.has(k));
  if (grantsOwnerOnly && !(await isFullAccessPlatformUser(actor.id))) {
    throw ApiError.forbidden("Only an owner can grant owner-level permissions");
  }

  await withTransaction(async (client) => {
    if (toAdd.length) {
      await client.query(
        `INSERT INTO role_permissions (role, permission_id)
         SELECT $1, id FROM permissions WHERE key = ANY($2::text[])
         ON CONFLICT (role, permission_id) DO NOTHING`,
        [key, toAdd]
      );
    }
    if (toRemove.length) {
      await client.query(
        `DELETE FROM role_permissions
         WHERE role = $1 AND permission_id IN (SELECT id FROM permissions WHERE key = ANY($2::text[]))`,
        [key, toRemove]
      );
    }
  });
  invalidatePermissionCache();
  await recordAudit(actor, {
    action: "rbac.matrix_saved",
    targetType: "rbac_role",
    targetId: null,
    institutionId: null,
    detail: { role: key, added: toAdd, removed: toRemove, reason: input.reason ?? null },
  });
  return roleDetail(key);
}

// ---- Role assignment to a platform admin ----

const PLATFORM_PRED = "u.role = 'super_admin' AND u.institution_id IS NULL";

async function activeOwnerCount(): Promise<number> {
  const { rows } = await query<{ c: number }>(
    `SELECT count(*)::int AS c FROM users u
     WHERE ${PLATFORM_PRED} AND u.platform_role = 'owner' AND u.is_active = true`
  );
  return Number(rows[0].c);
}

export async function assignRoleToUser(userId: string, input: AssignInput, actor: Actor) {
  const { rows } = await query<{ id: string; email: string; platform_role: string | null; is_active: boolean }>(
    `SELECT id, email, platform_role, is_active FROM users u WHERE u.id = $1 AND ${PLATFORM_PRED}`,
    [userId]
  );
  const target = rows[0];
  if (!target) throw ApiError.notFound("Platform admin not found");

  const role = await getRoleRow(input.roleKey);
  if (role.status === "archived") throw ApiError.badRequest("Cannot assign an archived role");

  // Owner-safety: don't demote the last active owner.
  if (target.platform_role === "owner" && input.roleKey !== "owner" && target.is_active) {
    if ((await activeOwnerCount()) <= 1) {
      throw ApiError.badRequest("Cannot demote the last active owner");
    }
  }
  await query("UPDATE users SET platform_role = $2 WHERE id = $1", [userId, input.roleKey]);
  invalidatePlatformRoleCache(userId);
  await recordAudit(actor, {
    action: "rbac.role_assigned",
    targetType: "user",
    targetId: userId,
    institutionId: null,
    detail: { email: target.email, from: target.platform_role, to: input.roleKey, reason: input.reason },
  });
  return { id: userId, platformRole: input.roleKey };
}

export async function usersInRole(key: string) {
  await getRoleRow(key);
  const { rows } = await query(
    `SELECT id, full_name AS "fullName", email, is_active AS "isActive",
            to_char(last_login_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "lastLoginAt"
     FROM users WHERE platform_role = $1 AND ${PLATFORM_PRED.replace(/u\./g, "")}
     ORDER BY full_name`,
    [key]
  );
  return rows;
}

// ---- Audit + export + effective ----

export async function rbacAudit(q: { action?: string; page: number; pageSize: number }) {
  const where = ["action LIKE 'rbac.%'"];
  const params: unknown[] = [];
  if (q.action) {
    params.push(q.action);
    where.push(`action = $${params.length}`);
  }
  const whereSql = `WHERE ${where.join(" AND ")}`;
  const count = await query<{ n: number }>(`SELECT count(*)::int AS n FROM platform_audit_log ${whereSql}`, params);
  const { rows } = await query(
    `SELECT id, action, actor_email AS "actorEmail", actor_id AS "actorId", target_type AS "targetType",
            target_id AS "targetId", detail, ip, created_at AS "createdAt"
     FROM platform_audit_log ${whereSql}
     ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, q.pageSize, (q.page - 1) * q.pageSize]
  );
  return { rows, total: count.rows[0].n, page: q.page, pageSize: q.pageSize };
}

/** Flat roles × permissions matrix rows for CSV/XLSX export. */
export async function exportMatrixRows() {
  const roles = (
    await query<{ key: string; name: string; kind: string; is_owner: boolean; updated_at: Date }>(
      `SELECT key, name, kind, is_owner, updated_at FROM rbac_roles ORDER BY is_owner DESC, kind, name`
    )
  ).rows;
  const perms = (
    await query<{ key: string; description: string }>("SELECT key, description FROM permissions ORDER BY key")
  ).rows;
  const grants = new Set(
    (
      await query<{ role: string; key: string }>(
        `SELECT rp.role, p.key FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id`
      )
    ).rows.map((g) => `${g.role}::${g.key}`)
  );
  const rows: Record<string, unknown>[] = [];
  for (const role of roles) {
    for (const perm of perms) {
      const enabled = role.is_owner || grants.has(`${role.key}::${perm.key}`);
      rows.push({
        roleName: role.name,
        roleKey: role.key,
        kind: role.kind,
        group: groupOf(perm.key),
        permissionKey: perm.key,
        enabled: enabled ? "yes" : "no",
        updatedAt: role.updated_at instanceof Date ? role.updated_at.toISOString().slice(0, 10) : "",
      });
    }
  }
  return rows;
}

export const EXPORT_COLUMNS = [
  { key: "roleName", label: "Role" },
  { key: "roleKey", label: "Role key" },
  { key: "kind", label: "Type" },
  { key: "group", label: "Permission group" },
  { key: "permissionKey", label: "Permission key" },
  { key: "enabled", label: "Enabled" },
  { key: "updatedAt", label: "Role updated" },
];
