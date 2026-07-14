import { randomBytes, randomUUID } from "node:crypto";
import type { z } from "zod";
import { query, withTransaction } from "../../db/postgres";
import { ApiError } from "../../utils/api-error";
import { hashPassword } from "../../utils/password";
import { effectiveLimits, scheduledReportCount, storageUsageMb } from "../../utils/plan-limits";
import { storage } from "../../utils/storage";
import { mailerConfigured } from "../../utils/mailer";
import { assertValidFile } from "../documents/documents.service";
import { requestPasswordReset } from "../auth/auth.service";
import { invalidateInstitutionStatusCache } from "../../middleware/institution-status";
import { recordAudit, type Actor } from "./platform.service";
import type {
  brandingSchema,
  complianceSchema,
  createTenantSchema,
  crmSchema,
  documentVerifySchema,
  noteSchema,
  primaryAdminSchema,
  settingsSchema,
  tenantExportQuerySchema,
  tenantListQuerySchema,
  updateNoteSchema,
  updateTenantSchema,
} from "./tenant.schema";

/**
 * Tenant / Institution Management (one common, type-driven module).
 *
 * institution_type (school/college/university/coaching/other) drives config; the
 * structural `type` (school/college) used by requireInstitutionType() is derived
 * here on write and otherwise untouched. Lifecycle `status` is kept in sync with
 * the legacy `is_active` flag so existing auth/guards keep working. All sensitive
 * actions are audited via platform_audit_log. Never hard-deletes a tenant.
 */

type CreateTenant = z.infer<typeof createTenantSchema>;
type UpdateTenant = z.infer<typeof updateTenantSchema>;
type SettingsInput = z.infer<typeof settingsSchema>;
type ComplianceInput = z.infer<typeof complianceSchema>;
type PrimaryAdmin = z.infer<typeof primaryAdminSchema>;
type NoteInput = z.infer<typeof noteSchema>;
type UpdateNote = z.infer<typeof updateNoteSchema>;
type ListQuery = z.infer<typeof tenantListQuerySchema>;
type ExportQuery = z.infer<typeof tenantExportQuerySchema>;
type BrandingInput = z.infer<typeof brandingSchema>;
type CrmInput = z.infer<typeof crmSchema>;
type DocVerifyInput = z.infer<typeof documentVerifySchema>;

/** Structural school/college mode derived from the tenant-facing type. */
function structuralType(institutionType: string): "school" | "college" {
  return institutionType === "school" ? "school" : "college";
}

/** Lifecycle statuses that mean the tenant is operational (is_active = true). */
const ACTIVE_STATUSES = new Set(["active", "trial"]);

const TENANT_COLS = `
  i.id, i.name, i.code, i.type, i.institution_type AS "institutionType",
  i.is_active AS "isActive", i.status, i.slug,
  i.legal_name AS "legalName", i.short_name AS "shortName", i.address, i.city,
  i.state, i.country, i.pincode, i.phone, i.email, i.website,
  i.academic_year AS "academicYear", i.timezone, i.currency, i.language, i.notes,
  i.settings, i.onboarding,
  i.terms_accepted AS "termsAccepted", i.agreement_signed AS "agreementSigned",
  i.kyc_status AS "kycStatus", i.approval_status AS "approvalStatus",
  i.approval_remarks AS "approvalRemarks", i.approved_at AS "approvedAt",
  i.data_processing_consent AS "dataProcessingConsent",
  i.account_manager AS "accountManager", i.last_contacted_at AS "lastContactedAt",
  i.created_at AS "createdAt", i.updated_at AS "updatedAt"`;

async function assertTenant(id: string): Promise<void> {
  const { rows } = await query("SELECT 1 FROM institutions WHERE id = $1", [id]);
  if (!rows[0]) throw ApiError.notFound("Institution not found");
}

// ---- Directory (list + export) ----

type Filters = Partial<Pick<ListQuery, "q" | "institutionType" | "status" | "type" | "package" | "createdFrom" | "createdTo">>;

function buildFilters(f: Filters): { whereSql: string; params: unknown[] } {
  const where: string[] = [];
  const params: unknown[] = [];
  const add = (clause: (n: number) => string, value: unknown) => {
    params.push(value);
    where.push(clause(params.length));
  };
  if (f.q) add((n) => `(i.name ILIKE $${n} OR i.code ILIKE $${n} OR i.email ILIKE $${n} OR i.slug ILIKE $${n})`, `%${f.q}%`);
  if (f.institutionType) add((n) => `i.institution_type = $${n}`, f.institutionType);
  if (f.status) add((n) => `i.status = $${n}`, f.status);
  if (f.type) add((n) => `i.type = $${n}`, f.type);
  if (f.package)
    add(
      (n) => `EXISTS (SELECT 1 FROM institution_subscriptions sub
                JOIN subscription_packages p ON p.id = sub.package_id
                WHERE sub.institution_id = i.id AND p.name ILIKE $${n})`,
      `%${f.package}%`
    );
  if (f.createdFrom) add((n) => `i.created_at >= $${n}`, f.createdFrom);
  if (f.createdTo) add((n) => `i.created_at < ($${n}::date + interval '1 day')`, f.createdTo);
  return { whereSql: where.length ? `WHERE ${where.join(" AND ")}` : "", params };
}

