import { gzipSync, gunzipSync } from "node:zlib";
import type { z } from "zod";
import type { PoolClient } from "pg";
import { query, withTransaction } from "../../db/postgres";
import { ApiError } from "../../utils/api-error";
import { env } from "../../config/env";
import { storage, storageMode } from "../../utils/storage";
import { recordBackup, recordRestore } from "../../observability/metrics";
import { enqueue } from "../jobs/jobs.service";
import type {
  createBackupSchema,
  listBackupsQuerySchema,
  restoreSchema,
  updateSettingsSchema,
} from "./backups.schema";

const DUMP_VERSION = 1;

/** Audit actor. id may be null for the system/scheduler (no human acted). */
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

/** Durable platform audit entry (never includes secrets or storage paths). */
async function recordAudit(actor: Actor, input: AuditInput): Promise<void> {
  await query(
    `INSERT INTO platform_audit_log
       (action, target_type, target_id, institution_id, actor_id, actor_email, actor_role, detail, ip)
     VALUES ($1,'backup',$2,$3,$4,$5,$6,$7::jsonb,$8)`,
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

// Public projection — NEVER exposes storage_key (the raw object path).
const PUBLIC_SELECT = `
  id, scope, institution_id AS "institutionId", status, trigger,
  storage_mode AS "storageMode", size_bytes AS "sizeBytes",
  table_count AS "tableCount", row_count AS "rowCount",
  schema_version AS "schemaVersion", error,
  (storage_key IS NOT NULL) AS "hasArtifact",
  created_by AS "createdBy", started_at AS "startedAt",
  completed_at AS "completedAt", created_at AS "createdAt"`;

// --- schema introspection (used by dump + restore) ---

/** Application base tables (everything except the migration ledger). */
async function listAppTables(client: PoolClient): Promise<string[]> {
  const { rows } = await client.query<{ table_name: string }>(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
       AND table_name <> 'schema_migrations'
     ORDER BY table_name`
  );
  return rows.map((r) => r.table_name);
}

async function tablesWithInstitutionId(client: PoolClient): Promise<Set<string>> {
  const { rows } = await client.query<{ table_name: string }>(
    `SELECT table_name FROM information_schema.columns
     WHERE table_schema = 'public' AND column_name = 'institution_id'`
  );
  return new Set(rows.map((r) => r.table_name));
}

async function listSequences(client: PoolClient): Promise<string[]> {
  const { rows } = await client.query<{ sequence_name: string }>(
    `SELECT sequence_name FROM information_schema.sequences WHERE sequence_schema = 'public'`
  );
  return rows.map((r) => r.sequence_name);
}

/** Quote a Postgres identifier we sourced from the catalogue (defence in depth). */
function ident(name: string): string {
  if (!/^[a-z_][a-z0-9_]*$/i.test(name)) {
    throw new Error(`Unsafe identifier: ${name}`);
  }
  return `"${name}"`;
}

interface DumpFile {
  meta: {
    version: number;
    createdAt: string;
    scope: "global" | "institution";
    institutionId: string | null;
    schemaVersion: number;
  };
  tables: string[];
  sequences: Record<string, { last_value: string; is_called: boolean }>;
  data: Record<string, unknown[]>;
}

interface BuiltDump {
  buffer: Buffer;
  tableCount: number;
  rowCount: number;
  schemaVersion: number;
}

/**
 * Build a logical snapshot inside one REPEATABLE READ transaction (a consistent
 * point-in-time view). Rows are captured via to_jsonb so every column type
 * round-trips through json_populate_recordset on restore — no pg_dump needed.
 */
async function buildDump(
  scope: "global" | "institution",
  institutionId: string | null
): Promise<BuiltDump> {
  return withTransaction(async (client) => {
    await client.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");
    const schemaVersion = Number(
      (await client.query<{ n: number }>("SELECT count(*)::int AS n FROM schema_migrations"))
        .rows[0].n
    );
    let tables = await listAppTables(client);
    if (scope === "institution") {
      const scoped = await tablesWithInstitutionId(client);
      tables = tables.filter((t) => scoped.has(t));
    }

    const data: Record<string, unknown[]> = {};
    let rowCount = 0;
    for (const table of tables) {
      const where = scope === "institution" ? ` WHERE institution_id = $1` : "";
      const params = scope === "institution" ? [institutionId] : [];
      const { rows } = await client.query<{ rows: unknown[] }>(
        `SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) AS rows
         FROM ${ident(table)} t${where}`,
        params
      );
      data[table] = rows[0].rows;
      rowCount += rows[0].rows.length;
    }

    // Sequence positions (only meaningful for a full/global restore).
    const sequences: DumpFile["sequences"] = {};
    if (scope === "global") {
      for (const seq of await listSequences(client)) {
        const { rows } = await client.query<{ last_value: string; is_called: boolean }>(
          `SELECT last_value, is_called FROM ${ident(seq)}`
        );
        sequences[seq] = { last_value: String(rows[0].last_value), is_called: rows[0].is_called };
      }
    }

    const dump: DumpFile = {
      meta: { version: DUMP_VERSION, createdAt: new Date().toISOString(), scope, institutionId, schemaVersion },
      tables,
      sequences,
      data,
    };
    const buffer = gzipSync(Buffer.from(JSON.stringify(dump), "utf8"));
    return { buffer, tableCount: tables.length, rowCount, schemaVersion };
  });
}

// --- backup lifecycle ---

interface PerformBackupInput {
  scope: "global" | "institution";
  institutionId: string | null;
  trigger: "manual" | "scheduled";
  actor: Actor;
}

/** Runs a backup end-to-end: record → dump → store → finalise → retention. */
export async function performBackup(input: PerformBackupInput) {
  const { rows } = await query<{ id: string }>(
    `INSERT INTO backups (scope, institution_id, status, trigger, created_by, started_at)
     VALUES ($1,$2,'running',$3,$4, now()) RETURNING id`,
    [input.scope, input.institutionId, input.trigger, input.actor.id]
  );
  const id = rows[0].id;

  try {
    const dump = await buildDump(input.scope, input.institutionId);
    const storageKey = `backups/${id}.json.gz`;
    await storage.put(storageKey, dump.buffer, "application/gzip");

    await query(
      `UPDATE backups SET status='success', storage_mode=$2, storage_key=$3, size_bytes=$4,
         table_count=$5, row_count=$6, schema_version=$7, completed_at=now()
       WHERE id=$1`,
      [id, storageMode, storageKey, dump.buffer.length, dump.tableCount, dump.rowCount, dump.schemaVersion]
    );
    recordBackup("success");
    await recordAudit(input.actor, {
      action: "backup.create",
      targetId: id,
      institutionId: input.institutionId,
      detail: {
        scope: input.scope,
        trigger: input.trigger,
        sizeBytes: dump.buffer.length,
        tableCount: dump.tableCount,
        rowCount: dump.rowCount,
        storageMode,
      },
    });
    await applyRetention(input.scope, input.actor);
    return getBackup(id);
  } catch (err) {
    const safe = (err instanceof Error ? err.message : "Backup failed").slice(0, 500);
    await query("UPDATE backups SET status='failed', error=$2, completed_at=now() WHERE id=$1", [
      id,
      safe,
    ]);
    recordBackup("failed");
    await recordAudit(input.actor, {
      action: "backup.failed",
      targetId: id,
      institutionId: input.institutionId,
      detail: { scope: input.scope, trigger: input.trigger, error: safe },
    });
    throw new ApiError(500, `Backup failed: ${safe}`);
  }
}

export async function createBackup(input: z.infer<typeof createBackupSchema>, actor: Actor) {
  return performBackup({
    scope: input.scope,
    institutionId: input.scope === "institution" ? input.institutionId! : null,
    trigger: "manual",
    actor,
  });
}

export async function listBackups(filters: z.infer<typeof listBackupsQuerySchema>) {
  const params: unknown[] = [];
  const where: string[] = [];
  if (filters.scope) {
    params.push(filters.scope);
    where.push(`scope = $${params.length}`);
  }
  if (filters.status) {
    params.push(filters.status);
    where.push(`status = $${params.length}`);
  }
  if (filters.institutionId) {
    params.push(filters.institutionId);
    where.push(`institution_id = $${params.length}`);
  }
  params.push(filters.limit ?? 100);
  const { rows } = await query(
    `SELECT ${PUBLIC_SELECT} FROM backups
     ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
     ORDER BY created_at DESC LIMIT $${params.length}`,
    params
  );
  return rows;
}

export async function getBackup(id: string) {
  const { rows } = await query(`SELECT ${PUBLIC_SELECT} FROM backups WHERE id = $1`, [id]);
  if (!rows[0]) throw ApiError.notFound("Backup not found");
  return rows[0];
}

/** Internal: fetch the storage key (never exposed via the API). */
async function getBackupInternal(id: string) {
  const { rows } = await query<{
    id: string;
    scope: string;
    status: string;
    storageKey: string | null;
    schemaVersion: number | null;
    institutionId: string | null;
  }>(
    `SELECT id, scope, status, storage_key AS "storageKey",
            schema_version AS "schemaVersion", institution_id AS "institutionId"
     FROM backups WHERE id = $1`,
    [id]
  );
  if (!rows[0]) throw ApiError.notFound("Backup not found");
  return rows[0];
}

export async function downloadBackup(id: string, actor: Actor) {
  const backup = await getBackupInternal(id);
  if (backup.status !== "success" || !backup.storageKey) {
    throw ApiError.badRequest("This backup has no downloadable artifact");
  }
  const buffer = await storage.get(backup.storageKey);
  await recordAudit(actor, {
    action: "backup.download",
    targetId: id,
    institutionId: backup.institutionId,
    detail: { scope: backup.scope, sizeBytes: buffer.length },
  });
  const stamp = new Date().toISOString().slice(0, 10);
  return { buffer, filename: `backup-${id}-${stamp}.json.gz` };
}

export async function deleteBackup(id: string, actor: Actor) {
  const backup = await getBackupInternal(id);
  if (backup.storageKey) await storage.remove(backup.storageKey).catch(() => undefined);
  await query("DELETE FROM backups WHERE id = $1", [id]);
  await recordAudit(actor, {
    action: "backup.delete",
    targetId: id,
    institutionId: backup.institutionId,
    detail: { scope: backup.scope },
  });
  return { deleted: true, id };
}

// --- restore ---

/** Read + decode a backup artifact into its DumpFile. */
async function loadDump(storageKey: string): Promise<DumpFile> {
  const buffer = await storage.get(storageKey);
  return JSON.parse(gunzipSync(buffer).toString("utf8")) as DumpFile;
}

/** Non-destructive metadata preview of what a restore would load. */
export async function restorePreview(id: string) {
  const backup = await getBackupInternal(id);
  if (backup.status !== "success" || !backup.storageKey) {
    throw ApiError.badRequest("This backup has no artifact to preview");
  }
  const dump = await loadDump(backup.storageKey);
  const currentVersion = Number(
    (await query<{ n: number }>("SELECT count(*)::int AS n FROM schema_migrations")).rows[0].n
  );
  const tables = dump.tables.map((t) => ({ name: t, rowCount: (dump.data[t] ?? []).length }));
  return {
    backupId: id,
    scope: backup.scope,
    createdAt: dump.meta.createdAt,
    schemaVersion: dump.meta.schemaVersion,
    currentSchemaVersion: currentVersion,
    schemaMatches: dump.meta.schemaVersion === currentVersion,
    restorable: backup.scope === "global" && dump.meta.schemaVersion === currentVersion,
    tableCount: tables.length,
    totalRows: tables.reduce((s, t) => s + t.rowCount, 0),
    tables,
  };
}

/**
 * Restore the whole database from a global backup. Destructive and guarded:
 * super-admin only (route), explicit confirmation always, and `force` required in
 * production. Runs in one transaction with FK checks/triggers disabled so tables
 * reload in any order; a failure rolls everything back. Every attempt is audited.
 */
export async function restoreBackup(
  id: string,
  input: z.infer<typeof restoreSchema>,
  actor: Actor
) {
  const backup = await getBackupInternal(id);

  if (backup.status !== "success" || !backup.storageKey) {
    throw ApiError.badRequest("Only a successful backup with an artifact can be restored");
  }
  if (backup.scope !== "global") {
    throw ApiError.badRequest("Only global backups can be restored");
  }
  if (!input.confirm) {
    throw ApiError.badRequest("Restore requires explicit confirmation (confirm=true)");
  }
  if (env.isProduction && !input.force) {
    throw ApiError.badRequest("Restoring in production requires force=true");
  }

  // Log the attempt up front (survives a failed/rolled-back restore).
  await recordAudit(actor, {
    action: "restore.start",
    targetId: id,
    institutionId: null,
    detail: { force: input.force, production: env.isProduction },
  });

  try {
    const dump = await loadDump(backup.storageKey);
    const currentVersion = Number(
      (await query<{ n: number }>("SELECT count(*)::int AS n FROM schema_migrations")).rows[0].n
    );
    if (dump.meta.schemaVersion !== currentVersion) {
      throw new Error(
        `schema version mismatch (backup ${dump.meta.schemaVersion} vs current ${currentVersion})`
      );
    }

    let restoredRows = 0;
    await withTransaction(async (client) => {
      // Disable FK checks + triggers for this transaction only, so tables can be
      // truncated/reloaded in any order. Requires elevated DB privileges.
      await client.query("SET LOCAL session_replication_role = replica");
      const tables = await listAppTables(client);
      const quoted = tables.map(ident).join(", ");
      await client.query(`TRUNCATE ${quoted} RESTART IDENTITY CASCADE`);

      for (const table of dump.tables) {
        const rows = dump.data[table] ?? [];
        if (rows.length === 0) continue;
        await client.query(
          `INSERT INTO ${ident(table)}
             SELECT * FROM json_populate_recordset(NULL::${ident(table)}, $1::json)`,
          [JSON.stringify(rows)]
        );
        restoredRows += rows.length;
      }

      for (const [seq, val] of Object.entries(dump.sequences)) {
        await client.query("SELECT setval($1::regclass, $2::bigint, $3::boolean)", [
          seq,
          val.last_value,
          val.is_called,
        ]);
      }
    });

    recordRestore("success");
    await recordAudit(actor, {
      action: "restore.success",
      targetId: id,
      institutionId: null,
      detail: { tableCount: dump.tables.length, rowCount: restoredRows },
    });
    return { restored: true, backupId: id, tableCount: dump.tables.length, rowCount: restoredRows };
  } catch (err) {
    const safe = (err instanceof Error ? err.message : "Restore failed").slice(0, 500);
    recordRestore("failed");
    await recordAudit(actor, {
      action: "restore.failed",
      targetId: id,
      institutionId: null,
      detail: { error: safe },
    });
    throw new ApiError(500, `Restore failed: ${safe}`);
  }
}

// --- settings + retention ---

const SETTINGS_SELECT = `
  retention_count AS "retentionCount", schedule_enabled AS "scheduleEnabled",
  schedule_frequency AS "scheduleFrequency", schedule_run_time AS "scheduleRunTime",
  next_run_at AS "nextRunAt", updated_at AS "updatedAt"`;

export async function getSettings() {
  // The settings row is a migration-seeded singleton; recreate it defensively if
  // it is ever missing so reads/writes never hit an empty table.
  await query("INSERT INTO backup_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING");
  const { rows } = await query(`SELECT ${SETTINGS_SELECT} FROM backup_settings WHERE id = 1`);
  return rows[0];
}

/** Next run time (UTC) for a frequency + HH:MM, strictly after `from`. */
export function computeNextBackupRun(
  frequency: "daily" | "weekly" | "monthly",
  runTime: string,
  from: Date = new Date()
): Date {
  const [h, m] = runTime.split(":").map(Number);
  const next = new Date(
    Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate(), h, m, 0, 0)
  );
  if (next <= from) {
    if (frequency === "monthly") next.setUTCMonth(next.getUTCMonth() + 1);
    else if (frequency === "weekly") next.setUTCDate(next.getUTCDate() + 7);
    else next.setUTCDate(next.getUTCDate() + 1);
  }
  return next;
}

export async function updateSettings(input: z.infer<typeof updateSettingsSchema>, actor: Actor) {
  const sets: string[] = [];
  const params: unknown[] = [];
  const map: Record<string, string> = {
    retentionCount: "retention_count",
    scheduleEnabled: "schedule_enabled",
    scheduleFrequency: "schedule_frequency",
    scheduleRunTime: "schedule_run_time",
  };
  for (const [field, column] of Object.entries(map)) {
    if ((input as Record<string, unknown>)[field] !== undefined) {
      params.push((input as Record<string, unknown>)[field]);
      sets.push(`${column} = $${params.length}`);
    }
  }

  // Recompute next_run_at whenever the schedule is touched.
  const current = (await getSettings()) as {
    scheduleEnabled: boolean;
    scheduleFrequency: "daily" | "weekly" | "monthly";
    scheduleRunTime: string;
  };
  const enabled = input.scheduleEnabled ?? current.scheduleEnabled;
  const frequency = input.scheduleFrequency ?? current.scheduleFrequency;
  const runTime = input.scheduleRunTime ?? current.scheduleRunTime;
  if (
    input.scheduleEnabled !== undefined ||
    input.scheduleFrequency !== undefined ||
    input.scheduleRunTime !== undefined
  ) {
    params.push(enabled ? computeNextBackupRun(frequency, runTime) : null);
    sets.push(`next_run_at = $${params.length}`);
  }

  params.push(actor.id);
  sets.push(`updated_by = $${params.length}`);
  await query(`UPDATE backup_settings SET ${sets.join(", ")} WHERE id = 1`, params);

  await recordAudit(actor, {
    action: "backup.settings_update",
    targetId: null,
    institutionId: null,
    detail: { ...input },
  });
  return getSettings();
}

/**
 * Retention: keep only the latest N successful backups of a scope; delete older
 * ones (artifact + row). When retention_count is NULL retention is OFF and
 * NOTHING is ever deleted.
 */
export async function applyRetention(scope: "global" | "institution", actor: Actor) {
  const settings = (await getSettings()) as { retentionCount: number | null };
  if (settings.retentionCount == null) return { deleted: 0 };

  const { rows } = await query<{ id: string; storageKey: string | null }>(
    `SELECT id, storage_key AS "storageKey" FROM backups
     WHERE status = 'success' AND scope = $1
     ORDER BY created_at DESC OFFSET $2`,
    [scope, settings.retentionCount]
  );
  for (const row of rows) {
    if (row.storageKey) await storage.remove(row.storageKey).catch(() => undefined);
    await query("DELETE FROM backups WHERE id = $1", [row.id]);
  }
  if (rows.length > 0) {
    await recordAudit(actor, {
      action: "backup.retention",
      targetId: null,
      institutionId: null,
      detail: { scope, deleted: rows.length, keep: settings.retentionCount },
    });
  }
  return { deleted: rows.length };
}

// --- scheduled automation (driven by the job worker) ---

/** Enqueue a global backup job when the schedule is due; advance next_run_at.
 *  Deduped per window so a missed/overlapping tick never double-runs. */
export async function enqueueDueScheduledBackups() {
  const settings = (await getSettings()) as {
    scheduleEnabled: boolean;
    scheduleFrequency: "daily" | "weekly" | "monthly";
    scheduleRunTime: string;
    nextRunAt: string | null;
  };
  if (!settings.scheduleEnabled || !settings.nextRunAt) return { due: 0, enqueued: 0 };
  if (new Date(settings.nextRunAt) > new Date()) return { due: 0, enqueued: 0 };

  const job = await enqueue({
    type: "scheduled_backup",
    payload: { scope: "global" },
    dedupeKey: `backup:${new Date(settings.nextRunAt).toISOString()}`,
  });
  await query("UPDATE backup_settings SET next_run_at = $1 WHERE id = 1", [
    computeNextBackupRun(settings.scheduleFrequency, settings.scheduleRunTime),
  ]);
  return { due: 1, enqueued: job ? 1 : 0 };
}

/** Worker entry point for the `scheduled_backup` job type. */
export async function runScheduledBackup() {
  return performBackup({ scope: "global", institutionId: null, trigger: "scheduled", actor: SYSTEM_ACTOR });
}
