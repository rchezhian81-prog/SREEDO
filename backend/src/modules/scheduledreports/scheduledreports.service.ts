import type { z } from "zod";
import { query } from "../../db/postgres";
import { ApiError } from "../../utils/api-error";
import type { UserRole } from "../../types";
import { permissionsForRole } from "../../middleware/permissions";
import { getReport, toCsv } from "../reportcenter/reportcenter.service";
import { tablePdf } from "../reportcenter/reportcenter.pdf";
import { getSaved, runSaved } from "../customreports/customreports.service";
import { dispatchExternal } from "../communication/communication.channels";
import type {
  createScheduleSchema,
  updateScheduleSchema,
} from "./scheduledreports.schema";

interface Actor {
  id: string;
  role: UserRole;
}

const SELECT = `
  sr.id, sr.report_id AS "reportId", cr.name AS "reportName",
  sr.name, sr.frequency, sr.run_time AS "runTime", sr.timezone,
  sr.day_of_week AS "dayOfWeek", sr.day_of_month AS "dayOfMonth",
  sr.recipients, sr.channels, sr.export_format AS "exportFormat",
  sr.enabled, sr.last_run_at AS "lastRunAt", sr.next_run_at AS "nextRunAt",
  sr.created_by AS "createdBy", sr.created_at AS "createdAt", sr.updated_at AS "updatedAt"`;

const RUN_SELECT = `
  id, schedule_id AS "scheduleId", status, trigger,
  started_at AS "startedAt", completed_at AS "completedAt",
  error_message AS "errorMessage", export_format AS "exportFormat",
  export_bytes AS "exportBytes", row_count AS "rowCount",
  recipient_count AS "recipientCount", delivery_status AS "deliveryStatus",
  triggered_by AS "triggeredBy", created_at AS "createdAt"`;

// --- Scheduling math (run_time interpreted as UTC HH:MM; tz stored for intent) ---

export function computeNextRun(
  frequency: string,
  runTime: string,
  dayOfWeek: number | null,
  dayOfMonth: number | null,
  from: Date = new Date()
): Date {
  const [h, m] = runTime.split(":").map(Number);
  const next = new Date(from);
  next.setUTCHours(h, m, 0, 0);
  if (frequency === "daily") {
    if (next <= from) next.setUTCDate(next.getUTCDate() + 1);
  } else if (frequency === "weekly") {
    const target = dayOfWeek ?? 1;
    let delta = (target - next.getUTCDay() + 7) % 7;
    if (delta === 0 && next <= from) delta = 7;
    next.setUTCDate(next.getUTCDate() + delta);
  } else {
    const dom = dayOfMonth ?? 1;
    next.setUTCDate(dom);
    if (next <= from) {
      next.setUTCMonth(next.getUTCMonth() + 1);
      next.setUTCDate(dom);
    }
  }
  return next;
}

// --- Validation helpers ---

/** The saved report must exist, be accessible to the actor, and the actor must
 *  hold its underlying permission — so a schedule can never be created for data
 *  the creator can't see. Returns the report key. */
async function assertReportUsable(reportId: string, actor: Actor, institutionId: string) {
  await getSaved(reportId, actor, institutionId); // 404 if missing / private-not-mine
  await runSaved(reportId, actor, institutionId); // 403 if lacking the underlying permission
}

async function validateRecipients(recipients: string[], institutionId: string) {
  if (recipients.length === 0) return;
  const { rows } = await query<{ id: string }>(
    `SELECT id FROM users WHERE institution_id = $1 AND id = ANY($2::uuid[])`,
    [institutionId, recipients]
  );
  if (rows.length !== new Set(recipients).size) {
    throw ApiError.badRequest("One or more recipients are not users of this institution");
  }
}

// --- CRUD ---

export async function listSchedules(institutionId: string) {
  const { rows } = await query(
    `SELECT ${SELECT},
            (SELECT row_to_json(r) FROM (
               SELECT status, completed_at AS "completedAt"
               FROM scheduled_report_runs run
               WHERE run.schedule_id = sr.id
               ORDER BY run.created_at DESC LIMIT 1) r) AS "lastRun"
     FROM scheduled_reports sr
     LEFT JOIN custom_reports cr ON cr.id = sr.report_id
     WHERE sr.institution_id = $1 ORDER BY sr.created_at DESC LIMIT 500`,
    [institutionId]
  );
  return rows;
}

