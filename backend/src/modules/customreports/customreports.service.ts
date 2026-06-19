import type { z } from "zod";
import { query } from "../../db/postgres";
import { ApiError } from "../../utils/api-error";
import type { UserRole } from "../../types";
import { permissionsForRole } from "../../middleware/permissions";
import {
  getReport,
  listReports,
  toCsv,
  type Col,
  type Filters,
} from "../reportcenter/reportcenter.service";
import { tablePdf } from "../reportcenter/reportcenter.pdf";
import type {
  adhocSchema,
  createCustomReportSchema,
  updateCustomReportSchema,
} from "./customreports.schema";

interface Actor {
  id: string;
  role: UserRole;
}

const SELECT = `
  id, name, report_key AS "reportKey", columns, filters, sort,
  group_by AS "groupBy", visibility, created_by AS "createdBy",
  created_at AS "createdAt", updated_at AS "updatedAt"`;

const isAdmin = (role: UserRole) => role === "admin" || role === "super_admin";

/** Enforce the underlying report's own permission (a custom report never widens access). */
async function assertUnderlyingPermission(role: UserRole, reportKey: string) {
  const report = getReport(reportKey); // throws notFound for unknown keys
  if (role === "super_admin") return report;
  const perms = await permissionsForRole(role);
  if (!perms.includes(report.permission)) {
    throw ApiError.forbidden("You do not have permission to run this report source");
  }
  return report;
}

interface Definition {
  reportKey: string;
  columns: string[];
  filters: Filters;
  sort: { key: string; dir: "asc" | "desc" } | null;
}

/** Runs the underlying report, projects to selected columns, applies sorting. */
async function runDefinition(def: Definition, institutionId: string) {
  const report = getReport(def.reportKey);
  const result = await report.run(def.filters ?? {}, institutionId);

  let columns: Col[] = result.columns;
  if (def.columns && def.columns.length > 0) {
    const picked = def.columns
      .map((k) => result.columns.find((c) => c.key === k))
      .filter((c): c is Col => Boolean(c));
    if (picked.length > 0) columns = picked;
  }

  let rows = result.rows;
  if (def.sort?.key) {
    const { key, dir } = def.sort;
    rows = [...rows].sort((a, b) => {
      const av = a[key];
      const bv = b[key];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      const an = Number(av);
      const bn = Number(bv);
      const cmp =
        !Number.isNaN(an) && !Number.isNaN(bn)
          ? an - bn
          : String(av).localeCompare(String(bv));
      return dir === "desc" ? -cmp : cmp;
    });
  }
  return { title: result.title, columns, rows };
}

// --- Saved definitions ---

export function sources() {
  return listReports();
}

export async function listSaved(actor: Actor, institutionId: string) {
  const { rows } = await query(
    `SELECT ${SELECT} FROM custom_reports
     WHERE institution_id = $1 AND (visibility = 'shared' OR created_by = $2)
     ORDER BY created_at DESC LIMIT 500`,
    [institutionId, actor.id]
  );
  return rows;
}

async function loadAccessible(id: string, actor: Actor, institutionId: string) {
  const { rows } = await query<{
    id: string;
    reportKey: string;
    columns: string[];
    filters: Filters;
    sort: { key: string; dir: "asc" | "desc" } | null;
    visibility: string;
    createdBy: string | null;
  }>(`SELECT ${SELECT} FROM custom_reports WHERE id = $1 AND institution_id = $2`, [
    id,
    institutionId,
  ]);
  const def = rows[0];
  // Private reports are visible only to their creator (no existence leak otherwise).
  if (!def || (def.visibility === "private" && def.createdBy !== actor.id)) {
    throw ApiError.notFound("Custom report not found");
  }
  return def;
}

export async function getSaved(id: string, actor: Actor, institutionId: string) {
  return loadAccessible(id, actor, institutionId);
}

export async function createSaved(
  input: z.infer<typeof createCustomReportSchema>,
  actor: Actor,
  institutionId: string,
  canShare: boolean
) {
  getReport(input.reportKey); // validate the source exists
  const visibility = input.visibility ?? "private";
  if (visibility === "shared" && !canShare) {
    throw ApiError.forbidden("You do not have permission to share reports");
  }
  const { rows } = await query(
    `INSERT INTO custom_reports
       (institution_id, name, report_key, columns, filters, sort, group_by, visibility, created_by)
     VALUES ($1,$2,$3,$4::jsonb,$5::jsonb,$6::jsonb,$7,$8,$9)
     RETURNING ${SELECT}`,
    [
      institutionId,
      input.name,
      input.reportKey,
      JSON.stringify(input.columns ?? []),
      JSON.stringify(input.filters ?? {}),
      input.sort ? JSON.stringify(input.sort) : null,
      input.groupBy ?? null,
      visibility,
      actor.id,
    ]
  );
  return rows[0];
}

