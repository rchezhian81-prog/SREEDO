import type { z } from "zod";
import { query } from "../../db/postgres";
import { getMongoDb } from "../../db/mongo";
import { ApiError } from "../../utils/api-error";
import { snapshot } from "../../observability/metrics";
import { recordSecurityEvent } from "../../utils/security-audit";
import { maskFreeText } from "../platform/audit.service";
import { getGatewaySettings } from "../saaspayments/saaspayments.service";
import { recordAudit, SYSTEM_ACTOR, type Actor } from "./audit";
import type {
  alertAckSchema,
  alertExportQuerySchema,
  alertListQuerySchema,
  alertLinkIncidentSchema,
  alertNoteSchema,
  alertResolveSchema,
  alertRuleCreateSchema,
  alertRuleUpdateSchema,
} from "./observability.schema";

/**
 * Alert rules + the alert feed (Super Admin L).
 *
 * Rules are configuration (audited on change). Alerts are a durable feed —
 * ack/resolve/link/note are status/annotation transitions; alert rows are NEVER
 * hard-deleted. `evaluateAlertRules()` reads live metrics and, when a threshold
 * is breached AND the rule's cooldown has elapsed, inserts a triggered alert
 * (audited; a security event too for critical). It is safe to call opportunistically
 * (cooldown makes it idempotent) and is also wired into the job worker.
 */

const RULE_SELECT = `
  id, name, type, threshold, window_minutes AS "windowMinutes", severity, enabled,
  notify_target AS "notifyTarget", cooldown_minutes AS "cooldownMinutes",
  last_triggered_at AS "lastTriggeredAt", created_by AS "createdBy",
  updated_by AS "updatedBy", created_at AS "createdAt", updated_at AS "updatedAt"`;

const ALERT_SELECT = `
  id, rule_id AS "ruleId", rule_name AS "ruleName", type, severity, status, service,
  metric_value AS "metricValue", threshold, details, incident_id AS "incidentId", note,
  triggered_at AS "triggeredAt", acknowledged_by AS "acknowledgedBy",
  acknowledged_at AS "acknowledgedAt", resolved_by AS "resolvedBy",
  resolved_at AS "resolvedAt", created_at AS "createdAt"`;

type RuleCreate = z.infer<typeof alertRuleCreateSchema>;
type RuleUpdate = z.infer<typeof alertRuleUpdateSchema>;
type AlertList = z.infer<typeof alertListQuerySchema>;
type AlertAck = z.infer<typeof alertAckSchema>;
type AlertResolve = z.infer<typeof alertResolveSchema>;
type AlertNote = z.infer<typeof alertNoteSchema>;
type AlertLink = z.infer<typeof alertLinkIncidentSchema>;
type AlertExport = z.infer<typeof alertExportQuerySchema>;

const mask = (v: string | null | undefined): string | null =>
  v == null ? null : (maskFreeText(v) as string);

// ============================ Alert rules ==================================

export async function listAlertRules() {
  const { rows } = await query(`SELECT ${RULE_SELECT} FROM alert_rules ORDER BY created_at DESC`);
  return rows;
}

export async function getAlertRule(id: string) {
  const { rows } = await query(`SELECT ${RULE_SELECT} FROM alert_rules WHERE id = $1`, [id]);
  if (!rows[0]) throw ApiError.notFound("Alert rule not found");
  return rows[0];
}

export async function createAlertRule(input: RuleCreate, actor: Actor) {
  const { rows } = await query<{ id: string }>(
    `INSERT INTO alert_rules
       (name, type, threshold, window_minutes, severity, enabled, notify_target, cooldown_minutes, created_by, updated_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9) RETURNING id`,
    [
      input.name,
      input.type,
      input.threshold ?? null,
      input.windowMinutes,
      input.severity,
      input.enabled,
      mask(input.notifyTarget ?? null),
      input.cooldownMinutes,
      actor.id,
    ]
  );
  await recordAudit(actor, {
    action: "alert.rule_created",
    targetType: "alert",
    targetId: rows[0].id,
    detail: { name: input.name, type: input.type, severity: input.severity, threshold: input.threshold ?? null },
  });
  return getAlertRule(rows[0].id);
}

