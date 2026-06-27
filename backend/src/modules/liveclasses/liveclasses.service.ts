import { query } from "../../db/postgres";
import { ApiError } from "../../utils/api-error";
import type {
  CreateLiveClassInput,
  UpdateLiveClassInput,
} from "./liveclasses.schema";

const COLS = `id, title, description, subject, target, provider,
  join_url AS "joinUrl", host_name AS "hostName",
  scheduled_at AS "scheduledAt", duration_min AS "durationMin",
  status, created_at AS "createdAt"`;

export async function list(institutionId: string) {
  const { rows } = await query(
    `SELECT ${COLS} FROM live_classes
     WHERE institution_id = $1
     ORDER BY scheduled_at DESC`,
    [institutionId]
  );
  return rows;
}

export async function create(
  input: CreateLiveClassInput,
  institutionId: string,
  userId: string
) {
  const { rows } = await query(
    `INSERT INTO live_classes
       (institution_id, title, description, subject, target, provider,
        join_url, host_name, scheduled_at, duration_min, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     RETURNING ${COLS}`,
    [
      institutionId,
      input.title,
      input.description ?? null,
      input.subject ?? null,
      input.target ?? null,
      input.provider,
      input.joinUrl,
      input.hostName ?? null,
      input.scheduledAt,
      input.durationMin,
      userId,
    ]
  );
  return rows[0];
}

const FIELD_COLUMNS: Record<string, string> = {
  title: "title",
  description: "description",
  subject: "subject",
  target: "target",
  provider: "provider",
  joinUrl: "join_url",
  hostName: "host_name",
  scheduledAt: "scheduled_at",
  durationMin: "duration_min",
  status: "status",
};

export async function update(
  id: string,
  input: UpdateLiveClassInput,
  institutionId: string
) {
  const sets: string[] = [];
  const values: unknown[] = [];
  let i = 1;
  for (const [key, column] of Object.entries(FIELD_COLUMNS)) {
    const value = (input as Record<string, unknown>)[key];
    if (value !== undefined) {
      sets.push(`${column} = $${i++}`);
      values.push(value);
    }
  }
  sets.push("updated_at = now()");
  values.push(id, institutionId);
  const { rows } = await query(
    `UPDATE live_classes SET ${sets.join(", ")}
     WHERE id = $${i++} AND institution_id = $${i}
     RETURNING ${COLS}`,
    values
  );
  if (!rows[0]) throw ApiError.notFound("Live class not found");
  return rows[0];
}

export async function remove(id: string, institutionId: string): Promise<void> {
  const { rowCount } = await query(
    "DELETE FROM live_classes WHERE id = $1 AND institution_id = $2",
    [id, institutionId]
  );
  if (!rowCount) throw ApiError.notFound("Live class not found");
}
