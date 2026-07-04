import { query, withTransaction } from "../../db/postgres";
import { ApiError } from "../../utils/api-error";
import { recordAudit, type Actor } from "./platform.service";
import {
  AUDIT_CATEGORIES,
  AUDIT_RESULTS,
  AUDIT_SEVERITIES,
  type auditExportQuerySchema,
  type auditListQuerySchema,
  type auditSummaryQuerySchema,
  type retentionUpdateSchema,
  type savedFilterCreateSchema,
  type savedFilterUpdateSchema,
} from "./audit.schema";
import type { z } from "zod";

/**
 * Super Admin F — Audit Consolidation (service layer).
 *
 * A single, governed reader over the durable, append-only platform_audit_log. The
 * store has 11 frozen columns; it has NO severity / category / result / user_agent
 * columns. Those are DERIVED here from the `action` string (and `detail`) — one
 * source of truth expressed BOTH as SQL `CASE` expressions (so the computed
 * columns and the category/severity/result filters run in-DB) AND as the TS
 * taxonomy the /categories reference endpoint returns.
 *
 * Never emits a secret: `maskSecrets` scrubs the detail returned by /:id and every
 * exported cell. Never deletes audit history: retention here is policy visibility
 * only (documented future purge job); saved filters are the only hard-deletable
 * rows and they are not audit records.
 */

// ============================ Taxonomy (single source of truth) ===============

const A = "a"; // default table alias for platform_audit_log

/**
 * "High-risk" platform actions — carried over verbatim from security.service's
 * HIGH_RISK_SQL so the two consoles agree on what is elevated.
 */
function highRiskSql(a = A): string {
  return `(
    ${a}.action ~ '^(rbac|impersonate|backup|restore|security)\\.'
    OR ${a}.action LIKE 'platform.admin.%'
    OR ${a}.action LIKE 'platform.security.%'
    OR ${a}.action LIKE 'platform.settings%'
    OR ${a}.action IN (
      'institution.suspend','subscription.assign','subscription.config_update',
      'invoice.voided','invoice.settings_changed','payment_gateway.settings_changed',
      'platform.audit_exported','platform.institutions_exported',
      'invoice.exported','invoice.report_exported'
    )
    OR ${a}.action LIKE 'support.%'
  )`;
}

/** The most dangerous subset of high-risk actions → severity 'critical'. */
function criticalSql(a = A): string {
  return `(
    (${a}.action = 'platform.admin.role_changed' AND (${a}.detail->>'to' = 'owner' OR ${a}.detail->>'from' = 'owner'))
    OR ${a}.action IN ('rbac.matrix_saved','rbac.grant','rbac.revoke')
    OR ${a}.action LIKE 'restore.%'
    OR ${a}.action = 'payment_gateway.settings_changed'
    OR ${a}.action IN ('tenant.suspend','institution.suspend')
    OR ${a}.action = 'invoice.voided'
    OR ${a}.action IN ('platform.admin.2fa_reset','user.2fa_reset')
    OR ${a}.action = 'impersonate.start'
    OR ${a}.action IN ('security.api_token_created','security.api_token_revoked')
    OR ${a}.action = 'platform.security.config_update'
  )`;
}

/** severity: critical > high_risk > (failed ⇒ at least warning) > info. */
function severitySql(a = A): string {
  return `CASE
    WHEN ${criticalSql(a)} THEN 'critical'
    WHEN ${highRiskSql(a)} THEN 'high_risk'
    WHEN ${a}.action LIKE '%.failed' THEN 'warning'
    ELSE 'info'
  END`;
}

/** Numeric severity rank for ORDER BY severity. */
function severityRankSql(a = A): string {
  return `CASE
    WHEN ${criticalSql(a)} THEN 4
    WHEN ${highRiskSql(a)} THEN 3
    WHEN ${a}.action LIKE '%.failed' THEN 2
    ELSE 1
  END`;
}

/** result: derived from the action suffix. */
function resultSql(a = A): string {
  return `CASE
    WHEN ${a}.action LIKE '%.failed' THEN 'failed'
    WHEN ${a}.action LIKE '%.blocked' OR ${a}.action = 'support.scope_blocked' THEN 'blocked'
    ELSE 'success'
  END`;
}

/**
 * Category rules, in PRECEDENCE order (first match wins). API Token is checked
 * before Security Center (it is a subset of security.*); Data Export is checked
 * before the functional prefixes so every *_exported / *.exported row is grouped
 * as an export. Labels are exactly the 16 AUDIT_CATEGORIES.
 */
