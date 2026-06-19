import type { z } from "zod";
import { query } from "../../db/postgres";
import { ApiError } from "../../utils/api-error";
import { signAccessToken } from "../../utils/jwt";
import { invalidatePermissionCache } from "../../middleware/permissions";
import * as superadmin from "../superadmin/superadmin.service";
import { institutionLimits, institutionStats, systemHealth } from "../adminconsole/adminconsole.service";
import type {
  assignSubscriptionSchema,
  createInstitutionSchema,
  impersonateSchema,
  platformAuditQuerySchema,
  setLimitsSchema,
  suspendSchema,
  updateInstitutionSchema,
} from "./platform.schema";

export interface Actor {
  id: string;
  email: string;
  role: string;
  ip: string | null;
}

interface AuditInput {
  action: string;
  targetType: string;
  targetId: string | null;
  institutionId: string | null;
  detail?: Record<string, unknown>;
}

/** Durable, cross-tenant record of a platform action (never includes secrets). */
async function recordAudit(actor: Actor, input: AuditInput): Promise<void> {
  await query(
    `INSERT INTO platform_audit_log
       (action, target_type, target_id, institution_id, actor_id, actor_email, actor_role, detail, ip)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9)`,
    [
      input.action,
      input.targetType,
      input.targetId,
      input.institutionId,
      actor.id,
      actor.email,
      actor.role,
      JSON.stringify(input.detail ?? {}),
      actor.ip,
    ]
  );
}

// --- Platform-wide KPIs ---

export async function platformKpis() {
  const totals = await query<Record<string, string>>(
    `SELECT
       (SELECT count(*)::int FROM institutions) AS "totalInstitutions",
       (SELECT count(*)::int FROM institutions WHERE is_active) AS "activeInstitutions",
       (SELECT count(*)::int FROM institutions WHERE NOT is_active) AS "suspendedInstitutions",
       (SELECT count(*)::int FROM students WHERE status <> 'archived') AS "totalStudents",
       (SELECT count(*)::int FROM teachers) AS "totalStaff",
       (SELECT count(*)::int FROM users) AS "totalUsers",
       (SELECT COALESCE(sum(amount_due - amount_paid), 0)::float FROM invoices
          WHERE status IN ('pending','partially_paid')) AS "feesOutstanding",
       (SELECT COALESCE(sum(amount), 0)::float FROM payment_orders WHERE status = 'success') AS "onlinePaymentsTotal",
       (SELECT count(*)::int FROM documents) AS "totalDocuments",
       (SELECT COALESCE(sum(size_bytes), 0)::bigint FROM documents) AS "storageBytes",
       (SELECT count(*)::int FROM scheduled_reports) AS "scheduledReports",
       (SELECT count(*)::int FROM custom_reports) AS "customReports",
       (SELECT count(*)::int FROM refresh_tokens WHERE revoked_at IS NULL AND expires_at > now()) AS "activeSessions"`
  );
  const adoption = await query<Record<string, string>>(
    `SELECT
       count(*) FILTER (WHERE EXISTS (SELECT 1 FROM students s WHERE s.institution_id = i.id))::int AS "withStudents",
       count(*) FILTER (WHERE EXISTS (SELECT 1 FROM invoices v WHERE v.institution_id = i.id))::int AS "withFees",
       count(*) FILTER (WHERE (i.settings->'featureFlags'->>'onlinePayments')::boolean IS TRUE)::int AS "withOnlinePayments",
       count(*) FILTER (WHERE EXISTS (SELECT 1 FROM books b WHERE b.institution_id = i.id))::int AS "withLibrary",
       count(*) FILTER (WHERE EXISTS (SELECT 1 FROM scheduled_reports sr WHERE sr.institution_id = i.id))::int AS "withScheduledReports"
     FROM institutions i`
  );
  return { ...totals.rows[0], moduleAdoption: adoption.rows[0] };
}

// --- Institutions (list + detail with usage) ---

export async function listInstitutions() {
  const { rows } = await query(
    `SELECT i.id, i.name, i.code, i.type, i.is_active AS "isActive", i.created_at AS "createdAt",
            (SELECT count(*)::int FROM students s WHERE s.institution_id = i.id AND s.status <> 'archived') AS students,
            (SELECT count(*)::int FROM teachers t WHERE t.institution_id = i.id) AS staff,
            (SELECT count(*)::int FROM users u WHERE u.institution_id = i.id) AS users,
            (SELECT p.name FROM institution_subscriptions sub
               JOIN subscription_packages p ON p.id = sub.package_id
               WHERE sub.institution_id = i.id ORDER BY sub.created_at DESC LIMIT 1) AS "packageName"
     FROM institutions i ORDER BY i.created_at DESC`
  );
  return rows;
}

export async function getInstitutionDetail(id: string) {
  const institution = await superadmin.getInstitution(id); // throws 404
  const [limits, stats] = await Promise.all([institutionLimits(id), institutionStats(id)]);
  return { ...institution, limits, stats };
}