const LIST_COLS = `
  i.id, i.name, i.code, i.type, i.institution_type AS "institutionType",
  i.status, i.is_active AS "isActive", i.slug, i.created_at AS "createdAt",
  (SELECT count(*)::int FROM students s WHERE s.institution_id = i.id AND s.status <> 'archived') AS students,
  (SELECT count(*)::int FROM teachers t WHERE t.institution_id = i.id) AS staff,
  (SELECT p.name FROM institution_subscriptions sub JOIN subscription_packages p ON p.id = sub.package_id
     WHERE sub.institution_id = i.id ORDER BY sub.created_at DESC LIMIT 1) AS "packageName"`;

const SORT: Record<string, string> = {
  name: "i.name", code: "i.code", status: "i.status",
  institutionType: "i.institution_type", createdAt: "i.created_at",
  students: "students", staff: "staff",
};

export async function listTenants(q: ListQuery) {
  const { whereSql, params } = buildFilters(q);
  const count = await query<{ n: number }>(`SELECT count(*)::int AS n FROM institutions i ${whereSql}`, params);
  const sortCol = SORT[q.sort] ?? "i.created_at";
  const order = q.order === "asc" ? "ASC" : "DESC";
  const { rows } = await query(
    `SELECT ${LIST_COLS} FROM institutions i ${whereSql}
     ORDER BY ${sortCol} ${order} NULLS LAST, i.created_at DESC
     LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, q.pageSize, (q.page - 1) * q.pageSize]
  );
  return { rows, total: count.rows[0].n, page: q.page, pageSize: q.pageSize };
}

const EXPORT_COLUMNS = [
  { key: "code", label: "Code" }, { key: "name", label: "Name" },
  { key: "institutionType", label: "Type" }, { key: "status", label: "Status" },
  { key: "students", label: "Students" }, { key: "staff", label: "Staff" },
  { key: "packageName", label: "Package" }, { key: "slug", label: "Slug" },
  { key: "createdAt", label: "Created" },
];

export async function exportTenants(q: ExportQuery) {
  const { whereSql, params } = buildFilters(q);
  const sortCol = SORT[q.sort] ?? "i.created_at";
  const order = q.order === "asc" ? "ASC" : "DESC";
  const raw = (
    await query<Record<string, unknown>>(
      `SELECT ${LIST_COLS} FROM institutions i ${whereSql}
       ORDER BY ${sortCol} ${order} NULLS LAST, i.created_at DESC LIMIT 20000`,
      params
    )
  ).rows;
  const rows = raw.map((r) => ({
    code: r.code, name: r.name, institutionType: r.institutionType, status: r.status,
    students: Number(r.students), staff: Number(r.staff), packageName: r.packageName ?? "",
    slug: r.slug ?? "",
    createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString().slice(0, 10) : String(r.createdAt ?? "").slice(0, 10),
  }));
  return { columns: EXPORT_COLUMNS, rows: rows as Record<string, unknown>[] };
}

// ---- Detail (rich: profile + settings + limits + usage + billing + onboarding) ----

const PROFILE_COL_MAP: Record<string, string> = {
  name: "name", legalName: "legal_name", shortName: "short_name", address: "address",
  city: "city", state: "state", country: "country", pincode: "pincode", phone: "phone",
  email: "email", website: "website", academicYear: "academic_year", timezone: "timezone",
  currency: "currency", language: "language", notes: "notes", slug: "slug",
};

async function tenantUsage(id: string) {
  const [counts, storageUsedMb, scheduledReports] = await Promise.all([
    query<Record<string, number>>(
      `SELECT
         (SELECT count(*)::int FROM students s WHERE s.institution_id = $1 AND s.status <> 'archived') AS students,
         (SELECT count(*)::int FROM teachers t WHERE t.institution_id = $1) AS staff,
         (SELECT count(*)::int FROM users u WHERE u.institution_id = $1) AS users,
         (SELECT count(*)::int FROM branches b WHERE b.institution_id = $1) AS branches,
         (SELECT count(*)::int FROM scheduled_reports sr WHERE sr.institution_id = $1) AS "scheduledReports",
         (SELECT count(*)::int FROM refresh_tokens rt JOIN users u ON u.id = rt.user_id
            WHERE u.institution_id = $1 AND rt.revoked_at IS NULL AND rt.expires_at > now()) AS "activeSessions"`,
      [id]
    ),
    storageUsageMb(id),
    scheduledReportCount(id),
  ]);
  return { ...counts.rows[0], storageUsedMb, scheduledReports };
}

/** Read-only billing summary for one tenant (never modifies the invoice module). */
export async function tenantBilling(id: string) {
  const inv = await query<Record<string, unknown>>(
    `SELECT
       count(*)::int AS total,
       count(*) FILTER (WHERE status='issued')::int AS issued,
       count(*) FILTER (WHERE status='paid')::int AS paid,
       coalesce(sum(total) FILTER (WHERE status='issued'),0)::text AS outstanding,
       count(*) FILTER (WHERE status='issued' AND due_date IS NOT NULL AND due_date < CURRENT_DATE)::int AS "overdueCount"
     FROM saas_invoices WHERE institution_id = $1`,
    [id]
  );
  const latest = await query<Record<string, unknown>>(
    `SELECT number, status, total::text AS total,
            to_char(created_at,'YYYY-MM-DD') AS "createdAt", to_char(due_date,'YYYY-MM-DD') AS "dueDate"
     FROM saas_invoices WHERE institution_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [id]
  );
  const sub = await query<Record<string, unknown>>(
    `SELECT s.id, p.name AS "packageName", s.status, p.billing_cycle AS "billingCycle",
            to_char(s.starts_at,'YYYY-MM-DD') AS "startsAt", to_char(s.ends_at,'YYYY-MM-DD') AS "endsAt",
            to_char(s.renews_at,'YYYY-MM-DD') AS "renewsAt",
            s.auto_renew AS "autoRenew", s.auto_charge AS "autoCharge",
            s.dunning_state AS "dunningState", s.dunning_attempts AS "dunningAttempts",
            to_char(s.next_retry_at,'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "nextRetryAt",
            to_char(s.last_charge_at,'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "lastChargeAt",
            s.last_payment_error AS "lastPaymentError"
     FROM institution_subscriptions s JOIN subscription_packages p ON p.id = s.package_id
     WHERE s.institution_id = $1 ORDER BY s.created_at DESC LIMIT 1`,
    [id]
  );
  return { ...inv.rows[0], latest: latest.rows[0] ?? null, subscription: sub.rows[0] ?? null };
}

