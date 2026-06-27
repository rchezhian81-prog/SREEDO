import { query } from "../../db/postgres";
import { ApiError } from "../../utils/api-error";
import { paginatedResponse, type Pagination } from "../../utils/pagination";
import type { z } from "zod";
import type {
  createItemSchema,
  updateItemSchema,
  listItemsQuerySchema,
} from "./lostfound.schema";

const SELECT = `
  l.id,
  l.type,
  l.title,
  l.description,
  l.location,
  l.status,
  l.reporter_name AS "reporterName",
  l.reporter_contact AS "reporterContact",
  to_char(l.item_date, 'YYYY-MM-DD') AS "itemDate",
  l.created_at AS "createdAt"
FROM lost_found_items l`;

export async function listItems(
  pagination: Pagination,
  filters: z.infer<typeof listItemsQuerySchema>,
  institutionId: string
) {
  const params: unknown[] = [institutionId];
  const conditions: string[] = ["l.institution_id = $1"];
  if (filters.type) {
    params.push(filters.type);
    conditions.push(`l.type = $${params.length}`);
  }
  if (filters.status) {
    params.push(filters.status);
    conditions.push(`l.status = $${params.length}`);
  }
  if (filters.search) {
    params.push(`%${filters.search}%`);
    conditions.push(
      `(l.title ILIKE $${params.length} OR l.description ILIKE $${params.length} OR l.location ILIKE $${params.length})`
    );
  }
  const where = `WHERE ${conditions.join(" AND ")}`;
  const countResult = await query<{ count: string }>(
    `SELECT count(*) FROM lost_found_items l ${where}`,
    params
  );
  const { rows } = await query(
    `SELECT ${SELECT} ${where}
     ORDER BY (l.status = 'open') DESC, l.item_date DESC
     LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, pagination.limit, pagination.offset]
  );
  return paginatedResponse(rows, Number(countResult.rows[0].count), pagination);
}

export async function getItem(id: string, institutionId: string) {
  const { rows } = await query(
    `SELECT ${SELECT} WHERE l.id = $1 AND l.institution_id = $2`,
    [id, institutionId]
  );
  if (!rows[0]) throw ApiError.notFound("Item not found");
  return rows[0];
}

export async function createItem(
  input: z.infer<typeof createItemSchema>,
  institutionId: string,
  userId: string
) {
  const { rows } = await query<{ id: string }>(
    `INSERT INTO lost_found_items (
       institution_id, type, title, description, location, reporter_name,
       reporter_contact, item_date, created_by
     ) VALUES ($1,$2,$3,$4,$5,$6,$7, COALESCE($8::date, CURRENT_DATE), $9)
     RETURNING id`,
    [
      institutionId,
      input.type ?? "found",
      input.title,
      input.description ?? null,
      input.location ?? null,
      input.reporterName ?? null,
      input.reporterContact ?? null,
      input.itemDate ?? null,
      userId,
    ]
  );
  return getItem(rows[0].id, institutionId);
}

const UPDATE_COLUMN_MAP: Record<string, string> = {
  type: "type",
  title: "title",
  description: "description",
  location: "location",
  status: "status",
  reporterName: "reporter_name",
  reporterContact: "reporter_contact",
  itemDate: "item_date",
};

export async function updateItem(
  id: string,
  input: z.infer<typeof updateItemSchema>,
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
  params.push(id, institutionId);
  const { rowCount } = await query(
    `UPDATE lost_found_items SET ${sets.join(", ")}
     WHERE id = $${params.length - 1} AND institution_id = $${params.length}`,
    params
  );
  if (!rowCount) throw ApiError.notFound("Item not found");
  return getItem(id, institutionId);
}

export async function deleteItem(id: string, institutionId: string): Promise<void> {
  const { rowCount } = await query(
    "DELETE FROM lost_found_items WHERE id = $1 AND institution_id = $2",
    [id, institutionId]
  );
  if (!rowCount) throw ApiError.notFound("Item not found");
}
