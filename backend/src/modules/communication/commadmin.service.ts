import type { z } from "zod";
import { query, withTransaction } from "../../db/postgres";
import { env } from "../../config/env";
import { ApiError } from "../../utils/api-error";
import { maskFreeText, maskSecrets } from "../platform/audit.service";
import { recordSecurityEvent } from "../../utils/security-audit";
import { deliverAndLog } from "../../utils/comm-delivery";
import { verifyMailer, mailerConfigured } from "../../utils/mailer";
import { smtpHealth } from "../observability/opsdashboard.service";
import { enqueue } from "../jobs/jobs.service";
import { TEMPLATE_VARS } from "./commadmin.schema";
import type {
  broadcastCreateSchema,
  broadcastListQuerySchema,
  broadcastPreviewAudienceSchema,
  broadcastUpdateSchema,
  deliveryExportQuerySchema,
  deliveryListQuerySchema,
  preferencesUpdateSchema,
  providerTestSchema,
  reportsQuerySchema,
  summaryQuerySchema,
  templateCreateSchema,
  templateListQuerySchema,
  templatePreviewSchema,
  templateUpdateSchema,
} from "./commadmin.schema";

/**
 * Super Admin O — Communication Admin (platform service).
 *
 * The platform email control center: DB-backed templates (+ append-only version
 * history), a unified delivery log (the O-originated `email_deliveries` UNION the
 * legacy read-only `invoice_emails`), platform broadcasts, global notification
 * preferences, reports and integration links.
 *
 * Invariants enforced here: NO hard delete (status/disable/archive only); no
 * secret is ever exposed (provider status is safe fields; failure reasons,
 * provider responses and rendered content are masked; secure links → "secure link
 * omitted"); every sensitive action is audited to platform_audit_log with masked
 * detail; broad broadcasts + disabling security notifications also raise a security
 * event; every state rule is enforced. It degrades gracefully when SMTP is unset.
 */

// ============================ Actor + audit ==================================

export interface Actor {
  id: string;
  email: string;
  role: string;
  ip: string | null;
}

/** Durable, MASKED platform audit entry for a communication action. */
async function recordAudit(
  actor: Actor,
  input: { action: string; targetId: string | null; institutionId?: string | null; detail?: Record<string, unknown> }
): Promise<void> {
  await query(
    `INSERT INTO platform_audit_log
       (action, target_type, target_id, institution_id, actor_id, actor_email, actor_role, detail, ip)
     VALUES ($1,'communication',$2,$3,$4,$5,$6,$7::jsonb,$8)`,
    [
      input.action,
      input.targetId,
      input.institutionId ?? null,
      actor.id,
      actor.email,
      actor.role,
      JSON.stringify(maskSecrets(input.detail ?? {})),
      actor.ip,
    ]
  );
}

// ============================ Safe defaults + masking =========================

const DEFAULT_PLATFORM_NAME = env.saasCompanyName || "SRE EDU OS";

/** Parse `env.smtpFrom` into a display name + address — NEVER exposes host/user/pass. */
function parseFrom(from: string): { fromName: string; fromEmail: string } {
  const m = /^\s*(.*?)\s*<([^>]+)>\s*$/.exec(from ?? "");
  if (m) return { fromName: (m[1] || DEFAULT_PLATFORM_NAME).replace(/^"|"$/g, ""), fromEmail: m[2].trim() };
  const trimmed = (from ?? "").trim();
  if (trimmed.includes("@")) return { fromName: DEFAULT_PLATFORM_NAME, fromEmail: trimmed };
  return { fromName: DEFAULT_PLATFORM_NAME, fromEmail: "no-reply@sreedo.edu" };
}

const FROM = parseFrom(env.smtpFrom);
const SUPPORT_EMAIL = env.saasCompanyEmail ?? FROM.fromEmail;
const APP_URL = env.appPublicUrl ?? env.corsOrigin[0] ?? "https://app.example.com";

/** Sample values for every allowlisted variable — used for preview + test renders. */
const DEFAULT_SAMPLE_CONTEXT: Record<string, string> = {
  tenantName: "Sample Institution",
  tenantCode: "SAMPLE",
  userName: "Sample User",
  email: "user@example.com",
  invoiceNumber: "SINV-0001",
  invoiceAmount: "1,000.00",
  invoiceDueDate: "2026-01-31",
  paymentLink: `${APP_URL}/pay/sample`,
  subscriptionPackage: "Standard",
  subscriptionExpiry: "2026-12-31",
  supportScope: "read-only",
  securitySummary: "A sample security notification summary.",
  exportName: "Sample export",
  exportStatus: "ready",
  backupStatus: "failed",
  platformName: DEFAULT_PLATFORM_NAME,
  supportEmail: SUPPORT_EMAIL,
  appUrl: APP_URL,
};

/** Strip `<script>` blocks + inline js: URIs from an HTML body (defense-in-depth). */
function stripScripts(html: string): string {
  return (html ?? "")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<\/?script\b[^>]*>/gi, "")
    .replace(/javascript:/gi, "blocked:");
}

// Secure/tokenised links that must never surface in a log or export.
const SECURE_LINK_RE =
  /\bhttps?:\/\/[^\s"'<>]*(token|reset|magic|verify|confirm|invite|payment|checkout|secret|session|otp)[^\s"'<>]*/gi;

function maskLinks(input: string): string {
  return input.replace(SECURE_LINK_RE, "secure link omitted");
}

/** Mask secret tokens + secure links out of a free-text field for display. */
function scrub(input: unknown): string | null {
  if (input === null || input === undefined) return null;
  return maskLinks(String(maskFreeText(String(input))));
}

/** Mask an email local-part for audit detail (a***@domain). */
function maskEmail(email: string | null): string {
  if (!email) return "(unknown)";
  const at = email.indexOf("@");
  if (at <= 0) return "***";
  return `${email.slice(0, 1)}***${email.slice(at)}`;
}

/**
 * Substitute `{{var}}` from the ALLOWLIST only. Values are masked so a secret in
 * sample data can never render; unknown `{{x}}` are left VISIBLE and reported (never
 * silently dropped); `<script>` is stripped from the body.
 */
export function renderTemplate(
  subject: string,
  body: string,
  vars: Record<string, string | number | null | undefined>
): { subject: string; body: string; unknownVars: string[] } {
  const allow = new Set<string>(TEMPLATE_VARS);
  const unknown = new Set<string>();
  const sub = (text: string): string =>
    (text ?? "").replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (m: string, name: string) => {
      if (!allow.has(name)) {
        unknown.add(name);
        return m;
      }
      const v = vars[name];
      if (v === undefined || v === null || v === "") return "";
      return String(maskFreeText(String(v)));
    });
  return { subject: sub(subject), body: stripScripts(sub(body)), unknownVars: [...unknown] };
}

// ============================ Window helper ==================================

type WindowQuery = { window: string; dateFrom?: string; dateTo?: string };

/** Fresh WHERE fragment (+ params) for a time window over `col`. */
function win(q: WindowQuery, col: string): { clause: string; params: unknown[] } {
  const params: unknown[] = [];
  let sql: string;
  if (q.window === "today") sql = `${col} >= date_trunc('day', now())`;
  else if (q.window === "24h") sql = `${col} >= now() - interval '24 hours'`;
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
  return { clause: sql, params };
}

// ============================ Provider status ================================

