import { createHash } from "node:crypto";
import { gzipSync, gunzipSync } from "node:zlib";
import type { z } from "zod";
import type { PoolClient } from "pg";
import { query, withTransaction } from "../../db/postgres";
import { ApiError } from "../../utils/api-error";
import { env } from "../../config/env";
import { deliverMail } from "../../utils/mailer";
import {
  backupWriteStorage,
  backupStorageFor,
  storageConfigured,
  type StorageMode,
} from "../../utils/storage";
import { recordBackup, recordRestore } from "../../observability/metrics";
import { enqueue } from "../jobs/jobs.service";
import type {
  createBackupSchema,
  historyQuerySchema,
  listBackupsQuerySchema,
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

/** Durable platform audit entry (never includes secrets or storage paths). Because
 *  `backup.*` / `restore.*` actions are already classified high-risk (and restores
 *  critical) by the audit + security consoles, one write here surfaces the event in
 *  both the Audit Console and the Security Center high-risk feed. */
export async function recordAudit(actor: Actor, input: AuditInput): Promise<void> {
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

// Public projection — NEVER exposes storage_key (the raw object path). Offsite is
// DERIVED from storage_mode ('s3' = an offsite copy exists); encryption is surfaced
// separately from settings (no per-artifact key material is ever stored/returned).
const PUBLIC_SELECT = `
  id, scope, institution_id AS "institutionId", status, trigger,
  storage_mode AS "storageMode", size_bytes AS "sizeBytes",
  table_count AS "tableCount", row_count AS "rowCount",
  schema_version AS "schemaVersion", error, logs_summary AS "logsSummary",
  checksum, checksum_algo AS "checksumAlgo", checksum_status AS "checksumStatus",
  checksum_verified_at AS "checksumVerifiedAt", checksum_verified_by AS "checksumVerifiedBy",
  (storage_mode = 's3') AS "offsite",
  archived_at AS "archivedAt", archived_by AS "archivedBy", archive_reason AS "archiveReason",
  (storage_key IS NOT NULL) AS "hasArtifact",
  created_by AS "createdBy", started_at AS "startedAt",
  completed_at AS "completedAt", created_at AS "createdAt"`;

/** SHA-256 hex digest of a buffer (the backup artifact integrity checksum). */
function sha256(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

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
  trigger: "manual" | "scheduled" | "pre_deploy" | "pre_restore";
  actor: Actor;
}

/** Runs a backup end-to-end: record → dump → checksum → store → finalise →
 *  retention. On failure the row is marked failed (metadata retained) and a
 *  best-effort failure alert is dispatched. */
export async function performBackup(input: PerformBackupInput) {
  const { rows } = await query<{ id: string }>(
    `INSERT INTO backups (scope, institution_id, status, trigger, created_by, started_at)
     VALUES ($1,$2,'running',$3,$4, now()) RETURNING id`,
    [input.scope, input.institutionId, input.trigger, input.actor.id]
  );
  const id = rows[0].id;

  try {
    const dump = await buildDump(input.scope, input.institutionId);
    const checksum = sha256(dump.buffer);
    const storageKey = `backups/${id}.json.gz`;
    // Backups go to local disk unless offsite is EXPLICITLY enabled (default off) —
    // configuring S3 for documents must never silently send DB dumps offsite.
    const settings = (await getSettings()) as { offsiteEnabled?: boolean };
    const backend = backupWriteStorage(Boolean(settings.offsiteEnabled));
    const mode = backend.mode;
    await backend.put(storageKey, dump.buffer, "application/gzip");
    const sizeKb = (dump.buffer.length / 1024).toFixed(1);
    const logsSummary =
      `${input.scope} backup via ${input.trigger}: ${dump.tableCount} tables, ` +
      `${dump.rowCount} rows, ${sizeKb} KB, sha256 computed, stored to ${mode}.`;

    await query(
      `UPDATE backups SET status='success', storage_mode=$2, storage_key=$3, size_bytes=$4,
         table_count=$5, row_count=$6, schema_version=$7, checksum=$8,
         checksum_status='verified', checksum_verified_at=now(), checksum_verified_by=$9,
         logs_summary=$10, completed_at=now()
       WHERE id=$1`,
      [id, mode, storageKey, dump.buffer.length, dump.tableCount, dump.rowCount,
       dump.schemaVersion, checksum, input.actor.id, logsSummary]
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
        storageMode: mode,
        checksumAlgo: "sha256",
      },
    });
    await applyRetention(input.scope, input.actor);
    return getBackup(id);
  } catch (err) {
    const safe = (err instanceof Error ? err.message : "Backup failed").slice(0, 500);
    await query(
      "UPDATE backups SET status='failed', error=$2, logs_summary=$3, completed_at=now() WHERE id=$1",
      [id, safe, `${input.scope} backup via ${input.trigger} FAILED: ${safe}`]
    );
    recordBackup("failed");
    await recordAudit(input.actor, {
      action: "backup.failed",
      targetId: id,
      institutionId: input.institutionId,
      detail: { scope: input.scope, trigger: input.trigger, error: safe },
    });
    // Best-effort alert; never allowed to mask the original failure.
    await sendBackupFailureAlert(id, input, safe).catch(() => undefined);
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

/** Build the WHERE clause + params shared by the paginated history + its export. */
function historyWhere(filters: z.infer<typeof historyQuerySchema>): { sql: string; params: unknown[] } {
  const params: unknown[] = [];
  const where: string[] = [];
  if (filters.dateFrom) {
    params.push(filters.dateFrom);
    where.push(`created_at >= $${params.length}`);
  }
  if (filters.dateTo) {
    params.push(filters.dateTo);
    where.push(`created_at < ($${params.length}::date + 1)`);
  }
  if (filters.status) {
    params.push(filters.status);
    where.push(`status = $${params.length}`);
  }
  if (filters.scope) {
    params.push(filters.scope);
    where.push(`scope = $${params.length}`);
  }
  if (filters.trigger) {
    params.push(filters.trigger);
    where.push(`trigger = $${params.length}`);
  }
  if (filters.createdBy) {
    params.push(filters.createdBy);
    where.push(`created_by = $${params.length}`);
  }
  return { sql: where.length ? `WHERE ${where.join(" AND ")}` : "", params };
}

/** Paginated, filterable backup run history. */
export async function listBackupHistory(filters: z.infer<typeof historyQuerySchema>) {
  const { sql, params } = historyWhere(filters);
  const sortCol =
    filters.sort === "status" ? "status" : filters.sort === "sizeBytes" ? "size_bytes" : "created_at";
  const order = filters.order === "asc" ? "ASC" : "DESC";
  const total = Number(
    (await query<{ n: number }>(`SELECT count(*)::int AS n FROM backups ${sql}`, params)).rows[0].n
  );
  const pageParams = [...params, filters.pageSize, (filters.page - 1) * filters.pageSize];
  const { rows } = await query(
    `SELECT ${PUBLIC_SELECT} FROM backups ${sql}
     ORDER BY ${sortCol} ${order} NULLS LAST
     LIMIT $${pageParams.length - 1} OFFSET $${pageParams.length}`,
    pageParams
  );
  return { rows, total, page: filters.page, pageSize: filters.pageSize };
}

/** Rows for a CSV/XLSX export of the history (masked projection; no storage paths). */
export async function backupHistoryExportRows(filters: z.infer<typeof historyQuerySchema>) {
  const { sql, params } = historyWhere(filters);
  const { rows } = await query(
    `SELECT ${PUBLIC_SELECT} FROM backups ${sql} ORDER BY created_at DESC LIMIT 50000`,
    params
  );
  return rows as Record<string, unknown>[];
}

export async function getBackup(id: string) {
  const { rows } = await query(`SELECT ${PUBLIC_SELECT} FROM backups WHERE id = $1`, [id]);
  if (!rows[0]) throw ApiError.notFound("Backup not found");
  return rows[0];
}

/** Internal: fetch the storage key + integrity fields (never exposed via the API). */
async function getBackupInternal(id: string) {
  const { rows } = await query<{
    id: string;
    scope: string;
    status: string;
    trigger: string;
    storageKey: string | null;
    storageMode: StorageMode;
    checksum: string | null;
    checksumStatus: string;
    schemaVersion: number | null;
    institutionId: string | null;
  }>(
    `SELECT id, scope, status, trigger, storage_key AS "storageKey",
            storage_mode AS "storageMode", checksum,
            checksum_status AS "checksumStatus", schema_version AS "schemaVersion",
            institution_id AS "institutionId"
     FROM backups WHERE id = $1`,
    [id]
  );
  if (!rows[0]) throw ApiError.notFound("Backup not found");
  return rows[0];
}

/**
 * Verify a backup's integrity: re-read the stored artifact, recompute its SHA-256
 * and compare to the checksum recorded at creation. Updates checksum_status
 * (verified/failed) + verifier/time; audited either way.
 */
export async function verifyBackupChecksum(id: string, actor: Actor) {
  const backup = await getBackupInternal(id);
  if (backup.status !== "success" || !backup.storageKey) {
    throw ApiError.badRequest("Only a successful backup with an artifact can be verified");
  }
  let ok = false;
  let actual = "";
  let detail = "";
  try {
    const buffer = await backupStorageFor(backup.storageMode).get(backup.storageKey);
    actual = sha256(buffer);
    ok = Boolean(backup.checksum) && actual === backup.checksum;
    detail = ok ? "checksum matches" : "checksum MISMATCH — artifact may be corrupted";
  } catch (err) {
    ok = false;
    detail = `artifact unreadable: ${(err instanceof Error ? err.message : "error").slice(0, 200)}`;
  }
  await query(
    `UPDATE backups SET checksum_status=$2, checksum_verified_at=now(), checksum_verified_by=$3 WHERE id=$1`,
    [id, ok ? "verified" : "failed", actor.id]
  );
  await recordAudit(actor, {
    action: ok ? "backup.verified" : "backup.verify_failed",
    targetId: id,
    institutionId: backup.institutionId,
    detail: { result: ok ? "verified" : "failed", note: detail },
  });
  return { backupId: id, verified: ok, checksumStatus: ok ? "verified" : "failed", detail };
}

export async function downloadBackup(id: string, reason: string, actor: Actor) {
  const backup = await getBackupInternal(id);
  if (backup.status !== "success" || !backup.storageKey) {
    throw ApiError.badRequest("This backup has no downloadable artifact");
  }
  const buffer = await backupStorageFor(backup.storageMode).get(backup.storageKey);
  await recordAudit(actor, {
    action: "backup.download",
    targetId: id,
    institutionId: backup.institutionId,
    detail: { scope: backup.scope, sizeBytes: buffer.length, reason },
  });
  const stamp = new Date().toISOString().slice(0, 10);
  return { buffer, filename: `backup-${id}-${stamp}.json.gz` };
}

/** Ids of the latest N successful GLOBAL backups (the rollback window). */
async function latestSuccessfulGlobalIds(limit: number): Promise<string[]> {
  const { rows } = await query<{ id: string }>(
    `SELECT id FROM backups WHERE status='success' AND scope='global'
     ORDER BY created_at DESC LIMIT $1`,
    [limit]
  );
  return rows.map((r) => r.id);
}

/**
 * Archive a backup: remove the stored artifact but ALWAYS keep the metadata row
 * (status → 'archived'). Guarded so the latest successful backup and the rollback
 * window are never silently lost — those need an explicit `override` + reason.
 * Replaces hard deletion (no backup history is ever destroyed).
 */
export async function archiveBackup(
  id: string,
  input: { reason: string; override: boolean },
  actor: Actor
) {
  const backup = await getBackupInternal(id);
  if (backup.status === "archived") {
    return { archived: true, id, alreadyArchived: true };
  }

  if (backup.status === "success" && backup.scope === "global") {
    const settings = (await getSettings()) as { retentionMinKeep: number };
    const windowIds = await latestSuccessfulGlobalIds(Math.max(1, settings.retentionMinKeep));
    if (windowIds[0] === id && !input.override) {
      throw ApiError.badRequest(
        "Refusing to archive the latest successful backup without override=true"
      );
    }
    if (windowIds.includes(id) && !input.override) {
      throw ApiError.badRequest(
        "Refusing to archive a backup inside the rollback window without override=true"
      );
    }
  }

  if (backup.storageKey) await backupStorageFor(backup.storageMode).remove(backup.storageKey).catch(() => undefined);
  await query(
    `UPDATE backups SET status='archived', storage_key=NULL, archived_at=now(),
       archived_by=$2, archive_reason=$3 WHERE id=$1`,
    [id, actor.id, input.reason]
  );
  await recordAudit(actor, {
    action: "backup.archived",
    targetId: id,
    institutionId: backup.institutionId,
    detail: { scope: backup.scope, reason: input.reason, override: input.override },
  });
  return { archived: true, id };
}

// --- restore ---

/** Read + decode a backup artifact into its DumpFile. */
async function loadDump(storageKey: string, mode: StorageMode): Promise<DumpFile> {
  const buffer = await backupStorageFor(mode).get(storageKey);
  return JSON.parse(gunzipSync(buffer).toString("utf8")) as DumpFile;
}

/** Non-destructive metadata preview of what a restore would load (safe/read-only). */
export async function restorePreview(id: string) {
  const backup = await getBackupInternal(id);
  if (backup.status !== "success" || !backup.storageKey) {
    throw ApiError.badRequest("This backup has no artifact to preview");
  }
  const dump = await loadDump(backup.storageKey, backup.storageMode);
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
    checksumStatus: backup.checksumStatus,
    restorable:
      backup.scope === "global" &&
      dump.meta.schemaVersion === currentVersion &&
      backup.checksumStatus !== "failed",
    tableCount: tables.length,
    totalRows: tables.reduce((s, t) => s + t.rowCount, 0),
    tables,
    // Advisory impact — this restore OVERWRITES all current data.
    impact: {
      overwritesAllData: true,
      downtimeRisk: "high",
      recommendPreRestoreBackup: true,
    },
  };
}

/**
 * The restore CORE — destructive. Validates the checksum, reloads every table in
 * one transaction (FK checks/triggers disabled) and rolls back on any error. Only
 * called by the approved restore-request execution path (never one-click). In
 * production it additionally requires `force`. A failed checksum blocks the restore
 * unless `force` (owner override) is set — the override is audited.
 */
export async function applyRestoreDump(
  backupId: string,
  actor: Actor,
  opts: { force: boolean; requestId?: string | null }
) {
  const backup = await getBackupInternal(backupId);
  if (backup.status !== "success" || !backup.storageKey) {
    throw ApiError.badRequest("Only a successful backup with an artifact can be restored");
  }
  if (backup.scope !== "global") {
    throw ApiError.badRequest("Only global backups can be restored");
  }
  if (env.isProduction && !opts.force) {
    throw ApiError.badRequest("Restoring in production requires force=true");
  }

  await recordAudit(actor, {
    action: "restore.start",
    targetId: backupId,
    institutionId: null,
    detail: { force: opts.force, production: env.isProduction, requestId: opts.requestId ?? null },
  });

  // Pre-flight validation (client errors ⇒ 400, surfaced BEFORE any destructive
  // work so a corrupt/incompatible backup never truncates data).
  const buffer = await backupStorageFor(backup.storageMode).get(backup.storageKey);
  const actual = sha256(buffer);
  const checksumOk = Boolean(backup.checksum) && actual === backup.checksum;
  if (!checksumOk) {
    if (!opts.force) {
      await recordAudit(actor, {
        action: "restore.blocked",
        targetId: backupId,
        institutionId: null,
        detail: { reason: "checksum verification failed", requestId: opts.requestId ?? null },
      });
      throw ApiError.badRequest(
        "Checksum verification failed — the backup may be corrupted. Override with force=true (owner)."
      );
    }
    await recordAudit(actor, {
      action: "restore.checksum_override",
      targetId: backupId,
      institutionId: null,
      detail: { requestId: opts.requestId ?? null },
    });
  }
  const dump = JSON.parse(gunzipSync(buffer).toString("utf8")) as DumpFile;
  const currentVersion = Number(
    (await query<{ n: number }>("SELECT count(*)::int AS n FROM schema_migrations")).rows[0].n
  );
  if (dump.meta.schemaVersion !== currentVersion) {
    throw ApiError.badRequest(
      `Schema version mismatch (backup ${dump.meta.schemaVersion} vs current ${currentVersion}) — restore blocked`
    );
  }

  try {
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
      targetId: backupId,
      institutionId: null,
      detail: { tableCount: dump.tables.length, rowCount: restoredRows, requestId: opts.requestId ?? null },
    });
    return { restored: true, backupId, tableCount: dump.tables.length, rowCount: restoredRows };
  } catch (err) {
    const safe = (err instanceof Error ? err.message : "Restore failed").slice(0, 500);
    recordRestore("failed");
    await recordAudit(actor, {
      action: "restore.failed",
      targetId: backupId,
      institutionId: null,
      detail: { error: safe, requestId: opts.requestId ?? null },
    });
    throw new ApiError(500, `Restore failed: ${safe}`);
  }
}

