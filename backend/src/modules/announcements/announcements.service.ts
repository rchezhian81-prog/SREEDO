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
  u.full_name AS "createdByName"
FROM announcements a
LEFT JOIN users u ON u.id = a.created_by`;

export async function listAnnouncements(
  pagination: Pagination,
  filters: { audience?: string }
) {
  const params: unknown[] = [];
  let where = "";
  if (filters.audience && filters.audience !== "all") {
    params.push(filters.audience);
    where = `WHERE a.audience IN ('all', $1)`;
  }
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
  createdBy: string
) {
  const { rows } = await query<{ id: string }>(
    `INSERT INTO announcements (title, body, audience, is_pinned, created_by)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id`,
    [
      input.title,
      input.body,
      input.audience ?? "all",
      input.isPinned ?? false,
      createdBy,
    ]
  );
  return getAnnouncement(rows[0].id);
}

export async function getAnnouncement(id: string) {
  const { rows } = await query(
    `SELECT ${ANNOUNCEMENT_SELECT} WHERE a.id = $1`,
    [id]
  );
  if (!rows[0]) throw ApiError.notFound("Announcement not found");
  return rows[0];
}

export async function updateAnnouncement(
  id: string,
  input: z.infer<typeof updateAnnouncementSchema>
) {
  const sets: string[] = [];
  const params: unknown[] = [];
  const columnMap: Record<string, string> = {
    title: "title",
    body: "body",
    audience: "audience",
    isPinned: "is_pinned",
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
  const { rowCount } = await query(
    `UPDATE announcements SET ${sets.join(", ")} WHERE id = $${params.length}`,
    params
  );
  if (!rowCount) throw ApiError.notFound("Announcement not found");
  return getAnnouncement(id);
}

export async function removeAnnouncement(id: string): Promise<void> {
  const { rowCount } = await query("DELETE FROM announcements WHERE id = $1", [
    id,
  ]);
  if (!rowCount) throw ApiError.notFound("Announcement not found");
}
