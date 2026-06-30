import { query, withTransaction } from "../../db/postgres";
import type { QueryResult } from "pg";
import { ApiError } from "../../utils/api-error";
import type { z } from "zod";
import type {
  assignSubscriptionSchema,
  createBranchSchema,
  createInstitutionSchema,
  createPackageSchema,
  duplicatePackageSchema,
  packageListQuerySchema,
  packageStatusSchema,
  packageUsageQuerySchema,
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
  id, name, description, currency, price, setup_fee AS "setupFee",
  billing_cycle AS "billingCycle", status, visibility, badge,
  display_order AS "displayOrder", applicable_types AS "applicableTypes",
  max_students AS "maxStudents", max_staff AS "maxStaff", limits, features,
  tax_percent AS "taxPercent", invoice_due_days AS "invoiceDueDays",
  payment_terms AS "paymentTerms", sac_hsn AS "sacHsn",
  billing_start_rule AS "billingStartRule", auto_renew AS "autoRenew",
  grace_days AS "graceDays", is_trial AS "isTrial", trial_days AS "trialDays",
  trial_expiry_behavior AS "trialExpiryBehavior",
  trial_conversion_package_id AS "trialConversionPackageId",
  is_active AS "isActive", created_at AS "createdAt", updated_at AS "updatedAt"`;

// camelCase field -> column, for dynamic INSERT/UPDATE. is_active is handled
// separately (kept in lock-step with status).
const PACKAGE_COLUMN_MAP: Record<string, string> = {
  name: "name", description: "description", currency: "currency", price: "price",
  setupFee: "setup_fee", billingCycle: "billing_cycle", status: "status",
  visibility: "visibility", badge: "badge", displayOrder: "display_order",
  applicableTypes: "applicable_types", maxStudents: "max_students", maxStaff: "max_staff",
  limits: "limits", features: "features", taxPercent: "tax_percent",
  invoiceDueDays: "invoice_due_days", paymentTerms: "payment_terms", sacHsn: "sac_hsn",
  billingStartRule: "billing_start_rule", autoRenew: "auto_renew", graceDays: "grace_days",
  isTrial: "is_trial", trialDays: "trial_days", trialExpiryBehavior: "trial_expiry_behavior",
  trialConversionPackageId: "trial_conversion_package_id",
};

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

/**
 * SAFE deactivate — replaces the former branch hard delete. A `DELETE FROM
 * branches` could cascade/orphan linked academic, user and history data, so the
 * branch is instead marked inactive and the action is audited. All linked data
 * is preserved.
 */
export async function archiveBranch(id: string, reason: string, actor: Actor) {
  const { rows } = await query<{ id: string; institution_id: string }>(
    `UPDATE branches SET is_active = false WHERE id = $1 RETURNING id, institution_id`,
    [id]
  );
  if (!rows[0]) throw ApiError.notFound("Branch not found");
  await query(
    `INSERT INTO platform_audit_log
       (action, target_type, target_id, institution_id, actor_id, actor_email, actor_role, detail, ip)
     VALUES ('tenant.branch_archived','branch',$1,$2,$3,$4,$5,$6::jsonb,$7)`,
    [id, rows[0].institution_id, actor.id, actor.email, actor.role, JSON.stringify({ reason, via: "legacy /branches/:id" }), actor.ip]
  );
  return { id: rows[0].id, archived: true };
}

// --- Subscription packages (Super Admin C — full plan administration) ---

const norm = (v: unknown): unknown => (v instanceof Date ? v.toISOString() : v);

function packageDiff(
  before: Record<string, unknown>,
  after: Record<string, unknown>
): Record<string, { from: unknown; to: unknown }> {
  const diff: Record<string, { from: unknown; to: unknown }> = {};
  for (const field of Object.keys(PACKAGE_COLUMN_MAP)) {
    const a = norm(before[field]);
    const b = norm(after[field]);
    if (JSON.stringify(a) !== JSON.stringify(b)) diff[field] = { from: a, to: b };
  }
  return diff;
}

/** A query runner: the pooled `query` by default, or a transaction client's `query`. */
type Executor = (text: string, params?: unknown[]) => Promise<QueryResult>;

async function recordPackageVersion(
  packageId: string,
  action: string,
  snapshot: unknown,
  diff: unknown,
  actor: Actor,
  reason: string | null = null,
  exec: Executor = query
): Promise<void> {
  // version_no = MAX+1. Callers that mutate an existing package take a FOR UPDATE lock
  // on that row first (updatePackage/setPackageStatus), serialising concurrent writers
  // so two simultaneous edits can never land the same version_no.
  const v = await exec(
    `SELECT COALESCE(MAX(version_no), 0) + 1 AS n FROM package_versions WHERE package_id = $1`,
    [packageId]
  );
  await exec(
    `INSERT INTO package_versions
       (package_id, version_no, action, snapshot, diff, actor_id, actor_email, reason)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [packageId, v.rows[0].n, action, JSON.stringify(snapshot), JSON.stringify(diff), actor.id, actor.email, reason]
  );
}

