import { pool, query } from "../../db/postgres";
import { getMongoDb } from "../../db/mongo";
import { ApiError } from "../../utils/api-error";
import { effectiveLimits, scheduledReportCount, storageUsageMb } from "../../utils/plan-limits";
import { invalidateFeatureFlagCache } from "../../middleware/feature-flag";
import type { z } from "zod";
import type { auditQuerySchema, updateSettingsSchema } from "./adminconsole.schema";

async function assertInstitution(id: string): Promise<void> {
  const { rows } = await query("SELECT 1 FROM institutions WHERE id = $1", [id]);
  if (!rows[0]) throw ApiError.notFound("Institution not found");
}

// --- Institutions (global, super-admin) ---

export async function listInstitutionsBrief() {
  const { rows } = await query(
    `SELECT id, name, code, type, is_active AS "isActive" FROM institutions ORDER BY name`
  );
  return rows;
}

export async function getInstitutionSettings(id: string) {
  const { rows } = await query(
    `SELECT id, name, code, type, is_active AS "isActive", settings FROM institutions WHERE id = $1`,
    [id]
  );
  if (!rows[0]) throw ApiError.notFound("Institution not found");
  return rows[0];
}

export async function updateInstitutionSettings(
  id: string,
  input: z.infer<typeof updateSettingsSchema>
) {
  // The structured settings keys are merged into the institutions.settings JSONB;
  // name/type/is_active are columns.
  const settingsPatch: Record<string, unknown> = {};
  if (input.contact !== undefined) settingsPatch.contact = input.contact;
  if (input.enabledModules !== undefined) settingsPatch.enabledModules = input.enabledModules;
  if (input.featureFlags !== undefined) settingsPatch.featureFlags = input.featureFlags;
  if (input.academicYearDefaults !== undefined)
    settingsPatch.academicYearDefaults = input.academicYearDefaults;

  const { rows } = await query(
    `UPDATE institutions SET
       name = COALESCE($2, name),
       type = COALESCE($3, type),
       is_active = COALESCE($4, is_active),
       settings = COALESCE(settings, '{}'::jsonb) || $5::jsonb
     WHERE id = $1
     RETURNING id, name, code, type, is_active AS "isActive", settings`,
    [
      id,
      input.name ?? null,
      input.type ?? null,
      input.isActive ?? null,
      JSON.stringify(settingsPatch),
    ]
  );
  if (!rows[0]) throw ApiError.notFound("Institution not found");
  // Feature flags may have changed — drop the cached copy so gates re-read.
  if (input.featureFlags !== undefined) invalidateFeatureFlagCache(id);
  return rows[0];
}

// --- Feature limits / plan usage ---

export async function institutionLimits(id: string) {
  await assertInstitution(id);
  // EFFECTIVE limits = per-institution overrides (settings.limits) over the plan,
  // so caps set in the platform console actually display and enforce.
  const [limits, counts, storageUsedMb, scheduledReports] = await Promise.all([
    effectiveLimits(id),
    query<{ students: number; staff: number; branches: number }>(
      `SELECT (SELECT count(*)::int FROM students WHERE institution_id = $1) AS students,
              (SELECT count(*)::int FROM teachers WHERE institution_id = $1) AS staff,
              (SELECT count(*)::int FROM branches WHERE institution_id = $1) AS branches`,
      [id]
    ),
    storageUsageMb(id),
    scheduledReportCount(id),
  ]);
  const { students, staff, branches } = counts.rows[0];
  const within = (max: number | null, used: number) => max == null || used <= max;
  return {
    packageName: limits.packageName,
    maxStudents: limits.maxStudents,
    students,
    maxStaff: limits.maxStaff,
    staff,
    maxBranches: limits.maxBranches,
    branches,
    storageLimitMb: limits.storageLimitMb,
    storageUsedMb,
    reportsQuota: limits.reportsQuota,
    scheduledReportsQuota: limits.scheduledReportsQuota,
    scheduledReports,
    smsQuota: limits.smsQuota,
    withinLimits:
      within(limits.maxStudents, students) &&
      within(limits.maxStaff, staff) &&
      within(limits.maxBranches, branches) &&
      within(limits.storageLimitMb, storageUsedMb) &&
      within(limits.scheduledReportsQuota, scheduledReports),
  };
}

// --- Cross-tenant read-only snapshot (the "switch" view) ---

export async function institutionStats(id: string) {
  await assertInstitution(id);
  const { rows } = await query(
    `SELECT (SELECT count(*)::int FROM students WHERE institution_id = $1) AS students,
            (SELECT count(*)::int FROM teachers WHERE institution_id = $1) AS teachers,
            (SELECT count(*)::int FROM classes WHERE institution_id = $1) AS classes,
            (SELECT count(*)::int FROM sections WHERE institution_id = $1) AS sections,
            (SELECT count(*)::int FROM subjects WHERE institution_id = $1) AS subjects,
            (SELECT count(*)::int FROM users WHERE institution_id = $1) AS users,
            (SELECT COALESCE(sum(amount_due - amount_paid), 0)
             FROM invoices WHERE institution_id = $1 AND status IN ('pending','partially_paid')) AS "feesOutstanding",
            (SELECT count(*)::int FROM payment_orders
             WHERE institution_id = $1 AND status = 'success') AS "onlinePaymentsCount",
            (SELECT COALESCE(sum(amount), 0) FROM payment_orders
             WHERE institution_id = $1 AND status = 'success') AS "onlinePaymentsTotal"
     FROM institutions WHERE id = $1`,
    [id]
  );
  return rows[0];
}

