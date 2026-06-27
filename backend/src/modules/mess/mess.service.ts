import { query } from "../../db/postgres";
import { ApiError } from "../../utils/api-error";
import { paginatedResponse, type Pagination } from "../../utils/pagination";
import type { z } from "zod";
import type {
  createMenuItemSchema,
  updateMenuItemSchema,
  listMenuQuerySchema,
} from "./mess.schema";

const SELECT = `
  m.id,
  m.day_of_week AS "dayOfWeek",
  m.meal,
  m.items,
  m.notes,
  m.created_at AS "createdAt",
  m.updated_at AS "updatedAt"
FROM mess_menu_items m`;

// Natural meal order so a day's menu reads breakfast -> dinner.
const MEAL_ORDER = `CASE m.meal
  WHEN 'breakfast' THEN 0
  WHEN 'lunch' THEN 1
  WHEN 'snacks' THEN 2
  WHEN 'dinner' THEN 3
  ELSE 4 END`;

export async function listMenuItems(
  pagination: Pagination,
  filters: z.infer<typeof listMenuQuerySchema>,
  institutionId: string
) {
  const params: unknown[] = [institutionId];
  const conditions: string[] = ["m.institution_id = $1"];
  if (filters.dayOfWeek !== undefined) {
    params.push(filters.dayOfWeek);
    conditions.push(`m.day_of_week = $${params.length}`);
  }
  if (filters.meal) {
    params.push(filters.meal);
    conditions.push(`m.meal = $${params.length}`);
  }
  const where = `WHERE ${conditions.join(" AND ")}`;
  const countResult = await query<{ count: string }>(
    `SELECT count(*) FROM mess_menu_items m ${where}`,
    params
  );
  const { rows } = await query(
    `SELECT ${SELECT} ${where}
     ORDER BY m.day_of_week ASC, ${MEAL_ORDER} ASC
     LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, pagination.limit, pagination.offset]
  );
  return paginatedResponse(rows, Number(countResult.rows[0].count), pagination);
}

/** The whole week, ordered for display — used by the student/parent portal. */
export async function listWeeklyMenu(institutionId: string) {
  const { rows } = await query(
    `SELECT ${SELECT} WHERE m.institution_id = $1
     ORDER BY m.day_of_week ASC, ${MEAL_ORDER} ASC`,
    [institutionId]
  );
  return rows;
}

export async function getMenuItem(id: string, institutionId: string) {
  const { rows } = await query(
    `SELECT ${SELECT} WHERE m.id = $1 AND m.institution_id = $2`,
    [id, institutionId]
  );
  if (!rows[0]) throw ApiError.notFound("Menu item not found");
  return rows[0];
}

export async function createMenuItem(
  input: z.infer<typeof createMenuItemSchema>,
  institutionId: string,
  userId: string
) {
  const { rows } = await query<{ id: string }>(
    `INSERT INTO mess_menu_items (
       institution_id, day_of_week, meal, items, notes, created_by
     ) VALUES ($1,$2,$3,$4,$5,$6)
     RETURNING id`,
    [
      institutionId,
      input.dayOfWeek,
      input.meal,
      input.items,
      input.notes ?? null,
      userId,
    ]
  );
  return getMenuItem(rows[0].id, institutionId);
}

const UPDATE_COLUMN_MAP: Record<string, string> = {
  dayOfWeek: "day_of_week",
  meal: "meal",
  items: "items",
  notes: "notes",
};

export async function updateMenuItem(
  id: string,
  input: z.infer<typeof updateMenuItemSchema>,
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
    `UPDATE mess_menu_items SET ${sets.join(", ")}
     WHERE id = $${params.length - 1} AND institution_id = $${params.length}`,
    params
  );
  if (!rowCount) throw ApiError.notFound("Menu item not found");
  return getMenuItem(id, institutionId);
}

export async function deleteMenuItem(
  id: string,
  institutionId: string
): Promise<void> {
  const { rowCount } = await query(
    "DELETE FROM mess_menu_items WHERE id = $1 AND institution_id = $2",
    [id, institutionId]
  );
  if (!rowCount) throw ApiError.notFound("Menu item not found");
}
