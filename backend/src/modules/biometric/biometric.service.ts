import { randomBytes } from "node:crypto";
import { query } from "../../db/postgres";
import { ApiError } from "../../utils/api-error";
import { paginatedResponse, type Pagination } from "../../utils/pagination";
import type { z } from "zod";
import type {
  createDeviceSchema,
  updateDeviceSchema,
  listEventsQuerySchema,
  ingestSchema,
} from "./biometric.schema";

const DEVICE_SELECT = `
  id,
  name,
  device_key AS "deviceKey",
  location,
  is_active AS "isActive",
  created_at AS "createdAt"
FROM biometric_devices`;

// ------------------------------------------------------------------ devices

export async function listDevices(institutionId: string) {
  const { rows } = await query(
    `SELECT ${DEVICE_SELECT} WHERE institution_id = $1 ORDER BY created_at DESC`,
    [institutionId]
  );
  return rows;
}

export async function getDevice(id: string, institutionId: string) {
  const { rows } = await query(
    `SELECT ${DEVICE_SELECT} WHERE id = $1 AND institution_id = $2`,
    [id, institutionId]
  );
  if (!rows[0]) throw ApiError.notFound("Device not found");
  return rows[0];
}

export async function createDevice(
  input: z.infer<typeof createDeviceSchema>,
  institutionId: string
) {
  const deviceKey = randomBytes(24).toString("hex");
  const { rows } = await query<{ id: string }>(
    `INSERT INTO biometric_devices (institution_id, name, device_key, location)
     VALUES ($1,$2,$3,$4) RETURNING id`,
    [institutionId, input.name, deviceKey, input.location ?? null]
  );
  return getDevice(rows[0].id, institutionId);
}

const DEVICE_UPDATE_MAP: Record<string, string> = {
  name: "name",
  location: "location",
  isActive: "is_active",
};

export async function updateDevice(
  id: string,
  input: z.infer<typeof updateDeviceSchema>,
  institutionId: string
) {
  const sets: string[] = [];
  const params: unknown[] = [];
  for (const [field, column] of Object.entries(DEVICE_UPDATE_MAP)) {
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
    `UPDATE biometric_devices SET ${sets.join(", ")}
     WHERE id = $${params.length - 1} AND institution_id = $${params.length}`,
    params
  );
  if (!rowCount) throw ApiError.notFound("Device not found");
  return getDevice(id, institutionId);
}

export async function deleteDevice(id: string, institutionId: string): Promise<void> {
  const { rowCount } = await query(
    "DELETE FROM biometric_devices WHERE id = $1 AND institution_id = $2",
    [id, institutionId]
  );
  if (!rowCount) throw ApiError.notFound("Device not found");
}

// ------------------------------------------------------------------- events

export async function listEvents(
  pagination: Pagination,
  filters: z.infer<typeof listEventsQuerySchema>,
  institutionId: string
) {
  const params: unknown[] = [institutionId];
  const conditions: string[] = ["e.institution_id = $1"];
  if (filters.deviceId) {
    params.push(filters.deviceId);
    conditions.push(`e.device_id = $${params.length}`);
  }
  if (filters.dateFrom) {
    params.push(filters.dateFrom);
    conditions.push(`e.event_time >= $${params.length}`);
  }
  if (filters.dateTo) {
    params.push(filters.dateTo);
    conditions.push(`e.event_time < ($${params.length}::date + 1)`);
  }
  const where = `WHERE ${conditions.join(" AND ")}`;
  const countResult = await query<{ count: string }>(
    `SELECT count(*) FROM biometric_events e ${where}`,
    params
  );
  const { rows } = await query(
    `SELECT e.id, e.identifier, e.event_type AS "eventType", e.event_time AS "eventTime",
            e.device_id AS "deviceId", d.name AS "deviceName",
            e.student_id AS "studentId",
            CASE WHEN s.id IS NULL THEN NULL ELSE (s.first_name || ' ' || s.last_name) END AS "studentName"
     FROM biometric_events e
     JOIN biometric_devices d ON d.id = e.device_id
     LEFT JOIN students s ON s.id = e.student_id
     ${where}
     ORDER BY e.event_time DESC
     LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, pagination.limit, pagination.offset]
  );
  return paginatedResponse(rows, Number(countResult.rows[0].count), pagination);
}

// ------------------------------------------------------- device ingest (no JWT)

export async function ingest(deviceKey: string, input: z.infer<typeof ingestSchema>) {
  const device = await query<{ id: string; institution_id: string }>(
    "SELECT id, institution_id FROM biometric_devices WHERE device_key = $1 AND is_active = true",
    [deviceKey]
  );
  if (!device.rows[0]) throw ApiError.unauthorized("Invalid or inactive device key");
  const { id: deviceId, institution_id: institutionId } = device.rows[0];

  // Resolve the scanned identifier to a student by admission number.
  const student = await query<{ id: string }>(
    "SELECT id FROM students WHERE admission_no = $1 AND institution_id = $2",
    [input.identifier, institutionId]
  );
  const studentId = student.rows[0]?.id ?? null;
  const eventType = input.eventType ?? "in";

  await query(
    `INSERT INTO biometric_events (institution_id, device_id, identifier, student_id, event_type, event_time)
     VALUES ($1,$2,$3,$4,$5, COALESCE($6::timestamptz, now()))`,
    [institutionId, deviceId, input.identifier, studentId, eventType, input.eventTime ?? null]
  );

  // An 'in' scan marks the student present for the day (without overriding an
  // attendance record already set manually).
  let attendanceMarked = false;
  if (studentId && eventType === "in") {
    const res = await query(
      `INSERT INTO attendance_records (institution_id, student_id, date, status)
       VALUES ($1,$2,CURRENT_DATE,'present')
       ON CONFLICT (student_id, date) DO NOTHING`,
      [institutionId, studentId]
    );
    attendanceMarked = (res.rowCount ?? 0) > 0;
  }

  return { recorded: true, matched: studentId !== null, attendanceMarked };
}