export async function providerStatus() {
  const configured = mailerConfigured();
  const verify = configured ? await verifyMailer() : { configured: false, ok: false };

  const last = (
    await query<{ status: string; at: Date }>(
      `SELECT status, COALESCE(sent_at, created_at) AS at FROM email_deliveries
       WHERE trigger_source='manual_test' ORDER BY created_at DESC LIMIT 1`
    )
  ).rows[0];
  const stats = (
    await query<{ lastSuccessAt: Date | null; lastFailedAt: Date | null; failureCount: number }>(
      `SELECT max(sent_at) FILTER (WHERE status='sent') AS "lastSuccessAt",
              max(created_at) FILTER (WHERE status='failed') AS "lastFailedAt",
              count(*) FILTER (WHERE status='failed' AND created_at >= now() - interval '30 days')::int AS "failureCount"
       FROM email_deliveries`
    )
  ).rows[0];

  return {
    configured,
    // Status only — NEVER verify.error (may carry host/credential detail).
    status: !configured ? "not_configured" : verify.ok ? "healthy" : "error",
    verified: Boolean(verify.ok),
    fromName: FROM.fromName,
    fromEmail: FROM.fromEmail,
    replyTo: SUPPORT_EMAIL,
    lastTestStatus: last?.status ?? null,
    lastTestAt: last?.at ?? null,
    lastSuccessAt: stats.lastSuccessAt,
    lastFailedAt: stats.lastFailedAt,
    failureCount: Number(stats.failureCount),
    note: !configured
      ? "SMTP provider not configured — transactional emails are skipped until SMTP_HOST is set."
      : verify.ok
        ? "SMTP reachable."
        : "SMTP is configured but verification failed — check the provider settings.",
    links: { observability: "/observability/smtp", settings: "/platform/settings" },
  };
}

// ============================ Dashboard ======================================

export async function dashboard(q: z.infer<typeof summaryQuerySchema>) {
  const provider = await providerStatus();

  const templates = (
    await query<Record<string, number>>(
      `SELECT count(*)::int AS total,
              count(*) FILTER (WHERE status='active')::int AS active,
              count(*) FILTER (WHERE status='disabled')::int AS disabled,
              count(*) FILTER (WHERE status='draft')::int AS draft,
              count(*) FILTER (WHERE is_builtin)::int AS builtin,
              count(*) FILTER (WHERE NOT is_builtin)::int AS custom
       FROM email_templates`
    )
  ).rows[0];

  const ew = win(q, "created_at");
  const em = (
    await query<Record<string, number>>(
      `SELECT count(*) FILTER (WHERE status='sent')::int AS sent,
              count(*) FILTER (WHERE status='failed')::int AS failed,
              count(*) FILTER (WHERE status='pending')::int AS pending,
              count(*) FILTER (WHERE status='skipped')::int AS skipped,
              count(*) FILTER (WHERE status='delivered')::int AS delivered,
              count(*)::int AS total
       FROM email_deliveries WHERE ${ew.clause}`,
      ew.params
    )
  ).rows[0];
  const iw = win(q, "created_at");
  const iv = (
    await query<Record<string, number>>(
      `SELECT count(*) FILTER (WHERE status='sent')::int AS sent,
              count(*) FILTER (WHERE status='failed')::int AS failed,
              count(*) FILTER (WHERE status='skipped')::int AS skipped,
              count(*)::int AS total
       FROM invoice_emails WHERE ${iw.clause}`,
      iw.params
    )
  ).rows[0];

  const sw = win(q, "created_at");
  const srcRows = (
    await query<{ trigger_source: string; n: number }>(
      `SELECT trigger_source, count(*)::int AS n FROM email_deliveries WHERE ${sw.clause} GROUP BY trigger_source`,
      sw.params
    )
  ).rows;
  const bySource: Record<string, number> = {
    invoice: 0,
    subscription: 0,
    support: 0,
    security: 0,
    backup: 0,
    export: 0,
    platform_admin: 0,
    manual_test: 0,
    broadcast: 0,
    system: 0,
  };
  for (const r of srcRows) bySource[r.trigger_source] = (bySource[r.trigger_source] ?? 0) + Number(r.n);
  bySource.invoice += Number(iv.total);

  const broadcasts = (
    await query<Record<string, number>>(
      `SELECT count(*) FILTER (WHERE status='sent')::int AS sent,
              count(*) FILTER (WHERE status='draft')::int AS draft,
              count(*) FILTER (WHERE status='scheduled')::int AS scheduled,
              count(*) FILTER (WHERE status='sending')::int AS sending,
              count(*) FILTER (WHERE status='failed')::int AS failed,
              count(*) FILTER (WHERE status='cancelled')::int AS cancelled
       FROM broadcasts`
    )
  ).rows[0];

  const recentFailures = (
    await query<Record<string, unknown>>(
      `SELECT id, template_key AS template, recipient, failure_reason, created_at AS "createdAt"
       FROM email_deliveries WHERE status='failed' ORDER BY created_at DESC LIMIT 10`
    )
  ).rows.map((r) => ({
    id: r.id,
    template: r.template,
    recipient: maskEmail(r.recipient as string),
    failureReason: scrub(r.failure_reason),
    createdAt: r.createdAt,
  }));

  const sent = Number(em.sent) + Number(iv.sent);
  const failed = Number(em.failed) + Number(iv.failed);
  const attempts = sent + failed;
  const failureRatePct = attempts > 0 ? Math.round((failed / attempts) * 10000) / 100 : 0;

  const warnings: string[] = [];
  if (!provider.configured) warnings.push("SMTP provider is not configured — emails are being skipped.");
  else if (provider.status === "error") warnings.push("SMTP is configured but failing verification.");
  if (attempts >= 5 && failureRatePct >= 25) warnings.push(`High email failure rate (${failureRatePct}%).`);

  return {
    window: q.window,
    provider: { configured: provider.configured, status: provider.status, fromEmail: provider.fromEmail },
    templates: {
      total: Number(templates.total),
      active: Number(templates.active),
      disabled: Number(templates.disabled),
      draft: Number(templates.draft),
      builtin: Number(templates.builtin),
      custom: Number(templates.custom),
    },
    emails: {
      sent,
      failed,
      pending: Number(em.pending),
      skipped: Number(em.skipped) + Number(iv.skipped),
      delivered: Number(em.delivered),
      total: Number(em.total) + Number(iv.total),
    },
    failureCount: failed,
    failureRatePct,
    lastTest: provider.lastTestStatus ? { status: provider.lastTestStatus, at: provider.lastTestAt } : null,
    broadcasts: {
      sent: Number(broadcasts.sent),
      draft: Number(broadcasts.draft),
      scheduled: Number(broadcasts.scheduled),
      sending: Number(broadcasts.sending),
      failed: Number(broadcasts.failed),
      cancelled: Number(broadcasts.cancelled),
    },
    bySource,
    recentFailures,
    health: { ok: warnings.length === 0, warnings },
  };
}

// ============================ Templates ======================================

interface TemplateRow {
  id: string;
  key: string;
  name: string;
  category: string;
  subject: string;
  body_text: string;
  body_html: string | null;
  status: string;
  version: number;
  is_builtin: boolean;
  description: string | null;
}

async function loadTemplateRow(key: string): Promise<TemplateRow | null> {
  const { rows } = await query<TemplateRow>(
    `SELECT id, key, name, category, subject, body_text, body_html, status, version, is_builtin, description
     FROM email_templates WHERE key = $1`,
    [key]
  );
  return rows[0] ?? null;
}