// --- settings + retention ---

const SETTINGS_SELECT = `
  retention_count AS "retentionCount", retention_min_keep AS "retentionMinKeep",
  schedule_enabled AS "scheduleEnabled", schedule_frequency AS "scheduleFrequency",
  schedule_run_time AS "scheduleRunTime", next_run_at AS "nextRunAt",
  offsite_enabled AS "offsiteEnabled", last_offsite_test_at AS "lastOffsiteTestAt",
  last_offsite_test_ok AS "lastOffsiteTestOk", last_offsite_test_detail AS "lastOffsiteTestDetail",
  encryption_enabled AS "encryptionEnabled", failure_alert_enabled AS "failureAlertEnabled",
  alert_emails AS "alertEmails", updated_at AS "updatedAt"`;

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
    retentionMinKeep: "retention_min_keep",
    scheduleEnabled: "schedule_enabled",
    scheduleFrequency: "schedule_frequency",
    scheduleRunTime: "schedule_run_time",
    offsiteEnabled: "offsite_enabled",
    encryptionEnabled: "encryption_enabled",
    failureAlertEnabled: "failure_alert_enabled",
    alertEmails: "alert_emails",
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

  // Audit the CHANGED fields only; alert_emails value is not echoed (recorded as a flag).
  const changed: Record<string, unknown> = { ...input };
  if ("alertEmails" in changed) changed.alertEmails = "<updated>";
  await recordAudit(actor, {
    action: "backup.settings_update",
    targetId: null,
    institutionId: null,
    detail: changed,
  });
  return getSettings();
}