async function auditPackage(
  action: string,
  packageId: string,
  detail: Record<string, unknown>,
  actor: Actor,
  exec: Executor = query
): Promise<void> {
  await exec(
    `INSERT INTO platform_audit_log
       (action, target_type, target_id, institution_id, actor_id, actor_email, actor_role, detail, ip)
     VALUES ($1, 'package', $2, NULL, $3, $4, $5, $6::jsonb, $7)`,
    [action, packageId, actor.id, actor.email, actor.role, JSON.stringify(detail), actor.ip]
  );
}

const PACKAGE_SORTS: Record<string, string> = {
  name: "name", price: "price", displayOrder: "display_order",
  status: "status", createdAt: "created_at",
};

export async function listPackages(filter: z.infer<typeof packageListQuerySchema> = {}) {
  const where: string[] = [];
  const params: unknown[] = [];
  if (filter.q) { params.push(`%${filter.q.toLowerCase()}%`); where.push(`lower(name) LIKE $${params.length}`); }
  if (filter.status) { params.push(filter.status); where.push(`status = $${params.length}`); }
  if (filter.billingCycle) { params.push(filter.billingCycle); where.push(`billing_cycle = $${params.length}`); }
  if (filter.visibility) { params.push(filter.visibility); where.push(`visibility = $${params.length}`); }
  if (filter.institutionType) {
    params.push(filter.institutionType);
    where.push(`(cardinality(applicable_types) = 0 OR $${params.length} = ANY(applicable_types))`);
  }
  const sortCol = PACKAGE_SORTS[filter.sort ?? "displayOrder"] ?? "display_order";
  const order = filter.order === "desc" ? "DESC" : "ASC";
  const { rows } = await query(
    `SELECT ${PACKAGE_COLUMNS} FROM subscription_packages
     ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
     ORDER BY ${sortCol} ${order}, name ASC`,
    params
  );
  return rows;
}

export async function getPackage(id: string, exec: Executor = query, lock = false) {
  const { rows } = await exec(
    `SELECT ${PACKAGE_COLUMNS} FROM subscription_packages WHERE id = $1${lock ? " FOR UPDATE" : ""}`,
    [id]
  );
  if (!rows[0]) throw ApiError.notFound("Package not found");
  return rows[0];
}

function isActiveFromInput(data: Record<string, unknown>): boolean | undefined {
  if (data.status !== undefined) return data.status === "active";
  if (data.isActive !== undefined) return Boolean(data.isActive);
  return undefined;
}

export async function createPackage(input: z.infer<typeof createPackageSchema>, actor: Actor) {
  const data = input as Record<string, unknown>;
  const cols: string[] = [];
  const vals: string[] = [];
  const params: unknown[] = [];
  for (const [field, col] of Object.entries(PACKAGE_COLUMN_MAP)) {
    if (field in data) { params.push(data[field]); cols.push(col); vals.push(`$${params.length}`); }
  }
  const ia = isActiveFromInput(data);
  if (ia !== undefined) { params.push(ia); cols.push("is_active"); vals.push(`$${params.length}`); }
  // keep archived_at consistent if a package is created directly in the archived state
  if ((data.status ?? "active") === "archived") { cols.push("archived_at"); vals.push("now()"); }
  params.push(actor.id); cols.push("updated_by"); vals.push(`$${params.length}`);
  // row + version + audit commit together — never a package row without its history/audit trail
  return withTransaction(async (client) => {
    const exec: Executor = (text, p = []) => client.query(text, p as never[]);
    const { rows } = await exec(
      `INSERT INTO subscription_packages (${cols.join(", ")}) VALUES (${vals.join(", ")})
       RETURNING ${PACKAGE_COLUMNS}`,
      params
    );
    const pkg = rows[0];
    await recordPackageVersion(pkg.id, "created", pkg, {}, actor, null, exec);
    await auditPackage("package.created", pkg.id, { name: pkg.name, status: pkg.status }, actor, exec);
    return pkg;
  });
}

