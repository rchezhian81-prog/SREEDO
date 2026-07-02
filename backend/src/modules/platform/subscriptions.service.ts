import type { z } from "zod";
import { query } from "../../db/postgres";
import { ApiError } from "../../utils/api-error";
import { sendMail, mailerConfigured } from "../../utils/mailer";
import {
  recordSubscriptionEvent,
  renewalReminderEmail,
  sweepSubscriptionLifecycle,
  effectiveLifecycleConfig,
  type SweepSummary,
} from "../billing/billing.service";
import { platformRevenue } from "./platform-revenue.service";
import { recordAudit, type Actor } from "./platform.service";
import type {
  calendarQuerySchema,
  changePackageSchema,
  cancelSchema,
  configUpdateSchema,
  extendSchema,
  listQuerySchema,
  markExpiredSchema,
  noteCreateSchema,
  noteUpdateSchema,
  reactivateSchema,
  renewSchema,
  reportQuerySchema,
  suspendSchema,
} from "./subscriptions.schema";

/**
 * Super Admin D — subscription lifecycle control center.
 *
 * Builds on B1 (billing.service sweep + subscription_events) and B5
 * (platform-revenue). Every mutating action is audited to platform_audit_log AND
 * appended to the durable subscription_events trail; nothing is ever hard-deleted
 * and a subscription change never silently flips a tenant's is_active flag unless
 * the operator explicitly asks (suspendTenant / reactivateTenant).
 */

type ListQuery = z.infer<typeof listQuerySchema>;
type CalendarQuery = z.infer<typeof calendarQuerySchema>;
type ReportQuery = z.infer<typeof reportQuerySchema>;
type ConfigUpdate = z.infer<typeof configUpdateSchema>;

const CYCLE_MONTHS: Record<string, number> = { monthly: 1, quarterly: 3, half_yearly: 6, annual: 12 };

// ---------------------------------------------------------------------------
// Lifecycle configuration (DB-backed singleton; the sweep reads the same row)
// ---------------------------------------------------------------------------

export async function getLifecycleConfig() {
  const cfg = await effectiveLifecycleConfig();
  return {
    // new, editable fields
    trialDays: cfg.trialDays,
    graceDays: cfg.graceDays,
    renewalReminderDays: cfg.reminderDays,
    expiryReminderDays: cfg.expiryReminderDays,
    autoExpireEnabled: cfg.autoExpire,
    autoSuspendEnabled: cfg.autoSuspend,
    billingOverdueSuspendEnabled: cfg.billingOverdueSuspend,
    enforce: cfg.enforce,
    updatedAt: cfg.updatedAt,
    updatedByEmail: cfg.updatedByEmail,
    // back-compat keys (older UI / B1 test)
    autoSuspend: cfg.autoSuspend,
    graceDaysLegacy: cfg.graceDays,
    reminderDays: cfg.reminderDays,
  };
}

export async function updateLifecycleConfig(input: ConfigUpdate, actor: Actor) {
  const sets: string[] = [];
  const params: unknown[] = [];
  const add = (col: string, val: unknown) => {
    params.push(val);
    sets.push(`${col} = $${params.length}`);
  };
  if (input.trialDays !== undefined) add("trial_days", input.trialDays);
  if (input.graceDays !== undefined) add("grace_days", input.graceDays);
  if (input.renewalReminderDays !== undefined) add("renewal_reminder_days", input.renewalReminderDays);
  if (input.expiryReminderDays !== undefined) add("expiry_reminder_days", input.expiryReminderDays);
  if (input.autoExpireEnabled !== undefined) add("auto_expire_enabled", input.autoExpireEnabled);
  if (input.autoSuspendEnabled !== undefined) add("auto_suspend_enabled", input.autoSuspendEnabled);
  if (input.billingOverdueSuspendEnabled !== undefined)
    add("billing_overdue_suspend_enabled", input.billingOverdueSuspendEnabled);
  params.push(actor.id, actor.email);
  // Guarantee the singleton row exists (tests truncate it), then apply the edit.
  await query(`INSERT INTO subscription_lifecycle_config (id) VALUES (1) ON CONFLICT (id) DO NOTHING`);
  await query(
    `UPDATE subscription_lifecycle_config
     SET ${sets.join(", ")}, updated_by = $${params.length - 1}, updated_by_email = $${params.length}, updated_at = now()
     WHERE id = 1`,
    params
  );
  await recordAudit(actor, {
    action: "subscription.config_update",
    targetType: "subscription_config",
    targetId: null,
    institutionId: null,
    detail: { ...input },
  });
  return getLifecycleConfig();
}

// ---------------------------------------------------------------------------
// Shared filter builder (list / calendar / reports / export)
// ---------------------------------------------------------------------------

const BASE_FROM = `
  FROM institution_subscriptions s
  JOIN institutions i ON i.id = s.institution_id
  JOIN subscription_packages p ON p.id = s.package_id
  LEFT JOIN LATERAL (
    SELECT COALESCE(SUM(total), 0)::float AS outstanding,
           COALESCE(SUM(total) FILTER (WHERE due_date IS NOT NULL AND due_date < CURRENT_DATE), 0)::float AS overdue,
           count(*)::int AS invoice_count
    FROM saas_invoices inv
    WHERE inv.institution_id = i.id AND inv.status = 'issued'
  ) bill ON true`;