// Onboarding checklist — steps derived from REAL data where possible; manual
// steps (branding/communication/documents) read from the onboarding jsonb.
const ONBOARDING_STEPS: { key: string; label: string; manual?: boolean; required?: boolean }[] = [
  { key: "profile", label: "Institution profile", required: true },
  { key: "academic_structure", label: "Institution type & academic structure", required: true },
  { key: "primary_admin", label: "Primary admin", required: true },
  { key: "subscription", label: "Subscription / package" },
  { key: "limits", label: "Plan limits" },
  { key: "branding", label: "Branding / logo", manual: true },
  { key: "domain", label: "Tenant URL / slug", required: true },
  { key: "documents", label: "Required documents" },
  { key: "communication", label: "Communication settings", manual: true },
  { key: "review", label: "Review & activate" },
];

function computeOnboarding(
  d: Record<string, unknown>,
  derived: { hasAdmin: boolean; hasSubscription: boolean; hasDocuments: boolean }
) {
  const settings = (d.settings ?? {}) as Record<string, unknown>;
  const onboarding = (d.onboarding ?? {}) as { steps?: Record<string, boolean> };
  const manual = onboarding.steps ?? {};
  const has = (o: unknown) => !!o && typeof o === "object" && Object.keys(o as object).length > 0;
  const auto: Record<string, boolean> = {
    profile: !!(d.name && d.email && d.phone && d.address),
    academic_structure: has(settings.academicStructure) || has(settings.schoolSettings) || has(settings.collegeSettings),
    primary_admin: derived.hasAdmin,
    subscription: derived.hasSubscription,
    limits: has((settings as { limits?: unknown }).limits),
    domain: !!d.slug,
    documents: derived.hasDocuments,
    review: d.status !== "draft",
  };
  const steps = ONBOARDING_STEPS.map((s) => ({
    key: s.key,
    label: s.label,
    required: s.required === true,
    done: s.manual ? manual[s.key] === true : auto[s.key] === true,
  }));
  const done = steps.filter((s) => s.done).length;
  const missing = steps.filter((s) => s.required && !s.done).map((s) => s.label);
  return {
    steps,
    completion: Math.round((done / steps.length) * 100),
    missing,
    completedAt: (onboarding as { completedAt?: string }).completedAt ?? null,
  };
}

export async function getTenant(id: string) {
  const { rows } = await query<Record<string, unknown>>(`SELECT ${TENANT_COLS} FROM institutions i WHERE i.id = $1`, [id]);
  if (!rows[0]) throw ApiError.notFound("Institution not found");
  const t = rows[0];
  const [usage, limits, billing, adminRows, recent, brandingRows, docCount] = await Promise.all([
    tenantUsage(id),
    effectiveLimits(id),
    tenantBilling(id),
    query<Record<string, unknown>>(
      `SELECT u.id, u.full_name AS "fullName", u.email, u.is_active AS "isActive",
              u.totp_enabled AS "twoFactorEnabled",
              (SELECT max(rt.last_used_at) FROM refresh_tokens rt WHERE rt.user_id = u.id) AS "lastActiveAt"
       FROM users u WHERE u.institution_id = $1 AND u.role = 'admin' ORDER BY u.created_at ASC`,
      [id]
    ),
    query(
      `SELECT a.action, a.actor_email AS "actorEmail", a.created_at AS "createdAt", a.ip
       FROM platform_audit_log a WHERE a.institution_id = $1 ORDER BY a.created_at DESC LIMIT 20`,
      [id]
    ),
    query<Record<string, unknown>>(
      `SELECT display_name AS "displayName", logo_url AS "logoUrl",
              primary_color AS "primaryColor", tagline, letterhead, footer
       FROM institution_branding WHERE institution_id = $1`,
      [id]
    ),
    query<{ n: number }>(
      `SELECT count(*)::int AS n FROM tenant_documents WHERE institution_id = $1 AND archived_at IS NULL`,
      [id]
    ),
  ]);
  const onboarding = computeOnboarding(t, {
    hasAdmin: adminRows.rows.length > 0,
    hasSubscription: !!billing.subscription,
    hasDocuments: docCount.rows[0].n > 0,
  });
  return {
    ...t,
    usage,
    limits,
    billing,
    branding: brandingRows.rows[0] ?? null,
    documentCount: docCount.rows[0].n,
    admins: adminRows.rows,
    recentActivity: recent.rows,
    onboardingProgress: onboarding,
  };
}

// ---- Create / update ----

