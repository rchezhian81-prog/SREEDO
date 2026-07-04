import type { z } from "zod";
import { query } from "../../db/postgres";
import { ApiError } from "../../utils/api-error";
import { invalidatePermissionCache } from "../../middleware/permissions";
import { cached, invalidatePrefix } from "../../cache/cache";
import * as superadmin from "../superadmin/superadmin.service";
import { institutionLimits, institutionStats, systemHealth } from "../adminconsole/adminconsole.service";
import type {
  assignSubscriptionSchema,
  createInstitutionSchema,
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
export async function recordAudit(actor: Actor, input: AuditInput): Promise<void> {
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
       (SELECT count(*)::int FROM institution_subscriptions WHERE status IN ('active','trialing')) AS "activeSubscriptions",
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

type InstitutionFilters = Partial<{
  q: string;
  status: "active" | "suspended";
  type: "school" | "college";
  packageId: string;
  createdFrom: string;
  createdTo: string;
}>;

/** Parameterized WHERE for the institution directory (no value interpolation). */
function buildInstitutionFilters(f: InstitutionFilters): {
  whereSql: string;
  params: unknown[];
} {
  const where: string[] = [];
  const params: unknown[] = [];
  const add = (clause: (n: number) => string, value: unknown) => {
    params.push(value);
    where.push(clause(params.length));
  };
  if (f.q) add((n) => `(i.name ILIKE $${n} OR i.code ILIKE $${n})`, `%${f.q}%`);
  if (f.status) add((n) => `i.is_active = $${n}`, f.status === "active");
  if (f.type) add((n) => `i.type = $${n}`, f.type);
  if (f.packageId)
    add(
      (n) =>
        `(SELECT sub.package_id FROM institution_subscriptions sub
            WHERE sub.institution_id = i.id ORDER BY sub.created_at DESC LIMIT 1) = $${n}`,
      f.packageId
    );
  if (f.createdFrom) add((n) => `i.created_at >= $${n}::date`, f.createdFrom);
  if (f.createdTo) add((n) => `i.created_at < ($${n}::date + 1)`, f.createdTo);
  return { whereSql: where.length ? `WHERE ${where.join(" AND ")}` : "", params };
}

const INSTITUTION_COLS = `
  i.id, i.name, i.code, i.type, i.is_active AS "isActive", i.created_at AS "createdAt",
  (SELECT count(*)::int FROM students s WHERE s.institution_id = i.id AND s.status <> 'archived') AS students,
  (SELECT count(*)::int FROM teachers t WHERE t.institution_id = i.id) AS staff,
  (SELECT count(*)::int FROM users u WHERE u.institution_id = i.id) AS users,
  (SELECT p.name FROM institution_subscriptions sub
     JOIN subscription_packages p ON p.id = sub.package_id
     WHERE sub.institution_id = i.id ORDER BY sub.created_at DESC LIMIT 1) AS "packageName"`;

const INSTITUTION_SORT: Record<string, string> = {
  name: "i.name",
  code: "i.code",
  status: "i.is_active",
  createdAt: "i.created_at",
  students: "students",
  staff: "staff",
  package: '"packageName"',
};

interface ListInstitutionsQuery extends InstitutionFilters {
  page: number;
  pageSize: number;
  sort: string;
  order: "asc" | "desc";
}

export async function listInstitutions(q: ListInstitutionsQuery) {
  const { whereSql, params } = buildInstitutionFilters(q);
  const count = await query<{ n: number }>(
    `SELECT count(*)::int AS n FROM institutions i ${whereSql}`,
    params
  );
  const sortCol = INSTITUTION_SORT[q.sort] ?? "i.created_at";
  const order = q.order === "asc" ? "ASC" : "DESC";
  const { rows } = await query(
    `SELECT ${INSTITUTION_COLS} FROM institutions i
     ${whereSql}
     ORDER BY ${sortCol} ${order} NULLS LAST, i.created_at DESC
     LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, q.pageSize, (q.page - 1) * q.pageSize]
  );
  return { rows, total: count.rows[0].n, page: q.page, pageSize: q.pageSize };
}

export interface PlatformExportColumn {
  key: string;
  label: string;
}

const INSTITUTION_EXPORT_COLUMNS: PlatformExportColumn[] = [
  { key: "code", label: "Code" },
  { key: "name", label: "Name" },
  { key: "type", label: "Type" },
  { key: "status", label: "Status" },
  { key: "students", label: "Students" },
  { key: "staff", label: "Staff" },
  { key: "users", label: "Users" },
  { key: "packageName", label: "Package" },
  { key: "createdAt", label: "Created" },
];

/** Flatten the filtered institution directory into export rows (capped). */
export async function exportInstitutions(
  f: InstitutionFilters & { sort: string; order: "asc" | "desc" }
) {
  const { whereSql, params } = buildInstitutionFilters(f);
  const sortCol = INSTITUTION_SORT[f.sort] ?? "i.created_at";
  const order = f.order === "asc" ? "ASC" : "DESC";
  const raw = (
    await query<Record<string, unknown>>(
      `SELECT ${INSTITUTION_COLS} FROM institutions i
       ${whereSql} ORDER BY ${sortCol} ${order} NULLS LAST, i.created_at DESC LIMIT 20000`,
      params
    )
  ).rows;
  const rows = raw.map((r) => ({
    code: r.code,
    name: r.name,
    type: r.type,
    status: r.isActive ? "active" : "suspended",
    students: Number(r.students),
    staff: Number(r.staff),
    users: Number(r.users),
    packageName: r.packageName ?? "",
    createdAt:
      r.createdAt instanceof Date
        ? r.createdAt.toISOString().slice(0, 10)
        : String(r.createdAt ?? "").slice(0, 10),
  }));
  return { columns: INSTITUTION_EXPORT_COLUMNS, rows: rows as Record<string, unknown>[] };
}

/** Tenant-user search for the support-access selector (impersonatable users only). */
export async function searchUsers(f: {
  q?: string;
  institutionId?: string;
  role?: string;
  status?: "active" | "inactive";
  limit: number;
}) {
  const where: string[] = ["u.role <> 'super_admin'", "u.institution_id IS NOT NULL"];
  const params: unknown[] = [];
  const add = (clause: (n: number) => string, value: unknown) => {
    params.push(value);
    where.push(clause(params.length));
  };
  if (f.q) add((n) => `(u.email ILIKE $${n} OR u.full_name ILIKE $${n})`, `%${f.q}%`);
  if (f.institutionId) add((n) => `u.institution_id = $${n}`, f.institutionId);
  if (f.role) add((n) => `u.role = $${n}`, f.role);
  if (f.status) add((n) => `u.is_active = $${n}`, f.status === "active");
  params.push(f.limit);
  const { rows } = await query(
    `SELECT u.id, u.email, u.full_name AS "fullName", u.role,
            u.is_active AS "isActive", u.institution_id AS "institutionId",
            inst.name AS "institutionName", inst.code AS "institutionCode"
     FROM users u JOIN institutions inst ON inst.id = u.institution_id
     WHERE ${where.join(" AND ")}
     ORDER BY u.full_name ASC LIMIT $${params.length}`,
    params
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
  // Forward the actor so a type-applicability override is audited on this path too.
  const subscription = await superadmin.assignSubscription(id, input, actor);
  await recordAudit(actor, {
    action: "subscription.assign",
    targetType: "subscription",
    targetId: subscription.id as string,
    institutionId: id,
    detail: { packageId: input.packageId, status: input.status ?? "active", override: input.override ?? false },
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

type AuditFilters = Partial<{
  q: string;
  institutionId: string;
  actorId: string;
  action: string;
  targetType: string;
  ip: string;
  dateFrom: string;
  dateTo: string;
}>;

/** Parameterized WHERE for the audit viewer (no value interpolation). */
function buildAuditFilters(f: AuditFilters): { whereSql: string; params: unknown[] } {
  const where: string[] = [];
  const params: unknown[] = [];
  const add = (clause: (n: number) => string, value: unknown) => {
    params.push(value);
    where.push(clause(params.length));
  };
  if (f.q)
    add(
      (n) =>
        `(a.action ILIKE $${n} OR a.actor_email ILIKE $${n} OR a.actor_role ILIKE $${n} OR a.target_id::text ILIKE $${n} OR a.ip ILIKE $${n} OR inst.name ILIKE $${n} OR inst.code ILIKE $${n})`,
      `%${f.q}%`
    );
  if (f.institutionId) add((n) => `a.institution_id = $${n}`, f.institutionId);
  if (f.actorId) add((n) => `a.actor_id = $${n}`, f.actorId);
  if (f.action) add((n) => `a.action = $${n}`, f.action);
  if (f.targetType) add((n) => `a.target_type = $${n}`, f.targetType);
  if (f.ip) add((n) => `a.ip ILIKE $${n}`, `%${f.ip}%`);
  if (f.dateFrom) add((n) => `a.created_at >= $${n}`, `${f.dateFrom}T00:00:00.000Z`);
  if (f.dateTo) add((n) => `a.created_at <= $${n}`, `${f.dateTo}T23:59:59.999Z`);
  return { whereSql: where.length ? `WHERE ${where.join(" AND ")}` : "", params };
}

const AUDIT_COLS = `
  a.id, a.action, a.target_type AS "targetType", a.target_id AS "targetId",
  a.institution_id AS "institutionId", inst.name AS "institutionName", inst.code AS "institutionCode",
  a.actor_id AS "actorId", a.actor_email AS "actorEmail", a.actor_role AS "actorRole",
  a.detail, a.ip, a.created_at AS "createdAt"`;

const AUDIT_SORT: Record<string, string> = {
  createdAt: "a.created_at",
  action: "a.action",
  actorEmail: "a.actor_email",
};

interface ListAuditQuery extends AuditFilters {
  page: number;
  pageSize: number;
  sort: string;
  order: "asc" | "desc";
}

export async function listAudit(q: ListAuditQuery) {
  const { whereSql, params } = buildAuditFilters(q);
  const count = await query<{ n: number }>(
    `SELECT count(*)::int AS n
     FROM platform_audit_log a
     LEFT JOIN institutions inst ON inst.id = a.institution_id
     ${whereSql}`,
    params
  );
  const sortCol = AUDIT_SORT[q.sort] ?? "a.created_at";
  const order = q.order === "asc" ? "ASC" : "DESC";
  const { rows } = await query(
    `SELECT ${AUDIT_COLS}
     FROM platform_audit_log a
     LEFT JOIN institutions inst ON inst.id = a.institution_id
     ${whereSql}
     ORDER BY ${sortCol} ${order} NULLS LAST, a.created_at DESC
     LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, q.pageSize, (q.page - 1) * q.pageSize]
  );
  return { rows, total: count.rows[0].n, page: q.page, pageSize: q.pageSize };
}

const AUDIT_EXPORT_COLUMNS: PlatformExportColumn[] = [
  { key: "createdAt", label: "Time" },
  { key: "action", label: "Action" },
  { key: "actorEmail", label: "Actor" },
  { key: "actorRole", label: "Actor role" },
  { key: "institutionName", label: "Institution" },
  { key: "targetType", label: "Target type" },
  { key: "targetId", label: "Target ID" },
  { key: "ip", label: "IP" },
];

/** Flatten the filtered audit log into export rows (capped). */
export async function exportAudit(
  f: AuditFilters & { sort: string; order: "asc" | "desc" }
) {
  const { whereSql, params } = buildAuditFilters(f);
  const sortCol = AUDIT_SORT[f.sort] ?? "a.created_at";
  const order = f.order === "asc" ? "ASC" : "DESC";
  const raw = (
    await query<Record<string, unknown>>(
      `SELECT ${AUDIT_COLS}
       FROM platform_audit_log a
       LEFT JOIN institutions inst ON inst.id = a.institution_id
       ${whereSql} ORDER BY ${sortCol} ${order} NULLS LAST, a.created_at DESC LIMIT 50000`,
      params
    )
  ).rows;
  const rows = raw.map((r) => ({
    createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt ?? ""),
    action: r.action,
    actorEmail: r.actorEmail ?? "",
    actorRole: r.actorRole ?? "",
    institutionName: r.institutionName ?? "",
    targetType: r.targetType ?? "",
    targetId: r.targetId ?? "",
    ip: r.ip ?? "",
  }));
  return { columns: AUDIT_EXPORT_COLUMNS, rows: rows as Record<string, unknown>[] };
}

