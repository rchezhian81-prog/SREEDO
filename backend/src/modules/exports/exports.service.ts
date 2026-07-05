import { createHash } from "node:crypto";
import type { z } from "zod";
import { query } from "../../db/postgres";
import { ApiError } from "../../utils/api-error";
import { storage, storageMode } from "../../utils/storage";
import { toCsv, toXlsx, toZip, type Cell } from "../../utils/spreadsheet";
import { enqueue } from "../jobs/jobs.service";
import { recordSecurityEvent } from "../../utils/security-audit";
import { maskSecrets, maskFreeText } from "../platform/audit.service";
// Per-scope data sources (all already masked at source; re-masked here as a net).
import { exportInstitutions } from "../platform/platform.service";
import { listPlatformAdmins } from "../platform/platform-admins.service";
import { exportInvoices } from "../billing/invoices.service";
import { exportSubscriptions } from "../platform/subscriptions.service";
import { listPackages } from "../superadmin/superadmin.service";
import { listCoupons } from "../billing/coupons.service";
import { listTransactions } from "../saaspayments/saaspayments.service";
import { exportRows as auditExportRows, EXPORT_COLUMNS as AUDIT_COLUMNS } from "../platform/audit.service";
import { highRiskExportRows, HIGH_RISK_COLUMNS } from "../platform/security.service";
import { exportSessions } from "../platform/support.service";
import { backupHistoryExportRows } from "../backups/backups.service";
import { SENSITIVE_SCOPES } from "./exports.schema";
import type {
  createExportSchema,
  decisionSchema,
  listExportsQuerySchema,
  retentionUpdateSchema,
  scheduleCreateSchema,
  scheduleListQuerySchema,
  scheduleUpdateSchema,
} from "./exports.schema";

/**
 * Super Admin K — Data Export Center (service layer).
 *
 * Governed, artifact-based platform exports. Every artifact is a masked snapshot
 * (secret-named keys + secret-shaped values redacted), stored under an internal
 * `exports/<id>.<ext>` key that is NEVER returned by the API (the public
 * projection exposes only a `hasArtifact` boolean). Sensitive scopes require a
 * reason; high-risk scopes additionally require a second-super-admin approval
 * before the artifact is generated. Downloads are reason-gated + audited. Rows are
 * soft-archived / expired — a platform_exports row is never hard-deleted.
 */

// --- audit actor (mirrors backups.service) ---------------------------------

export interface Actor {
  id: string | null;
  email: string;
  role: string;
  ip: string | null;
}

const SYSTEM_ACTOR: Actor = { id: null, email: "system", role: "system", ip: null };

interface AuditInput {
  action: string;
  targetId: string | null;
  institutionId: string | null;
  detail?: Record<string, unknown>;
}

/**
 * Durable platform audit entry, hardcoded to target_type='export' so every
 * `export.*` action lands in platform_audit_log and auto-appears in the Audit
 * Console + (because `export` is in the high-risk regex) the Security Center
 * high-risk feed. Never carries a secret or a storage path.
 */