// --- Lifecycle (audited) ---

export async function createInstitution(
  input: z.infer<typeof createInstitutionSchema>,
  actor: Actor
) {
  const institution = await superadmin.createInstitution(input);
  const instId = (institution as Record<string, unknown>).id as string;
  await recordAudit(actor, {
    action: "institution.create",
    targetType: "institution",
    targetId: instId,
    institutionId: instId,
    detail: { name: input.name, code: input.code, type: input.type ?? "school" },
  });
  return institution;
}

export async function updateInstitution(
  id: string,
  input: z.infer<typeof updateInstitutionSchema>,
  actor: Actor
) {
  const institution = await superadmin.updateInstitution(id, input);
  await recordAudit(actor, {
    action: "institution.update",
    targetType: "institution",
    targetId: id,
    institutionId: id,
    detail: { ...input },
  });
  return institution;
}

async function setActive(
  id: string,
  active: boolean,
  reason: string | undefined,
  actor: Actor
) {
  const { rows } = await query(
    `UPDATE institutions SET is_active = $2 WHERE id = $1
     RETURNING id, name, code, type, is_active AS "isActive"`,
    [id, active]
  );
  if (!rows[0]) throw ApiError.notFound("Institution not found");
  await recordAudit(actor, {
    action: active ? "institution.activate" : "institution.suspend",
    targetType: "institution",
    targetId: id,
    institutionId: id,
    detail: reason ? { reason } : {},
  });
  return rows[0];
}

export function suspendInstitution(id: string, input: z.infer<typeof suspendSchema>, actor: Actor) {
  return setActive(id, false, input.reason, actor);
}

export function activateInstitution(id: string, actor: Actor) {
  return setActive(id, true, undefined, actor);
}

export async function assignSubscription(
  id: string,
  input: z.infer<typeof assignSubscriptionSchema>,
  actor: Actor
) {
  const subscription = await superadmin.assignSubscription(id, input);
  await recordAudit(actor, {
    action: "subscription.assign",
    targetType: "subscription",
    targetId: subscription.id as string,
    institutionId: id,
    detail: { packageId: input.packageId, status: input.status ?? "active" },
  });
  return subscription;
}

export async function setLimits(
  id: string,
  input: z.infer<typeof setLimitsSchema>,
  actor: Actor
) {
  const { rows } = await query(
    `UPDATE institutions SET settings =
       COALESCE(settings, '{}'::jsonb)
       || jsonb_build_object('limits', COALESCE(settings->'limits', '{}'::jsonb) || $2::jsonb)
     WHERE id = $1
     RETURNING id, name, settings->'limits' AS limits`,
    [id, JSON.stringify(input)]
  );
  if (!rows[0]) throw ApiError.notFound("Institution not found");
  await recordAudit(actor, {
    action: "limits.update",
    targetType: "limits",
    targetId: id,
    institutionId: id,
    detail: { ...input },
  });
  return rows[0];
}

// --- Cross-tenant audit viewer (durable; read-only; no secrets) ---

export async function listAudit(filters: z.infer<typeof platformAuditQuerySchema>) {
  const params: unknown[] = [];
  const where: string[] = [];
  if (filters.institutionId) {
    params.push(filters.institutionId);
    where.push(`institution_id = $${params.length}`);
  }
  if (filters.actorId) {
    params.push(filters.actorId);
    where.push(`actor_id = $${params.length}`);
  }
  if (filters.action) {
    params.push(filters.action);
    where.push(`action = $${params.length}`);
  }
  if (filters.targetType) {
    params.push(filters.targetType);
    where.push(`target_type = $${params.length}`);
  }
  if (filters.dateFrom) {
    params.push(`${filters.dateFrom}T00:00:00.000Z`);
    where.push(`created_at >= $${params.length}`);
  }
  if (filters.dateTo) {
    params.push(`${filters.dateTo}T23:59:59.999Z`);
    where.push(`created_at <= $${params.length}`);
  }
  params.push(filters.limit ?? 100);
  const { rows } = await query(
    `SELECT id, action, target_type AS "targetType", target_id AS "targetId",
            institution_id AS "institutionId", actor_id AS "actorId", actor_email AS "actorEmail",
            actor_role AS "actorRole", detail, ip, created_at AS "createdAt"
     FROM platform_audit_log
     ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
     ORDER BY created_at DESC LIMIT $${params.length}`,
    params
  );
  return rows;
}

// --- Health ---

export function health() {
  return systemHealth();
}

// --- Support impersonation (audited; never returns secrets) ---