export async function updateAlertRule(id: string, input: RuleUpdate, actor: Actor) {
  await getAlertRule(id);
  const sets: string[] = [];
  const params: unknown[] = [];
  const set = (col: string, value: unknown) => {
    params.push(value);
    sets.push(`${col} = $${params.length}`);
  };
  if (input.name !== undefined) set("name", input.name);
  if (input.type !== undefined) set("type", input.type);
  if (input.threshold !== undefined) set("threshold", input.threshold);
  if (input.windowMinutes !== undefined) set("window_minutes", input.windowMinutes);
  if (input.severity !== undefined) set("severity", input.severity);
  if (input.enabled !== undefined) set("enabled", input.enabled);
  if (input.notifyTarget !== undefined) set("notify_target", mask(input.notifyTarget));
  if (input.cooldownMinutes !== undefined) set("cooldown_minutes", input.cooldownMinutes);
  set("updated_by", actor.id);
  params.push(id);
  await query(`UPDATE alert_rules SET ${sets.join(", ")} WHERE id = $${params.length}`, params);
  await recordAudit(actor, {
    action: "alert.rule_updated",
    targetType: "alert",
    targetId: id,
    detail: { fields: Object.keys(input), ...(input.enabled !== undefined ? { enabled: input.enabled } : {}) },
  });
  return getAlertRule(id);
}

/** Fire a synthetic 'suppressed' test alert (no real notification), audited. */
export async function testRule(id: string, actor: Actor) {
  const rule = (await getAlertRule(id)) as Record<string, unknown>;
  const { rows } = await query<{ id: string }>(
    `INSERT INTO alerts (rule_id, rule_name, type, severity, status, service, details, note, triggered_at)
     VALUES ($1,$2,$3,$4,'suppressed','test',$5::jsonb,$6, now()) RETURNING id`,
    [
      id,
      rule.name,
      rule.type,
      rule.severity,
      JSON.stringify({ test: true, note: "Synthetic test alert — no notification sent" }),
      "test alert",
    ]
  );
  await recordAudit(actor, {
    action: "alert.rule_tested",
    targetType: "alert",
    targetId: id,
    detail: { alertId: rows[0].id, type: rule.type },
  });
  const { rows: alertRows } = await query(`SELECT ${ALERT_SELECT} FROM alerts WHERE id = $1`, [rows[0].id]);
  return { tested: true, alert: alertRows[0] };
}

// ============================ Alert feed ===================================

function alertWhere(q: Pick<AlertList, "status" | "severity" | "ruleId" | "dateFrom" | "dateTo">) {
  const params: unknown[] = [];
  const where: string[] = [];
  const add = (clause: (n: number) => string, value: unknown) => {
    params.push(value);
    where.push(clause(params.length));
  };
  if (q.status) add((n) => `status = $${n}`, q.status);
  if (q.severity) add((n) => `severity = $${n}`, q.severity);
  if (q.ruleId) add((n) => `rule_id = $${n}`, q.ruleId);
  if (q.dateFrom) add((n) => `triggered_at >= $${n}`, `${q.dateFrom}T00:00:00.000Z`);
  if (q.dateTo) add((n) => `triggered_at <= $${n}`, `${q.dateTo}T23:59:59.999Z`);
  return { whereSql: where.length ? `WHERE ${where.join(" AND ")}` : "", params };
}