const CATEGORY_RULES: { category: (typeof AUDIT_CATEGORIES)[number]; match: (a: string) => string }[] = [
  { category: "API Token", match: (a) => `${a}.action LIKE 'security.api_token_%'` },
  { category: "Data Export", match: (a) => `(${a}.action LIKE '%_exported' OR ${a}.action LIKE '%.exported')` },
  { category: "Authentication", match: (a) => `${a}.action LIKE 'auth.%'` },
  { category: "Authorization/RBAC", match: (a) => `${a}.action LIKE 'rbac.%'` },
  { category: "Support Access", match: (a) => `(${a}.action LIKE 'impersonate.%' OR ${a}.action LIKE 'support.%')` },
  { category: "Backup/Restore", match: (a) => `(${a}.action LIKE 'backup.%' OR ${a}.action LIKE 'restore.%')` },
  { category: "Payment Gateway", match: (a) => `${a}.action LIKE 'payment_gateway.%'` },
  { category: "Communication", match: (a) => `${a}.action LIKE 'platform.email.%'` },
  { category: "Settings", match: (a) => `(${a}.action LIKE 'platform.settings%' OR ${a}.action LIKE 'platform.feature_flag%')` },
  { category: "Security Center", match: (a) => `(${a}.action LIKE 'security.%' OR ${a}.action LIKE 'platform.security.%')` },
  { category: "Platform Admin Users", match: (a) => `(${a}.action LIKE 'platform.admin.%' OR ${a}.action LIKE 'user.%')` },
  { category: "Tenant Management", match: (a) => `(${a}.action LIKE 'tenant.%' OR ${a}.action LIKE 'institution.%' OR ${a}.action LIKE 'limits.%')` },
  { category: "Billing/Package", match: (a) => `(${a}.action LIKE 'coupon.%' OR ${a}.action LIKE 'package.%')` },
  { category: "Invoice", match: (a) => `(${a}.action LIKE 'invoice.%' OR ${a}.action LIKE 'note.%')` },
  { category: "Subscription", match: (a) => `${a}.action LIKE 'subscription.%'` },
  { category: "Jobs/System", match: (a) => `${a}.action LIKE 'jobs.%'` },
];

function categorySql(a = A): string {
  const whens = CATEGORY_RULES.map((r) => `WHEN ${r.match(a)} THEN '${r.category}'`).join("\n    ");
  return `CASE
    ${whens}
    ELSE 'Other'
  END`;
}

/** SELECT-list fragment giving the derived category / severity / result columns. */
function computedCols(a = A): string {
  return `(${categorySql(a)}) AS category, (${severitySql(a)}) AS severity, (${resultSql(a)}) AS result`;
}

/** The taxonomy reference the UI filter dropdowns read. */
export function categoriesReference() {
  return {
    categories: AUDIT_CATEGORIES.map((value) => ({ value, label: value })),
    severities: AUDIT_SEVERITIES,
    results: AUDIT_RESULTS,
  };
}

// ============================ Filters (WHERE builder) =========================

type ListQuery = z.infer<typeof auditListQuerySchema>;
type ExportQuery = z.infer<typeof auditExportQuerySchema>;
type SummaryQuery = z.infer<typeof auditSummaryQuerySchema>;
type AuditFilters = Partial<
  Pick<
    ListQuery,
    | "q"
    | "institutionId"
    | "actorId"
    | "actorRole"
    | "action"
    | "targetType"
    | "targetId"
    | "ip"
    | "severity"
    | "result"
    | "category"
    | "module"
    | "dateFrom"
    | "dateTo"
  >
>;

/** Parameterized WHERE for the consolidated viewer. category / severity / result
 *  filter against the SAME computed CASE expressions used in the SELECT, so the
 *  displayed value and the filter can never diverge. */
function buildWhere(f: AuditFilters): { whereSql: string; params: unknown[] } {
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
  if (f.actorRole) add((n) => `a.actor_role = $${n}`, f.actorRole);
  if (f.action) add((n) => `a.action = $${n}`, f.action);
  if (f.targetType) add((n) => `a.target_type = $${n}`, f.targetType);
  if (f.targetId) add((n) => `a.target_id::text = $${n}`, f.targetId);
  if (f.ip) add((n) => `a.ip ILIKE $${n}`, `%${f.ip}%`);
  if (f.severity) add((n) => `(${severitySql()}) = $${n}`, f.severity);
  if (f.result) add((n) => `(${resultSql()}) = $${n}`, f.result);
  const category = f.category ?? f.module;
  if (category) add((n) => `(${categorySql()}) = $${n}`, category);
  if (f.dateFrom) add((n) => `a.created_at >= $${n}`, `${f.dateFrom}T00:00:00.000Z`);
  if (f.dateTo) add((n) => `a.created_at <= $${n}`, `${f.dateTo}T23:59:59.999Z`);
  return { whereSql: where.length ? `WHERE ${where.join(" AND ")}` : "", params };
}

