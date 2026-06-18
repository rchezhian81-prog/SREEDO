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

/**
 * Enforces a plan's student/staff cap before creating a record. No active plan
 * or a NULL limit means "unlimited" — the guard degrades to allow.
 */
export async function assertWithinPlanLimit(
  institutionId: string,
  kind: "students" | "staff"
): Promise<void> {
  const plan = await activePlan(institutionId);
  const max = kind === "students" ? plan.maxStudents : plan.maxStaff;
  if (max == null) return;
  const table = kind === "students" ? "students" : "teachers";
  const { rows } = await query<{ c: number }>(
    `SELECT count(*)::int AS c FROM ${table} WHERE institution_id = $1`,
    [institutionId]
  );
  if (Number(rows[0].c) >= max)
    throw ApiError.forbidden(`Plan limit reached: maximum ${kind} (${max}) for this plan`);
}