export async function getSchedule(id: string, institutionId: string) {
  const { rows } = await query(
    `SELECT ${SELECT} FROM scheduled_reports sr
     LEFT JOIN custom_reports cr ON cr.id = sr.report_id
     WHERE sr.id = $1 AND sr.institution_id = $2`,
    [id, institutionId]
  );
  if (!rows[0]) throw ApiError.notFound("Scheduled report not found");
  return rows[0];
}

export async function createSchedule(
  input: z.infer<typeof createScheduleSchema>,
  actor: Actor,
  institutionId: string
) {
  await assertReportUsable(input.reportId, actor, institutionId);
  const recipients = input.recipients ?? [];
  await validateRecipients(recipients, institutionId);
  const runTime = input.runTime ?? "06:00";
  const enabled = input.enabled ?? true;
  const nextRun = enabled
    ? computeNextRun(input.frequency, runTime, input.dayOfWeek ?? null, input.dayOfMonth ?? null)
    : null;
  const { rows } = await query(
    `INSERT INTO scheduled_reports
       (institution_id, report_id, name, frequency, run_time, timezone, day_of_week,
        day_of_month, recipients, channels, export_format, enabled, next_run_at, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11,$12,$13,$14)
     RETURNING id`,
    [
      institutionId,
      input.reportId,
      input.name,
      input.frequency,
      runTime,
      input.timezone ?? "UTC",
      input.dayOfWeek ?? null,
      input.dayOfMonth ?? null,
      JSON.stringify(recipients),
      JSON.stringify(input.channels ?? ["in_app"]),
      input.exportFormat ?? "pdf",
      enabled,
      nextRun,
      actor.id,
    ]
  );
  return getSchedule(rows[0].id, institutionId);
}

export async function updateSchedule(
  id: string,
  input: z.infer<typeof updateScheduleSchema>,
  actor: Actor,
  institutionId: string
) {
  const existing = await getSchedule(id, institutionId);
  if (input.reportId && input.reportId !== existing.reportId) {
    await assertReportUsable(input.reportId, actor, institutionId);
  }
  if (input.recipients) await validateRecipients(input.recipients, institutionId);

  const frequency = input.frequency ?? existing.frequency;
  const runTime = input.runTime ?? existing.runTime;
  const dayOfWeek = input.dayOfWeek !== undefined ? input.dayOfWeek : existing.dayOfWeek;
  const dayOfMonth = input.dayOfMonth !== undefined ? input.dayOfMonth : existing.dayOfMonth;
  const enabled = input.enabled !== undefined ? input.enabled : existing.enabled;
  const nextRun = enabled ? computeNextRun(frequency, runTime, dayOfWeek, dayOfMonth) : null;

  const { rows } = await query(
    `UPDATE scheduled_reports SET
       report_id = COALESCE($3, report_id),
       name = COALESCE($4, name),
       frequency = $5,
       run_time = $6,
       timezone = COALESCE($7, timezone),
       day_of_week = $8,
       day_of_month = $9,
       recipients = COALESCE($10::jsonb, recipients),
       channels = COALESCE($11::jsonb, channels),
       export_format = COALESCE($12, export_format),
       enabled = $13,
       next_run_at = $14
     WHERE id = $1 AND institution_id = $2
     RETURNING id`,
    [
      id,
      institutionId,
      input.reportId ?? null,
      input.name ?? null,
      frequency,
      runTime,
      input.timezone ?? null,
      dayOfWeek,
      dayOfMonth,
      input.recipients ? JSON.stringify(input.recipients) : null,
      input.channels ? JSON.stringify(input.channels) : null,
      input.exportFormat ?? null,
      enabled,
      nextRun,
    ]
  );
  if (!rows[0]) throw ApiError.notFound("Scheduled report not found");
  return getSchedule(id, institutionId);
}

