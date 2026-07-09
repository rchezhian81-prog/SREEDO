// PR-T5 — the Import/Export engine.
//
// Import is strictly two-phase: dry-run (validate every row, persist a batch +
// per-row errors, write NOTHING to domain tables) → commit (re-validate; refuse
// unless every row is clean; then commit atomically). No partial commits. Every
// action is audited. Export is read-only, reason-gated + audited for sensitive
// datasets, and formula-injection-sanitised.

import { query } from "../../db/postgres";
import { ApiError } from "../../utils/api-error";
import { toCsv, toXlsx, type Cell } from "../../utils/spreadsheet";
import { recordAudit, type Actor } from "../observability/audit";
import { parseCsv, sanitizeExportCell } from "./csv";
import { IMPORT_BY_KEY, IMPORT_ENTITIES } from "./dataio.import";
import { EXPORT_BY_KEY, EXPORT_ENTITIES } from "./dataio.export";
import type { RowError } from "./dataio.types";

const MAX_ROWS = 1000;

export interface IoContext {
  institutionId: string;
  type: "school" | "college";
  perms: Set<string>;
  actor: Actor;
}

const appliesToMode = (a: "school" | "college" | "both", type: string) => a === "both" || a === type;

/** The import/export catalogue the caller may actually use (mode + permission filtered). */
export function catalogFor(ctx: IoContext) {
  const canImport = ctx.perms.has("data_io:import");
  const canExport = ctx.perms.has("data_io:export");
  const has = (k: string) => k === "" || ctx.perms.has(k);
  return {
    imports: IMPORT_ENTITIES.filter(
      (e) => appliesToMode(e.appliesTo, ctx.type) && canImport && has(e.permission)
    ).map((e) => ({ key: e.key, label: e.label, appliesTo: e.appliesTo, columns: e.columns })),
    exports: EXPORT_ENTITIES.filter(
      (e) => appliesToMode(e.appliesTo, ctx.type) && canExport && has(e.permission)
    ).map((e) => ({ key: e.key, label: e.label, appliesTo: e.appliesTo, sensitive: !!e.sensitive, headers: e.headers })),
  };
}

function importEntityOr400(entityKey: string, ctx: IoContext) {
  const entity = IMPORT_BY_KEY[entityKey];
  if (!entity) throw ApiError.badRequest(`Unknown import entity: ${entityKey}`);
  if (!appliesToMode(entity.appliesTo, ctx.type))
    throw ApiError.badRequest(`"${entity.label}" is not available in ${ctx.type} mode`);
  if (entity.permission && !ctx.perms.has(entity.permission))
    throw ApiError.forbidden(`You lack the permission required to import ${entity.label}`);
  return entity;
}

interface RowResult {
  row: number; // 1-based data row number
  valid: boolean;
  errors: RowError[];
  data: Record<string, string>;
}

/** Parse + validate a CSV against an entity. Read-only; returns per-row results. */
async function evaluate(entityKey: string, csv: string, ctx: IoContext) {
  const entity = importEntityOr400(entityKey, ctx);
  let parsed;
  try {
    parsed = parseCsv(csv);
  } catch (err) {
    throw ApiError.badRequest(err instanceof Error ? err.message : "Could not parse the CSV");
  }
  if (parsed.rowCount === 0) throw ApiError.badRequest("The file has no data rows");
  if (parsed.rowCount > MAX_ROWS)
    throw ApiError.badRequest(`Import is limited to ${MAX_ROWS} rows at a time (got ${parsed.rowCount})`);

  const inputs: (unknown | undefined)[] = [];
  const shapeErrors: RowError[][] = [];
  for (const rec of parsed.records) {
    const { input, errors } = entity.toInput(rec);
    inputs.push(errors.length ? undefined : input);
    shapeErrors.push(errors);
  }
  const validationErrors = await entity.validate(inputs, ctx.institutionId);

  const rows: RowResult[] = parsed.records.map((data, i) => {
    const errors = [...shapeErrors[i], ...(validationErrors[i] ?? [])];
    return { row: i + 1, valid: errors.length === 0, errors, data };
  });
  const validInputs = inputs.filter((v, i) => rows[i].valid) as unknown[];
  return { entity, rows, validInputs, total: rows.length };
}