/** Latest audit events for one institution (institution detail timeline). */
export async function institutionRecentActivity(institutionId: string, limit = 20) {
  const { rows } = await query(
    `SELECT ${AUDIT_COLS}
     FROM platform_audit_log a
     LEFT JOIN institutions inst ON inst.id = a.institution_id
     WHERE a.institution_id = $1
     ORDER BY a.created_at DESC LIMIT $2`,
    [institutionId, limit]
  );
  return rows;
}

// --- Health ---

export function health() {
  return systemHealth();
}

// --- Support impersonation ---
// The start/end lifecycle moved to `support.service.ts` (Super Admin G — governed,
// scope-enforced, revocable sessions). The legacy /platform/impersonate routes
// delegate there so no unenforced impersonation path remains.

// --- RBAC console (role ↔ permission management) ---

/** Critical permissions that can never be revoked from super_admin (would remove
 *  the platform's own control surface). All `platform:*` keys are protected. */
function isCriticalForSuperAdmin(role: string, permissionKey: string): boolean {
  return role === "super_admin" && permissionKey.startsWith("platform:");
}

// The RBAC catalogue/matrix are global reference data (permissions +
// role_permissions are not tenant-scoped) read on every super-admin console
// load and changed only via grant/revoke below. Cache them under the shared
// "rbac:" namespace and drop the whole namespace whenever a grant/revoke lands.
const RBAC_TTL_MS = 60_000;
const RBAC_CACHE_PREFIX = "rbac:";