export async function createTenant(input: CreateTenant, actor: Actor) {
  const exists = await query("SELECT 1 FROM institutions WHERE code = $1", [input.code]);
  if (exists.rows[0]) throw ApiError.conflict("Institution code already exists");
  const slug = input.slug ?? input.code.toLowerCase();
  const type = structuralType(input.institutionType);
  const id = await withTransaction(async (client) => {
    const ins = await client.query<{ id: string }>(
      `INSERT INTO institutions
         (name, code, type, institution_type, status, slug, legal_name, short_name,
          address, city, state, country, pincode, phone, email, website,
          academic_year, timezone, currency, language, notes, is_active)
       VALUES ($1,$2,$3,$4,'draft',$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,
               COALESCE($17,'Asia/Kolkata'), COALESCE($18,'INR'),$19,$20, false)
       RETURNING id`,
      [
        input.name, input.code, type, input.institutionType, slug,
        input.legalName ?? null, input.shortName ?? null, input.address ?? null,
        input.city ?? null, input.state ?? null, input.country ?? null, input.pincode ?? null,
        input.phone ?? null, input.email ?? null, input.website ?? null,
        input.academicYear ?? null, input.timezone ?? null, input.currency ?? null,
        input.language ?? null, input.notes ?? null,
      ]
    );
    const newId = ins.rows[0].id;
    if (input.primaryAdmin) {
      await createAdminUser(client, newId, input.primaryAdmin);
    }
    return newId;
  });
  await recordAudit(actor, {
    action: "tenant.create", targetType: "institution", targetId: id, institutionId: id,
    detail: { code: input.code, institutionType: input.institutionType },
  });
  // Email the new admin a password-setup link (best-effort; no-op if SMTP is off).
  if (input.primaryAdmin) await sendSetupLink(input.primaryAdmin.email);
  return getTenant(id);
}

export async function updateTenant(id: string, input: UpdateTenant, actor: Actor) {
  await assertTenant(id);
  const data = input as Record<string, unknown>;
  // Capture the prior values of the changed fields for a before/after audit diff.
  const beforeRow =
    (await query<Record<string, unknown>>(`SELECT ${TENANT_COLS} FROM institutions i WHERE i.id = $1`, [id])).rows[0] ?? {};
  const sets: string[] = [];
  const params: unknown[] = [];
  for (const [field, col] of Object.entries(PROFILE_COL_MAP)) {
    if (field in data) {
      params.push(data[field]);
      sets.push(`${col} = $${params.length}`);
    }
  }
  // Changing the tenant-facing type re-derives the structural mode.
  if (input.institutionType) {
    params.push(input.institutionType);
    sets.push(`institution_type = $${params.length}`);
    params.push(structuralType(input.institutionType));
    sets.push(`type = $${params.length}`);
  }
  if (sets.length) {
    params.push(id);
    await query(`UPDATE institutions SET ${sets.join(", ")} WHERE id = $${params.length}`, params);
  }
  const diff: Record<string, { from: unknown; to: unknown }> = {};
  for (const field of Object.keys(data)) {
    if (field in beforeRow && beforeRow[field] !== data[field]) diff[field] = { from: beforeRow[field], to: data[field] };
  }
  await recordAudit(actor, {
    action: "tenant.update", targetType: "institution", targetId: id, institutionId: id,
    detail: { fields: Object.keys(data), diff },
  });
  return getTenant(id);
}

// ---- Lifecycle (status + is_active sync; suspend/archive require a reason) ----

const ALLOWED_STATUS = new Set(["draft", "trial", "active", "suspended", "expired", "archived", "closed"]);
// Reversible-stop and terminal states need an audited reason.
const REASON_REQUIRED = new Set(["suspended", "archived", "closed"]);

export async function setLifecycle(id: string, status: string, reason: string | undefined, actor: Actor) {
  if (!ALLOWED_STATUS.has(status)) throw ApiError.badRequest("Invalid status");
  await assertTenant(id);
  if (REASON_REQUIRED.has(status) && !reason?.trim()) {
    throw ApiError.badRequest(`A reason is required to ${status === "archived" ? "archive" : status} a tenant`);
  }
  const isActive = ACTIVE_STATUSES.has(status);
  const { rows } = await query(
    `UPDATE institutions SET status = $2, is_active = $3 WHERE id = $1
     RETURNING id, name, status, is_active AS "isActive"`,
    [id, status, isActive]
  );
  if (!rows[0]) throw ApiError.notFound("Institution not found");
  // PR-SEC2: bust the suspension guard's cache so a manual suspend/reactivate
  // takes effect on the very next request (rather than after the 60s TTL).
  invalidateInstitutionStatusCache(id);
  await recordAudit(actor, {
    action: `tenant.${status}`, targetType: "institution", targetId: id, institutionId: id,
    detail: reason ? { reason } : {},
  });
  return getTenant(id);
}

// ---- Settings (type-based config in settings jsonb) ----

export async function updateSettings(id: string, input: SettingsInput, actor: Actor) {
  await assertTenant(id);
  const before = (
    (await query<{ settings: Record<string, unknown> }>(`SELECT settings FROM institutions WHERE id = $1`, [id])).rows[0]
      ?.settings ?? {}
  ) as Record<string, unknown>;
  // Shallow-merge each provided settings sub-object into institutions.settings.
  const { rows } = await query(
    `UPDATE institutions SET settings = COALESCE(settings,'{}'::jsonb) || $2::jsonb WHERE id = $1 RETURNING id`,
    [id, JSON.stringify(input)]
  );
  if (!rows[0]) throw ApiError.notFound("Institution not found");
  const sections = Object.keys(input);
  const diff: Record<string, { from: unknown; to: unknown }> = {};
  for (const k of sections) diff[k] = { from: before[k], to: (input as Record<string, unknown>)[k] };
  await recordAudit(actor, {
    action: "tenant.settings_update", targetType: "institution", targetId: id, institutionId: id,
    detail: { sections, diff },
  });
  return getTenant(id);
}