export async function listAlerts(q: AlertList) {
  const { whereSql, params } = alertWhere(q);
  const total = Number(
    (await query<{ n: number }>(`SELECT count(*)::int AS n FROM alerts ${whereSql}`, params)).rows[0].n
  );
  const pageParams = [...params, q.pageSize, (q.page - 1) * q.pageSize];
  const { rows } = await query(
    `SELECT ${ALERT_SELECT} FROM alerts ${whereSql}
     ORDER BY triggered_at DESC LIMIT $${pageParams.length - 1} OFFSET $${pageParams.length}`,
    pageParams
  );
  return { rows, total, page: q.page, pageSize: q.pageSize };
}

export async function getAlert(id: string) {
  const { rows } = await query(`SELECT ${ALERT_SELECT} FROM alerts WHERE id = $1`, [id]);
  if (!rows[0]) throw ApiError.notFound("Alert not found");
  return rows[0];
}

export async function ackAlert(id: string, input: AlertAck, actor: Actor) {
  const { rows } = await query<{ id: string }>(
    `UPDATE alerts SET status='acknowledged', acknowledged_by=$2, acknowledged_at=now(),
       note = COALESCE($3, note)
     WHERE id=$1 AND status IN ('triggered','suppressed') RETURNING id`,
    [id, actor.id, mask(input.note ?? null)]
  );
  if (!rows[0]) {
    await getAlert(id); // 404 if missing
    throw ApiError.badRequest("Alert cannot be acknowledged in its current state");
  }
  await recordAudit(actor, { action: "alert.acknowledged", targetType: "alert", targetId: id, detail: {} });
  return getAlert(id);
}

export async function resolveAlert(id: string, input: AlertResolve, actor: Actor) {
  const { rows } = await query<{ id: string }>(
    `UPDATE alerts SET status='resolved', resolved_by=$2, resolved_at=now(),
       note = COALESCE($3, note)
     WHERE id=$1 AND status <> 'resolved' RETURNING id`,
    [id, actor.id, mask(input.note ?? null)]
  );
  if (!rows[0]) {
    await getAlert(id);
    throw ApiError.badRequest("Alert is already resolved");
  }
  await recordAudit(actor, { action: "alert.resolved", targetType: "alert", targetId: id, detail: {} });
  return getAlert(id);
}

export async function linkIncident(id: string, input: AlertLink, actor: Actor) {
  const inc = await query("SELECT 1 FROM incidents WHERE id = $1", [input.incidentId]);
  if (!inc.rows[0]) throw ApiError.notFound("Incident not found");
  const { rows } = await query<{ id: string }>(
    "UPDATE alerts SET incident_id=$2 WHERE id=$1 RETURNING id",
    [id, input.incidentId]
  );
  if (!rows[0]) throw ApiError.notFound("Alert not found");
  await recordAudit(actor, {
    action: "alert.linked_incident",
    targetType: "alert",
    targetId: id,
    detail: { incidentId: input.incidentId },
  });
  return getAlert(id);
}

export async function addAlertNote(id: string, input: AlertNote, actor: Actor) {
  const { rows } = await query<{ id: string }>(
    "UPDATE alerts SET note=$2 WHERE id=$1 RETURNING id",
    [id, mask(input.note)]
  );
  if (!rows[0]) throw ApiError.notFound("Alert not found");
  await recordAudit(actor, { action: "alert.note_added", targetType: "alert", targetId: id, detail: {} });
  return getAlert(id);
}

export const ALERT_EXPORT_COLUMNS = [
  { key: "triggeredAt", label: "Triggered" },
  { key: "ruleName", label: "Rule" },
  { key: "type", label: "Type" },
  { key: "severity", label: "Severity" },
  { key: "status", label: "Status" },
  { key: "service", label: "Service" },
  { key: "metricValue", label: "Metric" },
  { key: "threshold", label: "Threshold" },
  { key: "resolvedAt", label: "Resolved" },
];