export async function deleteSchedule(id: string, institutionId: string) {
  const { rowCount } = await query(
    "DELETE FROM scheduled_reports WHERE id = $1 AND institution_id = $2",
    [id, institutionId]
  );
  if (!rowCount) throw ApiError.notFound("Scheduled report not found");
}

// --- Run history ---

export async function listRuns(scheduleId: string, institutionId: string, limit = 50) {
  await getSchedule(scheduleId, institutionId); // tenant guard / 404
  const { rows } = await query(
    `SELECT ${RUN_SELECT} FROM scheduled_report_runs
     WHERE schedule_id = $1 AND institution_id = $2
     ORDER BY created_at DESC LIMIT $3`,
    [scheduleId, institutionId, limit]
  );
  return rows;
}

async function getRun(id: string, institutionId: string) {
  const { rows } = await query(
    `SELECT ${RUN_SELECT} FROM scheduled_report_runs WHERE id = $1 AND institution_id = $2`,
    [id, institutionId]
  );
  return rows[0];
}

// --- Execution + delivery ---

/** Recipients who actually hold the underlying report's permission (no leakage). */
async function authorizedRecipients(
  recipients: string[],
  permission: string,
  institutionId: string
): Promise<string[]> {
  if (recipients.length === 0) return [];
  const { rows } = await query<{ id: string; role: UserRole }>(
    `SELECT id, role FROM users WHERE institution_id = $1 AND id = ANY($2::uuid[])`,
    [institutionId, recipients]
  );
  const out: string[] = [];
  for (const u of rows) {
    if (u.role === "super_admin") {
      out.push(u.id);
      continue;
    }
    const perms = await permissionsForRole(u.role);
    if (perms.includes(permission)) out.push(u.id);
  }
  return out;
}

async function deliver(
  schedule: { id: string; name: string; channels: string[] },
  reportName: string,
  rowCount: number,
  recipients: string[],
  subjectUserId: string | null,
  institutionId: string
): Promise<{ count: number; status: string }> {
  if (recipients.length === 0) return { count: 0, status: "no authorized recipients" };
  const subject = `Scheduled report: ${schedule.name}`;
  const body = `Your scheduled report "${reportName}" is ready (${rowCount} row${rowCount === 1 ? "" : "s"}).`;
  const parts: string[] = [];

  if (schedule.channels.includes("in_app")) {
    const { rows } = await query<{ id: string }>(
      `INSERT INTO messages (institution_id, sender_id, category, subject, body, audience_type, audience_ref)
       VALUES ($1,$2,'scheduled_report',$3,$4,'scheduled_report',$5) RETURNING id`,
      [institutionId, subjectUserId, subject, body, schedule.id]
    );
    await query(
      `INSERT INTO message_recipients (institution_id, message_id, user_id)
       SELECT $1, $2, unnest($3::uuid[]) ON CONFLICT (message_id, user_id) DO NOTHING`,
      [institutionId, rows[0].id, recipients]
    );
    parts.push(`in_app: ${recipients.length}`);
  }

  if (schedule.channels.includes("email")) {
    // Best-effort: degrades to a no-op when SMTP is unconfigured (never throws).
    await dispatchExternal(institutionId, recipients, subject, body);
    parts.push("email: dispatched");
  }

  return { count: recipients.length, status: parts.join("; ") || "generated" };
}

/** Generates the report (enforcing the actor's access + the underlying report's
 *  permission), then delivers to authorized recipients. Always records a run row. */