// ---- Onboarding ----

export async function setOnboardingStep(id: string, step: string, done: boolean, actor: Actor) {
  await assertTenant(id);
  await query(
    `UPDATE institutions SET onboarding =
       jsonb_set(COALESCE(onboarding,'{}'::jsonb), '{steps}',
         COALESCE(onboarding->'steps','{}'::jsonb) || jsonb_build_object($2::text, $3::boolean))
     WHERE id = $1`,
    [id, step, done]
  );
  await recordAudit(actor, {
    action: "tenant.onboarding_step", targetType: "institution", targetId: id, institutionId: id,
    detail: { step, done },
  });
  return getTenant(id);
}

export async function completeOnboarding(id: string, override: boolean, actor: Actor) {
  await assertTenant(id);
  // Block activation until required onboarding steps are done — unless a
  // super-admin explicitly overrides (the override is recorded in the audit).
  const current = await getTenant(id);
  const missing = current.onboardingProgress.missing;
  if (missing.length && !override) {
    throw ApiError.badRequest(`Complete required steps before activating: ${missing.join(", ")}`);
  }
  // A draft tenant becomes active (and usable) on completion; a non-draft status is left as-is.
  await query(
    `UPDATE institutions SET
       status = CASE WHEN status = 'draft' THEN 'active' ELSE status END,
       is_active = true,
       onboarding = jsonb_set(COALESCE(onboarding,'{}'::jsonb), '{completedAt}', to_jsonb(now()::text))
     WHERE id = $1`,
    [id]
  );
  await recordAudit(actor, {
    action: "tenant.onboarding_complete", targetType: "institution", targetId: id, institutionId: id,
    detail: override && missing.length ? { override: true, missing } : {},
  });
  return getTenant(id);
}

// ---- Compliance / approval ----

export async function setCompliance(id: string, input: ComplianceInput, actor: Actor) {
  await assertTenant(id);
  const data = input as Record<string, unknown>;
  const map: Record<string, string> = {
    termsAccepted: "terms_accepted", agreementSigned: "agreement_signed",
    dataProcessingConsent: "data_processing_consent",
    kycStatus: "kyc_status", approvalStatus: "approval_status", approvalRemarks: "approval_remarks",
  };
  const sets: string[] = [];
  const params: unknown[] = [];
  for (const [field, col] of Object.entries(map)) {
    if (field in data) {
      params.push(data[field]);
      sets.push(`${col} = $${params.length}`);
    }
  }
  if ("approvalStatus" in data) {
    params.push(actor.id);
    sets.push(`approved_by = $${params.length}`);
    sets.push(`approved_at = now()`);
  }
  params.push(id);
  await query(`UPDATE institutions SET ${sets.join(", ")} WHERE id = $${params.length}`, params);
  await recordAudit(actor, {
    action: "tenant.compliance_update", targetType: "institution", targetId: id, institutionId: id,
    detail: { fields: Object.keys(data) },
  });
  return getTenant(id);
}

// ---- Primary admin ----

async function createAdminUser(
  client: { query: (t: string, p?: unknown[]) => Promise<{ rows: { id: string }[] }> },
  institutionId: string,
  admin: PrimaryAdmin
): Promise<string> {
  const dup = await client.query("SELECT 1 FROM users WHERE email = $1", [admin.email]);
  if (dup.rows[0]) throw ApiError.conflict("A user with this email already exists");
  // Secure random password (never returned); the admin sets their own via the
  // password-reset flow. No guessable default is created.
  const hash = await hashPassword(randomBytes(24).toString("base64url"));
  const { rows } = await client.query(
    `INSERT INTO users (email, password_hash, full_name, role, institution_id, is_active)
     VALUES ($1,$2,$3,'admin',$4,true) RETURNING id`,
    [admin.email, hash, admin.fullName, institutionId]
  );
  return rows[0].id;
}

/**
 * Best-effort: email a password-setup (reset) link so a newly created admin can
 * set their own password. Reuses the auth password-reset flow; safely no-ops
 * (logs only) when SMTP is unconfigured. Returns whether email delivery is on.
 */
async function sendSetupLink(email: string): Promise<boolean> {
  try {
    await requestPasswordReset(email);
  } catch (err) {
    console.warn("tenant admin setup-link send failed:", err);
  }
  return mailerConfigured();
}

export async function setPrimaryAdmin(id: string, input: PrimaryAdmin, actor: Actor) {
  await assertTenant(id);
  const adminId = await withTransaction((client) => createAdminUser(client as never, id, input));
  await recordAudit(actor, {
    action: "tenant.admin_create", targetType: "user", targetId: adminId, institutionId: id,
    detail: { email: input.email, emailConfigured: mailerConfigured() },
  });
  await sendSetupLink(input.email);
  return getTenant(id);
}

/** Re-send a password-setup / reset link to an existing tenant admin (audited). */
export async function sendAdminSetupLink(id: string, adminUserId: string, actor: Actor) {
  await assertTenant(id);
  const { rows } = await query<{ email: string }>(
    `SELECT email FROM users WHERE id = $2 AND institution_id = $1 AND role = 'admin'`,
    [id, adminUserId]
  );
  if (!rows[0]) throw ApiError.notFound("Tenant admin not found");
  const emailSent = await sendSetupLink(rows[0].email);
  await recordAudit(actor, {
    action: "tenant.admin_reset_link", targetType: "user", targetId: adminUserId, institutionId: id,
    detail: { email: rows[0].email, emailConfigured: emailSent },
  });
  return { emailSent };
}