/**
 * Retention: keep the latest N successful backups of a scope and ARCHIVE the older
 * ones (artifact removed, metadata row retained as 'archived' — history is never
 * destroyed). The rollback window (retention_min_keep) is always preserved. When
 * retention_count is NULL retention is OFF and nothing is archived.
 */
export async function applyRetention(scope: "global" | "institution", actor: Actor) {
  const settings = (await getSettings()) as { retentionCount: number | null; retentionMinKeep: number };
  if (settings.retentionCount == null) return { archived: 0 };
  const keep = Math.max(settings.retentionCount, settings.retentionMinKeep ?? 1);

  const { rows } = await query<{ id: string; storageKey: string | null; storageMode: StorageMode }>(
    `SELECT id, storage_key AS "storageKey", storage_mode AS "storageMode" FROM backups
     WHERE status = 'success' AND scope = $1
     ORDER BY created_at DESC OFFSET $2`,
    [scope, keep]
  );
  for (const row of rows) {
    if (row.storageKey) await backupStorageFor(row.storageMode).remove(row.storageKey).catch(() => undefined);
    await query(
      `UPDATE backups SET status='archived', storage_key=NULL, archived_at=now(),
         archive_reason='retention policy' WHERE id=$1`,
      [row.id]
    );
  }
  if (rows.length > 0) {
    await recordAudit(actor, {
      action: "backup.retention",
      targetId: null,
      institutionId: null,
      detail: { scope, archived: rows.length, keep },
    });
  }
  return { archived: rows.length };
}