async function persistBatch(
  ctx: IoContext,
  entityKey: string,
  filename: string | null,
  status: "dry_run" | "committed" | "failed" | "cancelled",
  rows: RowResult[],
  imported: number,
  errorMessage: string | null
): Promise<string> {
  const valid = rows.filter((r) => r.valid).length;
  const errorRows = rows.length - valid;
  const { rows: ins } = await query<{ id: string }>(
    `INSERT INTO import_batches
       (institution_id, entity, source_filename, status, total_rows, valid_rows, error_rows, imported_rows, error_message, created_by, created_by_email)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
    [ctx.institutionId, entityKey, filename, status, rows.length, valid, errorRows, imported, errorMessage, ctx.actor.id, ctx.actor.email]
  );
  const batchId = ins[0].id;
  // Persist per-row results (only rows with errors + a bounded sample of valid rows
  // keep the table lean while preserving full error reviewability).
  const toStore = rows.filter((r) => !r.valid || r.row <= 50);
  for (const r of toStore) {
    await query(
      `INSERT INTO import_batch_rows (batch_id, institution_id, row_number, valid, errors, data)
       VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb)`,
      [batchId, ctx.institutionId, r.row, r.valid, JSON.stringify(r.errors), JSON.stringify(r.data)]
    );
  }
  return batchId;
}

/** Phase 1: validate a file and record a dry-run batch. Writes no domain data. */
export async function dryRunImport(entityKey: string, csv: string, filename: string | null, ctx: IoContext) {
  const { rows, total } = await evaluate(entityKey, csv, ctx);
  const validCount = rows.filter((r) => r.valid).length;
  const batchId = await persistBatch(ctx, entityKey, filename, "dry_run", rows, 0, null);
  await recordAudit(ctx.actor, {
    action: "data_io.import.dry_run",
    targetType: "data_io",
    targetId: batchId,
    institutionId: ctx.institutionId,
    detail: { entity: entityKey, total, valid: validCount, errors: total - validCount },
  });
  return { batchId, entity: entityKey, total, valid: validCount, invalid: total - validCount, rows };
}

/** Phase 2: re-validate and, only if every row is clean, commit atomically. */
export async function commitImport(entityKey: string, csv: string, filename: string | null, ctx: IoContext) {
  const { entity, rows, validInputs, total } = await evaluate(entityKey, csv, ctx);
  const invalid = rows.filter((r) => !r.valid);
  if (invalid.length > 0) {
    const batchId = await persistBatch(ctx, entityKey, filename, "failed", rows, 0, "Validation failed");
    await recordAudit(ctx.actor, {
      action: "data_io.import.failed",
      targetType: "data_io",
      targetId: batchId,
      institutionId: ctx.institutionId,
      detail: { entity: entityKey, total, invalid: invalid.length },
    });
    throw new ApiError(400, "Import rejected — fix the row errors first (no rows were committed)", {
      batchId,
      total,
      invalid: invalid.length,
      rows: invalid,
    });
  }
  try {
    const imported = await entity.commit(validInputs, ctx.institutionId);
    const batchId = await persistBatch(ctx, entityKey, filename, "committed", rows, imported, null);
    await recordAudit(ctx.actor, {
      action: "data_io.import.commit",
      targetType: "data_io",
      targetId: batchId,
      institutionId: ctx.institutionId,
      detail: { entity: entityKey, imported },
    });
    return { batchId, entity: entityKey, imported };
  } catch (err) {
    const message = err instanceof ApiError ? err.message : "Import failed during commit";
    const batchId = await persistBatch(ctx, entityKey, filename, "failed", rows, 0, message);
    await recordAudit(ctx.actor, {
      action: "data_io.import.failed",
      targetType: "data_io",
      targetId: batchId,
      institutionId: ctx.institutionId,
      detail: { entity: entityKey, error: message },
    });
    throw err;
  }
}

/** Mark a dry-run batch cancelled (operator abandoned it). Audited. */
export async function cancelBatch(batchId: string, ctx: IoContext) {
  const { rows } = await query<{ id: string; status: string }>(
    `UPDATE import_batches SET status = 'cancelled', updated_at = now()
     WHERE id = $1 AND institution_id = $2 AND status = 'dry_run' RETURNING id, status`,
    [batchId, ctx.institutionId]
  );
  if (rows.length === 0) throw ApiError.notFound("No cancellable dry-run batch with that id");
  await recordAudit(ctx.actor, {
    action: "data_io.import.cancel",
    targetType: "data_io",
    targetId: batchId,
    institutionId: ctx.institutionId,
    detail: {},
  });
  return { batchId, status: "cancelled" };
}

/** Recent import batches for this tenant (history / troubleshooting). */
export async function listBatches(institutionId: string) {
  const { rows } = await query(
    `SELECT id, entity, source_filename AS "sourceFilename", status,
            total_rows AS "totalRows", valid_rows AS "validRows", error_rows AS "errorRows",
            imported_rows AS "importedRows", error_message AS "errorMessage",
            created_by_email AS "createdByEmail", created_at AS "createdAt"
     FROM import_batches WHERE institution_id = $1 ORDER BY created_at DESC LIMIT 100`,
    [institutionId]
  );
  return rows;
}

/** The per-row detail of one batch (for reviewing errors). */
export async function batchRows(batchId: string, institutionId: string) {
  const { rows: batch } = await query<{ id: string }>(
    `SELECT id FROM import_batches WHERE id = $1 AND institution_id = $2`,
    [batchId, institutionId]
  );
  if (batch.length === 0) throw ApiError.notFound("Import batch not found");
  const { rows } = await query(
    `SELECT row_number AS "row", valid, errors, data FROM import_batch_rows
     WHERE batch_id = $1 AND institution_id = $2 ORDER BY row_number`,
    [batchId, institutionId]
  );
  return rows;
}

const EXPORT_MIME: Record<string, string> = {
  csv: "text/csv; charset=utf-8",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

/** Read-only export → sanitised CSV/XLSX. Sensitive datasets require a reason + audit. */
export async function exportData(
  entityKey: string,
  format: "csv" | "xlsx",
  reason: string | undefined,
  isoDate: string,
  ctx: IoContext
): Promise<{ filename: string; mime: string; body: Buffer | string }> {
  const entity = EXPORT_BY_KEY[entityKey];
  if (!entity) throw ApiError.badRequest(`Unknown export entity: ${entityKey}`);
  if (!appliesToMode(entity.appliesTo, ctx.type))
    throw ApiError.badRequest(`"${entity.label}" is not available in ${ctx.type} mode`);
  if (entity.permission && !ctx.perms.has(entity.permission))
    throw ApiError.forbidden(`You lack the permission required to export ${entity.label}`);
  const cleanReason = (reason ?? "").trim();
  if (entity.sensitive && cleanReason.length < 3)
    throw ApiError.badRequest("A reason (min 3 chars) is required to export this sensitive dataset");

  const raw = await entity.fetch(ctx.institutionId);
  const rows: Cell[][] = raw.map((r) => r.map((cell) => sanitizeExportCell(cell) as Cell));
  const body = format === "xlsx" ? toXlsx(entity.headers, rows) : toCsv(entity.headers, rows);
  const filename = `${entity.key}_${isoDate}.${format}`;

  await recordAudit(ctx.actor, {
    action: "data_io.export.download",
    targetType: "data_io",
    targetId: null, // target_id is a UUID column; the entity key lives in detail
    institutionId: ctx.institutionId,
    detail: { entity: entity.key, format, rowCount: rows.length, sensitive: !!entity.sensitive, reason: cleanReason || undefined },
  });
  return { filename, mime: EXPORT_MIME[format], body };
}