export async function updatePackage(id: string, input: z.infer<typeof updatePackageSchema>, actor: Actor) {
  const data = input as Record<string, unknown>;
  const sets: string[] = [];
  const params: unknown[] = [];
  for (const [field, col] of Object.entries(PACKAGE_COLUMN_MAP)) {
    if (field in data) { params.push(data[field]); sets.push(`${col} = $${params.length}`); }
  }
  // is_active is never written here — status (its only driver) flows through setPackageStatus.
  if (!sets.length) throw ApiError.badRequest("No fields to update");
  params.push(actor.id);
  sets.push(`updated_at = now()`, `updated_by = $${params.length}`);
  params.push(id);
  return withTransaction(async (client) => {
    const exec: Executor = (text, p = []) => client.query(text, p as never[]);
    const before = await getPackage(id, exec, true); // lock the row → serialises concurrent edits + version_no
    const { rows } = await exec(
      `UPDATE subscription_packages SET ${sets.join(", ")} WHERE id = $${params.length}
       RETURNING ${PACKAGE_COLUMNS}`,
      params
    );
    const after = rows[0];
    const diff = packageDiff(before as Record<string, unknown>, after as Record<string, unknown>);
    if (Object.keys(diff).length) {
      await recordPackageVersion(id, "updated", after, diff, actor, null, exec);
      await auditPackage("package.updated", id, { fields: Object.keys(diff), diff }, actor, exec);
    }
    return after;
  });
}

export async function setPackageStatus(
  id: string,
  input: z.infer<typeof packageStatusSchema>,
  actor: Actor
) {
  if ((input.status === "archived" || input.status === "deprecated") && !input.reason?.trim()) {
    throw ApiError.badRequest("A reason is required to deprecate or archive a package");
  }
  const isActive = input.status === "active";
  const archivedAt = input.status === "archived" ? "now()" : "NULL";
  const impact = await packageImpact(id); // validates existence (404 before the tx) + counts for the audit detail
  return withTransaction(async (client) => {
    const exec: Executor = (text, p = []) => client.query(text, p as never[]);
    const before = await getPackage(id, exec, true);
    const { rows } = await exec(
      `UPDATE subscription_packages
         SET status = $1, is_active = $2, archived_at = ${archivedAt}, updated_at = now(), updated_by = $3
       WHERE id = $4 RETURNING ${PACKAGE_COLUMNS}`,
      [input.status, isActive, actor.id, id]
    );
    const after = rows[0];
    const fromStatus = (before as Record<string, unknown>).status;
    await recordPackageVersion(
      id,
      input.status === "archived" ? "archived" : "status_change",
      after,
      { status: { from: fromStatus, to: input.status } },
      actor,
      input.reason ?? null,
      exec
    );
    await auditPackage("package.status_change", id, {
      from: fromStatus,
      to: input.status,
      reason: input.reason ?? null,
      affectedTenants: impact.tenants.length,
      activeSubscriptions: impact.activeSubscriptions,
    }, actor, exec);
    return after;
  });
}