// --- dashboard summary ---

/** Aggregated dashboard cards for the backup console (one round of small queries). */
export async function summary() {
  const settings = (await getSettings()) as Record<string, unknown>;

  const counts = (
    await query<{
      total: number;
      success: number;
      failed: number;
      archived: number;
      checksum_verified: number;
      checksum_failed: number;
      offsite: number;
      storage_used: string | null;
      last_success_at: string | null;
      last_success_size: string | null;
    }>(
      `SELECT
         count(*)::int AS total,
         count(*) FILTER (WHERE status='success')::int AS success,
         count(*) FILTER (WHERE status='failed')::int AS failed,
         count(*) FILTER (WHERE status='archived')::int AS archived,
         count(*) FILTER (WHERE checksum_status='verified')::int AS checksum_verified,
         count(*) FILTER (WHERE checksum_status='failed')::int AS checksum_failed,
         count(*) FILTER (WHERE status='success' AND storage_mode='s3')::int AS offsite,
         coalesce(sum(size_bytes) FILTER (WHERE status='success'),0)::text AS storage_used,
         (SELECT completed_at FROM backups WHERE status='success' ORDER BY completed_at DESC LIMIT 1) AS last_success_at,
         (SELECT size_bytes FROM backups WHERE status='success' ORDER BY completed_at DESC LIMIT 1)::text AS last_success_size
       FROM backups`
    )
  ).rows[0];

  const last = (
    await query(
      `SELECT ${PUBLIC_SELECT} FROM backups ORDER BY created_at DESC LIMIT 1`
    )
  ).rows[0] ?? null;

  const restore = (
    await query<{ pending: number; last_status: string | null; last_at: string | null }>(
      `SELECT
         count(*) FILTER (WHERE status='pending')::int AS pending,
         (SELECT status FROM restore_requests ORDER BY created_at DESC LIMIT 1) AS last_status,
         (SELECT created_at FROM restore_requests ORDER BY created_at DESC LIMIT 1) AS last_at
       FROM restore_requests`
    )
  ).rows[0];

  // Health warnings — surfaced on the dashboard.
  const warnings: string[] = [];
  // Offsite backups are ACTIVE only when explicitly enabled AND S3 is configured —
  // S3 configured for document uploads alone does NOT send DB backups offsite.
  const offsiteActive = Boolean(settings.offsiteEnabled) && storageConfigured();
  const lastSuccessAt = counts.last_success_at ? new Date(counts.last_success_at) : null;
  const staleDays = lastSuccessAt
    ? (Date.now() - lastSuccessAt.getTime()) / 86_400_000
    : Infinity;
  if (!lastSuccessAt) warnings.push("No successful backup exists yet.");
  else if (staleDays > 2) warnings.push(`Latest successful backup is ${Math.floor(staleDays)} days old.`);
  if (counts.failed > 0) warnings.push(`${counts.failed} failed backup(s) recorded.`);
  if (counts.checksum_failed > 0) warnings.push(`${counts.checksum_failed} backup(s) failed checksum verification.`);
  if (!settings.encryptionEnabled) warnings.push("Backup-level encryption is not enabled (relies on storage at-rest encryption).");
  if (!offsiteActive) warnings.push("Offsite (S3) backups are not enabled — database backups are on the app-server disk only.");
  if (!settings.scheduleEnabled) warnings.push("Automatic scheduled backups are disabled.");

  return {
    lastBackup: last,
    lastSuccessAt: counts.last_success_at,
    lastSuccessSizeBytes: counts.last_success_size ? Number(counts.last_success_size) : null,
    schedule: {
      enabled: settings.scheduleEnabled,
      frequency: settings.scheduleFrequency,
      runTime: settings.scheduleRunTime,
      nextRunAt: settings.nextRunAt,
    },
    retention: {
      retentionCount: settings.retentionCount,
      retentionMinKeep: settings.retentionMinKeep,
    },
    totals: {
      total: counts.total,
      available: counts.success,
      archived: counts.archived,
      failed: counts.failed,
    },
    integrity: {
      checksumVerified: counts.checksum_verified,
      checksumFailed: counts.checksum_failed,
    },
    offsite: {
      mode: offsiteActive ? "s3" : "local",
      configured: offsiteActive,
      copies: counts.offsite,
      lastTestAt: settings.lastOffsiteTestAt,
      lastTestOk: settings.lastOffsiteTestOk,
    },
    encryption: { enabled: Boolean(settings.encryptionEnabled) },
    storageUsedBytes: Number(counts.storage_used ?? 0),
    restore: {
      pendingRequests: restore.pending,
      latestStatus: restore.last_status,
      latestAt: restore.last_at,
    },
    warnings,
  };
}