const ROW_COLS = `
  s.id, s.status,
  to_char(s.starts_at, 'YYYY-MM-DD') AS "startsAt",
  to_char(s.ends_at, 'YYYY-MM-DD') AS "endsAt",
  to_char(s.renews_at, 'YYYY-MM-DD') AS "renewsAt",
  to_char(s.trial_ends_at, 'YYYY-MM-DD') AS "trialEndsAt",
  to_char(s.grace_until, 'YYYY-MM-DD') AS "graceUntil",
  s.auto_renew AS "autoRenew",
  to_char(s.created_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "createdAt",
  i.id AS "institutionId", i.name AS "institutionName", i.code AS "institutionCode",
  i.institution_type AS "institutionType", i.is_active AS "institutionActive",
  p.id AS "packageId", p.name AS "packageName", p.billing_cycle AS "billingCycle",
  p.price::float AS "price", COALESCE(p.currency, 'INR') AS "currency",
  bill.outstanding AS "outstanding", bill.overdue AS "overdue", bill.invoice_count AS "invoiceCount",
  (s.status IN ('active','trialing')
    AND (s.ends_at IS NULL OR CURRENT_DATE <= COALESCE(s.grace_until, s.ends_at))) AS "isActiveNow"`;

type Filters = Partial<z.infer<typeof listQuerySchema>>;

function buildWhere(f: Filters): { whereSql: string; params: unknown[] } {
  const where: string[] = [];
  const params: unknown[] = [];
  const add = (clause: (n: number) => string, value: unknown) => {
    params.push(value);
    where.push(clause(params.length));
  };
  if (f.q) {
    params.push(`%${f.q}%`);
    const like = params.length;
    params.push(f.q);
    const exact = params.length;
    where.push(
      `(i.name ILIKE $${like} OR i.code ILIKE $${like} OR i.email ILIKE $${like}
        OR p.name ILIKE $${like} OR s.id::text = $${exact})`
    );
  }
  if (f.status) add((n) => `s.status = $${n}`, f.status);
  if (f.packageId) add((n) => `s.package_id = $${n}`, f.packageId);
  if (f.institutionType) add((n) => `i.institution_type = $${n}`, f.institutionType);
  if (f.billingCycle) add((n) => `p.billing_cycle = $${n}`, f.billingCycle);
  if (f.startFrom) add((n) => `s.starts_at >= $${n}`, f.startFrom);
  if (f.startTo) add((n) => `s.starts_at <= $${n}`, f.startTo);
  if (f.endFrom) add((n) => `s.ends_at >= $${n}`, f.endFrom);
  if (f.endTo) add((n) => `s.ends_at <= $${n}`, f.endTo);
  if (f.renewFrom) add((n) => `s.renews_at >= $${n}`, f.renewFrom);
  if (f.renewTo) add((n) => `s.renews_at <= $${n}`, f.renewTo);
  if (f.trialFrom) add((n) => `s.trial_ends_at >= $${n}`, f.trialFrom);
  if (f.trialTo) add((n) => `s.trial_ends_at <= $${n}`, f.trialTo);
  if (f.paymentStatus === "overdue") where.push(`bill.overdue > 0`);
  else if (f.paymentStatus === "outstanding") where.push(`bill.outstanding > 0`);
  else if (f.paymentStatus === "paid") where.push(`bill.outstanding = 0 AND bill.invoice_count = 0`);
  else if (f.paymentStatus === "none") where.push(`bill.invoice_count = 0`);
  return { whereSql: where.length ? `WHERE ${where.join(" AND ")}` : "", params };
}

const SORT_COLS: Record<string, string> = {
  institution: "i.name", package: "p.name", status: "s.status",
  start: "s.starts_at", expiry: "s.ends_at", renewal: "s.renews_at",
  outstanding: "bill.outstanding",
};

