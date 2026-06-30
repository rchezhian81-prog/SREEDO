import { query } from "../../db/postgres";
import { ApiError } from "../../utils/api-error";
import type { z } from "zod";
import type {
  assignSubscriptionSchema,
  createBranchSchema,
  createInstitutionSchema,
  createPackageSchema,
  updateBranchSchema,
  updateInstitutionSchema,
  updatePackageSchema,
} from "./superadmin.schema";

const INSTITUTION_COLUMNS = `
  id, name, code, type, is_active AS "isActive", settings,
  created_at AS "createdAt"`;

const BRANCH_COLUMNS = `
  id, institution_id AS "institutionId", name, address, timezone,
  is_active AS "isActive", created_at AS "createdAt"`;

const PACKAGE_COLUMNS = `
  id, name, max_students AS "maxStudents", max_staff AS "maxStaff",
  price, billing_cycle AS "billingCycle", features,
  is_active AS "isActive", created_at AS "createdAt"`;

// --- Institutions ---

export async function listInstitutions() {
  const { rows } = await query(
    `SELECT ${INSTITUTION_COLUMNS},
            (SELECT count(*) FROM branches b WHERE b.institution_id = i.id) AS "branchCount"
     FROM institutions i ORDER BY i.created_at DESC`
  );
  return rows;
}

export async function getInstitution(id: string) {
  const { rows } = await query(
    `SELECT ${INSTITUTION_COLUMNS} FROM institutions i WHERE id = $1`,
    [id]
  );
  if (!rows[0]) throw ApiError.notFound("Institution not found");
  const branches = await query(
    `SELECT ${BRANCH_COLUMNS} FROM branches WHERE institution_id = $1 ORDER BY name`,
    [id]
  );
  const subscription = await query(
    `SELECT s.id, s.status, s.starts_at AS "startsAt", s.ends_at AS "endsAt",
            p.id AS "packageId", p.name AS "packageName"
     FROM institution_subscriptions s
     JOIN subscription_packages p ON p.id = s.package_id
     WHERE s.institution_id = $1
     ORDER BY s.created_at DESC LIMIT 1`,
    [id]
  );
  return { ...rows[0], branches: branches.rows, subscription: subscription.rows[0] ?? null };
}

export async function createInstitution(
  input: z.infer<typeof createInstitutionSchema>
) {
  // Keep the tenant-facing institution_type in sync with the structural type so
  // the new tenant module never sees a school/college mismatch.
  const type = input.type ?? "school";
  const { rows } = await query<{ id: string }>(
    `INSERT INTO institutions (name, code, type, institution_type, settings)
     VALUES ($1, $2, $3, $3, $4) RETURNING id`,
    [input.name, input.code, type, input.settings ?? {}]
  );
  return getInstitution(rows[0].id);
}

export async function updateInstitution(
  id: string,
  input: z.infer<typeof updateInstitutionSchema>
) {
  const map: Record<string, string> = {
    name: "name",
    type: "type",
    isActive: "is_active",
    settings: "settings",
  };
  const sets: string[] = [];
  const params: unknown[] = [];
  for (const [field, column] of Object.entries(map)) {
    const value = (input as Record<string, unknown>)[field];
    if (value !== undefined) {
      params.push(value);
      sets.push(`${column} = $${params.length}`);
    }
  }
  // Keep institution_type in lock-step with the structural type on legacy updates.
  if (input.type !== undefined) {
    params.push(input.type);
    sets.push(`institution_type = $${params.length}`);
  }
  if (!sets.length) throw ApiError.badRequest("No fields to update");
  params.push(id);
  const { rowCount } = await query(
    `UPDATE institutions SET ${sets.join(", ")} WHERE id = $${params.length}`,
    params
  );
  if (!rowCount) throw ApiError.notFound("Institution not found");
  return getInstitution(id);
}

// Audit actor (kept local to avoid a circular import with platform.service,
// which already imports this module).
interface Actor { id: string; email: string; role: string; ip: string | null }

/**
 * SAFE archive — replaces the former hard delete. A production tenant is NEVER
 * removed (a `DELETE FROM institutions` would cascade-delete its users,
 * students, invoices, subscriptions, documents and audit history). Instead the
 * institution is marked archived + inactive, the action is audited, and every
 * related record is preserved and remains available in billing/audit history.
 */
export async function archiveInstitution(id: string, reason: string, actor: Actor): Promise<void> {
  const { rows } = await query<{ id: string }>(
    `UPDATE institutions SET status = 'archived', is_active = false WHERE id = $1 RETURNING id`,
    [id]
  );
  if (!rows[0]) throw ApiError.notFound("Institution not found");
  // Audit inline (same shape as platform.service.recordAudit) — no cross-module import.
  await query(
    `INSERT INTO platform_audit_log
       (action, target_type, target_id, institution_id, actor_id, actor_email, actor_role, detail, ip)
     VALUES ('tenant.archived','institution',$1,$1,$2,$3,$4,$5::jsonb,$6)`,
    [id, actor.id, actor.email, actor.role, JSON.stringify({ reason, via: "legacy /institutions/:id" }), actor.ip]
  );
}