export async function alertExportRows(q: AlertExport) {
  const { whereSql, params } = alertWhere(q);
  const { rows } = await query<Record<string, unknown>>(
    `SELECT to_char(triggered_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "triggeredAt",
            rule_name AS "ruleName", type, severity, status, service,
            metric_value AS "metricValue", threshold,
            to_char(resolved_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "resolvedAt"
     FROM alerts ${whereSql} ORDER BY triggered_at DESC LIMIT 50000`,
    params
  );
  return rows;
}

// ============================ Evaluation ===================================

interface RuleRow {
  id: string;
  name: string;
  type: string;
  threshold: number | null;
  windowMinutes: number;
  severity: string;
  cooldownMinutes: number;
  lastTriggeredAt: Date | null;
}

interface LiveMetrics {
  pgUp: boolean;
  mongoUp: boolean;
  queuePending: number;
  stuckJobs: number;
  failedJobsToday: number;
  errorRatePct: number;
  avgMs: number;
  smtpFailures: number;
  backupFailed: number;
  memPct: number;
  gatewayDegraded: boolean;
  securityEvents: number;
}

/** Gather the live signals the rule set can be evaluated against (all cheap). */
async function gatherMetrics(): Promise<LiveMetrics> {
  let pgUp = true;
  try {
    await query("SELECT 1");
  } catch {
    pgUp = false;
  }
  const snap = snapshot();
  const errorRatePct = snap.requestsTotal ? (snap.errorsTotal / snap.requestsTotal) * 100 : 0;
  const avgMs = snap.durationCount ? snap.durationSumMs / snap.durationCount : 0;

  const jobs = pgUp
    ? (
        await query<{ pending: number; stuck: number; failedToday: number }>(
          `SELECT
             count(*) FILTER (WHERE status='pending')::int AS pending,
             count(*) FILTER (WHERE status='running' AND locked_at < now() - interval '10 minutes')::int AS stuck,
             count(*) FILTER (WHERE status='failed' AND completed_at >= date_trunc('day', now()))::int AS "failedToday"
           FROM jobs`
        )
      ).rows[0]
    : { pending: 0, stuck: 0, failedToday: 0 };

  const smtp = pgUp
    ? Number(
        (
          await query<{ n: number }>(
            `SELECT count(*)::int AS n FROM invoice_emails
             WHERE status='failed' AND created_at >= now() - interval '24 hours'`
          )
        ).rows[0].n
      )
    : 0;

  const backupFailed = pgUp
    ? Number(
        (
          await query<{ n: number }>(
            `SELECT count(*)::int AS n FROM backups
             WHERE status='failed' AND created_at >= now() - interval '24 hours'`
          )
        ).rows[0].n
      )
    : 0;

  const securityEvents = pgUp
    ? Number(
        (
          await query<{ n: number }>(
            `SELECT count(*)::int AS n FROM platform_audit_log
             WHERE action='auth.login.failed' AND created_at >= now() - interval '24 hours'`
          )
        ).rows[0].n
      )
    : 0;

  const mem = process.memoryUsage();
  const memPct = mem.heapTotal ? Math.round((mem.heapUsed / mem.heapTotal) * 100) : 0;

  let gatewayDegraded = false;
  try {
    const g = await getGatewaySettings();
    gatewayDegraded = g.enabled && !g.configured;
  } catch {
    gatewayDegraded = false;
  }

  return {
    pgUp,
    mongoUp: getMongoDb() !== null,
    queuePending: jobs.pending,
    stuckJobs: jobs.stuck,
    failedJobsToday: jobs.failedToday,
    errorRatePct,
    avgMs,
    smtpFailures: smtp,
    backupFailed,
    memPct,
    gatewayDegraded,
    securityEvents,
  };
}

interface Breach {
  breached: boolean;
  value: number | null;
  service: string;
}

/** Resolve a rule against the metric bundle. `disk_low` is not safely available
 *  in-process → never breaches (honest 'unknown'). */