export async function listSubscriptions(q: ListQuery) {
  const { whereSql, params } = buildWhere(q);
  const count = await query<{ n: number }>(`SELECT count(*)::int AS n ${BASE_FROM} ${whereSql}`, params);
  const sortCol = SORT_COLS[q.sort] ?? "i.name";
  const order = q.order === "desc" ? "DESC" : "ASC";
  const { rows } = await query(
    `SELECT ${ROW_COLS} ${BASE_FROM} ${whereSql}
     ORDER BY ${sortCol} ${order} NULLS LAST, i.name ASC
     LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, q.pageSize, (q.page - 1) * q.pageSize]
  );
  return { rows, total: count.rows[0].n, page: q.page, pageSize: q.pageSize };
}

const EXPORT_COLUMNS = [
  { key: "institutionName", label: "Institution" },
  { key: "institutionCode", label: "Code" },
  { key: "institutionType", label: "Type" },
  { key: "packageName", label: "Package" },
  { key: "billingCycle", label: "Billing Cycle" },
  { key: "status", label: "Status" },
  { key: "startsAt", label: "Start" },
  { key: "endsAt", label: "Expiry" },
  { key: "renewsAt", label: "Renewal" },
  { key: "trialEndsAt", label: "Trial Ends" },
  { key: "outstanding", label: "Outstanding" },
  { key: "overdue", label: "Overdue" },
  { key: "currency", label: "Currency" },
];

export async function exportSubscriptions(q: ListQuery) {
  const { whereSql, params } = buildWhere(q);
  const sortCol = SORT_COLS[q.sort] ?? "i.name";
  const order = q.order === "desc" ? "DESC" : "ASC";
  const { rows } = await query<Record<string, unknown>>(
    `SELECT ${ROW_COLS} ${BASE_FROM} ${whereSql}
     ORDER BY ${sortCol} ${order} NULLS LAST, i.name ASC LIMIT 20000`,
    params
  );
  return { columns: EXPORT_COLUMNS, rows };
}

// ---------------------------------------------------------------------------
// Dashboard summary
// ---------------------------------------------------------------------------

export async function summary(soonDays = 30) {
  const { rows } = await query<Record<string, number>>(
    `SELECT
       count(*)::int AS total,
       count(*) FILTER (WHERE s.status = 'active')::int AS active,
       count(*) FILTER (WHERE s.status = 'trialing')::int AS trialing,
       count(*) FILTER (WHERE s.status = 'suspended')::int AS suspended,
       count(*) FILTER (WHERE s.status = 'cancelled')::int AS cancelled,
       count(*) FILTER (WHERE s.status = 'expired')::int AS expired,
       count(*) FILTER (WHERE s.status IN ('active','trialing') AND s.ends_at IS NOT NULL
                        AND s.ends_at >= CURRENT_DATE AND s.ends_at <= CURRENT_DATE + $1::int)::int AS "expiringSoon",
       count(*) FILTER (WHERE s.status IN ('active','trialing') AND s.grace_until IS NOT NULL
                        AND CURRENT_DATE > s.ends_at AND CURRENT_DATE <= s.grace_until)::int AS grace
     FROM institution_subscriptions s`,
    [soonDays]
  );
  const overdue = await query<{ tenants: number; amount: number }>(
    `SELECT count(DISTINCT institution_id)::int AS tenants,
            COALESCE(SUM(total),0)::float AS amount
     FROM saas_invoices
     WHERE status = 'issued' AND due_date IS NOT NULL AND due_date < CURRENT_DATE`
  );
  const outstanding = await query<{ amount: number }>(
    `SELECT COALESCE(SUM(total),0)::float AS amount FROM saas_invoices WHERE status = 'issued'`
  );
  let revenue: { mrr: number; arr: number; currency: string; mixedCurrency: boolean } = {
    mrr: 0, arr: 0, currency: "INR", mixedCurrency: false,
  };
  try {
    const rev = await platformRevenue(1);
    revenue = { mrr: rev.mrr, arr: rev.arr, currency: rev.currency, mixedCurrency: rev.mixedCurrency };
  } catch {
    /* revenue is best-effort; cards still render without it */
  }
  return {
    counts: {
      ...rows[0],
      overdueBilling: overdue.rows[0].tenants,
    },
    revenue: {
      ...revenue,
      outstanding: outstanding.rows[0].amount,
      overdue: overdue.rows[0].amount,
    },
  };
}

// ---------------------------------------------------------------------------
// Detail
// ---------------------------------------------------------------------------

async function loadSubscription(id: string) {
  const { rows } = await query<Record<string, unknown>>(
    `SELECT ${ROW_COLS},
            p.max_students AS "maxStudents", p.max_staff AS "maxStaff",
            p.limits AS "packageLimits", p.applicable_types AS "applicableTypes",
            p.tax_percent AS "taxPercent"
     ${BASE_FROM} WHERE s.id = $1`,
    [id]
  );
  if (!rows[0]) throw ApiError.notFound("Subscription not found");
  return rows[0];
}

export async function detail(id: string) {
  const sub = await loadSubscription(id);
  const institutionId = sub.institutionId as string;
  const [events, notes, latestInvoice, billing] = await Promise.all([
    query(
      `SELECT id, event, from_status AS "fromStatus", to_status AS "toStatus", reason,
              actor_email AS "actorEmail", detail, to_char(created_at,'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "createdAt"
       FROM subscription_events WHERE institution_id = $1 ORDER BY created_at DESC LIMIT 100`,
      [institutionId]
    ),
    listNotes(institutionId),
    query(
      `SELECT id, number, status, total::float AS total,
              to_char(issued_at,'YYYY-MM-DD') AS "issuedAt",
              to_char(due_date,'YYYY-MM-DD') AS "dueDate",
              (status = 'issued' AND due_date IS NOT NULL AND due_date < CURRENT_DATE) AS "isOverdue"
       FROM saas_invoices WHERE institution_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [institutionId]
    ),
    query<{ outstanding: number; overdue: number }>(
      `SELECT COALESCE(SUM(total),0)::float AS outstanding,
              COALESCE(SUM(total) FILTER (WHERE due_date IS NOT NULL AND due_date < CURRENT_DATE),0)::float AS overdue
       FROM saas_invoices WHERE institution_id = $1 AND status = 'issued'`,
      [institutionId]
    ),
  ]);
  return {
    ...sub,
    billing: { ...billing.rows[0], latestInvoice: latestInvoice.rows[0] ?? null },
    events: events.rows,
    notes,
  };
}

// ---------------------------------------------------------------------------
// Manual actions — every one audited + appended to subscription_events
// ---------------------------------------------------------------------------

interface MutContext {
  id: string;
  fromStatus: string;
  toStatus: string;
  event: string;
  reason?: string;
  detail?: Record<string, unknown>;
  audit: string;
}

async function afterMutation(institutionId: string, ctx: MutContext, actor: Actor) {
  await recordSubscriptionEvent({
    institutionId,
    subscriptionId: ctx.id,
    event: ctx.event,
    fromStatus: ctx.fromStatus,
    toStatus: ctx.toStatus,
    reason: ctx.reason ?? null,
    detail: ctx.detail ?? {},
    actor: { id: actor.id, email: actor.email },
  });
  await recordAudit(actor, {
    action: ctx.audit,
    targetType: "subscription",
    targetId: ctx.id,
    institutionId,
    detail: { reason: ctx.reason ?? null, ...(ctx.detail ?? {}) },
  });
}