function templatePublic(r: TemplateRow) {
  return {
    id: r.id,
    key: r.key,
    name: r.name,
    category: r.category,
    subject: r.subject,
    bodyText: r.body_text,
    bodyHtml: r.body_html ? stripScripts(r.body_html) : null,
    status: r.status,
    version: r.version,
    isBuiltin: r.is_builtin,
    description: r.description,
  };
}

export async function listTemplates(q: z.infer<typeof templateListQuerySchema>) {
  const where: string[] = [];
  const params: unknown[] = [];
  const add = (clause: (n: number) => string, value: unknown) => {
    params.push(value);
    where.push(clause(params.length));
  };
  if (q.q) add((n) => `(key ILIKE $${n} OR name ILIKE $${n} OR subject ILIKE $${n})`, `%${q.q}%`);
  if (q.category) add((n) => `category = $${n}`, q.category);
  if (q.status) add((n) => `status = $${n}`, q.status);
  if (q.builtin !== undefined) add((n) => `is_builtin = $${n}`, q.builtin);
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const count = await query<{ n: number }>(`SELECT count(*)::int AS n FROM email_templates ${whereSql}`, params);
  const { rows } = await query<TemplateRow>(
    `SELECT id, key, name, category, subject, body_text, body_html, status, version, is_builtin, description
     FROM email_templates ${whereSql}
     ORDER BY is_builtin DESC, category ASC, name ASC
     LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, q.pageSize, (q.page - 1) * q.pageSize]
  );
  return { rows: rows.map(templatePublic), total: Number(count.rows[0].n), page: q.page, pageSize: q.pageSize };
}

async function versionRows(templateId: string) {
  const { rows } = await query(
    `SELECT version, subject, body_text AS "bodyText", body_html AS "bodyHtml", status,
            change_note AS "changeNote", changed_by AS "changedBy", created_at AS "createdAt"
     FROM email_template_versions WHERE template_id = $1 ORDER BY version DESC, created_at DESC`,
    [templateId]
  );
  return rows;
}

export async function getTemplate(key: string) {
  const row = await loadTemplateRow(key);
  if (!row) throw ApiError.notFound("Template not found");
  return { ...templatePublic(row), versions: await versionRows(row.id) };
}

export async function versions(key: string) {
  const row = await loadTemplateRow(key);
  if (!row) throw ApiError.notFound("Template not found");
  return { key, version: row.version, versions: await versionRows(row.id) };
}

export async function createTemplate(input: z.infer<typeof templateCreateSchema>, actor: Actor) {
  const exists = await loadTemplateRow(input.key);
  if (exists) throw ApiError.conflict(`A template with key "${input.key}" already exists`);
  const bodyHtml = input.bodyHtml ? stripScripts(input.bodyHtml) : null;
  await withTransaction(async (client) => {
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO email_templates (key, name, category, subject, body_text, body_html, status, version, is_builtin, description, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,1,false,$8,$9) RETURNING id`,
      [input.key, input.name, input.category, input.subject, input.bodyText, bodyHtml, input.status, input.description ?? null, actor.id]
    );
    await client.query(
      `INSERT INTO email_template_versions (template_id, key, version, subject, body_text, body_html, status, change_note, changed_by)
       VALUES ($1,$2,1,$3,$4,$5,$6,'Initial version',$7)`,
      [rows[0].id, input.key, input.subject, input.bodyText, bodyHtml, input.status, actor.id]
    );
  });
  const created = await getTemplate(input.key);
  await recordAudit(actor, {
    action: "comm.template_created",
    targetId: created.id,
    detail: { key: input.key, category: input.category, status: input.status },
  });
  return created;
}

