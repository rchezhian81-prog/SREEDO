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
    reportsQuota: num(o.reportsQuota),
    smsQuota: (f.smsQuota as number | undefined) ?? null,
  };
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