export async function extend(id: string, input: z.infer<typeof extendSchema>, actor: Actor) {
  const sub = await loadSubscription(id);
  const status = sub.status as string;
  const toStatus = status === "expired" || status === "cancelled" ? "active" : status;
  await query(
    `UPDATE institution_subscriptions
     SET ends_at = $2, grace_until = NULL, status = $3 WHERE id = $1`,
    [id, input.endsAt, toStatus]
  );
  await afterMutation(sub.institutionId as string, {
    id, fromStatus: status, toStatus, event: "extended", reason: input.reason,
    detail: { endsAt: input.endsAt }, audit: "subscription.extend",
  }, actor);
  return detail(id);
}

export async function renew(id: string, input: z.infer<typeof renewSchema>, actor: Actor) {
  const sub = await loadSubscription(id);
  const packageId = input.packageId ?? (sub.packageId as string);
  // Determine the cycle (explicit → new package → current package).
  let cycle = input.billingCycle;
  if (!cycle) {
    const { rows } = await query<{ billing_cycle: string }>(
      `SELECT billing_cycle FROM subscription_packages WHERE id = $1`, [packageId]
    );
    cycle = (rows[0]?.billing_cycle as z.infer<typeof renewSchema>["billingCycle"]) ?? "annual";
  }
  const months = CYCLE_MONTHS[cycle ?? "annual"] * input.periods;
  const { rows: nd } = await query<{ ends_at: string; starts_at: string }>(
    `UPDATE institution_subscriptions
     SET package_id = $2,
         starts_at = LEAST(starts_at, CURRENT_DATE),
         ends_at = (GREATEST(COALESCE(ends_at, CURRENT_DATE), CURRENT_DATE) + ($3 || ' months')::interval)::date,
         renews_at = (GREATEST(COALESCE(ends_at, CURRENT_DATE), CURRENT_DATE) + ($3 || ' months')::interval)::date,
         grace_until = NULL, status = 'active'
     WHERE id = $1
     RETURNING to_char(ends_at,'YYYY-MM-DD') AS ends_at, to_char(starts_at,'YYYY-MM-DD') AS starts_at`,
    [id, packageId, months]
  );
  let invoiceId: string | null = null;
  if (input.createInvoice) invoiceId = await createRenewalDraftInvoice(sub.institutionId as string, packageId, actor);
  await afterMutation(sub.institutionId as string, {
    id, fromStatus: sub.status as string, toStatus: "active", event: "renewed", reason: input.reason,
    detail: { packageId, periods: input.periods, cycle, newEndsAt: nd[0]?.ends_at, invoiceId },
    audit: "subscription.renew",
  }, actor);
  return detail(id);
}

/** Minimal, safe renewal invoice: a DRAFT saas_invoice (no numbering/issue). */
async function createRenewalDraftInvoice(institutionId: string, packageId: string, actor: Actor): Promise<string | null> {
  const { rows: pk } = await query<{ price: number; currency: string; name: string; tax_percent: number | null }>(
    `SELECT price::float AS price, COALESCE(currency,'INR') AS currency, name, tax_percent FROM subscription_packages WHERE id = $1`,
    [packageId]
  );
  if (!pk[0]) return null;
  const subtotal = pk[0].price;
  const taxPercent = Number(pk[0].tax_percent ?? 0);
  const taxAmount = Math.round(subtotal * taxPercent) / 100;
  const total = subtotal + taxAmount;
  const { rows } = await query<{ id: string }>(
    `INSERT INTO saas_invoices
       (institution_id, package_id, status, currency, subtotal, tax_percent, tax_amount, total, is_renewal, created_by)
     VALUES ($1,$2,'draft',$3,$4,$5,$6,$7,true,$8) RETURNING id`,
    [institutionId, packageId, pk[0].currency, subtotal, taxPercent, taxAmount, total, actor.id]
  );
  await query(
    `INSERT INTO saas_invoice_lines (invoice_id, description, quantity, unit_price, amount)
     VALUES ($1,$2,1,$3,$3)`,
    [rows[0].id, `Renewal — ${pk[0].name}`, subtotal]
  );
  return rows[0].id;
}

export async function changePackage(id: string, input: z.infer<typeof changePackageSchema>, actor: Actor) {
  const sub = await loadSubscription(id);
  const { rows: pk } = await query<{ id: string; name: string }>(
    `SELECT id, name FROM subscription_packages WHERE id = $1`, [input.packageId]
  );
  if (!pk[0]) throw ApiError.badRequest("Target package not found");
  await query(`UPDATE institution_subscriptions SET package_id = $2 WHERE id = $1`, [id, input.packageId]);
  await afterMutation(sub.institutionId as string, {
    id, fromStatus: sub.status as string, toStatus: sub.status as string, event: "package_changed",
    reason: input.reason,
    detail: { fromPackage: sub.packageName, toPackage: pk[0].name, packageId: input.packageId, effectiveDate: input.effectiveDate ?? null },
    audit: "subscription.change_package",
  }, actor);
  return detail(id);
}

export async function cancel(id: string, input: z.infer<typeof cancelSchema>, actor: Actor) {
  const sub = await loadSubscription(id);
  await query(`UPDATE institution_subscriptions SET status = 'cancelled' WHERE id = $1`, [id]);
  await afterMutation(sub.institutionId as string, {
    id, fromStatus: sub.status as string, toStatus: "cancelled", event: "cancelled",
    reason: input.reason, detail: { effectiveDate: input.effectiveDate ?? null }, audit: "subscription.cancel",
  }, actor);
  return detail(id);
}