export async function setAdminActive(id: string, adminUserId: string, active: boolean, actor: Actor) {
  await assertTenant(id);
  const { rows } = await query(
    `UPDATE users SET is_active = $3 WHERE id = $2 AND institution_id = $1 AND role = 'admin' RETURNING id`,
    [id, adminUserId, active]
  );
  if (!rows[0]) throw ApiError.notFound("Tenant admin not found");
  await recordAudit(actor, {
    action: active ? "tenant.admin_enable" : "tenant.admin_disable",
    targetType: "user", targetId: adminUserId, institutionId: id, detail: {},
  });
  return getTenant(id);
}

// ---- Internal CRM notes (super-admin only; never exposed to tenant users) ----

export async function listNotes(id: string) {
  await assertTenant(id);
  const { rows } = await query(
    `SELECT id, note_type AS "noteType", body, to_char(follow_up_date,'YYYY-MM-DD') AS "followUpDate",
            author_email AS "authorEmail", created_at AS "createdAt", updated_at AS "updatedAt"
     FROM institution_notes WHERE institution_id = $1 ORDER BY created_at DESC`,
    [id]
  );
  return rows;
}

export async function addNote(id: string, input: NoteInput, actor: Actor) {
  await assertTenant(id);
  const { rows } = await query<{ id: string }>(
    `INSERT INTO institution_notes (institution_id, note_type, body, follow_up_date, author_id, author_email)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
    [id, input.noteType, input.body, input.followUpDate ?? null, actor.id, actor.email]
  );
  await recordAudit(actor, {
    action: "tenant.note_add", targetType: "institution", targetId: id, institutionId: id,
    detail: { noteId: rows[0].id, noteType: input.noteType },
  });
  return listNotes(id);
}

export async function updateNote(noteId: string, input: UpdateNote, actor: Actor) {
  const data = input as Record<string, unknown>;
  const map: Record<string, string> = { noteType: "note_type", body: "body", followUpDate: "follow_up_date" };
  const sets: string[] = [];
  const params: unknown[] = [];
  for (const [field, col] of Object.entries(map)) {
    if (field in data) {
      params.push(data[field]);
      sets.push(`${col} = $${params.length}`);
    }
  }
  params.push(noteId);
  const { rows } = await query<{ institution_id: string }>(
    `UPDATE institution_notes SET ${sets.join(", ")} WHERE id = $${params.length} RETURNING institution_id`,
    params
  );
  if (!rows[0]) throw ApiError.notFound("Note not found");
  await recordAudit(actor, {
    action: "tenant.note_update", targetType: "institution", targetId: rows[0].institution_id,
    institutionId: rows[0].institution_id, detail: { noteId },
  });
  return listNotes(rows[0].institution_id);
}

export async function deleteNote(noteId: string, actor: Actor) {
  const { rows } = await query<{ institution_id: string }>(
    `DELETE FROM institution_notes WHERE id = $1 RETURNING institution_id`,
    [noteId]
  );
  if (!rows[0]) throw ApiError.notFound("Note not found");
  await recordAudit(actor, {
    action: "tenant.note_delete", targetType: "institution", targetId: rows[0].institution_id,
    institutionId: rows[0].institution_id, detail: { noteId },
  });
  return listNotes(rows[0].institution_id);
}

// ---- CRM (account owner + last-contacted, on the institution row) ----

export async function updateCrm(id: string, input: CrmInput, actor: Actor) {
  await assertTenant(id);
  const data = input as Record<string, unknown>;
  const map: Record<string, string> = { accountManager: "account_manager", lastContactedAt: "last_contacted_at" };
  const sets: string[] = [];
  const params: unknown[] = [];
  for (const [field, col] of Object.entries(map)) {
    if (field in data) {
      params.push(data[field]);
      sets.push(`${col} = $${params.length}`);
    }
  }
  params.push(id);
  await query(`UPDATE institutions SET ${sets.join(", ")} WHERE id = $${params.length}`, params);
  await recordAudit(actor, {
    action: "tenant.crm_update", targetType: "institution", targetId: id, institutionId: id,
    detail: { fields: Object.keys(data) },
  });
  return getTenant(id);
}

// ---- Branding (per-tenant institution_branding; super-admin write path) ----

export async function updateBranding(id: string, input: BrandingInput, actor: Actor) {
  await assertTenant(id);
  const data = input as Record<string, unknown>;
  const map: Record<string, string> = {
    displayName: "display_name", logoUrl: "logo_url", primaryColor: "primary_color", tagline: "tagline",
    letterhead: "letterhead", footer: "footer",
  };
  await query(
    `INSERT INTO institution_branding (institution_id) VALUES ($1) ON CONFLICT (institution_id) DO NOTHING`,
    [id]
  );
  const sets: string[] = ["updated_at = now()"];
  const params: unknown[] = [];
  for (const [field, col] of Object.entries(map)) {
    if (field in data) {
      params.push(data[field]);
      sets.push(`${col} = $${params.length}`);
    }
  }
  params.push(id);
  await query(`UPDATE institution_branding SET ${sets.join(", ")} WHERE institution_id = $${params.length}`, params);
  await recordAudit(actor, {
    action: "tenant.branding_update", targetType: "institution", targetId: id, institutionId: id,
    detail: { fields: Object.keys(data) },
  });
  return getTenant(id);
}

// ---- Tenant documents (registration cert, agreement, KYC, …). Bytes in the
//      shared storage layer; verification + audit on every write. ----

const DOC_COLS = `
  id, category, original_name AS "originalName", mime_type AS "mimeType",
  size_bytes AS "sizeBytes", storage_mode AS "storageMode",
  verification_status AS "verificationStatus", verification_remarks AS "verificationRemarks",
  verified_at AS "verifiedAt", archived_at AS "archivedAt",
  uploaded_by_email AS "uploadedByEmail", created_at AS "createdAt"`;

export async function listDocuments(id: string) {
  await assertTenant(id);
  const { rows } = await query(
    `SELECT ${DOC_COLS} FROM tenant_documents WHERE institution_id = $1 ORDER BY created_at DESC`,
    [id]
  );
  return rows;
}

export async function addDocument(
  id: string,
  category: string,
  file: { originalname: string; mimetype: string; size: number; buffer: Buffer },
  actor: Actor
) {
  await assertTenant(id);
  const ext = assertValidFile(file.originalname, file.mimetype, file.size);
  const safeName = `${randomUUID()}.${ext}`;
  const storageKey = `tenant-documents/${id}/${safeName}`;
  try {
    await storage.put(storageKey, file.buffer, file.mimetype);
  } catch (err) {
    console.error("tenant document storage.put failed:", err);
    throw ApiError.serviceUnavailable("File storage is unavailable");
  }
  const { rows } = await query<{ id: string }>(
    `INSERT INTO tenant_documents
       (institution_id, category, original_name, safe_name, mime_type, size_bytes,
        storage_key, storage_mode, uploaded_by, uploaded_by_email)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
    [id, category, file.originalname, safeName, file.mimetype, file.size, storageKey, storage.mode, actor.id, actor.email]
  );
  await recordAudit(actor, {
    action: "tenant.document_add", targetType: "institution", targetId: id, institutionId: id,
    detail: { documentId: rows[0].id, category },
  });
  return listDocuments(id);
}