export async function updateTemplate(key: string, input: z.infer<typeof templateUpdateSchema>, actor: Actor) {
  const cur = await loadTemplateRow(key);
  if (!cur) throw ApiError.notFound("Template not found");
  const merged = {
    name: input.name ?? cur.name,
    category: input.category ?? cur.category,
    subject: input.subject ?? cur.subject,
    bodyText: input.bodyText ?? cur.body_text,
    bodyHtml:
      "bodyHtml" in input && input.bodyHtml !== undefined
        ? input.bodyHtml === null
          ? null
          : stripScripts(input.bodyHtml)
        : cur.body_html,
    description: input.description !== undefined ? input.description : cur.description,
  };
  const newVersion = cur.version + 1;
  await withTransaction(async (client) => {
    await client.query(
      `UPDATE email_templates SET name=$2, category=$3, subject=$4, body_text=$5, body_html=$6,
         description=$7, version=$8, updated_by=$9 WHERE key=$1`,
      [key, merged.name, merged.category, merged.subject, merged.bodyText, merged.bodyHtml, merged.description, newVersion, actor.id]
    );
    // Append-only history: the prior version row (cur.version) is retained; the new
    // content is snapshotted as version N+1.
    await client.query(
      `INSERT INTO email_template_versions (template_id, key, version, subject, body_text, body_html, status, change_note, changed_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [cur.id, key, newVersion, merged.subject, merged.bodyText, merged.bodyHtml, cur.status, input.changeNote ?? "Edited", actor.id]
    );
  });
  await recordAudit(actor, {
    action: "comm.template_updated",
    targetId: cur.id,
    detail: { key, fromVersion: cur.version, toVersion: newVersion, changeNote: input.changeNote ?? null },
  });
  return getTemplate(key);
}

export async function publishTemplate(key: string, status: "draft" | "active" | "disabled", actor: Actor) {
  const cur = await loadTemplateRow(key);
  if (!cur) throw ApiError.notFound("Template not found");
  await query(`UPDATE email_templates SET status=$2, updated_by=$3 WHERE key=$1`, [key, status, actor.id]);
  await recordAudit(actor, {
    action: "comm.template_published",
    targetId: cur.id,
    detail: { key, from: cur.status, to: status, isBuiltin: cur.is_builtin },
  });
  return getTemplate(key);
}

export async function restoreVersion(key: string, version: number, changeNote: string | undefined, actor: Actor) {
  const cur = await loadTemplateRow(key);
  if (!cur) throw ApiError.notFound("Template not found");
  const { rows } = await query<{ subject: string; body_text: string; body_html: string | null }>(
    `SELECT subject, body_text, body_html FROM email_template_versions
     WHERE template_id=$1 AND version=$2 ORDER BY created_at DESC LIMIT 1`,
    [cur.id, version]
  );
  const v = rows[0];
  if (!v) throw ApiError.notFound(`Version ${version} not found`);
  const newVersion = cur.version + 1;
  await withTransaction(async (client) => {
    await client.query(
      `UPDATE email_templates SET subject=$2, body_text=$3, body_html=$4, version=$5, updated_by=$6 WHERE key=$1`,
      [key, v.subject, v.body_text, v.body_html, newVersion, actor.id]
    );
    await client.query(
      `INSERT INTO email_template_versions (template_id, key, version, subject, body_text, body_html, status, change_note, changed_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [cur.id, key, newVersion, v.subject, v.body_text, v.body_html, cur.status, changeNote ?? `Restored from v${version}`, actor.id]
    );
  });
  await recordAudit(actor, {
    action: "comm.template_restored",
    targetId: cur.id,
    detail: { key, restoredFrom: version, newVersion },
  });
  return getTemplate(key);
}

export async function previewTemplate(key: string, input: z.infer<typeof templatePreviewSchema>) {
  const cur = await loadTemplateRow(key);
  if (!cur) throw ApiError.notFound("Template not found");
  const subject = input.subject ?? cur.subject;
  const bodyText = input.bodyText ?? cur.body_text;
  const bodyHtml = "bodyHtml" in input && input.bodyHtml !== undefined ? input.bodyHtml : cur.body_html;
  const ctx = { ...DEFAULT_SAMPLE_CONTEXT, ...(input.sampleContext ?? {}) };
  const rendered = renderTemplate(subject, bodyText, ctx);
  const html = bodyHtml ? renderTemplate("", bodyHtml, ctx) : null;
  const unknownVars = [...new Set([...rendered.unknownVars, ...(html?.unknownVars ?? [])])];
  return {
    key,
    subject: rendered.subject,
    bodyText: rendered.body,
    bodyHtml: html?.body ?? null,
    unknownVars,
    warnings: unknownVars.length ? [`Unknown variables left unresolved: ${unknownVars.join(", ")}`] : [],
    availableVars: [...TEMPLATE_VARS],
  };
}

// ============================ Test send ======================================

export async function sendTest(input: z.infer<typeof providerTestSchema>, actor: Actor) {
  const to = input.to.trim();
  const isTestAddress = /(test|example|\+test)/i.test(to);
  if (!isTestAddress && (!input.reason || input.reason.trim().length < 5)) {
    throw ApiError.badRequest(
      "A reason of at least 5 characters is required to send a test email to a non-test address"
    );
  }
  const tmpl = input.templateKey ? await loadTemplateRow(input.templateKey) : null;
  if (input.templateKey && !tmpl) throw ApiError.notFound("Template not found");

  const ctx = { ...DEFAULT_SAMPLE_CONTEXT, ...(input.sampleContext ?? {}) };
  const subjectSrc = tmpl?.subject ?? "{{platformName}} — test email";
  const bodySrc =
    tmpl?.body_text ??
    "Hi {{userName}},\n\nThis is a test email from {{platformName}} confirming your SMTP configuration is working.";
  const rendered = renderTemplate(subjectSrc, bodySrc, ctx);

  const delivery = await deliverAndLog(
    { to, subject: rendered.subject || "Test email", text: rendered.body || rendered.subject || "Test email" },
    { templateKey: input.templateKey ?? null, category: tmpl?.category ?? "platform", triggerSource: "manual_test", sentBy: actor.id }
  );

  await recordAudit(actor, {
    action: "comm.test_send",
    targetId: delivery?.id ?? null,
    detail: {
      to: maskEmail(to),
      templateKey: input.templateKey ?? null,
      status: delivery?.status ?? "unknown",
      reason: input.reason ?? null,
    },
  });

  // Preview surfaces the rendered SUBJECT only (masked) — never a secret/body dump.
  return {
    sent: true,
    status: delivery?.status ?? "unknown",
    deliveryId: delivery?.id ?? null,
    preview: { subject: rendered.subject, unknownVars: rendered.unknownVars },
  };
}

// ============================ Deliveries (unified log) ========================

/**
 * The unified delivery source: O-originated `email_deliveries` UNION the legacy,
 * READ-ONLY `invoice_emails` (mapped to the same shape, trigger_source='invoice',
 * joined through saas_invoices → institutions). The legacy side is never written.
 */
const DELIVERIES_UNION = `
  SELECT ed.id, ed.template_key AS template, ed.category, ed.subject, ed.recipient,
         ed.recipient_name, ed.institution_id, inst.name AS institution_name, inst.code AS institution_code,
         ed.trigger_source, ed.status, ed.failure_reason, ed.provider_response, ed.retry_count,
         ed.related_type, ed.related_id, ed.broadcast_id, ed.job_id, ed.sent_by,
         ed.created_at, ed.sent_at, 'platform'::text AS source
  FROM email_deliveries ed LEFT JOIN institutions inst ON inst.id = ed.institution_id
  UNION ALL
  SELECT ie.id, ie.template AS template, NULL::text AS category,
         ('Invoice ' || COALESCE(si.number, 'draft')) AS subject, ie.recipient,
         NULL::text AS recipient_name, si.institution_id, inst2.name AS institution_name, inst2.code AS institution_code,
         'invoice'::text AS trigger_source, ie.status, ie.error AS failure_reason, NULL::text AS provider_response, 0 AS retry_count,
         'invoice'::text AS related_type, ie.invoice_id AS related_id, NULL::uuid AS broadcast_id, NULL::uuid AS job_id, ie.triggered_by AS sent_by,
         ie.created_at, ie.created_at AS sent_at, 'invoice'::text AS source
  FROM invoice_emails ie
    JOIN saas_invoices si ON si.id = ie.invoice_id
    LEFT JOIN institutions inst2 ON inst2.id = si.institution_id`;

const DELIVERY_SORT: Record<string, string> = {
  createdAt: "d.created_at",
  status: "d.status",
  triggerSource: "d.trigger_source",
  template: "d.template",
};

function deliveryFilters(
  q: Partial<z.infer<typeof deliveryListQuerySchema>>
): { where: string; params: unknown[] } {
  const where: string[] = [];
  const params: unknown[] = [];
  const add = (clause: (n: number) => string, value: unknown) => {
    params.push(value);
    where.push(clause(params.length));
  };
  if (q.q)
    add(
      (n) => `(d.recipient ILIKE $${n} OR d.template ILIKE $${n} OR d.subject ILIKE $${n} OR d.failure_reason ILIKE $${n})`,
      `%${q.q}%`
    );
  if (q.status) add((n) => `d.status = $${n}`, q.status);
  if (q.template) add((n) => `d.template = $${n}`, q.template);
  if (q.category) add((n) => `d.category = $${n}`, q.category);
  if (q.tenant) add((n) => `d.institution_id = $${n}`, q.tenant);
  if (q.triggerSource) add((n) => `d.trigger_source = $${n}`, q.triggerSource);
  if (q.recipient) add((n) => `d.recipient ILIKE $${n}`, `%${q.recipient}%`);
  if (q.dateFrom) add((n) => `d.created_at >= $${n}`, `${q.dateFrom}T00:00:00.000Z`);
  if (q.dateTo) add((n) => `d.created_at <= $${n}`, `${q.dateTo}T23:59:59.999Z`);
  return { where: where.length ? `WHERE ${where.join(" AND ")}` : "", params };
}

function maskDeliveryRow(r: Record<string, unknown>) {
  return {
    id: r.id,
    template: r.template ?? null,
    category: r.category ?? null,
    subject: scrub(r.subject),
    recipient: r.recipient,
    recipientName: r.recipient_name ?? null,
    institutionId: r.institution_id ?? null,
    institutionName: r.institution_name ?? null,
    institutionCode: r.institution_code ?? null,
    triggerSource: r.trigger_source,
    status: r.status,
    failureReason: scrub(r.failure_reason),
    providerResponse: scrub(r.provider_response),
    retryCount: Number(r.retry_count ?? 0),
    relatedType: r.related_type ?? null,
    relatedId: r.related_id ?? null,
    broadcastId: r.broadcast_id ?? null,
    jobId: r.job_id ?? null,
    source: r.source,
    createdAt: r.created_at,
    sentAt: r.sent_at ?? null,
  };
}

export async function listDeliveries(q: z.infer<typeof deliveryListQuerySchema>) {
  const f = deliveryFilters(q);
  const count = await query<{ n: number }>(
    `SELECT count(*)::int AS n FROM (${DELIVERIES_UNION}) d ${f.where}`,
    f.params
  );
  const sortCol = DELIVERY_SORT[q.sort] ?? "d.created_at";
  const order = q.order === "asc" ? "ASC" : "DESC";
  const { rows } = await query<Record<string, unknown>>(
    `SELECT d.* FROM (${DELIVERIES_UNION}) d ${f.where}
     ORDER BY ${sortCol} ${order} NULLS LAST, d.created_at DESC
     LIMIT $${f.params.length + 1} OFFSET $${f.params.length + 2}`,
    [...f.params, q.pageSize, (q.page - 1) * q.pageSize]
  );
  return { rows: rows.map(maskDeliveryRow), total: Number(count.rows[0].n), page: q.page, pageSize: q.pageSize };
}

export async function getDelivery(id: string) {
  const { rows } = await query<Record<string, unknown>>(
    `SELECT d.* FROM (${DELIVERIES_UNION}) d WHERE d.id = $1 LIMIT 1`,
    [id]
  );
  if (!rows[0]) throw ApiError.notFound("Delivery not found");
  return maskDeliveryRow(rows[0]);
}

interface RawDeliveryRow {
  id: string;
  template: string | null;
  category: string | null;
  subject: string | null;
  recipient: string;
  recipient_name: string | null;
  institution_id: string | null;
  trigger_source: string;
  status: string;
  retry_count: number;
  sent_by: string | null;
}

/** Re-send a failed delivery (append-only new row, retry_count incremented). Body
 *  is re-rendered from the template (bodies are never stored) with sample data. */
async function resendFailedDelivery(row: RawDeliveryRow, sentBy: string | null) {
  const tmpl = row.template ? await loadTemplateRow(row.template) : null;
  const rendered = tmpl ? renderTemplate(tmpl.subject, tmpl.body_text, DEFAULT_SAMPLE_CONTEXT) : null;
  const subject = row.subject ?? rendered?.subject ?? "Platform notification";
  const text = rendered?.body || "This is a re-sent platform notification.";
  return deliverAndLog(
    { to: row.recipient, subject, text },
    {
      templateKey: row.template,
      category: row.category,
      recipientName: row.recipient_name,
      institutionId: row.institution_id,
      triggerSource: row.trigger_source as never,
      relatedType: "retry",
      relatedId: row.id,
      sentBy,
      retryCount: (row.retry_count ?? 0) + 1,
    }
  );
}

export async function retryDelivery(id: string, reason: string | undefined, actor: Actor) {
  const { rows } = await query<RawDeliveryRow>(
    `SELECT id, template_key AS template, category, subject, recipient, recipient_name,
            institution_id, trigger_source, status, retry_count, sent_by
     FROM email_deliveries WHERE id = $1`,
    [id]
  );
  const row = rows[0];
  if (!row) {
    const legacy = await query(`SELECT 1 FROM invoice_emails WHERE id = $1`, [id]);
    if (legacy.rows[0]) {
      throw ApiError.badRequest("Legacy invoice email deliveries are read-only and cannot be retried here");
    }
    throw ApiError.notFound("Delivery not found");
  }
  if (row.status !== "failed") throw ApiError.badRequest("Only failed deliveries can be retried");

  const newRow = await resendFailedDelivery(row, actor.id);
  await recordAudit(actor, {
    action: "comm.delivery_retried",
    targetId: id,
    institutionId: row.institution_id,
    detail: {
      recipient: maskEmail(row.recipient),
      template: row.template,
      reason: reason ?? null,
      newDeliveryId: newRow?.id ?? null,
      status: newRow?.status ?? "unknown",
    },
  });
  return { retried: true, status: newRow?.status ?? "unknown", delivery: newRow };
}

/** Worker path: re-send a failed delivery by id (best-effort; no actor). */
export async function runDeliveryRetryJob(deliveryId: string): Promise<void> {
  const { rows } = await query<RawDeliveryRow>(
    `SELECT id, template_key AS template, category, subject, recipient, recipient_name,
            institution_id, trigger_source, status, retry_count, sent_by
     FROM email_deliveries WHERE id = $1`,
    [deliveryId]
  );
  const row = rows[0];
  if (!row || row.status !== "failed") return;
  await resendFailedDelivery(row, row.sent_by ?? null);
}

export const EXPORT_COLUMNS = [
  { key: "time", label: "Time" },
  { key: "source", label: "Trigger source" },
  { key: "template", label: "Template" },
  { key: "category", label: "Category" },
  { key: "recipient", label: "Recipient" },
  { key: "tenant", label: "Tenant" },
  { key: "status", label: "Status" },
  { key: "failureReason", label: "Failure reason" },
];

export async function deliveryExportRows(q: z.infer<typeof deliveryExportQuerySchema>) {
  const f = deliveryFilters(q);
  const { rows } = await query<Record<string, unknown>>(
    `SELECT to_char(d.created_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS time, d.trigger_source, d.template,
            d.category, d.recipient, d.institution_name, d.status, d.failure_reason
     FROM (${DELIVERIES_UNION}) d ${f.where}
     ORDER BY d.created_at DESC LIMIT 50000`,
    f.params
  );
  return rows.map((r) => ({
    time: r.time ?? "",
    source: r.trigger_source ?? "",
    template: r.template ?? "",
    category: r.category ?? "",
    recipient: r.recipient ?? "",
    tenant: r.institution_name ?? "",
    status: r.status ?? "",
    failureReason: scrub(r.failure_reason) ?? "",
  }));
}

export async function recordDeliveryExportAudit(
  actor: Actor,
  detail: { format: string; count: number; reason: string }
) {
  await recordAudit(actor, { action: "comm.deliveries_exported", targetId: null, detail });
}

// ============================ Broadcasts =====================================

const BROADCAST_COLS = `id, title, body_text, body_html, audience, audience_filter, channel, status,
  scheduled_at, sent_at, recipient_count, sent_count, failed_count, reason, created_by, created_at, updated_at`;

interface BroadcastRow {
  id: string;
  title: string;
  body_text: string;
  body_html: string | null;
  audience: string;
  audience_filter: Record<string, unknown>;
  channel: string;
  status: string;
  scheduled_at: Date | null;
  sent_at: Date | null;
  recipient_count: number;
  sent_count: number;
  failed_count: number;
  reason: string | null;
  created_by: string | null;
  created_at: Date;
  updated_at: Date;
}

async function loadBroadcast(id: string): Promise<BroadcastRow> {
  const { rows } = await query<BroadcastRow>(`SELECT ${BROADCAST_COLS} FROM broadcasts WHERE id = $1`, [id]);
  if (!rows[0]) throw ApiError.notFound("Broadcast not found");
  return rows[0];
}

function broadcastPublic(r: BroadcastRow) {
  return {
    id: r.id,
    title: r.title,
    bodyText: r.body_text,
    bodyHtml: r.body_html ? stripScripts(r.body_html) : null,
    audience: r.audience,
    audienceFilter: r.audience_filter ?? {},
    channel: r.channel,
    status: r.status,
    scheduledAt: r.scheduled_at,
    sentAt: r.sent_at,
    recipientCount: Number(r.recipient_count),
    sentCount: Number(r.sent_count),
    failedCount: Number(r.failed_count),
    reason: scrub(r.reason),
    createdBy: r.created_by,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

const BROAD_AUDIENCES = new Set(["all_tenants", "tenant_admins", "institution_type"]);
const isBroad = (audience: string) => BROAD_AUDIENCES.has(audience);

/** Parameterized WHERE selecting the recipient set for an audience. */
function audienceWhere(
  audience: string,
  filter: { institutionId?: string; institutionType?: string } | undefined | null
): { clause: string; params: unknown[] } {
  const params: unknown[] = [];
  let clause = "u.is_active = true AND u.email IS NOT NULL";
  if (audience === "platform_admins") {
    clause += " AND u.role = 'super_admin'";
  } else if (audience === "tenant_admins" || audience === "all_tenants") {
    clause += " AND u.role = 'admin'";
  } else if (audience === "specific_tenant") {
    if (!filter?.institutionId) throw ApiError.badRequest("specific_tenant requires audienceFilter.institutionId");
    params.push(filter.institutionId);
    clause += ` AND u.role = 'admin' AND u.institution_id = $${params.length}`;
  } else if (audience === "institution_type") {
    if (!filter?.institutionType) throw ApiError.badRequest("institution_type requires audienceFilter.institutionType");
    params.push(filter.institutionType);
    clause += ` AND u.role = 'admin' AND u.institution_id IN (SELECT id FROM institutions WHERE type = $${params.length})`;
  } else {
    throw ApiError.badRequest("Unknown audience");
  }
  return { clause, params };
}

async function resolveAudienceCount(
  audience: string,
  filter: { institutionId?: string; institutionType?: string } | undefined | null
): Promise<number> {
  const w = audienceWhere(audience, filter);
  const { rows } = await query<{ n: number }>(
    `SELECT count(DISTINCT u.email)::int AS n FROM users u WHERE ${w.clause}`,
    w.params
  );
  return Number(rows[0].n);
}

interface Recipient {
  id: string;
  email: string;
  fullName: string | null;
  institutionId: string | null;
}

async function resolveAudienceRecipients(
  audience: string,
  filter: { institutionId?: string; institutionType?: string } | undefined | null
): Promise<Recipient[]> {
  const w = audienceWhere(audience, filter);
  const { rows } = await query<Recipient>(
    `SELECT DISTINCT ON (u.email) u.id, u.email, u.full_name AS "fullName", u.institution_id AS "institutionId"
     FROM users u WHERE ${w.clause} ORDER BY u.email`,
    w.params
  );
  return rows;
}

export async function listBroadcasts(q: z.infer<typeof broadcastListQuerySchema>) {
  const where: string[] = [];
  const params: unknown[] = [];
  const add = (clause: (n: number) => string, value: unknown) => {
    params.push(value);
    where.push(clause(params.length));
  };
  if (q.q) add((n) => `title ILIKE $${n}`, `%${q.q}%`);
  if (q.status) add((n) => `status = $${n}`, q.status);
  if (q.audience) add((n) => `audience = $${n}`, q.audience);
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const count = await query<{ n: number }>(`SELECT count(*)::int AS n FROM broadcasts ${whereSql}`, params);
  const { rows } = await query<BroadcastRow>(
    `SELECT ${BROADCAST_COLS} FROM broadcasts ${whereSql}
     ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, q.pageSize, (q.page - 1) * q.pageSize]
  );
  return { rows: rows.map(broadcastPublic), total: Number(count.rows[0].n), page: q.page, pageSize: q.pageSize };
}

export async function getBroadcast(id: string) {
  return broadcastPublic(await loadBroadcast(id));
}

export async function createBroadcast(input: z.infer<typeof broadcastCreateSchema>, actor: Actor) {
  const bodyHtml = input.bodyHtml ? stripScripts(input.bodyHtml) : null;
  const { rows } = await query<{ id: string }>(
    `INSERT INTO broadcasts (title, body_text, body_html, audience, audience_filter, channel, status, created_by, updated_by)
     VALUES ($1,$2,$3,$4,$5::jsonb,$6,'draft',$7,$7) RETURNING id`,
    [input.title, input.bodyText, bodyHtml, input.audience, JSON.stringify(input.audienceFilter ?? {}), input.channel, actor.id]
  );
  await recordAudit(actor, {
    action: "comm.broadcast_created",
    targetId: rows[0].id,
    detail: { title: input.title, audience: input.audience, channel: input.channel },
  });
  return getBroadcast(rows[0].id);
}

export async function updateBroadcast(id: string, input: z.infer<typeof broadcastUpdateSchema>, actor: Actor) {
  const cur = await loadBroadcast(id);
  if (cur.status !== "draft") throw ApiError.badRequest(`Only draft broadcasts can be edited (this one is ${cur.status})`);
  const sets: string[] = [];
  const params: unknown[] = [id];
  const set = (col: string, value: unknown, cast = "") => {
    params.push(value);
    sets.push(`${col} = $${params.length}${cast}`);
  };
  if (input.title !== undefined) set("title", input.title);
  if (input.bodyText !== undefined) set("body_text", input.bodyText);
  if ("bodyHtml" in input) set("body_html", input.bodyHtml ? stripScripts(input.bodyHtml) : null);
  if (input.audience !== undefined) set("audience", input.audience);
  if (input.audienceFilter !== undefined) set("audience_filter", JSON.stringify(input.audienceFilter), "::jsonb");
  if (input.channel !== undefined) set("channel", input.channel);
  params.push(actor.id);
  sets.push(`updated_by = $${params.length}`);
  await query(`UPDATE broadcasts SET ${sets.join(", ")} WHERE id = $1`, params);
  await recordAudit(actor, { action: "comm.broadcast_updated", targetId: id, detail: { fields: Object.keys(input) } });
  return getBroadcast(id);
}

export async function previewAudience(id: string, override: z.infer<typeof broadcastPreviewAudienceSchema>) {
  let audience: string;
  let filter: { institutionId?: string; institutionType?: string } | undefined;
  if (override.audience) {
    audience = override.audience;
    filter = override.audienceFilter;
  } else {
    const b = await loadBroadcast(id);
    audience = b.audience;
    filter = b.audience_filter as { institutionId?: string; institutionType?: string };
  }
  const recipientCount = await resolveAudienceCount(audience, filter);
  return { audience, audienceFilter: filter ?? {}, recipientCount, broad: isBroad(audience) };
}

export async function sendBroadcast(id: string, reason: string | undefined, actor: Actor) {
  const b = await loadBroadcast(id);
  if (b.status !== "draft" && b.status !== "scheduled") {
    throw ApiError.badRequest(`A ${b.status} broadcast cannot be sent`);
  }
  const broad = isBroad(b.audience);
  if (broad && (!reason || reason.trim().length < 5)) {
    throw ApiError.badRequest("A reason of at least 5 characters is required to send to a broad audience");
  }
  const recipientCount = await resolveAudienceCount(
    b.audience,
    b.audience_filter as { institutionId?: string; institutionType?: string }
  );
  await query(`UPDATE broadcasts SET status='sending', recipient_count=$2, reason=$3, updated_by=$4 WHERE id=$1`, [
    id,
    recipientCount,
    reason ?? null,
    actor.id,
  ]);
  const job = await enqueue({
    type: "broadcast_send",
    payload: { broadcastId: id },
    createdBy: actor.id,
    dedupeKey: `broadcast:send:${id}`,
  });
  await recordAudit(actor, {
    action: "comm.broadcast_sent",
    targetId: id,
    detail: { audience: b.audience, recipientCount, reason: reason ?? null, jobId: job?.id ?? null },
  });
  if (broad) {
    await recordSecurityEvent({
      action: "comm.broadcast_sent",
      actorId: actor.id,
      actorEmail: actor.email,
      actorRole: actor.role,
      targetType: "communication",
      targetId: id,
      detail: { audience: b.audience, recipientCount, reason: reason ?? null },
      ip: actor.ip,
    });
  }
  return getBroadcast(id);
}

export async function scheduleBroadcast(id: string, scheduledAt: string, actor: Actor) {
  const b = await loadBroadcast(id);
  if (b.status !== "draft" && b.status !== "scheduled") {
    throw ApiError.badRequest(`A ${b.status} broadcast cannot be scheduled`);
  }
  await query(`UPDATE broadcasts SET status='scheduled', scheduled_at=$2, updated_by=$3 WHERE id=$1`, [
    id,
    scheduledAt,
    actor.id,
  ]);
  await recordAudit(actor, { action: "comm.broadcast_scheduled", targetId: id, detail: { scheduledAt } });
  return getBroadcast(id);
}

export async function cancelBroadcast(id: string, reason: string | undefined, actor: Actor) {
  const b = await loadBroadcast(id);
  if (b.status !== "scheduled") throw ApiError.badRequest("Only scheduled broadcasts can be cancelled");
  await query(`UPDATE broadcasts SET status='cancelled', reason=$2, updated_by=$3 WHERE id=$1`, [
    id,
    reason ?? null,
    actor.id,
  ]);
  await recordAudit(actor, { action: "comm.broadcast_cancelled", targetId: id, detail: { reason: reason ?? null } });
  return getBroadcast(id);
}

/**
 * WORKER: actually send a broadcast, logging each recipient to email_deliveries
 * (trigger_source='broadcast', broadcast_id) and updating the counts + status. It
 * is idempotent-ish (skips an already 'sent'/'cancelled' broadcast) and wrapped so
 * a failure marks the broadcast 'failed' rather than throwing uncontrolled.
 */
export async function runBroadcastSend(
  broadcastId: string,
  jobId: string | null = null
): Promise<{ status: string; recipients?: number; sent?: number; failed?: number }> {
  const { rows } = await query<BroadcastRow>(`SELECT ${BROADCAST_COLS} FROM broadcasts WHERE id = $1`, [broadcastId]);
  const b = rows[0];
  if (!b) return { status: "not_found" };
  if (b.status === "sent" || b.status === "cancelled") return { status: b.status };
  if (b.status !== "sending" && b.status !== "scheduled") return { status: b.status };

  try {
    const recipients = await resolveAudienceRecipients(
      b.audience,
      b.audience_filter as { institutionId?: string; institutionType?: string }
    );
    let sent = 0;
    let failed = 0;
    for (const r of recipients) {
      const ctx = {
        ...DEFAULT_SAMPLE_CONTEXT,
        userName: r.fullName ?? DEFAULT_SAMPLE_CONTEXT.userName,
        email: r.email,
      };
      const rendered = renderTemplate(b.title, b.body_text ?? "", ctx);
      const html = b.body_html ? renderTemplate("", b.body_html, ctx).body : undefined;
      const res = await deliverAndLog(
        { to: r.email, subject: rendered.subject || b.title, text: rendered.body || rendered.subject || b.title, html },
        {
          templateKey: "platform_broadcast",
          category: "broadcast",
          recipientName: r.fullName,
          institutionId: r.institutionId,
          triggerSource: "broadcast",
          broadcastId: b.id,
          jobId,
          sentBy: b.created_by,
        }
      );
      if (res?.status === "failed") failed += 1;
      else if (res?.status === "sent") sent += 1;
    }
    await query(
      `UPDATE broadcasts SET recipient_count=$2, sent_count=$3, failed_count=$4, status='sent', sent_at=now() WHERE id=$1`,
      [b.id, recipients.length, sent, failed]
    );
    return { status: "sent", recipients: recipients.length, sent, failed };
  } catch (err) {
    // Never throw uncontrolled out of the worker — mark the broadcast failed.
    console.error(`broadcast ${broadcastId} send failed:`, err);
    await query(`UPDATE broadcasts SET status='failed' WHERE id=$1`, [b.id]).catch(() => undefined);
    return { status: "failed" };
  }
}

/** Scheduler tick: enqueue a broadcast_send job for each due scheduled broadcast
 *  and flip it to 'sending' so it is not re-enqueued. Additive + non-breaking. */
export async function enqueueDueScheduledBroadcasts(): Promise<{ due: number; enqueued: number }> {
  const { rows } = await query<{ id: string; createdBy: string | null }>(
    `SELECT id, created_by AS "createdBy" FROM broadcasts
     WHERE status='scheduled' AND scheduled_at IS NOT NULL AND scheduled_at <= now()`
  );
  let enqueued = 0;
  for (const b of rows) {
    const job = await enqueue({
      type: "broadcast_send",
      payload: { broadcastId: b.id },
      createdBy: b.createdBy,
      dedupeKey: `broadcast:send:${b.id}`,
    });
    await query(`UPDATE broadcasts SET status='sending' WHERE id=$1 AND status='scheduled'`, [b.id]);
    if (job) enqueued += 1;
  }
  return { due: rows.length, enqueued };
}

// ============================ Preferences ====================================

const DEFAULT_CATEGORIES: Record<string, boolean> = {
  invoice: true,
  subscription: true,
  support: true,
  security: true,
  backup: true,
  export: true,
  platform_admin: true,
  broadcast: true,
};

export async function getPreferences() {
  const { rows } = await query<{ categories: Record<string, boolean>; updatedBy: string | null; updatedAt: Date | null }>(
    `SELECT categories, updated_by AS "updatedBy", updated_at AS "updatedAt" FROM platform_comm_settings WHERE id = 1`
  );
  const row = rows[0] ?? { categories: DEFAULT_CATEGORIES, updatedBy: null, updatedAt: null };
  return { categories: { ...DEFAULT_CATEGORIES, ...row.categories }, updatedBy: row.updatedBy, updatedAt: row.updatedAt };
}

export async function updatePreferences(input: z.infer<typeof preferencesUpdateSchema>, actor: Actor) {
  const current = (await getPreferences()).categories;
  const merged = { ...current, ...input.categories };
  const securityDisabled = current.security !== false && merged.security === false;
  await query(
    `INSERT INTO platform_comm_settings (id, categories, updated_by, updated_at)
     VALUES (1, $1::jsonb, $2, now())
     ON CONFLICT (id) DO UPDATE SET categories=EXCLUDED.categories, updated_by=EXCLUDED.updated_by, updated_at=now()`,
    [JSON.stringify(merged), actor.id]
  );
  await recordAudit(actor, {
    action: "comm.preferences_updated",
    targetId: null,
    detail: { categories: merged, securityDisabled },
  });
  if (securityDisabled) {
    // Never SILENTLY disable a security-critical category — audit + security event.
    await recordSecurityEvent({
      action: "comm.security_notifications_disabled",
      actorId: actor.id,
      actorEmail: actor.email,
      actorRole: actor.role,
      targetType: "communication",
      detail: { categories: merged },
      ip: actor.ip,
    });
  }
  return {
    categories: merged,
    warning: securityDisabled
      ? "Security notifications are now DISABLED. Critical security emails will not be sent until re-enabled."
      : null,
  };
}

// ============================ Reports ========================================

/** Report window + filter WHERE. `prefix` (e.g. "ed.") disambiguates columns when
 *  email_deliveries is joined to institutions (both have created_at). */
function reportWhere(
  q: z.infer<typeof reportsQuerySchema>,
  prefix = ""
): { clause: string; params: unknown[] } {
  const col = (c: string) => `${prefix}${c}`;
  const wc = win(q, col("created_at"));
  const params = [...wc.params];
  const parts = [wc.clause];
  if (q.triggerSource) {
    params.push(q.triggerSource);
    parts.push(`${col("trigger_source")} = $${params.length}`);
  }
  if (q.category) {
    params.push(q.category);
    parts.push(`${col("category")} = $${params.length}`);
  }
  if (q.tenant) {
    params.push(q.tenant);
    parts.push(`${col("institution_id")} = $${params.length}`);
  }
  return { clause: parts.join(" AND "), params };
}

export async function reports(q: z.infer<typeof reportsQuerySchema>) {
  const rw = reportWhere(q);
  const status = (
    await query<Record<string, number>>(
      `SELECT count(*) FILTER (WHERE status='sent')::int AS sent,
              count(*) FILTER (WHERE status='failed')::int AS failed,
              count(*) FILTER (WHERE status='pending')::int AS pending,
              count(*) FILTER (WHERE status='skipped')::int AS skipped,
              count(*) FILTER (WHERE status='delivered')::int AS delivered,
              count(*)::int AS total
       FROM email_deliveries WHERE ${rw.clause}`,
      rw.params
    )
  ).rows[0];

  const tw = reportWhere(q);
  const byTemplate = (
    await query<{ template: string | null; total: number; failed: number }>(
      `SELECT COALESCE(template_key,'(none)') AS template, count(*)::int AS total,
              count(*) FILTER (WHERE status='failed')::int AS failed
       FROM email_deliveries WHERE ${tw.clause} GROUP BY template_key ORDER BY total DESC LIMIT 50`,
      tw.params
    )
  ).rows.map((r) => ({ template: r.template, total: Number(r.total), failed: Number(r.failed) }));

  const cw = reportWhere(q);
  const byCategory = (
    await query<{ category: string | null; total: number }>(
      `SELECT COALESCE(category,'(none)') AS category, count(*)::int AS total
       FROM email_deliveries WHERE ${cw.clause} GROUP BY category ORDER BY total DESC`,
      cw.params
    )
  ).rows.map((r) => ({ category: r.category, total: Number(r.total) }));

  const srw = reportWhere(q);
  const bySource = (
    await query<{ trigger_source: string; total: number; failed: number }>(
      `SELECT trigger_source, count(*)::int AS total, count(*) FILTER (WHERE status='failed')::int AS failed
       FROM email_deliveries WHERE ${srw.clause} GROUP BY trigger_source ORDER BY total DESC`,
      srw.params
    )
  ).rows.map((r) => ({ source: r.trigger_source, total: Number(r.total), failed: Number(r.failed) }));

  const ttw = reportWhere(q, "ed.");
  const byTenant = (
    await query<{ institutionId: string | null; institutionName: string | null; total: number }>(
      `SELECT ed.institution_id AS "institutionId", inst.name AS "institutionName", count(*)::int AS total
       FROM email_deliveries ed LEFT JOIN institutions inst ON inst.id = ed.institution_id
       WHERE ${ttw.clause}
       GROUP BY ed.institution_id, inst.name ORDER BY total DESC LIMIT 20`,
      ttw.params
    )
  ).rows.map((r) => ({ institutionId: r.institutionId, institutionName: r.institutionName, total: Number(r.total) }));

  const broadcastSummary = (
    await query<Record<string, number>>(
      `SELECT count(*)::int AS total,
              count(*) FILTER (WHERE status='sent')::int AS sent,
              count(*) FILTER (WHERE status='scheduled')::int AS scheduled,
              count(*) FILTER (WHERE status='draft')::int AS draft,
              count(*) FILTER (WHERE status='cancelled')::int AS cancelled,
              count(*) FILTER (WHERE status='failed')::int AS failed,
              COALESCE(sum(sent_count),0)::int AS "totalSent"
       FROM broadcasts`
    )
  ).rows[0];

  const testSends = Number(bySource.find((s) => s.source === "manual_test")?.total ?? 0);
  const securityEmails = Number(bySource.find((s) => s.source === "security")?.total ?? 0);

  return {
    window: q.window,
    status: {
      sent: Number(status.sent),
      failed: Number(status.failed),
      pending: Number(status.pending),
      skipped: Number(status.skipped),
      delivered: Number(status.delivered),
      total: Number(status.total),
    },
    byTemplate,
    byCategory,
    bySource,
    byTenant,
    broadcasts: {
      total: Number(broadcastSummary.total),
      sent: Number(broadcastSummary.sent),
      scheduled: Number(broadcastSummary.scheduled),
      draft: Number(broadcastSummary.draft),
      cancelled: Number(broadcastSummary.cancelled),
      failed: Number(broadcastSummary.failed),
      recipientsReached: Number(broadcastSummary.totalSent),
    },
    testSends,
    securityEmails,
  };
}

export const REPORT_EXPORT_COLUMNS = [
  { key: "template", label: "Template" },
  { key: "total", label: "Total" },
  { key: "sent", label: "Sent" },
  { key: "failed", label: "Failed" },
];

export async function reportsExportRows(q: z.infer<typeof reportsQuerySchema>) {
  const rw = reportWhere(q);
  const { rows } = await query<{ template: string | null; total: number; sent: number; failed: number }>(
    `SELECT COALESCE(template_key,'(none)') AS template, count(*)::int AS total,
            count(*) FILTER (WHERE status='sent')::int AS sent,
            count(*) FILTER (WHERE status='failed')::int AS failed
     FROM email_deliveries WHERE ${rw.clause} GROUP BY template_key ORDER BY total DESC LIMIT 50000`,
    rw.params
  );
  return rows.map((r) => ({
    template: r.template ?? "(none)",
    total: Number(r.total),
    sent: Number(r.sent),
    failed: Number(r.failed),
  }));
}

export async function recordReportExportAudit(
  actor: Actor,
  detail: { format: string; count: number; reason: string }
) {
  await recordAudit(actor, { action: "comm.reports_exported", targetId: null, detail });
}

// ============================ Integrations ===================================

export async function integrations() {
  const [smtp, jobRows, securityRow, auditRow] = await Promise.all([
    smtpHealth().catch(() => null),
    query<{ type: string; n: number; failed: number }>(
      `SELECT type, count(*)::int AS n, count(*) FILTER (WHERE status='failed')::int AS failed
       FROM jobs WHERE type IN ('broadcast_send','email_delivery_retry') GROUP BY type`
    )
      .then((r) => r.rows)
      .catch(() => []),
    query<{ n: number }>(
      `SELECT count(*)::int AS n FROM platform_audit_log
       WHERE action IN ('comm.broadcast_sent','comm.security_notifications_disabled')
         AND created_at >= now() - interval '30 days'`
    )
      .then((r) => r.rows[0])
      .catch(() => ({ n: 0 })),
    query<{ n: number }>(
      `SELECT count(*)::int AS n FROM platform_audit_log
       WHERE action LIKE 'comm.%' AND created_at >= now() - interval '30 days'`
    )
      .then((r) => r.rows[0])
      .catch(() => ({ n: 0 })),
  ]);

  const s = smtp as Awaited<ReturnType<typeof smtpHealth>> | null;
  return {
    smtp: s
      ? { configured: s.configured, status: s.status, verified: s.verified, delivery: s.delivery }
      : { unavailable: true },
    jobs: {
      byType: jobRows.map((r) => ({ type: r.type, total: Number(r.n), failed: Number(r.failed) })),
    },
    security: { events: Number(securityRow.n) },
    audit: { actions: Number(auditRow.n) },
    links: {
      observability: "/observability/smtp",
      jobs: "/jobs-ops",
      security: "/platform/security",
      audit: "/platform/audit",
    },
  };
}