export async function suspend(id: string, input: z.infer<typeof suspendSchema>, actor: Actor) {
  const sub = await loadSubscription(id);
  const institutionId = sub.institutionId as string;
  await query(`UPDATE institution_subscriptions SET status = 'suspended' WHERE id = $1`, [id]);
  if (input.suspendTenant) {
    await query(`UPDATE institutions SET is_active = false WHERE id = $1`, [institutionId]);
  }
  await afterMutation(institutionId, {
    id, fromStatus: sub.status as string, toStatus: "suspended", event: "suspended",
    reason: input.reason, detail: { suspendedTenant: input.suspendTenant }, audit: "subscription.suspend",
  }, actor);
  return detail(id);
}

export async function reactivate(id: string, input: z.infer<typeof reactivateSchema>, actor: Actor) {
  const sub = await loadSubscription(id);
  const institutionId = sub.institutionId as string;
  await query(
    `UPDATE institution_subscriptions
     SET status = 'active', grace_until = NULL,
         ends_at = COALESCE($2, ends_at) WHERE id = $1`,
    [id, input.endsAt ?? null]
  );
  if (input.reactivateTenant) {
    await query(`UPDATE institutions SET is_active = true WHERE id = $1`, [institutionId]);
  }
  await afterMutation(institutionId, {
    id, fromStatus: sub.status as string, toStatus: "active", event: "reactivated",
    reason: input.reason, detail: { endsAt: input.endsAt ?? null, reactivatedTenant: input.reactivateTenant },
    audit: "subscription.reactivate",
  }, actor);
  return detail(id);
}

export async function markExpired(id: string, input: z.infer<typeof markExpiredSchema>, actor: Actor) {
  const sub = await loadSubscription(id);
  await query(`UPDATE institution_subscriptions SET status = 'expired' WHERE id = $1`, [id]);
  await afterMutation(sub.institutionId as string, {
    id, fromStatus: sub.status as string, toStatus: "expired", event: "expired",
    reason: input.reason, detail: { manual: true }, audit: "subscription.mark_expired",
  }, actor);
  return detail(id);
}

// ---------------------------------------------------------------------------
// Lifecycle preview (dry-run) + run
// ---------------------------------------------------------------------------

export async function lifecyclePreview() {
  const cfg = await effectiveLifecycleConfig();
  const [grace, trialExp, termExp, reminders, overdue] = await Promise.all([
    query<{ n: number }>(
      `SELECT count(*)::int AS n FROM institution_subscriptions
       WHERE status IN ('active','trialing') AND ends_at IS NOT NULL
         AND CURRENT_DATE > ends_at AND CURRENT_DATE <= ends_at + $1::int AND grace_until IS NULL`,
      [cfg.graceDays]
    ),
    query<{ n: number }>(
      `SELECT count(*)::int AS n FROM institution_subscriptions
       WHERE status = 'trialing' AND trial_ends_at IS NOT NULL AND CURRENT_DATE > trial_ends_at`
    ),
    query<{ n: number }>(
      `SELECT count(*)::int AS n FROM institution_subscriptions
       WHERE status IN ('active','trialing') AND ends_at IS NOT NULL
         AND CURRENT_DATE > COALESCE(grace_until, ends_at + $1::int)`,
      [cfg.graceDays]
    ),
    query<{ n: number }>(
      `SELECT count(*)::int AS n FROM institution_subscriptions s
       WHERE s.status IN ('active','trialing') AND s.ends_at IS NOT NULL
         AND (s.ends_at - CURRENT_DATE) = ANY($1::int[])
         AND (s.last_reminder_day IS DISTINCT FROM (s.ends_at - CURRENT_DATE))`,
      [cfg.reminderDays]
    ),
    query<{ n: number }>(
      `SELECT count(DISTINCT institution_id)::int AS n FROM saas_invoices
       WHERE status = 'issued' AND due_date IS NOT NULL AND due_date < CURRENT_DATE`
    ),
  ]);
  const willExpire = trialExp.rows[0].n + termExp.rows[0].n;
  return {
    config: cfg,
    actions: {
      graceStarting: grace.rows[0].n,
      trialExpiring: trialExp.rows[0].n,
      termExpiring: termExp.rows[0].n,
      willExpire,
      willAutoSuspend: cfg.autoSuspend ? willExpire : 0,
      remindersToSend: cfg.reminderDays.length ? reminders.rows[0].n : 0,
      overdueBillingRisk: overdue.rows[0].n,
    },
    note: cfg.autoExpire
      ? "Running the lifecycle will apply these transitions."
      : "Auto-expire is OFF: expiries are previewed but will NOT be applied on run.",
  };
}

export async function runLifecycle(actor: Actor): Promise<SweepSummary> {
  const summary = await sweepSubscriptionLifecycle({ id: actor.id, email: actor.email });
  await recordAudit(actor, {
    action: "subscription.run_lifecycle",
    targetType: "subscription",
    targetId: null,
    institutionId: null,
    detail: { ...summary },
  });
  return summary;
}

// ---------------------------------------------------------------------------
// Renewal calendar
// ---------------------------------------------------------------------------