// --- Branches ---

async function assertInstitutionExists(id: string): Promise<void> {
  const { rows } = await query("SELECT 1 FROM institutions WHERE id = $1", [id]);
  if (!rows[0]) throw ApiError.notFound("Institution not found");
}

export async function listBranches(institutionId: string) {
  await assertInstitutionExists(institutionId);
  const { rows } = await query(
    `SELECT ${BRANCH_COLUMNS} FROM branches WHERE institution_id = $1 ORDER BY name`,
    [institutionId]
  );
  return rows;
}

export async function createBranch(
  institutionId: string,
  input: z.infer<typeof createBranchSchema>
) {
  await assertInstitutionExists(institutionId);
  const { rows } = await query(
    `INSERT INTO branches (institution_id, name, address, timezone)
     VALUES ($1, $2, $3, $4) RETURNING ${BRANCH_COLUMNS}`,
    [institutionId, input.name, input.address ?? null, input.timezone ?? "Asia/Kolkata"]
  );
  return rows[0];
}

export async function updateBranch(
  id: string,
  input: z.infer<typeof updateBranchSchema>
) {
  const map: Record<string, string> = {
    name: "name",
    address: "address",
    timezone: "timezone",
    isActive: "is_active",
  };
  const sets: string[] = [];
  const params: unknown[] = [];
  for (const [field, column] of Object.entries(map)) {
    const value = (input as Record<string, unknown>)[field];
    if (value !== undefined) {
      params.push(value);
      sets.push(`${column} = $${params.length}`);
    }
  }
  if (!sets.length) throw ApiError.badRequest("No fields to update");
  params.push(id);
  const { rows } = await query(
    `UPDATE branches SET ${sets.join(", ")} WHERE id = $${params.length}
     RETURNING ${BRANCH_COLUMNS}`,
    params
  );
  if (!rows[0]) throw ApiError.notFound("Branch not found");
  return rows[0];
}

export async function removeBranch(id: string): Promise<void> {
  const { rowCount } = await query("DELETE FROM branches WHERE id = $1", [id]);
  if (!rowCount) throw ApiError.notFound("Branch not found");
}

// --- Subscription packages ---

export async function listPackages() {
  const { rows } = await query(
    `SELECT ${PACKAGE_COLUMNS} FROM subscription_packages ORDER BY price`
  );
  return rows;
}

export async function createPackage(
  input: z.infer<typeof createPackageSchema>
) {
  const { rows } = await query(
    `INSERT INTO subscription_packages
       (name, max_students, max_staff, price, billing_cycle, features)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING ${PACKAGE_COLUMNS}`,
    [
      input.name,
      input.maxStudents ?? null,
      input.maxStaff ?? null,
      input.price ?? 0,
      input.billingCycle ?? "annual",
      input.features ?? {},
    ]
  );
  return rows[0];
}

export async function updatePackage(
  id: string,
  input: z.infer<typeof updatePackageSchema>
) {
  const map: Record<string, string> = {
    name: "name",
    maxStudents: "max_students",
    maxStaff: "max_staff",
    price: "price",
    billingCycle: "billing_cycle",
    features: "features",
    isActive: "is_active",
  };
  const sets: string[] = [];
  const params: unknown[] = [];
  for (const [field, column] of Object.entries(map)) {
    const value = (input as Record<string, unknown>)[field];
    if (value !== undefined) {
      params.push(value);
      sets.push(`${column} = $${params.length}`);
    }
  }
  if (!sets.length) throw ApiError.badRequest("No fields to update");
  params.push(id);
  const { rows } = await query(
    `UPDATE subscription_packages SET ${sets.join(", ")} WHERE id = $${params.length}
     RETURNING ${PACKAGE_COLUMNS}`,
    params
  );
  if (!rows[0]) throw ApiError.notFound("Package not found");
  return rows[0];
}

// --- Subscriptions ---

export async function assignSubscription(
  institutionId: string,
  input: z.infer<typeof assignSubscriptionSchema>
) {
  await assertInstitutionExists(institutionId);
  const pkg = await query("SELECT 1 FROM subscription_packages WHERE id = $1", [
    input.packageId,
  ]);
  if (!pkg.rows[0]) throw ApiError.notFound("Package not found");
  const { rows } = await query(
    `INSERT INTO institution_subscriptions
       (institution_id, package_id, status, starts_at, ends_at)
     VALUES ($1, $2, $3, COALESCE($4, CURRENT_DATE), $5)
     RETURNING id, institution_id AS "institutionId", package_id AS "packageId",
               status, starts_at AS "startsAt", ends_at AS "endsAt"`,
    [
      institutionId,
      input.packageId,
      input.status ?? "active",
      input.startsAt ?? null,
      input.endsAt ?? null,
    ]
  );
  return rows[0];
}