// --- failure alerting ---

/** Resolve the alert recipient list: configured emails, else all active platform admins. */
async function resolveAlertRecipients(configured: string | null): Promise<string[]> {
  const list = (configured ?? "")
    .split(/[,\n;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (list.length > 0) return list;
  const { rows } = await query<{ email: string }>(
    `SELECT email FROM users WHERE role='super_admin' AND institution_id IS NULL AND is_active = true`
  );
  return rows.map((r) => r.email);
}

/**
 * Best-effort backup-failure alert. Emails the configured platform admins (or all
 * super admins) and records the outcome to the audit log. NEVER throws — a failed
 * alert must not mask the underlying backup failure. Skips cleanly when SMTP or
 * the alert setting is off (the dashboard warning still surfaces the failure).
 */
export async function sendBackupFailureAlert(
  backupId: string,
  input: { scope: string; trigger: string },
  error: string
) {
  try {
    const settings = (await getSettings()) as { failureAlertEnabled: boolean; alertEmails: string | null };
    if (!settings.failureAlertEnabled) {
      await recordAudit(SYSTEM_ACTOR, {
        action: "backup.failure_alert",
        targetId: backupId,
        institutionId: null,
        detail: { status: "skipped", reason: "alerts disabled" },
      });
      return;
    }
    const recipients = await resolveAlertRecipients(settings.alertEmails);
    const subject = `[SRE EDU OS] Backup FAILED (${input.scope} / ${input.trigger})`;
    const text =
      `A ${input.scope} backup triggered by ${input.trigger} failed.\n\n` +
      `Backup ID: ${backupId}\nError: ${error}\n\n` +
      `Review the backup dashboard and run a manual backup once resolved. ` +
      `This is an automated security notification from SRE EDU OS.`;

    let sent = 0;
    let lastStatus: "sent" | "skipped" | "failed" = "skipped";
    for (const to of recipients) {
      const res = await deliverMail({ to, subject, text });
      lastStatus = res.status;
      if (res.status === "sent") sent += 1;
    }
    await recordAudit(SYSTEM_ACTOR, {
      action: "backup.failure_alert",
      targetId: backupId,
      institutionId: null,
      detail: { status: recipients.length === 0 ? "skipped" : lastStatus, recipients: recipients.length, sent },
    });
  } catch {
    // Swallow — alerting must never break the backup path.
  }
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
