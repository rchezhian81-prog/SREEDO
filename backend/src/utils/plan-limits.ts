import { query } from "../db/postgres";
import { ApiError } from "./api-error";

export interface ActivePlan {
  packageName: string | null;
  maxStudents: number | null;
  maxStaff: number | null;
  features: Record<string, unknown>;
}

/** The institution's current (active/trialing) subscription package, if any. */
export async function activePlan(institutionId: string): Promise<ActivePlan> {
  const { rows } = await query<{
    name: string;
    max_students: number | null;
    max_staff: number | null;
    features: Record<string, unknown>;
  }>(
    `SELECT p.name, p.max_students, p.max_staff, p.features
     FROM institution_subscriptions s
     JOIN subscription_packages p ON p.id = s.package_id
     WHERE s.institution_id = $1 AND s.status IN ('active', 'trialing')
     ORDER BY s.created_at DESC LIMIT 1`,
    [institutionId]
  );
  const r = rows[0];
  return {
    packageName: r?.name ?? null,
    maxStudents: r?.max_students ?? null,
    maxStaff: r?.max_staff ?? null,
    features: r?.features ?? {},
  };
}

export interface EffectiveLimits {
  packageName: string | null;
  maxStudents: number | null;
  maxStaff: number | null;
  maxBranches: number | null;
  storageLimitMb: number | null;
  reportsQuota: number | null;
  scheduledReportsQuota: number | null;
  smsQuota: number | null;
}

/**
 * The institution's EFFECTIVE limits: per-institution overrides (stored in
 * institutions.settings.limits by the platform console) take precedence over the
 * active subscription package, which in turn falls back to its `features`. A null
 * override means "no override" → fall through to the plan. This is the single
 * source of truth for both display (institutionLimits) and enforcement
 * (assertWithinPlanLimit), so overrides actually round-trip and apply.
 */
export async function effectiveLimits(institutionId: string): Promise<EffectiveLimits> {
  const plan = await activePlan(institutionId);
  const { rows } = await query<{ limits: Record<string, number | null> | null }>(
    `SELECT settings->'limits' AS limits FROM institutions WHERE id = $1`,
    [institutionId]
  );
  const o = rows[0]?.limits ?? {};
  const num = (v: unknown): number | null => (typeof v === "number" ? v : null);
  const f = plan.features ?? {};
  return {
    packageName: plan.packageName,
    maxStudents: num(o.maxStudents) ?? plan.maxStudents,
    maxStaff: num(o.maxStaff) ?? plan.maxStaff,
    maxBranches: num(o.maxBranches),
    storageLimitMb: num(o.storageLimitMb) ?? (f.storageLimitMb as number | undefined) ?? null,
    reportsQuota: num(o.reportsQuota) ?? (f.reportsQuota as number | undefined) ?? null,
    scheduledReportsQuota:
      num(o.scheduledReportsQuota) ?? (f.scheduledReportsQuota as number | undefined) ?? null,
    smsQuota: (f.smsQuota as number | undefined) ?? null,
  };
}

const MB = 1024 * 1024;

/**
 * Total storage an institution is currently using, in MB — the sum of every
 * stored file it owns across the tenant `documents` table AND the operator-facing
 * `tenant_documents` table (both keep byte sizes; the actual bytes live in object
 * storage / disk). Rounded to 2 decimals. Cheap enough to compute on demand.
 */
export async function storageUsageMb(institutionId: string): Promise<number> {
  const { rows } = await query<{ bytes: string }>(
    `SELECT
       COALESCE((SELECT sum(size_bytes) FROM documents WHERE institution_id = $1), 0) +
       COALESCE((SELECT sum(size_bytes) FROM tenant_documents
                 WHERE institution_id = $1 AND archived_at IS NULL), 0) AS bytes`,
    [institutionId]
  );
  const bytes = Number(rows[0]?.bytes ?? 0);
  return Math.round((bytes / MB) * 100) / 100;
}

/**
 * Enforces the institution's EFFECTIVE storage cap before accepting an upload:
 * (current usage + the incoming file) must stay within `storageLimitMb`. A null
 * limit means "unlimited" — the guard degrades to allow.
 */
export async function assertStorageWithinLimit(
  institutionId: string,
  incomingBytes: number
): Promise<void> {
  const { storageLimitMb } = await effectiveLimits(institutionId);
  if (storageLimitMb == null) return;
  const used = await storageUsageMb(institutionId);
  const incoming = incomingBytes / MB;
  if (used + incoming > storageLimitMb) {
    throw ApiError.forbidden(
      `Storage limit reached: this plan allows ${storageLimitMb} MB (currently using ${used} MB). Free up space or upgrade the plan.`
    );
  }
}

/** Number of saved scheduled-report definitions the institution has. */
export async function scheduledReportCount(institutionId: string): Promise<number> {
  const { rows } = await query<{ c: number }>(
    `SELECT count(*)::int AS c FROM scheduled_reports WHERE institution_id = $1`,
    [institutionId]
  );
  return Number(rows[0]?.c ?? 0);
}

/**
 * Enforces the institution's EFFECTIVE scheduled-report quota before creating a
 * new schedule. A null quota means "unlimited" — the guard degrades to allow.
 */
export async function assertScheduledReportQuota(institutionId: string): Promise<void> {
  const { scheduledReportsQuota } = await effectiveLimits(institutionId);
  if (scheduledReportsQuota == null) return;
  const count = await scheduledReportCount(institutionId);
  if (count >= scheduledReportsQuota) {
    throw ApiError.forbidden(
      `Plan limit reached: maximum scheduled reports (${scheduledReportsQuota}) for this plan`
    );
  }
}

/**
 * Enforces an institution's EFFECTIVE student/staff cap before creating a record
 * (per-institution override wins over the plan). No cap (NULL) means "unlimited"
 * — the guard degrades to allow.
 */
export async function assertWithinPlanLimit(
  institutionId: string,
  kind: "students" | "staff"
): Promise<void> {
  const limits = await effectiveLimits(institutionId);
  const max = kind === "students" ? limits.maxStudents : limits.maxStaff;
  if (max == null) return;
  const table = kind === "students" ? "students" : "teachers";
  const { rows } = await query<{ c: number }>(
    `SELECT count(*)::int AS c FROM ${table} WHERE institution_id = $1`,
    [institutionId]
  );
  if (Number(rows[0].c) >= max)
    throw ApiError.forbidden(`Plan limit reached: maximum ${kind} (${max}) for this plan`);
}
