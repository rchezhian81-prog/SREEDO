import { query } from "../../db/postgres";
import { ApiError } from "../../utils/api-error";
import { paginatedResponse, type Pagination } from "../../utils/pagination";
import type { z } from "zod";
import type {
  createAnnouncementSchema,
  updateAnnouncementSchema,
} from "./announcements.schema";

const ANNOUNCEMENT_SELECT = `
  a.id, a.title, a.body, a.audience,
  a.is_pinned AS "isPinned",
  a.published_at AS "publishedAt",
  (a.published_at > now()) AS "scheduled",
  u.full_name AS "createdByName"
FROM announcements a
LEFT JOIN users u ON u.id = a.created_by`;

export async function listAnnouncements(
  pagination: Pagination,
  filters: { audience?: string; includeScheduled?: boolean },
  institutionId: string
) {
  const params: unknown[] = [institutionId];
  const conditions: string[] = ["a.institution_id = $1"];
  if (filters.audience && filters.audience !== "all") {
    params.push(filters.audience);
    conditions.push(`a.audience IN ('all', $${params.length})`);
  }
  // The audience only sees announcements once published; publishers see
  // upcoming (scheduled) ones too so they can manage them.
  if (!filters.includeScheduled) {
    conditions.push("a.published_at <= now()");
  }
  const where = `WHERE ${conditions.join(" AND ")}`;
  const countResult = await query<{ count: string }>(
    `SELECT count(*) FROM announcements a ${where}`,
    params
  );
  const { rows } = await query(
    `SELECT ${ANNOUNCEMENT_SELECT} ${where}
     ORDER BY a.is_pinned DESC, a.published_at DESC
     LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, pagination.limit, pagination.offset]
  );
  return paginatedResponse(rows, Number(countResult.rows[0].count), pagination);
}

export async function createAnnouncement(
  input: z.infer<typeof createAnnouncementSchema>,
  createdBy: string,
  institutionId: string
) {
  const { rows } = await query<{ id: string }>(
    `INSERT INTO announcements (institution_id, title, body, audience, is_pinned, created_by, published_at)
     VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7::timestamptz, now()))
     RETURNING id`,
    [
      institutionId,
      input.title,
      input.body,
      input.audience ?? "all",
      input.isPinned ?? false,
      createdBy,
      input.publishAt ?? null,
    ]
  );
  // Publishers always get the created row back (even when scheduled for later).
  return getAnnouncement(rows[0].id, institutionId, true);
}

export async function getAnnouncement(
  id: string,
  institutionId: string,
  includeScheduled = false
) {
  const conditions = ["a.id = $1", "a.institution_id = $2"];
  if (!includeScheduled) conditions.push("a.published_at <= now()");
  const { rows } = await query(
    `SELECT ${ANNOUNCEMENT_SELECT} WHERE ${conditions.join(" AND ")}`,
    [id, institutionId]
  );
  if (!rows[0]) throw ApiError.notFound("Announcement not found");
  return rows[0];
}

export async function updateAnnouncement(
  id: string,
  input: z.infer<typeof updateAnnouncementSchema>,
  institutionId: string
) {
  const sets: string[] = [];
  const params: unknown[] = [];
  const columnMap: Record<string, string> = {
    title: "title",
    body: "body",
    audience: "audience",
    isPinned: "is_pinned",
    publishAt: "published_at",
  };
  for (const [field, column] of Object.entries(columnMap)) {
    const value = (input as Record<string, unknown>)[field];
    if (value !== undefined) {
      params.push(value);
      sets.push(`${column} = $${params.length}`);
    }
  }
  if (!sets.length) throw ApiError.badRequest("No fields to update");

  params.push(id);
  params.push(institutionId);
  const { rowCount } = await query(
    `UPDATE announcements SET ${sets.join(", ")}
     WHERE id = $${params.length - 1} AND institution_id = $${params.length}`,
    params
  );
  if (!rowCount) throw ApiError.notFound("Announcement not found");
  return getAnnouncement(id, institutionId, true);
}

export async function removeAnnouncement(
  id: string,
  institutionId: string
): Promise<void> {
  const { rowCount } = await query(
    "DELETE FROM announcements WHERE id = $1 AND institution_id = $2",
    [id, institutionId]
  );
  if (!rowCount) throw ApiError.notFound("Announcement not found");
}