async function execute(
  schedule: Record<string, unknown> & {
    id: string;
    reportId: string | null;
    name: string;
    recipients: string[];
    channels: string[];
    exportFormat: string;
  },
  actor: Actor,
  trigger: "manual" | "scheduled",
  triggeredBy: string | null,
  institutionId: string
) {
  const { rows: created } = await query<{ id: string }>(
    `INSERT INTO scheduled_report_runs (institution_id, schedule_id, status, trigger, started_at, triggered_by)
     VALUES ($1,$2,'running',$3,now(),$4) RETURNING id`,
    [institutionId, schedule.id, trigger, triggeredBy]
  );
  const runId = created[0].id;

  try {
    if (!schedule.reportId) throw ApiError.badRequest("The saved report no longer exists");
    // Enforces the actor's access + the underlying report's own permission.
    const table = await runSaved(schedule.reportId, actor, institutionId);
    const rowCount = table.rows.length;

    const formats = schedule.exportFormat === "both" ? ["csv", "pdf"] : [schedule.exportFormat];
    let bytes = 0;
    for (const fmt of formats) {
      if (fmt === "pdf") {
        bytes += (await tablePdf(table.title, table.columns, table.rows)).length;
      } else {
        bytes += Buffer.byteLength(toCsv(table.columns, table.rows));
      }
    }

    const { rows: keyRows } = await query<{ report_key: string }>(
      "SELECT report_key FROM custom_reports WHERE id = $1 AND institution_id = $2",
      [schedule.reportId, institutionId]
    );
    const permission = getReport(keyRows[0].report_key).permission;
    const recipients = await authorizedRecipients(schedule.recipients, permission, institutionId);
    const delivery = await deliver(schedule, table.title, rowCount, recipients, triggeredBy, institutionId);

    await query(
      `UPDATE scheduled_report_runs SET status='success', completed_at=now(),
         export_format=$2, export_bytes=$3, row_count=$4, recipient_count=$5, delivery_status=$6
       WHERE id=$1`,
      [runId, schedule.exportFormat, bytes, rowCount, delivery.count, delivery.status]
    );
  } catch (err) {
    await query(
      `UPDATE scheduled_report_runs SET status='failed', completed_at=now(), error_message=$2 WHERE id=$1`,
      [runId, err instanceof Error ? err.message : "Run failed"]
    );
  }

  await query("UPDATE scheduled_reports SET last_run_at=now() WHERE id=$1 AND institution_id=$2", [
    schedule.id,
    institutionId,
  ]);
  return getRun(runId, institutionId);
}

/** Manual run: executes as the triggering user (you can only generate what you can see). */
export async function runNow(id: string, actor: Actor, institutionId: string) {
  const schedule = await getSchedule(id, institutionId);
  return execute(
    schedule as never,
    actor,
    "manual",
    actor.id,
    institutionId
  );
}

/** Processes this tenant's due schedules, each as its CREATOR (the scheduler tick). */
export async function runDue(institutionId: string) {
  const { rows: due } = await query<Record<string, unknown> & {
    id: string;
    reportId: string | null;
    createdBy: string | null;
    frequency: string;
    runTime: string;
    dayOfWeek: number | null;
    dayOfMonth: number | null;
  }>(
    `SELECT ${SELECT} FROM scheduled_reports sr
     LEFT JOIN custom_reports cr ON cr.id = sr.report_id
     WHERE sr.institution_id = $1 AND sr.enabled = true
       AND sr.next_run_at IS NOT NULL AND sr.next_run_at <= now()
     ORDER BY sr.next_run_at`,
    [institutionId]
  );

  let processed = 0;
  let skipped = 0;
  for (const schedule of due) {
    const creator = schedule.createdBy
      ? await query<{ role: UserRole }>("SELECT role FROM users WHERE id = $1", [schedule.createdBy])
      : { rows: [] as { role: UserRole }[] };
    const role = creator.rows[0]?.role;
    if (!role) {
      // No valid creator to enforce permissions against — record a skip, don't deliver.
      await query(
        `INSERT INTO scheduled_report_runs (institution_id, schedule_id, status, trigger, started_at, completed_at, error_message)
         VALUES ($1,$2,'skipped','scheduled',now(),now(),'No valid creator to authorise the run')`,
        [institutionId, schedule.id]
      );
      skipped += 1;
    } else {
      await execute(schedule as never, { id: schedule.createdBy!, role }, "scheduled", schedule.createdBy, institutionId);
      processed += 1;
    }
    await query(
      "UPDATE scheduled_reports SET next_run_at=$2 WHERE id=$1",
      [schedule.id, computeNextRun(schedule.frequency, schedule.runTime, schedule.dayOfWeek, schedule.dayOfMonth)]
    );
  }
  return { processed, skipped, due: due.length };
}