export async function duplicatePackage(
  id: string,
  input: z.infer<typeof duplicatePackageSchema>,
  actor: Actor
) {
  const src = (await getPackage(id)) as Record<string, unknown>;
  const dup = await query("SELECT 1 FROM subscription_packages WHERE name = $1", [input.name]);
  if (dup.rows[0]) throw ApiError.conflict("A package with this name already exists");
  return withTransaction(async (client) => {
    const exec: Executor = (text, p = []) => client.query(text, p as never[]);
    const { rows } = await exec(
      `INSERT INTO subscription_packages
         (name, description, currency, price, setup_fee, billing_cycle, status, visibility,
          badge, display_order, applicable_types, max_students, max_staff, limits, features,
          tax_percent, invoice_due_days, payment_terms, sac_hsn, billing_start_rule, auto_renew,
          grace_days, is_trial, trial_days, trial_expiry_behavior, is_active, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,'draft','internal',$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,false,$24)
       RETURNING ${PACKAGE_COLUMNS}`,
      [
        input.name, src.description ?? null, src.currency ?? "INR", src.price ?? 0,
        src.setupFee ?? 0, src.billingCycle ?? "annual", src.badge ?? null,
        src.displayOrder ?? 0, src.applicableTypes ?? [], src.maxStudents ?? null,
        src.maxStaff ?? null, src.limits ?? {}, src.features ?? {}, src.taxPercent ?? 0,
        src.invoiceDueDays ?? null, src.paymentTerms ?? null, src.sacHsn ?? null,
        src.billingStartRule ?? "immediate", src.autoRenew ?? true, src.graceDays ?? null,
        src.isTrial ?? false, src.trialDays ?? null, src.trialExpiryBehavior ?? null, actor.id,
      ]
    );
    const pkg = rows[0];
    await recordPackageVersion(pkg.id, "duplicated", pkg, { copiedFrom: id }, actor, null, exec);
    await auditPackage("package.duplicated", pkg.id, { name: pkg.name, copiedFrom: id }, actor, exec);
    return pkg;
  });
}

export async function packageHistory(id: string) {
  await getPackage(id);
  const { rows } = await query(
    `SELECT id, version_no AS "versionNo", action, diff, actor_email AS "actorEmail",
            reason, created_at AS "createdAt"
     FROM package_versions WHERE package_id = $1 ORDER BY created_at DESC`,
    [id]
  );
  return rows;
}

export async function packageImpact(id: string) {
  await getPackage(id);
  const tenants = await query(
    `WITH latest AS (
       SELECT DISTINCT ON (institution_id) institution_id, package_id, status
       FROM institution_subscriptions ORDER BY institution_id, created_at DESC)
     SELECT i.id, i.name, i.code, i.institution_type AS "institutionType", l.status
     FROM latest l JOIN institutions i ON i.id = l.institution_id
     WHERE l.package_id = $1 ORDER BY i.name`,
    [id]
  );
  const active = await query<{ c: string }>(
    `SELECT count(*)::int AS c FROM institution_subscriptions
     WHERE package_id = $1 AND status IN ('active','trialing')`,
    [id]
  );
  const invoices = await query<{ c: string }>(
    `SELECT count(*)::int AS c FROM saas_invoices WHERE package_id = $1 AND status = 'issued'`,
    [id]
  );
  return {
    tenants: tenants.rows,
    activeSubscriptions: Number(active.rows[0]?.c ?? 0),
    openInvoices: Number(invoices.rows[0]?.c ?? 0),
  };
}

export async function comparePackages(ids: string[]) {
  if (!ids.length) return [];
  const { rows } = await query(
    `SELECT ${PACKAGE_COLUMNS} FROM subscription_packages WHERE id = ANY($1::uuid[]) ORDER BY display_order, name`,
    [ids]
  );
  return rows;
}

const USAGE_REPORT_COLUMNS = [
  { key: "name", label: "Package" }, { key: "status", label: "Status" },
  { key: "billingCycle", label: "Billing" }, { key: "price", label: "Price" },
  { key: "currency", label: "Currency" }, { key: "tenants", label: "Tenants" },
  { key: "active", label: "Active" }, { key: "trial", label: "Trial" },
  { key: "suspended", label: "Suspended" }, { key: "expired", label: "Expired" },
  { key: "students", label: "Students" }, { key: "staff", label: "Staff" },
  { key: "revenue", label: "Revenue (paid)" }, { key: "outstanding", label: "Outstanding" },
  { key: "overdue", label: "Overdue" },
];

