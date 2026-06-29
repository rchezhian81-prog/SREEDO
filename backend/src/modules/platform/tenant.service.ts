import { randomBytes } from "node:crypto";
import type { z } from "zod";
import { query, withTransaction } from "../../db/postgres";
import { ApiError } from "../../utils/api-error";
import { hashPassword } from "../../utils/password";
import { effectiveLimits } from "../../utils/plan-limits";
import { recordAudit, type Actor } from "./platform.service";
import type {
  complianceSchema,
  createTenantSchema,
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
  i.created_at AS "createdAt", i.updated_at AS "updatedAt"`;

async function assertTenant(id: string): Promise<void> {
  const { rows } = await query("SELECT 1 FROM institutions WHERE id = $1", [id]);
  if (!rows[0]) throw ApiError.notFound("Institution not found");
}

// ---- Directory (list + export) ----

type Filters = Partial<Pick<ListQuery, "q" | "institutionType" | "status" | "type">>;

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
  const { rows } = await query<Record<string, number>>(
    `SELECT
       (SELECT count(*)::int FROM students s WHERE s.institution_id = $1 AND s.status <> 'archived') AS students,
       (SELECT count(*)::int FROM teachers t WHERE t.institution_id = $1) AS staff,
       (SELECT count(*)::int FROM users u WHERE u.institution_id = $1) AS users,
       (SELECT count(*)::int FROM branches b WHERE b.institution_id = $1) AS branches,
       (SELECT count(*)::int FROM refresh_tokens rt JOIN users u ON u.id = rt.user_id
          WHERE u.institution_id = $1 AND rt.revoked_at IS NULL AND rt.expires_at > now()) AS "activeSessions"`,
    [id]
  );
  return rows[0];
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
    `SELECT p.name AS "packageName", s.status, p.billing_cycle AS "billingCycle",
            to_char(s.starts_at,'YYYY-MM-DD') AS "startsAt", to_char(s.ends_at,'YYYY-MM-DD') AS "endsAt"
     FROM institution_subscriptions s JOIN subscription_packages p ON p.id = s.package_id
     WHERE s.institution_id = $1 ORDER BY s.created_at DESC LIMIT 1`,
    [id]
  );
  return { ...inv.rows[0], latest: latest.rows[0] ?? null, subscription: sub.rows[0] ?? null };
}

// Onboarding checklist — steps derived from REAL data where possible; manual
// steps (branding/communication/documents) read from the onboarding jsonb.
const ONBOARDING_STEPS: { key: string; label: string; manual?: boolean }[] = [
  { key: "profile", label: "Institution profile" },
  { key: "academic_structure", label: "Institution type & academic structure" },
  { key: "primary_admin", label: "Primary admin" },
  { key: "subscription", label: "Subscription / package" },
  { key: "limits", label: "Plan limits" },
  { key: "branding", label: "Branding / logo", manual: true },
  { key: "domain", label: "Tenant URL / slug" },
  { key: "communication", label: "Communication settings", manual: true },
  { key: "review", label: "Review & activate" },
];

function computeOnboarding(
  d: Record<string, unknown>,
  derived: { hasAdmin: boolean; hasSubscription: boolean }
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
    review: d.status !== "draft",
  };
  const steps = ONBOARDING_STEPS.map((s) => ({
    key: s.key,
    label: s.label,
    done: s.manual ? manual[s.key] === true : auto[s.key] === true,
  }));
  const done = steps.filter((s) => s.done).length;
  return { steps, completion: Math.round((done / steps.length) * 100), completedAt: (onboarding as { completedAt?: string }).completedAt ?? null };
}

export async function getTenant(id: string) {
  const { rows } = await query<Record<string, unknown>>(`SELECT ${TENANT_COLS} FROM institutions i WHERE i.id = $1`, [id]);
  if (!rows[0]) throw ApiError.notFound("Institution not found");
  const t = rows[0];
  const [usage, limits, billing, adminRows, recent] = await Promise.all([
    tenantUsage(id),
    effectiveLimits(id),
    tenantBilling(id),
    query<Record<string, unknown>>(
      `SELECT id, full_name AS "fullName", email, is_active AS "isActive"
       FROM users WHERE institution_id = $1 AND role = 'admin' ORDER BY created_at ASC`,
      [id]
    ),
    query(
      `SELECT a.action, a.actor_email AS "actorEmail", a.created_at AS "createdAt", a.ip
       FROM platform_audit_log a WHERE a.institution_id = $1 ORDER BY a.created_at DESC LIMIT 20`,
      [id]
    ),
  ]);
  const onboarding = computeOnboarding(t, {
    hasAdmin: adminRows.rows.length > 0,
    hasSubscription: !!billing.subscription,
  });
  return { ...t, usage, limits, billing, admins: adminRows.rows, recentActivity: recent.rows, onboardingProgress: onboarding };
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
  return getTenant(id);
}

export async function updateTenant(id: string, input: UpdateTenant, actor: Actor) {
  await assertTenant(id);
  const data = input as Record<string, unknown>;
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
  await recordAudit(actor, {
    action: "tenant.update", targetType: "institution", targetId: id, institutionId: id,
    detail: { fields: Object.keys(data) },
  });
  return getTenant(id);
}

// ---- Lifecycle (status + is_active sync; suspend/archive require a reason) ----

const ALLOWED_STATUS = new Set(["draft", "trial", "active", "suspended", "expired", "archived"]);

export async function setLifecycle(id: string, status: string, reason: string | undefined, actor: Actor) {
  if (!ALLOWED_STATUS.has(status)) throw ApiError.badRequest("Invalid status");
  await assertTenant(id);
  if ((status === "suspended" || status === "archived") && !reason?.trim()) {
    throw ApiError.badRequest(`A reason is required to ${status === "archived" ? "archive" : "suspend"} a tenant`);
  }
  const isActive = ACTIVE_STATUSES.has(status);
  const { rows } = await query(
    `UPDATE institutions SET status = $2, is_active = $3 WHERE id = $1
     RETURNING id, name, status, is_active AS "isActive"`,
    [id, status, isActive]
  );
  if (!rows[0]) throw ApiError.notFound("Institution not found");
  await recordAudit(actor, {
    action: `tenant.${status}`, targetType: "institution", targetId: id, institutionId: id,
    detail: reason ? { reason } : {},
  });
  return getTenant(id);
}

// ---- Settings (type-based config in settings jsonb) ----

export async function updateSettings(id: string, input: SettingsInput, actor: Actor) {
  await assertTenant(id);
  // Shallow-merge each provided settings sub-object into institutions.settings.
  const { rows } = await query(
    `UPDATE institutions SET settings = COALESCE(settings,'{}'::jsonb) || $2::jsonb WHERE id = $1 RETURNING id`,
    [id, JSON.stringify(input)]
  );
  if (!rows[0]) throw ApiError.notFound("Institution not found");
  await recordAudit(actor, {
    action: "tenant.settings_update", targetType: "institution", targetId: id, institutionId: id,
    detail: { sections: Object.keys(input) },
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

export async function completeOnboarding(id: string, actor: Actor) {
  await assertTenant(id);
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
    action: "tenant.onboarding_complete", targetType: "institution", targetId: id, institutionId: id, detail: {},
  });
  return getTenant(id);
}

// ---- Compliance / approval ----

export async function setCompliance(id: string, input: ComplianceInput, actor: Actor) {
  await assertTenant(id);
  const data = input as Record<string, unknown>;
  const map: Record<string, string> = {
    termsAccepted: "terms_accepted", agreementSigned: "agreement_signed",
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

export async function setPrimaryAdmin(id: string, input: PrimaryAdmin, actor: Actor) {
  await assertTenant(id);
  const adminId = await withTransaction((client) => createAdminUser(client as never, id, input));
  await recordAudit(actor, {
    action: "tenant.admin_create", targetType: "user", targetId: adminId, institutionId: id,
    detail: { email: input.email },
  });
  return getTenant(id);
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