export async function impersonate(
  input: z.infer<typeof impersonateSchema>,
  actor: Actor
) {
  const { rows } = await query<{
    id: string;
    email: string;
    role: string;
    institutionId: string | null;
    fullName: string;
  }>(
    `SELECT id, email, role, institution_id AS "institutionId", full_name AS "fullName"
     FROM users WHERE id = $1`,
    [input.userId]
  );
  const target = rows[0];
  if (!target) throw ApiError.notFound("User not found");
  if (target.role === "super_admin") {
    throw ApiError.badRequest("Cannot impersonate a platform super admin");
  }
  if (!target.institutionId) {
    throw ApiError.badRequest("Target is not a tenant user");
  }

  const token = signAccessToken({
    sub: target.id,
    email: target.email,
    role: target.role as never,
    institutionId: target.institutionId,
  });
  await recordAudit(actor, {
    action: "impersonate.start",
    targetType: "user",
    targetId: target.id,
    institutionId: target.institutionId,
    detail: { targetEmail: target.email, targetRole: target.role, reason: input.reason },
  });

  // Only the impersonation token + safe identity fields are returned — never the
  // password hash, refresh token, or any stored secret.
  return {
    impersonating: true,
    token,
    user: {
      id: target.id,
      email: target.email,
      role: target.role,
      institutionId: target.institutionId,
      fullName: target.fullName,
    },
  };
}

// --- RBAC console (role ↔ permission management) ---

/** Critical permissions that can never be revoked from super_admin (would remove
 *  the platform's own control surface). All `platform:*` keys are protected. */
function isCriticalForSuperAdmin(role: string, permissionKey: string): boolean {
  return role === "super_admin" && permissionKey.startsWith("platform:");
}

/** Full permission catalogue grouped by module, with the roles holding each. */
export async function permissionCatalogue() {
  const { rows } = await query<{ key: string; description: string; roles: string[] }>(
    `SELECT p.key, p.description,
            COALESCE(array_agg(rp.role ORDER BY rp.role) FILTER (WHERE rp.role IS NOT NULL), '{}') AS roles
     FROM permissions p
     LEFT JOIN role_permissions rp ON rp.permission_id = p.id
     GROUP BY p.id, p.key, p.description
     ORDER BY p.key`
  );
  const groups = new Map<string, Array<{ key: string; description: string; roles: string[] }>>();
  for (const r of rows) {
    const moduleKey = r.key.split(":")[0];
    if (!groups.has(moduleKey)) groups.set(moduleKey, []);
    groups.get(moduleKey)!.push({ key: r.key, description: r.description, roles: r.roles });
  }
  return Array.from(groups.entries()).map(([module, permissions]) => ({ module, permissions }));
}

/** Role → explicitly granted permission keys (from role_permissions). Note:
 *  super_admin additionally has implicit full access at runtime. */
export async function roleMatrix() {
  const { rows } = await query<{ role: string; permissions: string[] }>(
    `SELECT rp.role, array_agg(p.key ORDER BY p.key) AS permissions
     FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id
     GROUP BY rp.role ORDER BY rp.role`
  );
  return rows;
}

async function permissionIdByKey(permissionKey: string): Promise<string> {
  const { rows } = await query<{ id: string }>("SELECT id FROM permissions WHERE key = $1", [
    permissionKey,
  ]);
  if (!rows[0]) throw ApiError.notFound("Unknown permission");
  return rows[0].id;
}

export async function grantRolePermission(
  role: string,
  permissionKey: string,
  actor: Actor,
  reason?: string
) {
  const permissionId = await permissionIdByKey(permissionKey); // 404 for invalid permission
  const { rowCount } = await query(
    `INSERT INTO role_permissions (role, permission_id) VALUES ($1, $2)
     ON CONFLICT (role, permission_id) DO NOTHING`,
    [role, permissionId]
  );
  const added = (rowCount ?? 0) > 0;
  invalidatePermissionCache(); // changes apply immediately
  await recordAudit(actor, {
    action: "rbac.grant",
    targetType: "role_permission",
    targetId: permissionId,
    institutionId: null,
    detail: { role, permission: permissionKey, alreadyGranted: !added, reason },
  });
  return { role, permission: permissionKey, granted: true, alreadyGranted: !added };
}

export async function revokeRolePermission(
  role: string,
  permissionKey: string,
  actor: Actor,
  reason?: string
) {
  if (isCriticalForSuperAdmin(role, permissionKey)) {
    throw ApiError.badRequest("Cannot revoke a critical platform permission from super_admin");
  }
  const permissionId = await permissionIdByKey(permissionKey); // 404 for invalid permission
  const { rowCount } = await query(
    "DELETE FROM role_permissions WHERE role = $1 AND permission_id = $2",
    [role, permissionId]
  );
  const removed = (rowCount ?? 0) > 0;
  invalidatePermissionCache();
  await recordAudit(actor, {
    action: "rbac.revoke",
    targetType: "role_permission",
    targetId: permissionId,
    institutionId: null,
    detail: { role, permission: permissionKey, removed, reason },
  });
  return { role, permission: permissionKey, revoked: true, removed };
}