export async function packageUsageReport(filter: z.infer<typeof packageUsageQuerySchema> = {}) {
  const where: string[] = [];
  const params: unknown[] = [];
  if (filter.packageId) { params.push(filter.packageId); where.push(`p.id = $${params.length}`); }
  if (filter.billingCycle) { params.push(filter.billingCycle); where.push(`p.billing_cycle = $${params.length}`); }
  if (filter.status) { params.push(filter.status); where.push(`p.status = $${params.length}`); }
  if (filter.institutionType) {
    params.push(filter.institutionType);
    where.push(`(cardinality(p.applicable_types) = 0 OR $${params.length} = ANY(p.applicable_types))`);
  }
  const { rows } = await query(
    `WITH latest AS (
       SELECT DISTINCT ON (s.institution_id) s.institution_id, s.package_id, s.status
       FROM institution_subscriptions s ORDER BY s.institution_id, s.created_at DESC),
     tcount AS (
       SELECT l.package_id,
         count(*)::int AS tenants,
         count(*) FILTER (WHERE l.status='active')::int AS active,
         count(*) FILTER (WHERE l.status='trialing')::int AS trial,
         count(*) FILTER (WHERE l.status='suspended')::int AS suspended,
         count(*) FILTER (WHERE l.status='expired')::int AS expired,
         count(*) FILTER (WHERE l.status='cancelled')::int AS cancelled,
         COALESCE(SUM((SELECT count(*) FROM students st WHERE st.institution_id=l.institution_id AND st.status<>'archived')),0)::int AS students,
         COALESCE(SUM((SELECT count(*) FROM teachers t WHERE t.institution_id=l.institution_id)),0)::int AS staff
       FROM latest l GROUP BY l.package_id),
     rev AS (
       SELECT package_id,
         COALESCE(SUM(total) FILTER (WHERE status='paid'),0) AS revenue,
         COALESCE(SUM(total) FILTER (WHERE status='issued'),0) AS outstanding,
         COALESCE(SUM(total) FILTER (WHERE status='issued' AND due_date < CURRENT_DATE),0) AS overdue
       FROM saas_invoices WHERE package_id IS NOT NULL GROUP BY package_id)
     SELECT p.id, p.name, p.status, p.billing_cycle AS "billingCycle", p.price, p.currency,
            COALESCE(tc.tenants,0) AS tenants, COALESCE(tc.active,0) AS active,
            COALESCE(tc.trial,0) AS trial, COALESCE(tc.suspended,0) AS suspended,
            COALESCE(tc.expired,0) AS expired, COALESCE(tc.cancelled,0) AS cancelled,
            COALESCE(tc.students,0) AS students, COALESCE(tc.staff,0) AS staff,
            COALESCE(r.revenue,0) AS revenue, COALESCE(r.outstanding,0) AS outstanding,
            COALESCE(r.overdue,0) AS overdue
     FROM subscription_packages p
     LEFT JOIN tcount tc ON tc.package_id = p.id
     LEFT JOIN rev r ON r.package_id = p.id
     ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
     ORDER BY p.display_order, p.name`,
    params
  );
  return rows;
}

export async function exportPackageUsage(filter: z.infer<typeof packageUsageQuerySchema>) {
  const rows = await packageUsageReport(filter);
  return { columns: USAGE_REPORT_COLUMNS, rows: rows as Record<string, unknown>[] };
}

// --- Subscriptions ---

export async function assignSubscription(
  institutionId: string,
  input: z.infer<typeof assignSubscriptionSchema>,
  actor?: Actor
) {
  await assertInstitutionExists(institutionId);
  const pkg = await query<{ applicable_types: string[]; institution_type?: string }>(
    "SELECT applicable_types FROM subscription_packages WHERE id = $1",
    [input.packageId]
  );
  if (!pkg.rows[0]) throw ApiError.notFound("Package not found");
  // Institution-type applicability guard (super-admin may override with reason).
  const applicable = pkg.rows[0].applicable_types ?? [];
  let overrodeType = false;
  if (applicable.length) {
    const inst = await query<{ institution_type: string }>(
      "SELECT institution_type FROM institutions WHERE id = $1",
      [institutionId]
    );
    const itype = inst.rows[0]?.institution_type;
    if (itype && !applicable.includes(itype)) {
      if (!input.override) {
        throw ApiError.badRequest(
          `This package does not apply to ${itype} institutions. Set override to assign anyway.`
        );
      }
      overrodeType = true;
    }
  }
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
  // Audit a type-applicability override (the action itself is also audited by the
  // platform wrapper as subscription.assign).
  if (overrodeType && actor) {
    await query(
      `INSERT INTO platform_audit_log
         (action, target_type, target_id, institution_id, actor_id, actor_email, actor_role, detail, ip)
       VALUES ('package.assign_override','package',$1,$2,$3,$4,$5,$6::jsonb,$7)`,
      [input.packageId, institutionId, actor.id, actor.email, actor.role,
       JSON.stringify({ reason: input.reason ?? null }), actor.ip]
    );
  }
  return rows[0];
}