export async function calendar(q: CalendarQuery) {
  const from = q.from ?? new Date().toISOString().slice(0, 10);
  const params: unknown[] = [from];
  let toClause = "";
  if (q.to) { params.push(q.to); toClause = `AND d.date <= $${params.length}`; }
  const extra: string[] = [];
  if (q.status) { params.push(q.status); extra.push(`s.status = $${params.length}`); }
  if (q.packageId) { params.push(q.packageId); extra.push(`s.package_id = $${params.length}`); }
  if (q.institutionType) { params.push(q.institutionType); extra.push(`i.institution_type = $${params.length}`); }
  const extraSql = extra.length ? `AND ${extra.join(" AND ")}` : "";
  // Each subscription contributes rows for whichever lifecycle dates it has.
  const { rows } = await query(
    `WITH cal AS (
       SELECT s.id, i.id AS institution_id, i.name AS institution_name, i.code,
              p.name AS package_name, s.status,
              d.kind, d.date
       FROM institution_subscriptions s
       JOIN institutions i ON i.id = s.institution_id
       JOIN subscription_packages p ON p.id = s.package_id
       CROSS JOIN LATERAL (VALUES
         ('renewal', s.renews_at),
         ('expiry', s.ends_at),
         ('trial_end', s.trial_ends_at),
         ('grace_end', s.grace_until)
       ) AS d(kind, date)
       WHERE d.date IS NOT NULL AND d.date >= $1 ${toClause} ${extraSql}
     )
     SELECT id AS "subscriptionId", institution_id AS "institutionId",
            institution_name AS "institutionName", code AS "institutionCode",
            package_name AS "packageName", status, kind,
            to_char(date,'YYYY-MM-DD') AS date
     FROM cal ORDER BY date ASC, institution_name ASC LIMIT 2000`,
    params
  );
  return rows;
}

// ---------------------------------------------------------------------------
// Reminders
// ---------------------------------------------------------------------------

export async function sendReminder(subscriptionId: string, actor: Actor) {
  const sub = await loadSubscription(subscriptionId);
  const institutionId = sub.institutionId as string;
  const endsAt = (sub.endsAt as string) ?? "—";
  const daysUntil = sub.endsAt
    ? Math.ceil((new Date(sub.endsAt as string).getTime() - Date.now()) / 86_400_000)
    : 0;
  const mail = renewalReminderEmail(daysUntil, (sub.packageName as string) ?? null, endsAt);
  const { rows: admins } = await query<{ email: string }>(
    `SELECT email FROM users WHERE institution_id = $1 AND role = 'admin' AND is_active = true`,
    [institutionId]
  );
  const configured = mailerConfigured();
  const results: { to: string; status: string; error?: string }[] = [];
  for (const a of admins) {
    if (!configured) {
      results.push({ to: a.email, status: "skipped" });
    } else {
      try {
        await sendMail({ to: a.email, subject: mail.subject, text: mail.text });
        results.push({ to: a.email, status: "sent" });
      } catch (err) {
        results.push({ to: a.email, status: "failed", error: (err as Error).message });
      }
    }
    await query(
      `INSERT INTO subscription_reminders
         (institution_id, subscription_id, kind, to_email, subject, status, error, actor_id, actor_email)
       VALUES ($1,$2,'manual',$3,$4,$5,$6,$7,$8)`,
      [institutionId, subscriptionId, a.email, mail.subject,
       results[results.length - 1].status, results[results.length - 1].error ?? null, actor.id, actor.email]
    );
  }
  await recordSubscriptionEvent({
    institutionId, subscriptionId, event: "reminder_sent",
    detail: { manual: true, recipients: results.length, configured }, actor: { id: actor.id, email: actor.email },
  });
  await recordAudit(actor, {
    action: "subscription.send_reminder", targetType: "subscription", targetId: subscriptionId,
    institutionId, detail: { recipients: results.length, configured },
  });
  return { configured, recipients: results };
}

export async function listReminders(subscriptionId: string) {
  const { rows } = await query(
    `SELECT id, kind, to_email AS "toEmail", subject, status, error,
            actor_email AS "actorEmail", to_char(created_at,'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "createdAt"
     FROM subscription_reminders WHERE subscription_id = $1 ORDER BY created_at DESC LIMIT 200`,
    [subscriptionId]
  );
  return rows;
}

// ---------------------------------------------------------------------------
// Notes (CRM follow-up) — soft-delete only
// ---------------------------------------------------------------------------

export async function listNotes(institutionId: string) {
  const { rows } = await query(
    `SELECT id, note_type AS "noteType", body,
            to_char(follow_up_date,'YYYY-MM-DD') AS "followUpDate", owner,
            created_by_email AS "createdByEmail",
            to_char(created_at,'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "createdAt",
            to_char(updated_at,'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "updatedAt"
     FROM subscription_notes
     WHERE institution_id = $1 AND deleted_at IS NULL
     ORDER BY created_at DESC`,
    [institutionId]
  );
  return rows;
}

/** Notes for the subscription's institution (resolves the tenant first). */
export async function notesForSubscription(subscriptionId: string) {
  const { rows } = await query<{ institution_id: string }>(
    `SELECT institution_id FROM institution_subscriptions WHERE id = $1`,
    [subscriptionId]
  );
  if (!rows[0]) throw ApiError.notFound("Subscription not found");
  return listNotes(rows[0].institution_id);
}