const SORT: Record<string, string> = {
  createdAt: "a.created_at",
  action: "a.action",
  actorEmail: "a.actor_email",
  severity: severityRankSql(),
};

const FROM = `FROM platform_audit_log a LEFT JOIN institutions inst ON inst.id = a.institution_id`;

/** List columns. `detail` is fetched but MASKED in JS before it leaves the service
 *  (see maskRow), so a list row is backward-compatible yet never leaks a secret. */
function listCols(): string {
  return `
    a.id, a.action, a.target_type AS "targetType", a.target_id AS "targetId",
    a.institution_id AS "institutionId", inst.name AS "institutionName", inst.code AS "institutionCode",
    a.actor_id AS "actorId", a.actor_email AS "actorEmail", a.actor_role AS "actorRole",
    a.ip, a.created_at AS "createdAt", a.detail, a.detail->>'reason' AS reason,
    ${computedCols()}`;
}

/** Mask the `detail` of a fetched list row (leaves every other column intact). */
function maskRow(r: Record<string, unknown>): Record<string, unknown> {
  return { ...r, detail: maskSecrets((r.detail ?? {}) as Record<string, unknown>) };
}

// ============================ 1. Enhanced list ================================

export async function listEvents(q: ListQuery) {
  const { whereSql, params } = buildWhere(q);
  const count = await query<{ n: number }>(`SELECT count(*)::int AS n ${FROM} ${whereSql}`, params);
  const sortCol = SORT[q.sort] ?? "a.created_at";
  const order = q.order === "asc" ? "ASC" : "DESC";
  const { rows } = await query<Record<string, unknown>>(
    `SELECT ${listCols()} ${FROM} ${whereSql}
     ORDER BY ${sortCol} ${order} NULLS LAST, a.created_at DESC
     LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, q.pageSize, (q.page - 1) * q.pageSize]
  );
  return { rows: rows.map(maskRow), total: count.rows[0].n, page: q.page, pageSize: q.pageSize };
}

// ============================ 2. Summary (dashboard cards) =====================

/** Window WHERE for the summary/alerts aggregates (fresh params each call). */
function windowWhere(q: SummaryQuery): { whereSql: string; params: unknown[] } {
  const col = "a.created_at";
  const params: unknown[] = [];
  let sql: string;
  if (q.window === "today") sql = `${col} >= date_trunc('day', now())`;
  else if (q.window === "7d") sql = `${col} >= now() - interval '7 days'`;
  else if (q.window === "30d") sql = `${col} >= now() - interval '30 days'`;
  else {
    const parts: string[] = [];
    if (q.dateFrom) {
      params.push(`${q.dateFrom}T00:00:00.000Z`);
      parts.push(`${col} >= $${params.length}`);
    }
    if (q.dateTo) {
      params.push(`${q.dateTo}T23:59:59.999Z`);
      parts.push(`${col} <= $${params.length}`);
    }
    sql = parts.length ? parts.join(" AND ") : "TRUE";
  }
  return { whereSql: `WHERE ${sql}`, params };
}

export async function summary(q: SummaryQuery) {
  const cat = categorySql();
  const agg = (
    await query<Record<string, number>>(
      `SELECT
         count(*)::int AS "totalEvents",
         count(*) FILTER (WHERE ${criticalSql()} OR ${highRiskSql()})::int AS "highRiskCount",
         count(*) FILTER (WHERE (${resultSql()}) IN ('failed','blocked'))::int AS "failedBlockedCount",
         count(*) FILTER (WHERE (${cat}) IN ('Authentication','Security Center','API Token'))::int AS "authSecurity",
         count(*) FILTER (WHERE (${cat}) = 'Tenant Management')::int AS "tenant",
         count(*) FILTER (WHERE (${cat}) IN ('Billing/Package','Invoice','Subscription','Payment Gateway'))::int AS "billingInvoice",
         count(*) FILTER (WHERE (${cat}) IN ('Authorization/RBAC','Platform Admin Users'))::int AS "rbacSecurity",
         count(*) FILTER (WHERE (${cat}) = 'Support Access')::int AS "support",
         count(*) FILTER (WHERE (${cat}) = 'Data Export')::int AS "export"
       FROM platform_audit_log a ${windowWhere(q).whereSql}`,
      windowWhere(q).params
    )
  ).rows[0];

  const actorsW = windowWhere(q);
  const topActors = (
    await query(
      `SELECT a.actor_email AS "actorEmail", count(*)::int AS count
       FROM platform_audit_log a ${actorsW.whereSql} AND a.actor_email IS NOT NULL
       GROUP BY a.actor_email ORDER BY count DESC, a.actor_email ASC LIMIT 10`,
      actorsW.params
    )
  ).rows;

  const tenantsW = windowWhere(q);
  const topTenants = (
    await query(
      `SELECT inst.name AS "institutionName", inst.code AS "institutionCode", count(*)::int AS count
       FROM platform_audit_log a JOIN institutions inst ON inst.id = a.institution_id ${tenantsW.whereSql}
       GROUP BY inst.name, inst.code ORDER BY count DESC, inst.name ASC LIMIT 10`,
      tenantsW.params
    )
  ).rows;

  const critW = windowWhere(q);
  const recentCritical = (
    await query<Record<string, unknown>>(
      `SELECT ${listCols()} ${FROM} ${critW.whereSql} AND ${criticalSql()}
       ORDER BY a.created_at DESC LIMIT 10`,
      critW.params
    )
  ).rows.map(maskRow);

  return {
    window: q.window,
    totalEvents: Number(agg.totalEvents),
    highRiskCount: Number(agg.highRiskCount),
    failedBlockedCount: Number(agg.failedBlockedCount),
    buckets: {
      authSecurity: Number(agg.authSecurity),
      tenant: Number(agg.tenant),
      billingInvoice: Number(agg.billingInvoice),
      rbacSecurity: Number(agg.rbacSecurity),
      support: Number(agg.support),
      export: Number(agg.export),
    },
    topActors,
    topTenants,
    recentCritical,
  };
}

// ============================ 3. Single event =================================

/** Best-effort human display name for a target (users / institutions). */
async function resolveTargetName(targetType: string | null, targetId: string | null): Promise<string | null> {
  if (!targetId) return null;
  try {
    if (targetType === "user" || targetType === "platform_admin") {
      const { rows } = await query<{ name: string }>(
        "SELECT COALESCE(NULLIF(full_name,''), email) AS name FROM users WHERE id = $1",
        [targetId]
      );
      return rows[0]?.name ?? null;
    }
    if (targetType === "institution" || targetType === "tenant") {
      const { rows } = await query<{ name: string }>("SELECT name FROM institutions WHERE id = $1", [targetId]);
      return rows[0]?.name ?? null;
    }
  } catch {
    // best-effort only — a non-resolvable target simply has no display name.
  }
  return null;
}

export async function getEvent(id: string) {
  const { rows } = await query<Record<string, unknown>>(
    `SELECT a.id, a.action, a.target_type AS "targetType", a.target_id AS "targetId",
            a.institution_id AS "institutionId", inst.name AS "institutionName", inst.code AS "institutionCode",
            a.actor_id AS "actorId", a.actor_email AS "actorEmail", a.actor_role AS "actorRole",
            a.detail, a.ip, a.created_at AS "createdAt", ${computedCols()}
     ${FROM} WHERE a.id = $1`,
    [id]
  );
  const row = rows[0];
  if (!row) throw ApiError.notFound("Audit event not found");
  const detail = (row.detail ?? {}) as Record<string, unknown>;
  const targetName = await resolveTargetName(row.targetType as string, row.targetId as string);
  return {
    id: row.id,
    action: row.action,
    category: row.category,
    severity: row.severity,
    result: row.result,
    timestamp: row.createdAt,
    ip: row.ip ?? null,
    userAgent: (detail.userAgent as string) ?? null,
    reason: (detail.reason as string) ?? null,
    actor: { id: row.actorId ?? null, email: row.actorEmail ?? null, role: row.actorRole ?? null },
    target: { type: row.targetType ?? null, id: row.targetId ?? null, name: targetName },
    institution: row.institutionId
      ? { id: row.institutionId, name: row.institutionName, code: row.institutionCode }
      : null,
    diff: extractDiff(row.action as string, detail),
    // The FULL detail, masked — never the raw secret.
    metadata: maskSecrets(detail),
  };
}

// ============================ Diff extractor + secret masker ===================

export const MASK = "••• masked •••";

const SECRET_KEY_RE =
  /(pass(word)?|secret|token|otp|api[_-]?key|2fa|totp|session|cookie|webhook|private[_-]?key|credential|authorization)/i;
// Obvious secret-looking VALUES (gateway keys, bearer/JWT, webhook secrets…).
const SECRET_VALUE_RE = /^(sk|pk|rk|gcp|whsec|xox[baprs]|bearer\s|eyj)[-_a-z0-9./+]{6,}/i;

/** Deep-clone `value`, replacing any secret-named key (or obvious secret value)
 *  with the mask marker. Applied to /:id detail and every exported cell. */
export function maskSecrets(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(maskSecrets);
  // Dates are objects but must pass through untouched — recursing into one via
  // Object.entries() would flatten it to `{}`. (pg returns timestamptz as Date,
  // so a masked row that carries Date columns would otherwise lose them.)
  if (value instanceof Date) return value;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SECRET_KEY_RE.test(k) ? MASK : maskSecrets(v);
    }
    return out;
  }
  if (typeof value === "string" && SECRET_VALUE_RE.test(value)) return MASK;
  return value;
}

export interface DiffRow {
  field: string;
  from: unknown;
  to: unknown;
  kind: "added" | "removed" | "changed";
}

function diffLabel(item: unknown): string {
  if (item && typeof item === "object") {
    const o = item as Record<string, unknown>;
    return String(o.permission ?? o.key ?? o.field ?? o.name ?? JSON.stringify(o));
  }
  return String(item);
}

function fieldFromAction(action: string): string {
  const seg = action.split(".").pop() ?? action;
  const cleaned = seg.replace(/_?(changed|change|updated|update|set|reset)$/i, "");
  return cleaned || seg;
}

/** Uniform diff across the varied detail shapes. Values are masked. Returns []
 *  when no diff is captured (the UI shows "not captured"). */
export function extractDiff(action: string, detail: Record<string, unknown>): DiffRow[] {
  const out: DiffRow[] = [];
  const d = detail ?? {};

  // 1. detail.diff = { field: { from, to } }
  const diff = d.diff;
  if (diff && typeof diff === "object" && !Array.isArray(diff)) {
    for (const [field, change] of Object.entries(diff as Record<string, unknown>)) {
      if (change && typeof change === "object" && !Array.isArray(change)) {
        const c = change as Record<string, unknown>;
        if ("from" in c || "to" in c) {
          out.push({ field, from: maskSecrets(c.from ?? null), to: maskSecrets(c.to ?? null), kind: "changed" });
          continue;
        }
      }
      out.push({ field, from: null, to: maskSecrets(change), kind: "changed" });
    }
  }

  // 2. added[] / removed[]
  if (Array.isArray(d.added))
    for (const item of d.added) out.push({ field: diffLabel(item), from: null, to: maskSecrets(item), kind: "added" });
  if (Array.isArray(d.removed))
    for (const item of d.removed)
      out.push({ field: diffLabel(item), from: maskSecrets(item), to: null, kind: "removed" });

  // 3. top-level from/to (status/role changes) — only if nothing above matched.
  if (out.length === 0 && ("from" in d || "to" in d)) {
    out.push({
      field: fieldFromAction(action),
      from: maskSecrets(d.from ?? null),
      to: maskSecrets(d.to ?? null),
      kind: "changed",
    });
  }
  return out;
}

// ============================ 4. Governed export ==============================

export const EXPORT_COLUMNS = [
  { key: "timestamp", label: "Timestamp" },
  { key: "action", label: "Action" },
  { key: "category", label: "Category" },
  { key: "severity", label: "Severity" },
  { key: "result", label: "Result" },
  { key: "actor", label: "Actor" },
  { key: "actorRole", label: "Actor role" },
  { key: "targetType", label: "Target type" },
  { key: "targetId", label: "Target ID" },
  { key: "tenant", label: "Tenant" },
  { key: "ip", label: "IP" },
  { key: "reason", label: "Reason" },
  { key: "summary", label: "Summary" },
];

function summarize(masked: Record<string, unknown>): string {
  if (!masked || Object.keys(masked).length === 0) return "";
  const s = JSON.stringify(masked);
  return s.length > 500 ? `${s.slice(0, 497)}...` : s;
}

/** True when the export is broad / sensitive and therefore needs a reason. */
export function exportNeedsReason(q: Pick<ExportQuery, "severity" | "dateFrom">): boolean {
  return q.severity === "high_risk" || q.severity === "critical" || !q.dateFrom;
}

/** Flatten the filtered log into export rows (capped 50000; every cell masked). */
export async function exportRows(f: ExportQuery) {
  const { whereSql, params } = buildWhere(f);
  const sortCol = SORT[f.sort] ?? "a.created_at";
  const order = f.order === "asc" ? "ASC" : "DESC";
  const { rows } = await query<Record<string, unknown>>(
    `SELECT a.action, a.target_type AS "targetType", a.target_id AS "targetId",
            inst.name AS "institutionName", a.actor_email AS "actorEmail", a.actor_role AS "actorRole",
            a.detail, a.ip,
            to_char(a.created_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "createdAt",
            ${computedCols()}
     ${FROM} ${whereSql}
     ORDER BY ${sortCol} ${order} NULLS LAST, a.created_at DESC LIMIT 50000`,
    params
  );
  return rows.map((r) => {
    const masked = maskSecrets((r.detail ?? {}) as Record<string, unknown>) as Record<string, unknown>;
    return {
      timestamp: r.createdAt ?? "",
      action: r.action ?? "",
      category: r.category ?? "",
      severity: r.severity ?? "",
      result: r.result ?? "",
      actor: r.actorEmail ?? "",
      actorRole: r.actorRole ?? "",
      targetType: r.targetType ?? "",
      targetId: r.targetId ?? "",
      tenant: r.institutionName ?? "",
      ip: r.ip ?? "",
      reason: (masked.reason as string) ?? "",
      summary: summarize(masked),
    } as Record<string, unknown>;
  });
}

// ============================ 6. Suspicious-activity alerts ====================

type AlertDef = {
  key: string;
  severity: "warning" | "high_risk" | "critical";
  title: string;
  description: string;
  match: string;
  threshold?: number;
};

const ALERT_DEFS: AlertDef[] = [
  {
    key: "multiple_failed_logins",
    severity: "warning",
    title: "Multiple failed logins",
    description: "Several failed sign-in attempts were recorded in the window.",
    match: "a.action = 'auth.login.failed'",
    threshold: 5,
  },
  {
    key: "owner_or_rbac_change",
    severity: "critical",
    title: "Owner / RBAC change",
    description: "An owner assignment or role-permission change was recorded.",
    match:
      "(a.action IN ('rbac.grant','rbac.revoke','rbac.matrix_saved') OR (a.action = 'platform.admin.role_changed' AND (a.detail->>'to' = 'owner' OR a.detail->>'from' = 'owner')))",
  },
  {
    key: "sensitive_export",
    severity: "warning",
    title: "Data / audit export",
    description: "Audit or data was exported.",
    match: "(a.action LIKE '%_exported' OR a.action LIKE '%.exported')",
  },
  {
    key: "backup_restore",
    severity: "critical",
    title: "Backup restore",
    description: "A backup restore was requested or executed.",
    match: "a.action LIKE 'restore.%'",
  },
  {
    key: "impersonation",
    severity: "high_risk",
    title: "Support impersonation",
    description: "A support impersonation session was started.",
    match: "a.action IN ('impersonate.start','support.session_started')",
  },
  {
    key: "tenant_suspend_archive",
    severity: "warning",
    title: "Tenant suspend / archive",
    description: "A tenant was suspended or a tenant record archived.",
    match:
      "(a.action IN ('institution.suspend','tenant.suspend') OR a.action = 'tenant.document_archive' OR a.action LIKE 'tenant.%archive%')",
  },
  {
    key: "gateway_change",
    severity: "critical",
    title: "Payment gateway change",
    description: "Payment gateway settings were changed.",
    match: "a.action = 'payment_gateway.settings_changed'",
  },
  {
    key: "api_token_change",
    severity: "high_risk",
    title: "API token created / revoked",
    description: "A platform API token was created, revoked or rotated.",
    match: "a.action IN ('security.api_token_created','security.api_token_revoked','security.api_token_rotated')",
  },
  {
    key: "ip_allowlist_change",
    severity: "warning",
    title: "IP allowlist change",
    description: "The platform IP allowlist was modified.",
    match: "a.action LIKE 'security.ip_allowlist_%'",
  },
  {
    key: "twofa_reset",
    severity: "high_risk",
    title: "2FA reset",
    description: "Two-factor authentication was reset for an account.",
    match: "a.action IN ('platform.admin.2fa_reset','user.2fa_reset')",
  },
];

/** Read-only suspicious-activity feed: the latest matching audit row per alert
 *  type in the window (each links to an audit row id). No notifications. */
export async function alerts(q: SummaryQuery) {
  const out: Array<Record<string, unknown>> = [];
  for (const def of ALERT_DEFS) {
    const { whereSql, params } = windowWhere(q);
    const { rows } = await query<Record<string, unknown>>(
      `SELECT count(*)::int AS n,
              (array_agg(a.id ORDER BY a.created_at DESC))[1] AS "auditId",
              (array_agg(a.action ORDER BY a.created_at DESC))[1] AS action,
              (array_agg(a.actor_email ORDER BY a.created_at DESC))[1] AS "actorEmail",
              max(a.created_at) AS "lastAt"
       FROM platform_audit_log a ${whereSql} AND ${def.match}`,
      params
    );
    const row = rows[0];
    const n = Number(row?.n ?? 0);
    if (n >= (def.threshold ?? 1)) {
      out.push({
        key: def.key,
        type: def.key,
        severity: def.severity,
        title: def.title,
        description: def.description,
        count: n,
        auditId: row.auditId,
        action: row.action,
        actorEmail: row.actorEmail,
        lastAt: row.lastAt,
      });
    }
  }
  return { window: q.window, alerts: out };
}

// ============================ 7. Saved filters =================================

type SavedFilterCreate = z.infer<typeof savedFilterCreateSchema>;
type SavedFilterUpdate = z.infer<typeof savedFilterUpdateSchema>;

const SAVED_FILTER_COLS = `
  id, name, owner_id AS "ownerId", is_shared AS "isShared", is_default AS "isDefault",
  filters, created_by_email AS "createdByEmail", created_at AS "createdAt", updated_at AS "updatedAt"`;

export async function listSavedFilters(userId: string) {
  const { rows } = await query(
    `SELECT ${SAVED_FILTER_COLS}, (owner_id = $1) AS "isOwn"
     FROM audit_saved_filters
     WHERE owner_id = $1 OR is_shared = true
     ORDER BY is_default DESC, name ASC`,
    [userId]
  );
  return rows;
}

export async function createSavedFilter(input: SavedFilterCreate, actor: Actor) {
  const row = await withTransaction(async (client) => {
    if (input.isDefault) {
      await client.query("UPDATE audit_saved_filters SET is_default = false WHERE owner_id = $1", [actor.id]);
    }
    const res = await client.query(
      `INSERT INTO audit_saved_filters (name, owner_id, is_shared, is_default, filters, created_by_email)
       VALUES ($1,$2,$3,$4,$5::jsonb,$6)
       RETURNING ${SAVED_FILTER_COLS}`,
      [input.name, actor.id, input.isShared, input.isDefault, JSON.stringify(input.filters ?? {}), actor.email]
    );
    return res.rows[0] as Record<string, unknown>;
  });
  // Only SHARED (platform-wide) filter changes are audit-worthy.
  if (input.isShared) {
    await recordAudit(actor, {
      action: "audit.saved_filter_created",
      targetType: "audit_saved_filter",
      targetId: row.id as string,
      institutionId: null,
      detail: { name: input.name, shared: true },
    });
  }
  return row;
}

export async function updateSavedFilter(id: string, input: SavedFilterUpdate, actor: Actor) {
  const existing = await query<{ owner_id: string | null; is_shared: boolean; name: string }>(
    "SELECT owner_id, is_shared, name FROM audit_saved_filters WHERE id = $1",
    [id]
  );
  const ex = existing.rows[0];
  if (!ex) throw ApiError.notFound("Saved filter not found");
  // Owner OR any super_admin for a SHARED filter (shared-with-manage).
  if (ex.owner_id !== actor.id && !ex.is_shared) {
    throw ApiError.forbidden("You cannot modify this saved filter");
  }

  const row = await withTransaction(async (client) => {
    const sets: string[] = [];
    const params: unknown[] = [];
    const set = (col: string, value: unknown, cast = "") => {
      params.push(value);
      sets.push(`${col} = $${params.length}${cast}`);
    };
    if (input.name !== undefined) set("name", input.name);
    if (input.filters !== undefined) set("filters", JSON.stringify(input.filters), "::jsonb");
    if (input.isShared !== undefined) set("is_shared", input.isShared);
    if (input.isDefault !== undefined) {
      if (input.isDefault && ex.owner_id) {
        await client.query("UPDATE audit_saved_filters SET is_default = false WHERE owner_id = $1", [ex.owner_id]);
      }
      set("is_default", input.isDefault);
    }
    sets.push("updated_at = now()");
    params.push(id);
    const res = await client.query(
      `UPDATE audit_saved_filters SET ${sets.join(", ")} WHERE id = $${params.length} RETURNING ${SAVED_FILTER_COLS}`,
      params
    );
    return res.rows[0] as Record<string, unknown>;
  });

  // Audit if the filter is (or is becoming) shared.
  if (ex.is_shared || input.isShared) {
    await recordAudit(actor, {
      action: "audit.saved_filter_updated",
      targetType: "audit_saved_filter",
      targetId: id,
      institutionId: null,
      detail: { name: (row.name as string) ?? ex.name, shared: (row.isShared as boolean) ?? ex.is_shared },
    });
  }
  return row;
}

export async function deleteSavedFilter(id: string, actor: Actor) {
  const existing = await query<{ owner_id: string | null; is_shared: boolean; name: string }>(
    "SELECT owner_id, is_shared, name FROM audit_saved_filters WHERE id = $1",
    [id]
  );
  const ex = existing.rows[0];
  if (!ex) throw ApiError.notFound("Saved filter not found");
  if (ex.owner_id !== actor.id && !ex.is_shared) {
    throw ApiError.forbidden("You cannot delete this saved filter");
  }
  // Hard delete is fine — a saved filter is NOT audit history.
  await query("DELETE FROM audit_saved_filters WHERE id = $1", [id]);
  if (ex.is_shared) {
    await recordAudit(actor, {
      action: "audit.saved_filter_deleted",
      targetType: "audit_saved_filter",
      targetId: id,
      institutionId: null,
      detail: { name: ex.name, shared: true },
    });
  }
  return { deleted: true };
}

// ============================ 8. Retention policy =============================

type RetentionUpdate = z.infer<typeof retentionUpdateSchema>;

// A soft threshold above which we flag the store as "growing large" so an
// operator can plan the (future) archive job. Never triggers a delete.
const GROWING_LARGE_THRESHOLD = 1_000_000;

export async function getRetention() {
  const { rows } = await query<{
    status: string;
    retentionDays: number | null;
    archiveEnabled: boolean;
    updatedByEmail: string | null;
    updatedAt: Date | null;
  }>(
    `SELECT status, retention_days AS "retentionDays", archive_enabled AS "archiveEnabled",
            updated_by_email AS "updatedByEmail", updated_at AS "updatedAt"
     FROM audit_retention_config WHERE id = TRUE`
  );
  const cfg =
    rows[0] ?? {
      status: "not_configured",
      retentionDays: null,
      archiveEnabled: false,
      updatedByEmail: null,
      updatedAt: null,
    };
  const stats = await query<{ totalEvents: number; oldestEventAt: Date | null }>(
    `SELECT count(*)::int AS "totalEvents", min(created_at) AS "oldestEventAt" FROM platform_audit_log`
  );
  const totalEvents = Number(stats.rows[0].totalEvents);
  return {
    ...cfg,
    stats: {
      totalEvents,
      oldestEventAt: stats.rows[0].oldestEventAt,
      growingLargeWarning: totalEvents > GROWING_LARGE_THRESHOLD,
    },
  };
}

export async function updateRetention(input: RetentionUpdate, actor: Actor) {
  const status = input.retentionDays == null ? "not_configured" : input.archiveEnabled ? "archived" : "configured";
  // Policy visibility ONLY — this never deletes or archives audit rows. An
  // automated purge/archive job is a documented future enhancement.
  await query(
    `INSERT INTO audit_retention_config (id, status, retention_days, archive_enabled, updated_by, updated_by_email, updated_at)
     VALUES (TRUE, $1, $2, $3, $4, $5, now())
     ON CONFLICT (id) DO UPDATE SET
       status = EXCLUDED.status, retention_days = EXCLUDED.retention_days,
       archive_enabled = EXCLUDED.archive_enabled, updated_by = EXCLUDED.updated_by,
       updated_by_email = EXCLUDED.updated_by_email, updated_at = now()`,
    [status, input.retentionDays, input.archiveEnabled, actor.id, actor.email]
  );
  await recordAudit(actor, {
    action: "audit.retention_updated",
    targetType: "audit_retention_config",
    targetId: null,
    institutionId: null,
    detail: { retentionDays: input.retentionDays, archiveEnabled: input.archiveEnabled, status },
  });
  return getRetention();
}

// ============================ 9. Integrity status =============================

/** No hash chain exists — do NOT fake tamper-evidence. Rows are append-only and
 *  never hard-deleted; row-level hash-chaining is a documented future feature. */
export function integrity() {
  return {
    enabled: false,
    status: "not_enabled",
    note: "Row-level hash-chaining is a documented future enhancement; audit rows are append-only and never hard-deleted.",
  };
}
