import { query } from "../../db/postgres";
import { ApiError } from "../../utils/api-error";
import { paginatedResponse, type Pagination } from "../../utils/pagination";
import type { z } from "zod";
import type {
  createFeedbackSchema,
  updateFeedbackSchema,
  listFeedbackQuerySchema,
  publicFeedbackSchema,
} from "./feedback.schema";

const SELECT = `
  f.id,
  f.type,
  f.subject,
  f.message,
  f.submitter_name AS "submitterName",
  f.submitter_contact AS "submitterContact",
  f.status,
  f.resolution,
  f.created_at AS "createdAt",
  f.updated_at AS "updatedAt"
FROM feedback_entries f`;

export async function listFeedback(
  pagination: Pagination,
  filters: z.infer<typeof listFeedbackQuerySchema>,
  institutionId: string
) {
  const params: unknown[] = [institutionId];
  const conditions: string[] = ["f.institution_id = $1"];
  if (filters.type) {
    params.push(filters.type);
    conditions.push(`f.type = $${params.length}`);
  }
  if (filters.status) {
    params.push(filters.status);
    conditions.push(`f.status = $${params.length}`);
  }
  if (filters.search) {
    params.push(`%${filters.search}%`);
    conditions.push(
      `(f.subject ILIKE $${params.length} OR f.message ILIKE $${params.length} OR f.submitter_name ILIKE $${params.length})`
    );
  }
  const where = `WHERE ${conditions.join(" AND ")}`;
  const countResult = await query<{ count: string }>(
    `SELECT count(*) FROM feedback_entries f ${where}`,
    params
  );
  const { rows } = await query(
    `SELECT ${SELECT} ${where}
     ORDER BY f.created_at DESC
     LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, pagination.limit, pagination.offset]
  );
  return paginatedResponse(rows, Number(countResult.rows[0].count), pagination);
}

export async function getFeedback(id: string, institutionId: string) {
  const { rows } = await query(
    `SELECT ${SELECT} WHERE f.id = $1 AND f.institution_id = $2`,
    [id, institutionId]
  );
  if (!rows[0]) throw ApiError.notFound("Feedback entry not found");
  return rows[0];
}

export async function createFeedback(
  input: z.infer<typeof createFeedbackSchema>,
  institutionId: string,
  userId: string
) {
  const { rows } = await query<{ id: string }>(
    `INSERT INTO feedback_entries (
       institution_id, type, subject, message, submitter_name, submitter_contact, created_by
     ) VALUES ($1,$2,$3,$4,$5,$6,$7)
     RETURNING id`,
    [
      institutionId,
      input.type ?? "feedback",
      input.subject,
      input.message,
      input.submitterName ?? null,
      input.submitterContact ?? null,
      userId,
    ]
  );
  return getFeedback(rows[0].id, institutionId);
}

const UPDATE_COLUMN_MAP: Record<string, string> = {
  type: "type",
  subject: "subject",
  message: "message",
  submitterName: "submitter_name",
  submitterContact: "submitter_contact",
  status: "status",
  resolution: "resolution",
};

export async function updateFeedback(
  id: string,
  input: z.infer<typeof updateFeedbackSchema>,
  institutionId: string
) {
  const sets: string[] = [];
  const params: unknown[] = [];
  for (const [field, column] of Object.entries(UPDATE_COLUMN_MAP)) {
    const value = (input as Record<string, unknown>)[field];
    if (value !== undefined) {
      params.push(value);
      sets.push(`${column} = $${params.length}`);
    }
  }
  if (!sets.length) throw ApiError.badRequest("No fields to update");
  sets.push("updated_at = now()");
  params.push(id);
  params.push(institutionId);
  const { rowCount } = await query(
    `UPDATE feedback_entries SET ${sets.join(", ")}
     WHERE id = $${params.length - 1} AND institution_id = $${params.length}`,
    params
  );
  if (!rowCount) throw ApiError.notFound("Feedback entry not found");
  return getFeedback(id, institutionId);
}

export async function deleteFeedback(
  id: string,
  institutionId: string
): Promise<void> {
  const { rowCount } = await query(
    "DELETE FROM feedback_entries WHERE id = $1 AND institution_id = $2",
    [id, institutionId]
  );
  if (!rowCount) throw ApiError.notFound("Feedback entry not found");
}

/** Public submission: resolve the school by code, record an open entry. */
export async function createPublicFeedback(
  input: z.infer<typeof publicFeedbackSchema>
) {
  const inst = await query<{ id: string }>(
    "SELECT id FROM institutions WHERE code = $1",
    [input.institutionCode]
  );
  if (!inst.rows[0]) throw ApiError.notFound("No school found for that code");
  const { rows } = await query<{ id: string }>(
    `INSERT INTO feedback_entries (
       institution_id, type, subject, message, submitter_name, submitter_contact
     ) VALUES ($1,$2,$3,$4,$5,$6)
     RETURNING id`,
    [
      inst.rows[0].id,
      input.type ?? "feedback",
      input.subject,
      input.message,
      input.submitterName ?? null,
      input.submitterContact ?? null,
    ]
  );
  return { id: rows[0].id, status: "open" as const };
}
