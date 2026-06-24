import { query } from "../../db/postgres";
import { ApiError } from "../../utils/api-error";
import type { z } from "zod";
import type {
  createEventSchema,
  updateEventSchema,
  listEventsQuerySchema,
} from "./calendar.schema";

const SELECT = `
  e.id,
  e.title,
  e.description,
  to_char(e.event_date, 'YYYY-MM-DD') AS "eventDate",
  to_char(e.end_date, 'YYYY-MM-DD') AS "endDate",
  e.type,
  e.all_day AS "allDay",
  e.created_at AS "createdAt"
FROM calendar_events e`;

export async function listEvents(
  filters: z.infer<typeof listEventsQuerySchema>,
  institutionId: string
) {
  const params: unknown[] = [institutionId];
  const conditions: string[] = ["e.institution_id = $1"];
  if (filters.type) {
    params.push(filters.type);
    conditions.push(`e.type = $${params.length}`);
  }
  if (filters.dateFrom) {
    params.push(filters.dateFrom);
    conditions.push(`e.event_date >= $${params.length}`);
  }
  if (filters.dateTo) {
    params.push(filters.dateTo);
    conditions.push(`e.event_date <= $${params.length}`);
  }
  const where = `WHERE ${conditions.join(" AND ")}`;
  const { rows } = await query(
    `SELECT ${SELECT} ${where} ORDER BY e.event_date ASC, e.created_at ASC LIMIT 1000`,
    params
  );
  return rows;
}

export async function getEvent(id: string, institutionId: string) {
  const { rows } = await query(
    `SELECT ${SELECT} WHERE e.id = $1 AND e.institution_id = $2`,
    [id, institutionId]
  );
  if (!rows[0]) throw ApiError.notFound("Event not found");
  return rows[0];
}

export async function createEvent(
  input: z.infer<typeof createEventSchema>,
  institutionId: string,
  userId: string
) {
  const { rows } = await query<{ id: string }>(
    `INSERT INTO calendar_events (
       institution_id, title, description, event_date, end_date, type, all_day, created_by
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     RETURNING id`,
    [
      institutionId,
      input.title,
      input.description ?? null,
      input.eventDate,
      input.endDate ?? null,
      input.type ?? "event",
      input.allDay ?? true,
      userId,
    ]
  );
  return getEvent(rows[0].id, institutionId);
}

const UPDATE_COLUMN_MAP: Record<string, string> = {
  title: "title",
  description: "description",
  eventDate: "event_date",
  endDate: "end_date",
  type: "type",
  allDay: "all_day",
};

export async function updateEvent(
  id: string,
  input: z.infer<typeof updateEventSchema>,
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
    `UPDATE calendar_events SET ${sets.join(", ")}
     WHERE id = $${params.length - 1} AND institution_id = $${params.length}`,
    params
  );
  if (!rowCount) throw ApiError.notFound("Event not found");
  return getEvent(id, institutionId);
}

export async function deleteEvent(
  id: string,
  institutionId: string
): Promise<void> {
  const { rowCount } = await query(
    "DELETE FROM calendar_events WHERE id = $1 AND institution_id = $2",
    [id, institutionId]
  );
  if (!rowCount) throw ApiError.notFound("Event not found");
}