export async function getDocumentForDownload(id: string, docId: string) {
  await assertTenant(id);
  const { rows } = await query<{ storage_key: string; mime_type: string; original_name: string }>(
    `SELECT storage_key, mime_type, original_name FROM tenant_documents WHERE id = $2 AND institution_id = $1`,
    [id, docId]
  );
  if (!rows[0]) throw ApiError.notFound("Document not found");
  let buffer: Buffer;
  try {
    buffer = await storage.get(rows[0].storage_key);
  } catch (err) {
    console.error("tenant document storage.get failed:", err);
    throw ApiError.serviceUnavailable("File storage is unavailable");
  }
  return { buffer, mimeType: rows[0].mime_type, originalName: rows[0].original_name };
}

export async function verifyDocument(id: string, docId: string, input: DocVerifyInput, actor: Actor) {
  await assertTenant(id);
  const { rows } = await query<{ id: string }>(
    `UPDATE tenant_documents
       SET verification_status = $3, verification_remarks = $4, verified_by = $5, verified_at = now()
     WHERE id = $2 AND institution_id = $1 RETURNING id`,
    [id, docId, input.status, input.remarks ?? null, actor.id]
  );
  if (!rows[0]) throw ApiError.notFound("Document not found");
  await recordAudit(actor, {
    action: "tenant.document_verify", targetType: "institution", targetId: id, institutionId: id,
    detail: { documentId: docId, status: input.status },
  });
  return listDocuments(id);
}

/** Soft-archive a document (keeps the file + row; drops it from active views). */
export async function archiveDocument(id: string, docId: string, actor: Actor) {
  await assertTenant(id);
  const { rows } = await query<{ id: string }>(
    `UPDATE tenant_documents SET archived_at = now()
     WHERE id = $2 AND institution_id = $1 AND archived_at IS NULL RETURNING id`,
    [id, docId]
  );
  if (!rows[0]) throw ApiError.notFound("Document not found");
  await recordAudit(actor, {
    action: "tenant.document_archive", targetType: "institution", targetId: id, institutionId: id,
    detail: { documentId: docId },
  });
  return listDocuments(id);
}

/** Permanently remove a single document file + row (a document, not a tenant). */
export async function deleteDocument(id: string, docId: string, actor: Actor) {
  await assertTenant(id);
  const { rows } = await query<{ storage_key: string }>(
    `DELETE FROM tenant_documents WHERE id = $2 AND institution_id = $1 RETURNING storage_key`,
    [id, docId]
  );
  if (!rows[0]) throw ApiError.notFound("Document not found");
  await storage.remove(rows[0].storage_key).catch((err) => console.warn("tenant document storage.remove failed:", err));
  await recordAudit(actor, {
    action: "tenant.document_delete", targetType: "institution", targetId: id, institutionId: id,
    detail: { documentId: docId },
  });
  return listDocuments(id);
}

// ---- Health / usage dashboard (REAL metrics only) ----