/** Full permission catalogue grouped by module, with the roles holding each. */
export function permissionCatalogue() {
  return cached(`${RBAC_CACHE_PREFIX}catalogue`, RBAC_TTL_MS, async () => {
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
  });
}

/** Role → explicitly granted permission keys (from role_permissions). Note:
 *  super_admin additionally has implicit full access at runtime. */
export function roleMatrix() {
  return cached(`${RBAC_CACHE_PREFIX}matrix`, RBAC_TTL_MS, async () => {
    const { rows } = await query<{ role: string; permissions: string[] }>(
      `SELECT rp.role, array_agg(p.key ORDER BY p.key) AS permissions
       FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id
       GROUP BY rp.role ORDER BY rp.role`
    );
    return rows;
  });
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
  invalidatePermissionCache(); // runtime authz changes apply immediately
  invalidatePrefix(RBAC_CACHE_PREFIX); // catalogue/matrix now stale
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
  invalidatePrefix(RBAC_CACHE_PREFIX); // catalogue/matrix now stale
  await recordAudit(actor, {
    action: "rbac.revoke",
    targetType: "role_permission",
    targetId: permissionId,
    institutionId: null,
    detail: { role, permission: permissionKey, removed, reason },
  });
  return { role, permission: permissionKey, revoked: true, removed };
}