function resolveBreach(rule: RuleRow, m: LiveMetrics): Breach {
  const num = (value: number, def: number, service: string): Breach => {
    const t = rule.threshold ?? def;
    return { breached: value >= t, value, service };
  };
  const bool = (cond: boolean, service: string): Breach => ({
    breached: cond,
    value: cond ? 1 : 0,
    service,
  });
  switch (rule.type) {
    case "queue_depth_high":
      return num(m.queuePending, 100, "queue");
    case "job_failure_spike":
      return num(m.failedJobsToday, 5, "worker");
    case "error_rate_high":
      return num(Math.round(m.errorRatePct * 100) / 100, 5, "api");
    case "latency_high":
      return num(Math.round(m.avgMs), 2000, "api");
    case "smtp_failures":
      return num(m.smtpFailures, 5, "smtp");
    case "backup_failed":
      return num(m.backupFailed, 1, "backup");
    case "memory_high":
      return num(m.memPct, 90, "memory");
    case "security_event":
      return num(m.securityEvents, 10, "security");
    case "db_down":
    case "api_down":
      return bool(!m.pgUp, rule.type === "db_down" ? "database" : "api");
    case "mongo_down":
      return bool(!m.mongoUp, "mongo");
    case "worker_down":
      return bool(m.stuckJobs > 0, "worker");
    case "scheduler_stalled":
      return bool(m.stuckJobs > 0, "scheduler");
    case "gateway_degraded":
      return bool(m.gatewayDegraded, "gateway");
    case "disk_low":
      return { breached: false, value: null, service: "disk" };
    default:
      return { breached: false, value: null, service: "other" };
  }
}

/**
 * Evaluate every enabled rule; insert a triggered alert when a threshold is
 * breached AND the cooldown has elapsed. Idempotent within a cooldown window.
 */
export async function evaluateAlertRules(): Promise<{ evaluated: number; triggered: number }> {
  const { rows: rules } = await query<RuleRow>(
    `SELECT id, name, type, threshold, window_minutes AS "windowMinutes", severity,
            cooldown_minutes AS "cooldownMinutes", last_triggered_at AS "lastTriggeredAt"
     FROM alert_rules WHERE enabled = true`
  );
  if (rules.length === 0) return { evaluated: 0, triggered: 0 };

  const metrics = await gatherMetrics();
  let triggered = 0;
  const now = Date.now();

  for (const rule of rules) {
    const b = resolveBreach(rule, metrics);
    if (!b.breached) continue;
    // Cooldown gate.
    if (rule.lastTriggeredAt && now - new Date(rule.lastTriggeredAt).getTime() < rule.cooldownMinutes * 60_000) {
      continue;
    }
    const { rows } = await query<{ id: string }>(
      `INSERT INTO alerts (rule_id, rule_name, type, severity, status, service, metric_value, threshold, details, triggered_at)
       VALUES ($1,$2,$3,$4,'triggered',$5,$6,$7,$8::jsonb, now()) RETURNING id`,
      [
        rule.id,
        rule.name,
        rule.type,
        rule.severity,
        b.service,
        b.value,
        rule.threshold,
        JSON.stringify({ windowMinutes: rule.windowMinutes, metric: b.value }),
      ]
    );
    await query("UPDATE alert_rules SET last_triggered_at = now() WHERE id = $1", [rule.id]);
    await recordAudit(SYSTEM_ACTOR, {
      action: "alert.triggered",
      targetType: "alert",
      targetId: rows[0].id,
      detail: { rule: rule.name, type: rule.type, service: b.service, value: b.value, threshold: rule.threshold },
    });
    if (rule.severity === "critical") {
      await recordSecurityEvent({
        action: "alert.triggered",
        targetType: "alert",
        targetId: rows[0].id,
        actorId: null,
        actorEmail: "system",
        actorRole: "system",
        detail: { rule: rule.name, type: rule.type, service: b.service },
        ip: null,
      });
    }
    triggered += 1;
  }
  return { evaluated: rules.length, triggered };
}