// --- Audit log viewer (reads MongoDB; degrades gracefully) ---

interface AuditRow {
  id: string;
  method: string;
  path: string;
  module: string | null;
  statusCode: number | null;
  userId: string | null;
  userRole: string | null;
  institutionId: string | null;
  ip: string | null;
  createdAt: string;
}

async function fetchAuditRows(
  filters: z.infer<typeof auditQuerySchema>
): Promise<{ available: boolean; rows: AuditRow[] }> {
  const db = getMongoDb();
  if (!db) return { available: false, rows: [] };
  const q: Record<string, unknown> = {};
  if (filters.institutionId) q.institutionId = filters.institutionId;
  if (filters.userId) q.userId = filters.userId;
  if (filters.module) q.module = filters.module;
  if (filters.action) q.method = filters.action.toUpperCase();
  if (filters.dateFrom || filters.dateTo) {
    const range: Record<string, Date> = {};
    if (filters.dateFrom) range.$gte = new Date(`${filters.dateFrom}T00:00:00.000Z`);
    if (filters.dateTo) range.$lte = new Date(`${filters.dateTo}T23:59:59.999Z`);
    q.createdAt = range;
  }
  const docs = await db
    .collection("audit_logs")
    .find(q)
    .sort({ createdAt: -1 })
    .limit(filters.limit ?? 100)
    .toArray();
  const rows: AuditRow[] = docs.map((d) => ({
    id: String(d._id),
    method: d.method ?? "",
    path: d.path ?? "",
    module: d.module ?? null,
    statusCode: d.statusCode ?? null,
    userId: d.userId ?? null,
    userRole: d.userRole ?? null,
    institutionId: d.institutionId ?? null,
    ip: d.ip ?? null,
    createdAt: d.createdAt instanceof Date ? d.createdAt.toISOString() : String(d.createdAt ?? ""),
  }));
  return { available: true, rows };
}

export async function listAuditLogs(filters: z.infer<typeof auditQuerySchema>) {
  return fetchAuditRows(filters);
}

export async function auditLogsCsv(filters: z.infer<typeof auditQuerySchema>): Promise<string> {
  const { rows } = await fetchAuditRows(filters);
  const cols: Array<keyof AuditRow> = [
    "createdAt", "method", "path", "module", "statusCode", "userRole", "userId", "institutionId", "ip",
  ];
  const esc = (v: unknown) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
  };
  const lines = [cols.join(",")];
  for (const r of rows) lines.push(cols.map((c) => esc(r[c])).join(","));
  return lines.join("\n");
}

// --- Backup / export (safe summary; no secrets or storage keys) ---

export async function createExport(id: string, requestedBy: string) {
  const inst = await query<{ name: string; code: string; type: string }>(
    "SELECT name, code, type FROM institutions WHERE id = $1",
    [id]
  );
  if (!inst.rows[0]) throw ApiError.notFound("Institution not found");

  // A safe, aggregate snapshot — counts + institution metadata only. No PII rows,
  // no secrets, no private storage keys are ever included.
  const counts = await query<Record<string, number>>(
    `SELECT (SELECT count(*)::int FROM students WHERE institution_id = $1) AS students,
            (SELECT count(*)::int FROM teachers WHERE institution_id = $1) AS teachers,
            (SELECT count(*)::int FROM classes WHERE institution_id = $1) AS classes,
            (SELECT count(*)::int FROM invoices WHERE institution_id = $1) AS invoices,
            (SELECT count(*)::int FROM payments WHERE institution_id = $1) AS payments,
            (SELECT count(*)::int FROM exams WHERE institution_id = $1) AS exams`,
    [id]
  );
  const summary = {
    institution: inst.rows[0],
    counts: counts.rows[0],
    generatedAt: new Date().toISOString(),
  };
  const { rows } = await query(
    `INSERT INTO data_exports (institution_id, kind, status, summary, requested_by)
     VALUES ($1, 'summary', 'completed', $2::jsonb, $3)
     RETURNING id, institution_id AS "institutionId", kind, status, summary, created_at AS "createdAt"`,
    [id, JSON.stringify(summary), requestedBy]
  );
  return rows[0];
}

export async function listExports(institutionId?: string) {
  const params: unknown[] = [];
  let where = "";
  if (institutionId) {
    params.push(institutionId);
    where = "WHERE e.institution_id = $1";
  }
  const { rows } = await query(
    `SELECT e.id, e.institution_id AS "institutionId", i.name AS "institutionName",
            e.kind, e.status, e.summary, e.created_at AS "createdAt"
     FROM data_exports e JOIN institutions i ON i.id = e.institution_id
     ${where} ORDER BY e.created_at DESC LIMIT 100`,
    params
  );
  return rows;
}

// --- System health / status ---

export async function systemHealth() {
  let postgres = false;
  try {
    await pool.query("SELECT 1");
    postgres = true;
  } catch {
    postgres = false;
  }
  const counts = postgres
    ? (
        await query<{ institutions: number; users: number }>(
          `SELECT (SELECT count(*)::int FROM institutions) AS institutions,
                  (SELECT count(*)::int FROM users) AS users`
        )
      ).rows[0]
    : { institutions: 0, users: 0 };
  return {
    postgres,
    mongo: getMongoDb() !== null,
    auditLog: getMongoDb() !== null,
    institutions: counts.institutions,
    users: counts.users,
    uptimeSeconds: Math.round(process.uptime()),
  };
}