export async function updateSaved(
  id: string,
  input: z.infer<typeof updateCustomReportSchema>,
  actor: Actor,
  institutionId: string,
  canShare: boolean
) {
  const existing = await loadAccessible(id, actor, institutionId);
  if (existing.createdBy !== actor.id && !isAdmin(actor.role)) {
    throw ApiError.forbidden("You can only edit your own reports");
  }
  if (input.visibility === "shared" && !canShare) {
    throw ApiError.forbidden("You do not have permission to share reports");
  }
  const { rows } = await query(
    `UPDATE custom_reports SET
       name = COALESCE($3, name),
       columns = COALESCE($4::jsonb, columns),
       filters = COALESCE($5::jsonb, filters),
       sort = CASE WHEN $6 THEN $7::jsonb ELSE sort END,
       group_by = COALESCE($8, group_by),
       visibility = COALESCE($9, visibility)
     WHERE id = $1 AND institution_id = $2
     RETURNING ${SELECT}`,
    [
      id,
      institutionId,
      input.name ?? null,
      input.columns ? JSON.stringify(input.columns) : null,
      input.filters ? JSON.stringify(input.filters) : null,
      input.sort !== undefined, // explicitly set (incl. null) when provided
      input.sort ? JSON.stringify(input.sort) : null,
      input.groupBy ?? null,
      input.visibility ?? null,
    ]
  );
  return rows[0];
}

export async function duplicateSaved(id: string, actor: Actor, institutionId: string) {
  const src = await loadAccessible(id, actor, institutionId);
  const { rows } = await query(
    `INSERT INTO custom_reports
       (institution_id, name, report_key, columns, filters, sort, group_by, visibility, created_by)
     SELECT institution_id, 'Copy of ' || name, report_key, columns, filters, sort, group_by,
            'private', $3
     FROM custom_reports WHERE id = $1 AND institution_id = $2
     RETURNING ${SELECT}`,
    [id, institutionId, actor.id]
  );
  return rows[0] ?? src;
}

export async function deleteSaved(id: string, actor: Actor, institutionId: string) {
  const existing = await loadAccessible(id, actor, institutionId);
  if (existing.createdBy !== actor.id && !isAdmin(actor.role)) {
    throw ApiError.forbidden("You can only delete your own reports");
  }
  await query("DELETE FROM custom_reports WHERE id = $1 AND institution_id = $2", [
    id,
    institutionId,
  ]);
}

// --- Running / exporting ---

export async function runSaved(id: string, actor: Actor, institutionId: string) {
  const def = await loadAccessible(id, actor, institutionId);
  await assertUnderlyingPermission(actor.role, def.reportKey);
  return runDefinition(def, institutionId);
}

export async function exportSaved(
  id: string,
  format: "csv" | "pdf",
  actor: Actor,
  institutionId: string
) {
  const table = await runSaved(id, actor, institutionId);
  if (format === "pdf") {
    return { kind: "pdf" as const, buffer: await tablePdf(table.title, table.columns, table.rows) };
  }
  return { kind: "csv" as const, csv: toCsv(table.columns, table.rows) };
}

export async function adhocRun(
  input: z.infer<typeof adhocSchema>,
  actor: Actor,
  institutionId: string
) {
  await assertUnderlyingPermission(actor.role, input.reportKey);
  return runDefinition(
    {
      reportKey: input.reportKey,
      columns: input.columns ?? [],
      filters: input.filters ?? {},
      sort: input.sort ?? null,
    },
    institutionId
  );
}

export async function adhocExport(
  input: z.infer<typeof adhocSchema>,
  format: "csv" | "pdf",
  actor: Actor,
  institutionId: string
) {
  const table = await adhocRun(input, actor, institutionId);
  if (format === "pdf") {
    return { kind: "pdf" as const, buffer: await tablePdf(table.title, table.columns, table.rows) };
  }
  return { kind: "csv" as const, csv: toCsv(table.columns, table.rows) };
}