export async function tenantHealth(id: string) {
  await assertTenant(id);
  const [usage, billing, extra] = await Promise.all([
    tenantUsage(id),
    tenantBilling(id),
    query<Record<string, unknown>>(
      `SELECT
         (SELECT COALESCE(sum(size_bytes),0)::bigint FROM documents WHERE institution_id = $1) AS "storageBytes",
         (SELECT count(*)::int FROM users WHERE institution_id = $1 AND locked_until IS NOT NULL AND locked_until > now()) AS "lockedAccounts",
         (SELECT count(*)::int FROM users WHERE institution_id = $1 AND failed_login_attempts > 0) AS "failingLogins",
         (SELECT count(*)::int FROM messages WHERE institution_id = $1) AS "inAppMessages",
         (SELECT count(*)::int FROM tenant_documents WHERE institution_id = $1 AND archived_at IS NULL) AS "documents",
         (SELECT max(rt.last_used_at) FROM refresh_tokens rt JOIN users u ON u.id = rt.user_id WHERE u.institution_id = $1) AS "lastSessionActivity"`,
      [id]
    ),
  ]);
  const e = extra.rows[0];
  const b = billing as Record<string, unknown>;
  return {
    usage,
    storageBytes: Number(e.storageBytes ?? 0),
    lockedAccounts: Number(e.lockedAccounts ?? 0),
    failingLogins: Number(e.failingLogins ?? 0),
    inAppMessages: Number(e.inAppMessages ?? 0),
    documents: Number(e.documents ?? 0),
    lastSessionActivity: e.lastSessionActivity ?? null,
    billing: {
      outstanding: b.outstanding,
      overdueCount: b.overdueCount,
      paid: b.paid,
      issued: b.issued,
      subscription: b.subscription,
    },
  };
}

// ---- Safe exit / export (basic profile + users; never deletes tenant data) ----

export async function exportTenantProfile(id: string) {
  const t = (await getTenant(id)) as Record<string, unknown>;
  const columns = [{ key: "field", label: "Field" }, { key: "value", label: "Value" }];
  const pick: [string, unknown][] = [
    ["Name", t.name], ["Code", t.code], ["Type", t.institutionType], ["Status", t.status],
    ["Legal name", t.legalName], ["Short name", t.shortName], ["Email", t.email], ["Phone", t.phone],
    ["Website", t.website], ["Address", t.address], ["City", t.city], ["State", t.state],
    ["Country", t.country], ["PIN", t.pincode], ["Academic year", t.academicYear],
    ["Timezone", t.timezone], ["Currency", t.currency], ["Slug", t.slug],
    ["Account manager", t.accountManager],
  ];
  const rows = pick.map(([field, value]) => ({ field, value: value ?? "" }));
  return { columns, rows: rows as Record<string, unknown>[] };
}

export async function exportTenantUsers(id: string) {
  await assertTenant(id);
  const { rows } = await query<Record<string, unknown>>(
    `SELECT full_name AS "fullName", email, role, is_active AS "isActive",
            to_char(created_at,'YYYY-MM-DD') AS "createdAt"
     FROM users WHERE institution_id = $1 ORDER BY role, full_name`,
    [id]
  );
  const columns = [
    { key: "fullName", label: "Name" }, { key: "email", label: "Email" },
    { key: "role", label: "Role" }, { key: "isActive", label: "Active" },
    { key: "createdAt", label: "Created" },
  ];
  const data = rows.map((r) => ({ ...r, isActive: r.isActive ? "yes" : "no" }));
  return { columns, rows: data };
}

// ---- Full tenant user directory (all roles, with filters) ----

export async function listTenantUsers(id: string, filters: { role?: string; status?: string }) {
  await assertTenant(id);
  const where: string[] = ["u.institution_id = $1"];
  const params: unknown[] = [id];
  if (filters.role) {
    params.push(filters.role);
    where.push(`u.role = $${params.length}`);
  }
  if (filters.status === "active") where.push("u.is_active = true");
  else if (filters.status === "disabled") where.push("u.is_active = false");
  else if (filters.status === "locked") where.push("u.locked_until IS NOT NULL AND u.locked_until > now()");
  const { rows } = await query(
    `SELECT u.id, u.full_name AS "fullName", u.email, u.role, u.is_active AS "isActive",
            u.totp_enabled AS "twoFactorEnabled",
            (u.locked_until IS NOT NULL AND u.locked_until > now()) AS "locked",
            (SELECT max(rt.last_used_at) FROM refresh_tokens rt WHERE rt.user_id = u.id) AS "lastActiveAt"
     FROM users u WHERE ${where.join(" AND ")} ORDER BY u.role, u.full_name`,
    params
  );
  return rows;
}

// ---- Reset a tenant admin's two-factor auth (audited; no secret exposed) ----

export async function resetAdmin2fa(id: string, adminUserId: string, actor: Actor) {
  await assertTenant(id);
  const { rows } = await query<{ id: string }>(
    `UPDATE users SET totp_enabled = false, totp_secret = NULL
     WHERE id = $2 AND institution_id = $1 AND role = 'admin' RETURNING id`,
    [id, adminUserId]
  );
  if (!rows[0]) throw ApiError.notFound("Tenant admin not found");
  await recordAudit(actor, {
    action: "tenant.admin_2fa_reset", targetType: "user", targetId: adminUserId, institutionId: id, detail: {},
  });
  return getTenant(id);
}

// ---- Bulk lifecycle (reuses setLifecycle: per-tenant reason guard + audit) ----

export async function bulkLifecycle(ids: string[], status: string, reason: string | undefined, actor: Actor) {
  const results: { id: string; ok: boolean; error?: string }[] = [];
  for (const id of ids) {
    try {
      await setLifecycle(id, status, reason, actor);
      results.push({ id, ok: true });
    } catch (err) {
      results.push({ id, ok: false, error: err instanceof ApiError ? err.message : "Action failed" });
    }
  }
  return { status, requested: ids.length, succeeded: results.filter((r) => r.ok).length, results };
}