export async function addNote(subscriptionId: string, input: z.infer<typeof noteCreateSchema>, actor: Actor) {
  const sub = await loadSubscription(subscriptionId);
  const institutionId = sub.institutionId as string;
  const { rows } = await query<{ id: string }>(
    `INSERT INTO subscription_notes
       (institution_id, subscription_id, note_type, body, follow_up_date, owner, created_by, created_by_email)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
    [institutionId, subscriptionId, input.noteType, input.body, input.followUpDate ?? null,
     input.owner ?? null, actor.id, actor.email]
  );
  await recordAudit(actor, {
    action: "subscription.note_add", targetType: "subscription", targetId: subscriptionId,
    institutionId, detail: { noteId: rows[0].id, noteType: input.noteType },
  });
  return listNotes(institutionId);
}

export async function updateNote(noteId: string, input: z.infer<typeof noteUpdateSchema>, actor: Actor) {
  const { rows: existing } = await query<{ institution_id: string }>(
    `SELECT institution_id FROM subscription_notes WHERE id = $1 AND deleted_at IS NULL`, [noteId]
  );
  if (!existing[0]) throw ApiError.notFound("Note not found");
  const sets: string[] = [];
  const params: unknown[] = [];
  const add = (col: string, val: unknown) => { params.push(val); sets.push(`${col} = $${params.length}`); };
  if (input.noteType !== undefined) add("note_type", input.noteType);
  if (input.body !== undefined) add("body", input.body);
  if (input.followUpDate !== undefined) add("follow_up_date", input.followUpDate);
  if (input.owner !== undefined) add("owner", input.owner);
  params.push(noteId);
  await query(`UPDATE subscription_notes SET ${sets.join(", ")}, updated_at = now() WHERE id = $${params.length}`, params);
  await recordAudit(actor, {
    action: "subscription.note_update", targetType: "subscription", targetId: noteId,
    institutionId: existing[0].institution_id, detail: { ...input },
  });
  return listNotes(existing[0].institution_id);
}

export async function deleteNote(noteId: string, actor: Actor) {
  const { rows } = await query<{ institution_id: string }>(
    `UPDATE subscription_notes SET deleted_at = now()
     WHERE id = $1 AND deleted_at IS NULL RETURNING institution_id`, [noteId]
  );
  if (!rows[0]) throw ApiError.notFound("Note not found");
  await recordAudit(actor, {
    action: "subscription.note_delete", targetType: "subscription", targetId: noteId,
    institutionId: rows[0].institution_id, detail: {},
  });
  return listNotes(rows[0].institution_id);
}

// ---------------------------------------------------------------------------
// Events (by subscription)
// ---------------------------------------------------------------------------

export async function listEvents(subscriptionId: string) {
  const { rows } = await query(
    `SELECT id, event, from_status AS "fromStatus", to_status AS "toStatus", reason,
            actor_email AS "actorEmail", detail,
            to_char(created_at,'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "createdAt"
     FROM subscription_events WHERE subscription_id = $1 ORDER BY created_at DESC LIMIT 200`,
    [subscriptionId]
  );
  return rows;
}

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------

const STATUS_REPORT: Record<string, string> = {
  active: "active", trial: "trialing", expired: "expired",
  suspended: "suspended", cancelled: "cancelled",
};

export async function report(q: ReportQuery): Promise<{ columns: { key: string; label: string }[]; rows: Record<string, unknown>[]; totals?: Record<string, unknown> }> {
  const key = q.key;

  // Simple status-filtered lists reuse the list projection.
  if (key in STATUS_REPORT) {
    const { rows } = await listSubscriptions({ ...(q as unknown as ListQuery), status: STATUS_REPORT[key] as ListQuery["status"], sort: "institution", order: "asc", page: 1, pageSize: 20000 });
    return { columns: EXPORT_COLUMNS, rows: rows as Record<string, unknown>[], totals: { count: rows.length } };
  }

  if (key === "expiring") {
    const { rows } = await query<Record<string, unknown>>(
      `SELECT ${ROW_COLS} ${BASE_FROM}
       WHERE s.status IN ('active','trialing') AND s.ends_at IS NOT NULL
         AND s.ends_at >= CURRENT_DATE AND s.ends_at <= CURRENT_DATE + $1::int
       ORDER BY s.ends_at ASC LIMIT 20000`,
      [q.soonDays]
    );
    return { columns: EXPORT_COLUMNS, rows, totals: { count: rows.length } };
  }

  if (key === "grace") {
    const { rows } = await query<Record<string, unknown>>(
      `SELECT ${ROW_COLS} ${BASE_FROM}
       WHERE s.grace_until IS NOT NULL AND CURRENT_DATE > s.ends_at AND CURRENT_DATE <= s.grace_until
       ORDER BY s.grace_until ASC LIMIT 20000`
    );
    return { columns: EXPORT_COLUMNS, rows, totals: { count: rows.length } };
  }

  if (key === "renewal_due") {
    const { rows } = await query<Record<string, unknown>>(
      `SELECT ${ROW_COLS} ${BASE_FROM}
       WHERE s.status IN ('active','trialing') AND s.ends_at IS NOT NULL
         AND s.ends_at <= CURRENT_DATE + $1::int
       ORDER BY s.ends_at ASC LIMIT 20000`,
      [q.soonDays]
    );
    return { columns: EXPORT_COLUMNS, rows, totals: { count: rows.length } };
  }

  if (key === "overdue") {
    const { rows } = await query<Record<string, unknown>>(
      `SELECT ${ROW_COLS} ${BASE_FROM}
       WHERE bill.overdue > 0 ORDER BY bill.overdue DESC LIMIT 20000`
    );
    const totalOverdue = rows.reduce((s, r) => s + Number(r.overdue ?? 0), 0);
    return { columns: EXPORT_COLUMNS, rows, totals: { count: rows.length, overdue: totalOverdue } };
  }

  if (key === "package_wise") {
    const { rows } = await query<Record<string, unknown>>(
      `SELECT p.name AS "packageName", p.billing_cycle AS "billingCycle", COALESCE(p.currency,'INR') AS currency,
              count(*)::int AS "subscriptions",
              count(*) FILTER (WHERE s.status = 'active')::int AS active,
              count(*) FILTER (WHERE s.status = 'trialing')::int AS trialing,
              count(*) FILTER (WHERE s.status = 'expired')::int AS expired
       FROM institution_subscriptions s JOIN subscription_packages p ON p.id = s.package_id
       GROUP BY p.name, p.billing_cycle, p.currency ORDER BY count(*) DESC`
    );
    return {
      columns: [
        { key: "packageName", label: "Package" }, { key: "billingCycle", label: "Cycle" },
        { key: "currency", label: "Currency" }, { key: "subscriptions", label: "Subscriptions" },
        { key: "active", label: "Active" }, { key: "trialing", label: "Trial" }, { key: "expired", label: "Expired" },
      ], rows,
    };
  }

  if (key === "institution_type_wise") {
    const { rows } = await query<Record<string, unknown>>(
      `SELECT i.institution_type AS "institutionType", count(*)::int AS "subscriptions",
              count(*) FILTER (WHERE s.status = 'active')::int AS active,
              count(*) FILTER (WHERE s.status = 'trialing')::int AS trialing,
              count(*) FILTER (WHERE s.status IN ('expired','cancelled','suspended'))::int AS inactive
       FROM institution_subscriptions s JOIN institutions i ON i.id = s.institution_id
       GROUP BY i.institution_type ORDER BY count(*) DESC`
    );
    return {
      columns: [
        { key: "institutionType", label: "Institution Type" }, { key: "subscriptions", label: "Subscriptions" },
        { key: "active", label: "Active" }, { key: "trialing", label: "Trial" }, { key: "inactive", label: "Inactive" },
      ], rows,
    };
  }

  if (key === "mrr" || key === "arr") {
    const rev = await platformRevenue(q.months);
    const rows = rev.byCurrency.map((c) => ({
      currency: c.currency, mrr: c.mrr, arr: c.arr, activeSubscriptions: c.activeSubscriptions,
    }));
    return {
      columns: [
        { key: "currency", label: "Currency" }, { key: "mrr", label: "MRR" },
        { key: "arr", label: "ARR" }, { key: "activeSubscriptions", label: "Active Subs" },
      ], rows, totals: { mrr: rev.mrr, arr: rev.arr, currency: rev.currency, mixedCurrency: rev.mixedCurrency },
    };
  }

  if (key === "churn") {
    // Subscriptions that left (cancelled/expired) in the window, from the event trail.
    const { rows } = await query<Record<string, unknown>>(
      `SELECT to_char(date_trunc('month', created_at),'YYYY-MM') AS month,
              count(*) FILTER (WHERE event IN ('cancelled','expired','trial_expired'))::int AS churned,
              count(*) FILTER (WHERE event = 'reactivated')::int AS reactivated
       FROM subscription_events
       WHERE created_at >= (date_trunc('month', CURRENT_DATE) - (($1 - 1) || ' months')::interval)
       GROUP BY 1 ORDER BY 1`,
      [q.months]
    );
    return {
      columns: [{ key: "month", label: "Month" }, { key: "churned", label: "Churned" }, { key: "reactivated", label: "Reactivated" }],
      rows,
    };
  }

  if (key === "trial_conversion") {
    const trials = await query<{ started: number; converted: number; expired: number }>(
      `SELECT
         count(*) FILTER (WHERE event = 'status_changed' AND to_status = 'trialing')::int AS started,
         count(*) FILTER (WHERE event = 'renewed' AND from_status = 'trialing')::int AS converted,
         count(*) FILTER (WHERE event = 'trial_expired')::int AS expired
       FROM subscription_events
       WHERE created_at >= (date_trunc('month', CURRENT_DATE) - (($1 - 1) || ' months')::interval)`,
      [q.months]
    );
    const curTrial = await query<{ n: number }>(
      `SELECT count(*)::int AS n FROM institution_subscriptions WHERE status = 'trialing'`
    );
    const t = trials.rows[0];
    return {
      columns: [
        { key: "metric", label: "Metric" }, { key: "value", label: "Value" },
      ],
      rows: [
        { metric: "Currently trialing", value: curTrial.rows[0].n },
        { metric: "Trials converted (renewed)", value: t.converted },
        { metric: "Trials expired", value: t.expired },
      ],
      totals: { ...t, currentlyTrialing: curTrial.rows[0].n },
    };
  }

  if (key === "upgrade_downgrade") {
    const { rows } = await query<Record<string, unknown>>(
      `SELECT to_char(created_at,'YYYY-MM-DD') AS date, institution_id AS "institutionId",
              actor_email AS "actorEmail",
              detail->>'fromPackage' AS "fromPackage", detail->>'toPackage' AS "toPackage", reason
       FROM subscription_events WHERE event = 'package_changed'
       ORDER BY created_at DESC LIMIT 20000`
    );
    return {
      columns: [
        { key: "date", label: "Date" }, { key: "fromPackage", label: "From Package" },
        { key: "toPackage", label: "To Package" }, { key: "actorEmail", label: "By" }, { key: "reason", label: "Reason" },
      ], rows, totals: { count: rows.length },
    };
  }

  throw ApiError.badRequest("Unknown report key");
}