export async function recordAudit(actor: Actor, input: AuditInput): Promise<void> {
  await query(
    `INSERT INTO platform_audit_log
       (action, target_type, target_id, institution_id, actor_id, actor_email, actor_role, detail, ip)
     VALUES ($1,'export',$2,$3,$4,$5,$6,$7::jsonb,$8)`,
    [
      input.action,
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

// --- projection (NEVER exposes storage_key) --------------------------------

const PUBLIC_SELECT = `
  id, name, scope, format, institution_id AS "institutionId", filters, reason,
  sensitive, status,
  approval_status AS "approvalStatus", approved_by AS "approvedBy", approved_at AS "approvedAt",
  approval_reason AS "approvalReason",
  storage_mode AS "storageMode", size_bytes AS "sizeBytes", row_count AS "rowCount",
  file_count AS "fileCount", checksum, checksum_algo AS "checksumAlgo", error,
  expires_at AS "expiresAt", download_count AS "downloadCount",
  last_downloaded_by AS "lastDownloadedBy", last_downloaded_at AS "lastDownloadedAt",
  archived_at AS "archivedAt", archived_by AS "archivedBy", archive_reason AS "archiveReason",
  schedule_id AS "scheduleId", requested_by AS "requestedBy",
  started_at AS "startedAt", completed_at AS "completedAt", created_at AS "createdAt",
  (storage_key IS NOT NULL) AS "hasArtifact"`;

type Row = Record<string, unknown>;

/** SHA-256 hex digest of a buffer (artifact integrity checksum). */
function sha256(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

/** Mask an API row: operator free-text through maskFreeText, filters through maskSecrets. */
function maskRow(r: Row): Row {
  if (!r) return r;
  return {
    ...r,
    filters: maskSecrets(r.filters ?? {}),
    reason: r.reason ? maskFreeText(r.reason) : r.reason,
    approvalReason: r.approvalReason ? maskFreeText(r.approvalReason) : r.approvalReason,
    archiveReason: r.archiveReason ? maskFreeText(r.archiveReason) : r.archiveReason,
  };
}

/** FINAL safety net: every artifact row is deep-masked, even though sources mask. */
function maskRowsForArtifact(rows: Row[]): Row[] {
  return rows.map((r) => maskSecrets(r) as Row);
}

// --- spreadsheet helpers ----------------------------------------------------

interface Column {
  key: string;
  label: string;
}
interface Dataset {
  columns: Column[];
  rows: Row[];
}

function toCell(v: unknown): Cell {
  if (v === null || v === undefined) return "";
  if (typeof v === "number") return Number.isFinite(v) ? v : String(v);
  if (typeof v === "boolean") return v ? "true" : "false";
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

function dataMatrix(columns: Column[], rows: Row[]): Cell[][] {
  return rows.map((r) => columns.map((c) => toCell(r[c.key])));
}

function csvString(columns: Column[], rows: Row[]): string {
  return toCsv(columns.map((c) => c.label), dataMatrix(columns, rows));
}

const FORMAT_META: Record<string, { ext: string; contentType: string }> = {
  csv: { ext: "csv", contentType: "text/csv; charset=utf-8" },
  xlsx: { ext: "xlsx", contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
  json: { ext: "json", contentType: "application/json; charset=utf-8" },
  zip: { ext: "zip", contentType: "application/zip" },
};

// --- scope registry ---------------------------------------------------------

interface ScopeSource {
  label: string;
  sensitive: boolean;
  requiresInstitution?: boolean;
  approval?: boolean;
  generate(filters: Row, institutionId: string | null, actor: Actor): Promise<Dataset>;
}

/** Data this platform export cannot safely produce standalone (per-tenant only). */
const UNAVAILABLE_SCOPES = new Set(["students", "staff", "fees", "attendance", "exams"]);
const STANDALONE_UNAVAILABLE_MSG =
  "exported per-tenant via the Data Portability Pack, not as a standalone platform export";

const P = <T>(x: T): T => x; // identity to keep casts readable

/** Column set for a masked cross-tenant user projection (NEVER password_hash). */
const TENANT_USER_COLUMNS: Column[] = [
  { key: "email", label: "Email" },
  { key: "fullName", label: "Full name" },
  { key: "role", label: "Role" },
  { key: "institutionName", label: "Institution" },
  { key: "institutionCode", label: "Institution code" },
  { key: "isActive", label: "Active" },
  { key: "twoFactorEnabled", label: "2FA enabled" },
  { key: "createdAt", label: "Created" },
];

const PLATFORM_ADMIN_COLUMNS: Column[] = [
  { key: "fullName", label: "Name" },
  { key: "email", label: "Email" },
  { key: "platformRole", label: "Platform role" },
  { key: "isActive", label: "Active" },
  { key: "twoFactorEnabled", label: "2FA enabled" },
  { key: "locked", label: "Locked" },
  { key: "lastLoginAt", label: "Last login" },
  { key: "activeSessions", label: "Active sessions" },
  { key: "createdAt", label: "Created" },
];

const PACKAGE_COLUMNS: Column[] = [
  { key: "name", label: "Name" },
  { key: "description", label: "Description" },
  { key: "currency", label: "Currency" },
  { key: "price", label: "Price" },
  { key: "billingCycle", label: "Billing cycle" },
  { key: "status", label: "Status" },
  { key: "visibility", label: "Visibility" },
  { key: "maxStudents", label: "Max students" },
  { key: "maxStaff", label: "Max staff" },
  { key: "taxPercent", label: "Tax %" },
  { key: "isActive", label: "Active" },
  { key: "createdAt", label: "Created" },
];

// internalNotes is intentionally DROPPED (not a column and stripped from rows).
const COUPON_COLUMNS: Column[] = [
  { key: "code", label: "Code" },
  { key: "name", label: "Name" },
  { key: "discountType", label: "Discount type" },
  { key: "discountValue", label: "Discount value" },
  { key: "maxDiscountAmount", label: "Max discount" },
  { key: "minInvoiceAmount", label: "Min invoice" },
  { key: "validFrom", label: "Valid from" },
  { key: "validUntil", label: "Valid until" },
  { key: "totalUsageLimit", label: "Total usage limit" },
  { key: "perTenantUsageLimit", label: "Per-tenant limit" },
  { key: "status", label: "Status" },
  { key: "usedCount", label: "Used" },
  { key: "createdAt", label: "Created" },
];

const BACKUP_COLUMNS: Column[] = [
  { key: "createdAt", label: "Created" },
  { key: "scope", label: "Scope" },
  { key: "trigger", label: "Trigger" },
  { key: "status", label: "Status" },
  { key: "sizeBytes", label: "Size (bytes)" },
  { key: "tableCount", label: "Tables" },
  { key: "rowCount", label: "Rows" },
  { key: "checksumStatus", label: "Checksum" },
  { key: "createdBy", label: "Created by" },
  { key: "completedAt", label: "Completed" },
];

const DOCUMENT_COLUMNS: Column[] = [
  { key: "id", label: "Document ID" },
  { key: "institutionName", label: "Institution" },
  { key: "ownerType", label: "Owner type" },
  { key: "category", label: "Category" },
  { key: "originalName", label: "Original name" },
  { key: "mimeType", label: "MIME type" },
  { key: "sizeBytes", label: "Size (bytes)" },
  { key: "storageMode", label: "Storage mode" },
  { key: "uploadedBy", label: "Uploaded by" },
  { key: "createdAt", label: "Created" },
];

const PROFILE_COLUMNS: Column[] = [
  { key: "id", label: "Institution ID" },
  { key: "name", label: "Name" },
  { key: "code", label: "Code" },
  { key: "type", label: "Type" },
  { key: "isActive", label: "Active" },
  { key: "createdAt", label: "Created" },
];

/** Masked cross-tenant (or single-tenant) user rows — the hash column is never selected. */
async function tenantUsersRows(institutionId: string | null, filters?: Row): Promise<Row[]> {
  const params: unknown[] = [];
  const where: string[] = ["u.institution_id IS NOT NULL", "u.role <> 'super_admin'"];
  if (institutionId) {
    params.push(institutionId);
    where.push(`u.institution_id = $${params.length}`);
  }
  if (filters?.dateFrom) {
    params.push(`${String(filters.dateFrom)}T00:00:00.000Z`);
    where.push(`u.created_at >= $${params.length}`);
  }
  if (filters?.dateTo) {
    params.push(`${String(filters.dateTo)}T23:59:59.999Z`);
    where.push(`u.created_at <= $${params.length}`);
  }
  const { rows } = await query<Row>(
    `SELECT u.email, u.full_name AS "fullName", u.role,
            inst.name AS "institutionName", inst.code AS "institutionCode",
            u.is_active AS "isActive", u.totp_enabled AS "twoFactorEnabled",
            u.created_at AS "createdAt"
     FROM users u LEFT JOIN institutions inst ON inst.id = u.institution_id
     WHERE ${where.join(" AND ")}
     ORDER BY u.created_at DESC LIMIT 50000`,
    params
  );
  return rows;
}

/** Masked document metadata — storage_key / safe_name never selected. */
async function documentsMetaRows(institutionId: string | null): Promise<Row[]> {
  const params: unknown[] = [];
  let where = "";
  if (institutionId) {
    params.push(institutionId);
    where = `WHERE d.institution_id = $1`;
  }
  const { rows } = await query<Row>(
    `SELECT d.id, inst.name AS "institutionName", d.owner_type AS "ownerType",
            d.category, d.original_name AS "originalName", d.mime_type AS "mimeType",
            d.size_bytes AS "sizeBytes", d.storage_mode AS "storageMode",
            d.uploaded_by AS "uploadedBy", d.created_at AS "createdAt"
     FROM documents d LEFT JOIN institutions inst ON inst.id = d.institution_id
     ${where} ORDER BY d.created_at DESC LIMIT 50000`,
    params
  );
  return rows;
}

/** Flatten the paginated platform-admin list up to a hard cap. */
async function flattenPlatformAdmins(): Promise<Row[]> {
  const out: Row[] = [];
  let page = 1;
  const pageSize = 200;
  for (;;) {
    const res = await listPlatformAdmins(
      P<Parameters<typeof listPlatformAdmins>[0]>({ page, pageSize, sort: "createdAt", order: "desc" } as never)
    );
    out.push(...(res.rows as Row[]));
    if (res.rows.length < pageSize || out.length >= res.total || out.length >= 50000) break;
    page += 1;
  }
  return out;
}

const SCOPE_SOURCES: Record<string, ScopeSource> = {
  institutions: {
    label: "Institutions",
    sensitive: false,
    generate: async (filters) =>
      exportInstitutions(
        P<Parameters<typeof exportInstitutions>[0]>({ ...filters, sort: "createdAt", order: "desc" } as never)
      ) as Promise<Dataset>,
  },
  platform_admins: {
    label: "Platform admins",
    sensitive: true,
    approval: true,
    generate: async () => ({ columns: PLATFORM_ADMIN_COLUMNS, rows: await flattenPlatformAdmins() }),
  },
  tenant_users: {
    label: "Tenant users",
    sensitive: true,
    generate: async (filters, institutionId) => ({
      columns: TENANT_USER_COLUMNS,
      rows: await tenantUsersRows(institutionId ?? null, filters),
    }),
  },
  invoices: {
    label: "Invoices",
    sensitive: false,
    generate: async (filters) =>
      exportInvoices(
        P<Parameters<typeof exportInvoices>[0]>({ ...filters, sort: "createdAt", order: "desc" } as never)
      ) as Promise<Dataset>,
  },
  subscriptions: {
    label: "Subscriptions",
    sensitive: false,
    generate: async (filters) =>
      exportSubscriptions(
        P<Parameters<typeof exportSubscriptions>[0]>({
          ...filters,
          sort: "institution",
          order: "asc",
          page: 1,
          pageSize: 20000,
        } as never)
      ) as Promise<Dataset>,
  },
  packages: {
    label: "Subscription packages",
    sensitive: false,
    generate: async () => ({ columns: PACKAGE_COLUMNS, rows: (await listPackages()) as Row[] }),
  },
  coupons: {
    label: "Coupons",
    sensitive: false,
    generate: async () => {
      const raw = (await listCoupons()) as Row[];
      // Drop internalNotes entirely from the exported rows.
      const rows = raw.map(({ internalNotes: _drop, ...rest }) => rest as Row);
      return { columns: COUPON_COLUMNS, rows };
    },
  },
  payments: {
    label: "Payments",
    sensitive: true,
    generate: async (filters) => {
      const res = await listTransactions(P<Parameters<typeof listTransactions>[0]>({ ...filters } as never));
      return { columns: res.columns as Column[], rows: res.rows as Row[] };
    },
  },
  audit_logs: {
    label: "Audit logs",
    sensitive: true,
    approval: true,
    generate: async (filters) => {
      const rows = await auditExportRows(
        P<Parameters<typeof auditExportRows>[0]>({ ...filters, sort: "createdAt", order: "desc" } as never)
      );
      return { columns: AUDIT_COLUMNS as Column[], rows: rows as Row[] };
    },
  },
  security_reports: {
    label: "Security reports",
    sensitive: true,
    approval: true,
    generate: async (filters) => {
      const rows = await highRiskExportRows(
        P<Parameters<typeof highRiskExportRows>[0]>({ ...filters, category: "all" } as never)
      );
      return { columns: HIGH_RISK_COLUMNS as Column[], rows: rows as Row[] };
    },
  },
  support_history: {
    label: "Support access history",
    sensitive: true,
    approval: true,
    generate: async (filters) => {
      const res = await exportSessions(P<Parameters<typeof exportSessions>[0]>({ ...filters } as never));
      return { columns: res.columns as Column[], rows: res.rows as Row[] };
    },
  },
  backup_metadata: {
    label: "Backup metadata",
    sensitive: true,
    approval: true,
    generate: async (filters) => {
      const rows = await backupHistoryExportRows(
        P<Parameters<typeof backupHistoryExportRows>[0]>({ ...filters } as never)
      );
      return { columns: BACKUP_COLUMNS, rows: rows as Row[] };
    },
  },
  documents_metadata: {
    label: "Document metadata",
    sensitive: false,
    generate: async (_filters, institutionId) => ({
      columns: DOCUMENT_COLUMNS,
      rows: await documentsMetaRows(institutionId ?? null),
    }),
  },
};

/** True when the filters carry any date bound (broad personal-data pulls need approval). */
function hasDateFilter(filters: Row | undefined): boolean {
  if (!filters) return false;
  const keys = [
    "dateFrom", "dateTo", "from", "to", "createdFrom", "createdTo",
    "startFrom", "startTo", "endFrom", "endTo", "paidFrom", "paidTo", "dueFrom", "dueTo",
  ];
  return keys.some((k) => filters[k] !== undefined && filters[k] !== "");
}

// --- internal row + generation ---------------------------------------------

interface InternalRow {
  id: string;
  name: string;
  scope: string;
  format: string;
  status: string;
  storageKey: string | null;
  institutionId: string | null;
  sensitive: boolean;
  expiresAt: Date | null;
  archivedAt: Date | null;
  approvalStatus: string;
  requestedBy: string | null;
  filters: Row | null;
}

async function loadInternal(id: string): Promise<InternalRow> {
  const { rows } = await query<InternalRow>(
    `SELECT id, name, scope, format, status, storage_key AS "storageKey",
            institution_id AS "institutionId", sensitive, expires_at AS "expiresAt",
            archived_at AS "archivedAt", approval_status AS "approvalStatus",
            requested_by AS "requestedBy", filters
     FROM platform_exports WHERE id = $1`,
    [id]
  );
  if (!rows[0]) throw ApiError.notFound("Export not found");
  return rows[0];
}

async function schemaVersion(): Promise<number> {
  const { rows } = await query<{ n: number }>("SELECT count(*)::int AS n FROM schema_migrations");
  return Number(rows[0].n);
}

async function ensureSettings(): Promise<void> {
  await query("INSERT INTO export_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING");
}

async function retentionDaysFor(sensitive: boolean): Promise<number> {
  await ensureSettings();
  const { rows } = await query<{ def: number; sens: number }>(
    `SELECT default_retention_days AS def, sensitive_retention_days AS sens FROM export_settings WHERE id = 1`
  );
  const r = rows[0] ?? { def: 7, sens: 2 };
  return sensitive ? Number(r.sens) : Number(r.def);
}

// NOTE: worded to avoid emitting any literal credential term (e.g. the raw
// column names) so the manifest itself can never be mistaken for leaked data —
// it DESCRIBES what is withheld without ever restating a sensitive field name.
const EXCLUDED_FIELDS = [
  "internal object-storage path",
  "credential hashes",
  "API / gateway keys",
  "auth + refresh bearer values",
  "2FA / TOTP seeds",
  "session / cookie / webhook signing keys",
  "document safe filename",
];
const MASKING_NOTE =
  "Every row was scrubbed through the platform redaction filter: credential-bearing " +
  "fields and redaction-shaped values are replaced with a masked marker before writing.";

/** Render the single- or multi-file artifact buffer + the list of file names. */
function renderArtifact(
  format: string,
  scope: string,
  columns: Column[],
  rows: Row[]
): { buffer: Buffer; files: string[] } {
  if (format === "xlsx") {
    const buffer = toXlsx(columns.map((c) => c.label), dataMatrix(columns, rows));
    return { buffer, files: [`${scope}.xlsx`] };
  }
  if (format === "json") {
    const buffer = Buffer.from(JSON.stringify({ scope, columns, rows }, null, 2), "utf8");
    return { buffer, files: [`${scope}.json`] };
  }
  if (format === "zip") {
    const csv = Buffer.from(csvString(columns, rows), "utf8");
    const parts = [{ name: `${scope}.csv`, data: csv }];
    const checksums = parts.map((p) => `${sha256(p.data)}  ${p.name}`).join("\n") + "\n";
    const innerManifest = {
      scope,
      files: parts.map((p) => ({ name: p.name, sha256: sha256(p.data), bytes: p.data.length })),
      maskedFields: MASKING_NOTE,
      excludedFields: EXCLUDED_FIELDS,
    };
    const all = [
      ...parts,
      { name: "CHECKSUMS.txt", data: Buffer.from(checksums, "utf8") },
      { name: "manifest.json", data: Buffer.from(JSON.stringify(innerManifest, null, 2), "utf8") },
    ];
    return { buffer: toZip(all), files: all.map((f) => f.name) };
  }
  // csv (default)
  const buffer = Buffer.from(csvString(columns, rows), "utf8");
  return { buffer, files: [`${scope}.csv`] };
}

async function buildManifest(opts: {
  row: InternalRow;
  actor: Actor;
  columns: Column[];
  rowCount: number;
  files: string[];
  checksum: string;
}): Promise<Record<string, unknown>> {
  return {
    id: opts.row.id,
    name: opts.row.name,
    scope: opts.row.scope,
    format: opts.row.format,
    institutionId: opts.row.institutionId ?? null,
    createdBy: opts.actor.email,
    createdAt: new Date().toISOString(),
    filters: maskSecrets(opts.row.filters ?? {}),
    columns: opts.columns.map((c) => c.key),
    rowCount: opts.rowCount,
    fileCount: opts.files.length,
    files: opts.files,
    checksum: opts.checksum,
    checksumAlgo: "sha256",
    storageMode,
    maskedFields: MASKING_NOTE,
    excludedFields: EXCLUDED_FIELDS,
    appCommit: process.env.APP_COMMIT ?? null,
    schemaVersion: await schemaVersion(),
  };
}

/** Generate + store the artifact for a pending/approved row. Sets running → completed. */
async function generateArtifact(row: InternalRow, actor: Actor) {
  await query("UPDATE platform_exports SET status='running', started_at=now() WHERE id=$1", [row.id]);
  try {
    const source = SCOPE_SOURCES[row.scope];
    if (!source) throw new Error(`Unsupported export scope: ${row.scope}`);
    const dataset = await source.generate(row.filters ?? {}, row.institutionId, actor);
    const masked = maskRowsForArtifact(dataset.rows);
    const meta = FORMAT_META[row.format] ?? FORMAT_META.csv;
    const { buffer, files } = renderArtifact(row.format, row.scope, dataset.columns, masked);
    const checksum = sha256(buffer);
    const storageKey = `exports/${row.id}.${meta.ext}`;
    await storage.put(storageKey, buffer, meta.contentType);
    const retentionDays = await retentionDaysFor(row.sensitive);
    const manifest = await buildManifest({
      row,
      actor,
      columns: dataset.columns,
      rowCount: masked.length,
      files,
      checksum,
    });
    await query(
      `UPDATE platform_exports SET status='completed', storage_key=$2, storage_mode=$3,
         size_bytes=$4, row_count=$5, file_count=$6, checksum=$7, manifest=$8::jsonb,
         expires_at = now() + ($9 || ' days')::interval, completed_at=now(), error=NULL
       WHERE id=$1`,
      [row.id, storageKey, storageMode, buffer.length, masked.length, files.length, checksum,
       JSON.stringify(manifest), String(retentionDays)]
    );
    await recordAudit(actor, {
      action: "export.completed",
      targetId: row.id,
      institutionId: row.institutionId,
      detail: { scope: row.scope, format: row.format, rowCount: masked.length, sizeBytes: buffer.length, checksumAlgo: "sha256", storageMode },
    });
    if (row.sensitive) {
      await recordSecurityEvent({
        action: "export.completed",
        targetType: "export",
        targetId: row.id,
        actorId: actor.id,
        actorEmail: actor.email,
        actorRole: actor.role,
        institutionId: row.institutionId,
        detail: { scope: row.scope, rowCount: masked.length },
        ip: actor.ip,
      });
    }
    return getExport(row.id);
  } catch (err) {
    const safe = (err instanceof Error ? err.message : "Export failed").slice(0, 500);
    await query("UPDATE platform_exports SET status='failed', error=$2, completed_at=now() WHERE id=$1", [row.id, safe]);
    await recordAudit(actor, {
      action: "export.failed",
      targetId: row.id,
      institutionId: row.institutionId,
      detail: { scope: row.scope, error: safe },
    });
    await recordSecurityEvent({
      action: "export.failed",
      targetType: "export",
      targetId: row.id,
      actorId: actor.id,
      actorEmail: actor.email,
      actorRole: actor.role,
      institutionId: row.institutionId,
      detail: { scope: row.scope, error: safe },
      ip: actor.ip,
    });
    throw new ApiError(500, `Export failed: ${safe}`);
  }
}

// --- expiry sweep -----------------------------------------------------------

/** Past-expiry completed exports → 'expired' + artifact removed (metadata kept). */
async function sweepExpired(): Promise<{ expired: number }> {
  const { rows } = await query<{ id: string; storageKey: string | null }>(
    `SELECT id, storage_key AS "storageKey" FROM platform_exports
     WHERE status='completed' AND expires_at IS NOT NULL AND expires_at < now()`
  );
  for (const r of rows) {
    if (r.storageKey) await storage.remove(r.storageKey).catch(() => undefined);
  }
  if (rows.length > 0) {
    await query(
      `UPDATE platform_exports SET status='expired', storage_key=NULL
       WHERE status='completed' AND expires_at IS NOT NULL AND expires_at < now()`
    );
  }
  return { expired: rows.length };
}

// --- create / list / get / manifest ----------------------------------------

export async function createExport(input: z.infer<typeof createExportSchema>, actor: Actor) {
  const scope = input.scope as string;
  if (UNAVAILABLE_SCOPES.has(scope)) {
    throw ApiError.badRequest(`"${scope}" is ${STANDALONE_UNAVAILABLE_MSG}.`);
  }
  if (scope === "portability_pack") {
    throw ApiError.badRequest("Use POST /exports/portability to generate a tenant data-portability pack.");
  }
  const source = SCOPE_SOURCES[scope];
  if (!source) throw ApiError.badRequest("Unsupported export scope");
  if (source.requiresInstitution && !input.institutionId) {
    throw ApiError.badRequest("A tenant (institutionId) is required for this export scope");
  }

  const sensitive = source.sensitive;
  const reason = (input.reason ?? input.riskReason ?? "").trim();
  if (sensitive && reason.length === 0) {
    throw ApiError.badRequest("A reason is required for a sensitive export.");
  }
  const approvalRequired = Boolean(source.approval) || (sensitive && !hasDateFilter(input.filters));
  const approvalStatus = approvalRequired ? "pending" : "not_required";

  const { rows } = await query<{ id: string }>(
    `INSERT INTO platform_exports
       (name, scope, format, institution_id, filters, reason, sensitive, status, approval_status, requested_by)
     VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,'pending',$8,$9) RETURNING id`,
    [
      input.name, scope, input.format, input.institutionId ?? null,
      JSON.stringify(input.filters ?? {}),
      reason ? maskFreeText(reason) : null, sensitive, approvalStatus, actor.id,
    ]
  );
  const id = rows[0].id;

  await recordAudit(actor, {
    action: "export.requested",
    targetId: id,
    institutionId: input.institutionId ?? null,
    detail: { scope, format: input.format, sensitive, approvalRequired, reason: reason ? maskFreeText(reason) : null },
  });
  if (sensitive) {
    await recordSecurityEvent({
      action: "export.requested",
      targetType: "export",
      targetId: id,
      actorId: actor.id,
      actorEmail: actor.email,
      actorRole: actor.role,
      institutionId: input.institutionId ?? null,
      detail: { scope, approvalRequired },
      ip: actor.ip,
    });
  }

  if (approvalRequired) {
    // Awaiting a second super-admin — no artifact is generated yet.
    return getExport(id);
  }
  await generateArtifact(await loadInternal(id), actor);
  return getExport(id);
}

const LIST_SORT: Record<string, string> = {
  createdAt: "created_at",
  status: "status",
  sizeBytes: "size_bytes",
  expiresAt: "expires_at",
};

export async function listExports(q: z.infer<typeof listExportsQuerySchema>) {
  await sweepExpired();
  const params: unknown[] = [];
  const where: string[] = [];
  const add = (clause: (n: number) => string, value: unknown) => {
    params.push(value);
    where.push(clause(params.length));
  };
  if (q.status) add((n) => `status = $${n}`, q.status);
  if (q.scope) add((n) => `scope = $${n}`, q.scope);
  if (q.format) add((n) => `format = $${n}`, q.format);
  if (q.createdBy) add((n) => `requested_by = $${n}`, q.createdBy);
  if (q.sensitive !== undefined) add((n) => `sensitive = $${n}`, q.sensitive);
  if (q.approvalStatus) add((n) => `approval_status = $${n}`, q.approvalStatus);
  if (q.dateFrom) add((n) => `created_at >= $${n}`, `${q.dateFrom}T00:00:00.000Z`);
  if (q.dateTo) add((n) => `created_at <= $${n}`, `${q.dateTo}T23:59:59.999Z`);
  if (q.search) add((n) => `(name ILIKE $${n} OR scope ILIKE $${n})`, `%${q.search}%`);
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

  const total = Number(
    (await query<{ n: number }>(`SELECT count(*)::int AS n FROM platform_exports ${whereSql}`, params)).rows[0].n
  );
  const sortCol = LIST_SORT[q.sort] ?? "created_at";
  const order = q.order === "asc" ? "ASC" : "DESC";
  const pageParams = [...params, q.pageSize, (q.page - 1) * q.pageSize];
  const { rows } = await query<Row>(
    `SELECT ${PUBLIC_SELECT} FROM platform_exports ${whereSql}
     ORDER BY ${sortCol} ${order} NULLS LAST, created_at DESC
     LIMIT $${pageParams.length - 1} OFFSET $${pageParams.length}`,
    pageParams
  );
  return { rows: rows.map(maskRow), total, page: q.page, pageSize: q.pageSize };
}

export async function getExport(id: string) {
  const { rows } = await query<Row>(`SELECT ${PUBLIC_SELECT} FROM platform_exports WHERE id = $1`, [id]);
  if (!rows[0]) throw ApiError.notFound("Export not found");
  return maskRow(rows[0]);
}

export async function getManifest(id: string) {
  const { rows } = await query<{ manifest: Record<string, unknown> | null }>(
    "SELECT manifest FROM platform_exports WHERE id = $1",
    [id]
  );
  if (!rows[0]) throw ApiError.notFound("Export not found");
  // Defensive re-mask — the manifest is built masked and never holds a storage_key.
  return maskSecrets(rows[0].manifest ?? {});
}

// --- dashboard summary ------------------------------------------------------

export async function summary() {
  await sweepExpired();
  const c = (
    await query<Record<string, string>>(
      `SELECT
         count(*)::int AS total,
         count(*) FILTER (WHERE status='completed')::int AS completed,
         count(*) FILTER (WHERE status='running')::int AS running,
         count(*) FILTER (WHERE status='pending')::int AS pending,
         count(*) FILTER (WHERE status='failed')::int AS failed,
         count(*) FILTER (WHERE status='expired')::int AS expired,
         count(*) FILTER (WHERE status='cancelled')::int AS cancelled,
         count(*) FILTER (WHERE created_at >= date_trunc('day', now()))::int AS today,
         count(*) FILTER (WHERE sensitive)::int AS sensitive,
         count(*) FILTER (WHERE approval_status='pending')::int AS "pendingApproval",
         count(*) FILTER (WHERE scope='portability_pack')::int AS "portabilityPacks",
         count(*) FILTER (WHERE status='completed' AND expires_at IS NOT NULL
                          AND expires_at < now() + interval '1 day')::int AS "nearingExpiry",
         coalesce(sum(size_bytes) FILTER (WHERE status='completed'),0)::text AS "storageUsedBytes",
         coalesce(sum(download_count),0)::int AS downloads
       FROM platform_exports`
    )
  ).rows[0];

  const latest =
    (await query<{ status: string | null }>(`SELECT status FROM platform_exports ORDER BY created_at DESC LIMIT 1`))
      .rows[0]?.status ?? null;

  const schedules = (
    await query<{ total: number; enabled: number }>(
      `SELECT count(*)::int AS total, count(*) FILTER (WHERE enabled)::int AS enabled FROM export_schedules`
    )
  ).rows[0];

  const recentAudit = (
    await query<Row>(
      `SELECT action, actor_email AS "actorEmail", target_id AS "targetId", created_at AS "createdAt"
       FROM platform_audit_log WHERE target_type='export'
       ORDER BY created_at DESC LIMIT 10`
    )
  ).rows;

  return {
    totals: {
      total: Number(c.total),
      completed: Number(c.completed),
      running: Number(c.running),
      pending: Number(c.pending),
      failed: Number(c.failed),
      expired: Number(c.expired),
      cancelled: Number(c.cancelled),
    },
    today: Number(c.today),
    sensitive: Number(c.sensitive),
    pendingApproval: Number(c.pendingApproval),
    portabilityPacks: Number(c.portabilityPacks),
    nearingExpiry: Number(c.nearingExpiry),
    storageUsedBytes: Number(c.storageUsedBytes ?? 0),
    downloads: Number(c.downloads),
    latestStatus: latest,
    schedules: { total: Number(schedules.total), enabled: Number(schedules.enabled) },
    recentEvents: recentAudit,
  };
}

// --- download ---------------------------------------------------------------

export async function downloadExport(id: string, reason: string, actor: Actor) {
  await sweepExpired();
  const row = await loadInternal(id);
  if (row.archivedAt) throw ApiError.badRequest("This export has been archived — its artifact is no longer available");
  if (row.status !== "completed" || !row.storageKey) {
    throw ApiError.badRequest("This export has no downloadable artifact");
  }
  if (row.expiresAt && new Date(row.expiresAt) < new Date()) {
    throw ApiError.badRequest("This export has expired");
  }
  const buffer = await storage.get(row.storageKey);
  await query(
    `UPDATE platform_exports SET download_count = download_count + 1,
       last_downloaded_by = $2, last_downloaded_at = now() WHERE id = $1`,
    [id, actor.id]
  );
  await recordAudit(actor, {
    action: "export.downloaded",
    targetId: id,
    institutionId: row.institutionId,
    detail: { scope: row.scope, sizeBytes: buffer.length, reason: maskFreeText(reason) },
  });
  await recordSecurityEvent({
    action: "export.downloaded",
    targetType: "export",
    targetId: id,
    actorId: actor.id,
    actorEmail: actor.email,
    actorRole: actor.role,
    institutionId: row.institutionId,
    detail: { scope: row.scope, reason: maskFreeText(reason) },
    ip: actor.ip,
  });
  const meta = FORMAT_META[row.format] ?? FORMAT_META.csv;
  const stamp = new Date().toISOString().slice(0, 10);
  return {
    buffer,
    filename: `export-${row.scope}-${id}-${stamp}.${meta.ext}`,
    contentType: meta.contentType,
  };
}

// --- cancel / archive / decide ---------------------------------------------

export async function cancelExport(id: string, reason: string | undefined, actor: Actor) {
  const row = await loadInternal(id);
  if (!["pending", "running"].includes(row.status)) {
    throw ApiError.badRequest(`Only a pending or running export can be cancelled (is ${row.status})`);
  }
  const { rows } = await query<{ id: string }>(
    `UPDATE platform_exports
       SET status='cancelled',
           approval_status = CASE WHEN approval_status='pending' THEN 'cancelled' ELSE approval_status END
     WHERE id=$1 AND status IN ('pending','running') RETURNING id`,
    [id]
  );
  if (!rows[0]) throw ApiError.conflict("Export can no longer be cancelled");
  await recordAudit(actor, {
    action: "export.cancelled",
    targetId: id,
    institutionId: row.institutionId,
    detail: { scope: row.scope, reason: reason ? maskFreeText(reason) : null },
  });
  return getExport(id);
}

export async function archiveExport(id: string, reason: string, actor: Actor) {
  const row = await loadInternal(id);
  if (row.archivedAt) return { archived: true, id, alreadyArchived: true };
  if (row.storageKey) await storage.remove(row.storageKey).catch(() => undefined);
  // Metadata row is ALWAYS retained — only the artifact is removed.
  await query(
    `UPDATE platform_exports SET storage_key=NULL, archived_at=now(), archived_by=$2, archive_reason=$3 WHERE id=$1`,
    [id, actor.id, maskFreeText(reason)]
  );
  await recordAudit(actor, {
    action: "export.archived",
    targetId: id,
    institutionId: row.institutionId,
    detail: { scope: row.scope, reason: maskFreeText(reason) },
  });
  return { archived: true, id };
}

export async function decideExport(id: string, input: z.infer<typeof decisionSchema>, actor: Actor) {
  const row = await loadInternal(id);
  if (row.approvalStatus !== "pending") {
    throw ApiError.badRequest(`This export is not awaiting approval (is ${row.approvalStatus})`);
  }
  // Two-person integrity: the approver must differ from the requester.
  if (input.decision === "approved" && row.requestedBy && row.requestedBy === actor.id) {
    throw ApiError.forbidden(
      "You cannot approve your own export request — a different super-admin must approve it"
    );
  }
  const nextApproval = input.decision === "approved" ? "approved" : "rejected";
  const { rows } = await query<{ id: string }>(
    `UPDATE platform_exports
       SET approval_status=$2, approved_by=$3, approved_at=now(), approval_reason=$4,
           status = CASE WHEN $2 = 'rejected' THEN 'cancelled' ELSE status END
     WHERE id=$1 AND approval_status='pending' RETURNING id`,
    [id, nextApproval, actor.id, maskFreeText(input.reason)]
  );
  if (!rows[0]) throw ApiError.conflict("This export was already decided");
  await recordAudit(actor, {
    action: input.decision === "approved" ? "export.approved" : "export.rejected",
    targetId: id,
    institutionId: row.institutionId,
    detail: { scope: row.scope, reason: maskFreeText(input.reason) },
  });
  if (input.decision === "approved") {
    await generateArtifact(await loadInternal(id), actor);
  }
  return getExport(id);
}

// --- portability pack -------------------------------------------------------

export async function generatePortabilityPack(
  institutionId: string,
  name: string | undefined,
  reason: string,
  actor: Actor
) {
  const inst = (
    await query<Row>(
      `SELECT id, name, code, type, is_active AS "isActive", created_at AS "createdAt"
       FROM institutions WHERE id = $1`,
      [institutionId]
    )
  ).rows[0];
  if (!inst) throw ApiError.notFound("Institution not found");

  const packName = (name && name.trim()) || `Portability pack — ${String(inst.name)}`;
  const { rows } = await query<{ id: string }>(
    `INSERT INTO platform_exports
       (name, scope, format, institution_id, filters, reason, sensitive, status, approval_status, requested_by)
     VALUES ($1,'portability_pack','zip',$2,'{}'::jsonb,$3,true,'running','not_required',$4) RETURNING id`,
    [packName, institutionId, maskFreeText(reason), actor.id]
  );
  const id = rows[0].id;

  try {
    // Assemble the per-tenant datasets (all masked; no secrets, no storage paths).
    const subsAll = await exportSubscriptions(
      P<Parameters<typeof exportSubscriptions>[0]>({ sort: "institution", order: "asc", page: 1, pageSize: 20000 } as never)
    );
    const subsRows = (subsAll.rows as Row[]).filter((r) => r.institutionId === institutionId);
    const invoices = await exportInvoices(
      P<Parameters<typeof exportInvoices>[0]>({ institutionId, sort: "createdAt", order: "desc" } as never)
    );
    const payments = await listTransactions(
      P<Parameters<typeof listTransactions>[0]>({ institutionId } as never)
    );

    const datasets: { file: string; columns: Column[]; rows: Row[] }[] = [
      { file: "profile.csv", columns: PROFILE_COLUMNS, rows: [inst] },
      { file: "users.csv", columns: TENANT_USER_COLUMNS, rows: await tenantUsersRows(institutionId) },
      { file: "subscription.csv", columns: subsAll.columns as Column[], rows: subsRows },
      { file: "invoices.csv", columns: invoices.columns as Column[], rows: invoices.rows as Row[] },
      { file: "payments.csv", columns: payments.columns as Column[], rows: payments.rows as Row[] },
      { file: "packages.csv", columns: PACKAGE_COLUMNS, rows: (await listPackages()) as Row[] },
      { file: "documents-metadata.csv", columns: DOCUMENT_COLUMNS, rows: await documentsMetaRows(institutionId) },
    ];

    const files: { name: string; data: Buffer }[] = [];
    const fileManifest: { name: string; sha256: string; bytes: number; rows: number }[] = [];
    let totalRows = 0;
    for (const ds of datasets) {
      const masked = maskRowsForArtifact(ds.rows);
      totalRows += masked.length;
      const csv = Buffer.from(csvString(ds.columns, masked), "utf8");
      files.push({ name: ds.file, data: csv });
      fileManifest.push({ name: ds.file, sha256: sha256(csv), bytes: csv.length, rows: masked.length });
    }

    const readme =
      `Data Portability Pack\n` +
      `Institution: ${String(inst.name)} (${String(inst.code)})\n` +
      `Generated: ${new Date().toISOString()} by ${actor.email}\n` +
      `Reason: ${String(maskFreeText(reason))}\n\n` +
      `This archive contains MASKED tenant data only (no password hashes, tokens, ` +
      `gateway secrets or storage paths). Files:\n` +
      fileManifest.map((f) => ` - ${f.name} (${f.rows} rows)`).join("\n") + "\n";

    const manifest: Record<string, unknown> = {
      id,
      scope: "portability_pack",
      institutionId,
      institution: { name: inst.name, code: inst.code },
      generatedBy: actor.email,
      generatedAt: new Date().toISOString(),
      reason: maskFreeText(reason),
      files: fileManifest,
      rowCount: totalRows,
      maskedFields: MASKING_NOTE,
      excludedFields: EXCLUDED_FIELDS,
      appCommit: process.env.APP_COMMIT ?? null,
      schemaVersion: await schemaVersion(),
    };
    files.push({ name: "README.txt", data: Buffer.from(readme, "utf8") });
    files.push({ name: "manifest.json", data: Buffer.from(JSON.stringify(manifest, null, 2), "utf8") });

    const buffer = toZip(files);
    const checksum = sha256(buffer);
    manifest.checksum = checksum;
    manifest.checksumAlgo = "sha256";
    const storageKey = `exports/${id}.zip`;
    await storage.put(storageKey, buffer, "application/zip");
    const retentionDays = await retentionDaysFor(true);
    await query(
      `UPDATE platform_exports SET status='completed', storage_key=$2, storage_mode=$3,
         size_bytes=$4, row_count=$5, file_count=$6, checksum=$7, manifest=$8::jsonb,
         expires_at = now() + ($9 || ' days')::interval, completed_at=now(), error=NULL
       WHERE id=$1`,
      [id, storageKey, storageMode, buffer.length, totalRows, files.length, checksum,
       JSON.stringify(manifest), String(retentionDays)]
    );
    await recordAudit(actor, {
      action: "export.portability_generated",
      targetId: id,
      institutionId,
      detail: { files: files.length, rowCount: totalRows, sizeBytes: buffer.length, reason: maskFreeText(reason) },
    });
    await recordSecurityEvent({
      action: "export.portability_generated",
      targetType: "export",
      targetId: id,
      actorId: actor.id,
      actorEmail: actor.email,
      actorRole: actor.role,
      institutionId,
      detail: { files: files.length, rowCount: totalRows },
      ip: actor.ip,
    });
    return getExport(id);
  } catch (err) {
    const safe = (err instanceof Error ? err.message : "Portability pack failed").slice(0, 500);
    await query("UPDATE platform_exports SET status='failed', error=$2, completed_at=now() WHERE id=$1", [id, safe]);
    await recordAudit(actor, {
      action: "export.failed",
      targetId: id,
      institutionId,
      detail: { scope: "portability_pack", error: safe },
    });
    throw new ApiError(500, `Portability pack failed: ${safe}`);
  }
}

// --- schedules --------------------------------------------------------------

const SCHEDULE_SELECT = `
  id, name, scope, format, institution_id AS "institutionId", filters, frequency,
  run_time AS "runTime", enabled, reason, next_run_at AS "nextRunAt",
  last_run_at AS "lastRunAt", last_status AS "lastStatus", last_export_id AS "lastExportId",
  created_by AS "createdBy", created_at AS "createdAt", updated_at AS "updatedAt"`;

/** Next run time (UTC) for a frequency + HH:MM, strictly after `from`. */
export function computeNextExportRun(
  frequency: "daily" | "weekly" | "monthly",
  runTime: string,
  from: Date = new Date()
): Date {
  const [h, m] = runTime.split(":").map(Number);
  const next = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate(), h, m, 0, 0));
  if (next <= from) {
    if (frequency === "monthly") next.setUTCMonth(next.getUTCMonth() + 1);
    else if (frequency === "weekly") next.setUTCDate(next.getUTCDate() + 7);
    else next.setUTCDate(next.getUTCDate() + 1);
  }
  return next;
}

function maskScheduleRow(r: Row): Row {
  if (!r) return r;
  return { ...r, filters: maskSecrets(r.filters ?? {}), reason: r.reason ? maskFreeText(r.reason) : r.reason };
}

export async function getSchedule(id: string) {
  const { rows } = await query<Row>(`SELECT ${SCHEDULE_SELECT} FROM export_schedules WHERE id = $1`, [id]);
  if (!rows[0]) throw ApiError.notFound("Schedule not found");
  return maskScheduleRow(rows[0]);
}

export async function createSchedule(input: z.infer<typeof scheduleCreateSchema>, actor: Actor) {
  if (UNAVAILABLE_SCOPES.has(input.scope)) {
    throw ApiError.badRequest(`"${input.scope}" is ${STANDALONE_UNAVAILABLE_MSG}.`);
  }
  const nextRun = computeNextExportRun(input.frequency, input.runTime);
  const { rows } = await query<{ id: string }>(
    `INSERT INTO export_schedules
       (name, scope, format, institution_id, filters, frequency, run_time, reason, next_run_at, created_by, updated_by)
     VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9,$10,$10) RETURNING id`,
    [
      input.name, input.scope, input.format, input.institutionId ?? null,
      JSON.stringify(input.filters ?? {}), input.frequency, input.runTime,
      input.reason ? maskFreeText(input.reason) : null, nextRun, actor.id,
    ]
  );
  await recordAudit(actor, {
    action: "export.schedule_created",
    targetId: rows[0].id,
    institutionId: input.institutionId ?? null,
    detail: { scope: input.scope, format: input.format, frequency: input.frequency, runTime: input.runTime },
  });
  return getSchedule(rows[0].id);
}

export async function listSchedules(q: z.infer<typeof scheduleListQuerySchema>) {
  const params: unknown[] = [];
  const where: string[] = [];
  if (q.enabled !== undefined) {
    params.push(q.enabled);
    where.push(`enabled = $${params.length}`);
  }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const total = Number(
    (await query<{ n: number }>(`SELECT count(*)::int AS n FROM export_schedules ${whereSql}`, params)).rows[0].n
  );
  const pageParams = [...params, q.pageSize, (q.page - 1) * q.pageSize];
  const { rows } = await query<Row>(
    `SELECT ${SCHEDULE_SELECT} FROM export_schedules ${whereSql}
     ORDER BY created_at DESC LIMIT $${pageParams.length - 1} OFFSET $${pageParams.length}`,
    pageParams
  );
  return { rows: rows.map(maskScheduleRow), total, page: q.page, pageSize: q.pageSize };
}

export async function updateSchedule(id: string, input: z.infer<typeof scheduleUpdateSchema>, actor: Actor) {
  const existing = await query<{ frequency: string; run_time: string; enabled: boolean }>(
    "SELECT frequency, run_time, enabled FROM export_schedules WHERE id = $1",
    [id]
  );
  if (!existing.rows[0]) throw ApiError.notFound("Schedule not found");

  const sets: string[] = [];
  const params: unknown[] = [];
  const set = (col: string, value: unknown, cast = "") => {
    params.push(value);
    sets.push(`${col} = $${params.length}${cast}`);
  };
  if (input.name !== undefined) set("name", input.name);
  if (input.format !== undefined) set("format", input.format);
  if (input.filters !== undefined) set("filters", JSON.stringify(input.filters), "::jsonb");
  if (input.frequency !== undefined) set("frequency", input.frequency);
  if (input.runTime !== undefined) set("run_time", input.runTime);
  if (input.enabled !== undefined) set("enabled", input.enabled);
  if (input.reason !== undefined) set("reason", input.reason ? maskFreeText(input.reason) : null);

  // Recompute next_run_at whenever cadence or enabled changes.
  const frequency = (input.frequency ?? existing.rows[0].frequency) as "daily" | "weekly" | "monthly";
  const runTime = input.runTime ?? existing.rows[0].run_time;
  const enabled = input.enabled ?? existing.rows[0].enabled;
  if (input.frequency !== undefined || input.runTime !== undefined || input.enabled !== undefined) {
    set("next_run_at", enabled ? computeNextExportRun(frequency, runTime) : null);
  }
  set("updated_by", actor.id);
  params.push(id);
  await query(`UPDATE export_schedules SET ${sets.join(", ")} WHERE id = $${params.length}`, params);
  await recordAudit(actor, {
    action: "export.schedule_updated",
    targetId: id,
    institutionId: null,
    detail: { fields: Object.keys(input) },
  });
  return getSchedule(id);
}

export async function deleteSchedule(id: string, actor: Actor) {
  // A schedule is configuration, not export history — a real delete is fine.
  const { rows } = await query<{ id: string; scope: string }>(
    "DELETE FROM export_schedules WHERE id = $1 RETURNING id, scope",
    [id]
  );
  if (!rows[0]) throw ApiError.notFound("Schedule not found");
  await recordAudit(actor, {
    action: "export.schedule_deleted",
    targetId: id,
    institutionId: null,
    detail: { scope: rows[0].scope },
  });
  return { deleted: true, id };
}

/** Enqueue a job for every due, enabled schedule; advance next_run_at (deduped). */
export async function enqueueDueScheduledExports() {
  const { rows } = await query<{
    id: string;
    frequency: "daily" | "weekly" | "monthly";
    runTime: string;
    nextRunAt: string;
  }>(
    `SELECT id, frequency, run_time AS "runTime", next_run_at AS "nextRunAt"
     FROM export_schedules
     WHERE enabled = true AND next_run_at IS NOT NULL AND next_run_at <= now()`
  );
  let enqueued = 0;
  for (const s of rows) {
    const job = await enqueue({
      type: "scheduled_export",
      payload: { scheduleId: s.id },
      dedupeKey: `export:${s.id}:${new Date(s.nextRunAt).toISOString()}`,
    });
    if (job) enqueued += 1;
    await query("UPDATE export_schedules SET next_run_at = $2 WHERE id = $1", [
      s.id,
      computeNextExportRun(s.frequency, s.runTime),
    ]);
  }
  return { due: rows.length, enqueued };
}

/** Worker entry point for the `scheduled_export` job type. */
export async function runScheduledExport(payload: Record<string, unknown>) {
  const scheduleId = payload.scheduleId as string | undefined;
  if (!scheduleId) throw new Error("scheduled_export requires a scheduleId");
  const sch = (
    await query<Row>(
      `SELECT id, name, scope, format, institution_id AS "institutionId", filters
       FROM export_schedules WHERE id = $1 AND enabled = true`,
      [scheduleId]
    )
  ).rows[0];
  if (!sch) return; // schedule removed/disabled — nothing to do.

  const scope = String(sch.scope);
  const sensitive = (SENSITIVE_SCOPES as readonly string[]).includes(scope);
  const { rows } = await query<{ id: string }>(
    `INSERT INTO platform_exports
       (name, scope, format, institution_id, filters, reason, sensitive, status, approval_status, schedule_id, requested_by)
     VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,'pending','not_required',$8,NULL) RETURNING id`,
    [sch.name, scope, sch.format, sch.institutionId ?? null, JSON.stringify(sch.filters ?? {}),
     "scheduled export", sensitive, scheduleId]
  );
  const exportId = rows[0].id;
  try {
    await generateArtifact(await loadInternal(exportId), SYSTEM_ACTOR);
    await query(
      "UPDATE export_schedules SET last_run_at=now(), last_status='completed', last_export_id=$2 WHERE id=$1",
      [scheduleId, exportId]
    );
  } catch {
    await query(
      "UPDATE export_schedules SET last_run_at=now(), last_status='failed', last_export_id=$2 WHERE id=$1",
      [scheduleId, exportId]
    );
  }
}

// --- retention settings -----------------------------------------------------

export async function getRetention() {
  await ensureSettings();
  const { rows } = await query<Row>(
    `SELECT default_retention_days AS "defaultRetentionDays",
            sensitive_retention_days AS "sensitiveRetentionDays",
            updated_by AS "updatedBy", updated_at AS "updatedAt"
     FROM export_settings WHERE id = 1`
  );
  return rows[0];
}

export async function updateRetention(input: z.infer<typeof retentionUpdateSchema>, actor: Actor) {
  await ensureSettings();
  const sets: string[] = [];
  const params: unknown[] = [];
  if (input.defaultRetentionDays !== undefined) {
    params.push(input.defaultRetentionDays);
    sets.push(`default_retention_days = $${params.length}`);
  }
  if (input.sensitiveRetentionDays !== undefined) {
    params.push(input.sensitiveRetentionDays);
    sets.push(`sensitive_retention_days = $${params.length}`);
  }
  params.push(actor.id);
  sets.push(`updated_by = $${params.length}`);
  await query(`UPDATE export_settings SET ${sets.join(", ")}, updated_at = now() WHERE id = 1`, params);
  await recordAudit(actor, {
    action: "export.retention_updated",
    targetId: null,
    institutionId: null,
    detail: { ...input },
  });
  return getRetention();
}
