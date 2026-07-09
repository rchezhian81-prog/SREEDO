import { query } from "../../db/postgres";
import { ApiError } from "../../utils/api-error";
import { assertTeachingStaff } from "../teachers/teachers.service";
import type { z } from "zod";
import type {
  createEntrySchema,
  createPeriodSchema,
  createRoomSchema,
  listEntriesQuerySchema,
  updateEntrySchema,
  updatePeriodSchema,
  updateRoomSchema,
} from "./timetable.schema";

const NIL_UUID = "00000000-0000-0000-0000-000000000000";

export const DAY_NAMES = [
  "",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { code?: string }).code === "23505"
  );
}

/** Builds a dynamic SET clause from a field→column map, skipping undefined. */
function buildSets(
  map: Record<string, string>,
  input: Record<string, unknown>
): { sets: string[]; params: unknown[] } {
  const sets: string[] = [];
  const params: unknown[] = [];
  for (const [field, column] of Object.entries(map)) {
    const value = input[field];
    if (value !== undefined) {
      params.push(value);
      sets.push(`${column} = $${params.length}`);
    }
  }
  if (!sets.length) throw ApiError.badRequest("No fields to update");
  return { sets, params };
}

// --- Period master ---

export async function listPeriods(institutionId: string) {
  const { rows } = await query(
    `SELECT id, name, start_time AS "startTime", end_time AS "endTime",
            sort_order AS "sortOrder", is_break AS "isBreak"
     FROM periods WHERE institution_id = $1
     ORDER BY sort_order, start_time`,
    [institutionId]
  );
  return rows;
}

export async function createPeriod(
  input: z.infer<typeof createPeriodSchema>,
  institutionId: string
) {
  try {
    const { rows } = await query(
      `INSERT INTO periods (institution_id, name, start_time, end_time, sort_order, is_break)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, name, start_time AS "startTime", end_time AS "endTime",
                 sort_order AS "sortOrder", is_break AS "isBreak"`,
      [
        institutionId,
        input.name,
        input.startTime,
        input.endTime,
        input.sortOrder ?? 0,
        input.isBreak ?? false,
      ]
    );
    return rows[0];
  } catch (err) {
    if (isUniqueViolation(err))
      throw ApiError.conflict("A period with that name already exists");
    throw err;
  }
}

const PERIOD_COLUMN_MAP: Record<string, string> = {
  name: "name",
  startTime: "start_time",
  endTime: "end_time",
  sortOrder: "sort_order",
  isBreak: "is_break",
};

export async function updatePeriod(
  id: string,
  input: z.infer<typeof updatePeriodSchema>,
  institutionId: string
) {
  const { sets, params } = buildSets(
    PERIOD_COLUMN_MAP,
    input as Record<string, unknown>
  );
  params.push(id, institutionId);
  try {
    const { rows } = await query(
      `UPDATE periods SET ${sets.join(", ")}
       WHERE id = $${params.length - 1} AND institution_id = $${params.length}
       RETURNING id, name, start_time AS "startTime", end_time AS "endTime",
                 sort_order AS "sortOrder", is_break AS "isBreak"`,
      params
    );
    if (!rows[0]) throw ApiError.notFound("Period not found");
    return rows[0];
  } catch (err) {
    if (isUniqueViolation(err))
      throw ApiError.conflict("A period with that name already exists");
    throw err;
  }
}

export async function deletePeriod(
  id: string,
  institutionId: string
): Promise<void> {
  const { rowCount } = await query(
    "DELETE FROM periods WHERE id = $1 AND institution_id = $2",
    [id, institutionId]
  );
  if (!rowCount) throw ApiError.notFound("Period not found");
}

// --- Room master ---

export async function listRooms(institutionId: string) {
  const { rows } = await query(
    `SELECT id, name, code, capacity, building
     FROM rooms WHERE institution_id = $1
     ORDER BY name`,
    [institutionId]
  );
  return rows;
}

export async function createRoom(
  input: z.infer<typeof createRoomSchema>,
  institutionId: string
) {
  try {
    const { rows } = await query(
      `INSERT INTO rooms (institution_id, name, code, capacity, building)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, name, code, capacity, building`,
      [
        institutionId,
        input.name,
        input.code,
        input.capacity ?? null,
        input.building ?? null,
      ]
    );
    return rows[0];
  } catch (err) {
    if (isUniqueViolation(err))
      throw ApiError.conflict("A room with that code already exists");
    throw err;
  }
}

const ROOM_COLUMN_MAP: Record<string, string> = {
  name: "name",
  code: "code",
  capacity: "capacity",
  building: "building",
};

export async function updateRoom(
  id: string,
  input: z.infer<typeof updateRoomSchema>,
  institutionId: string
) {
  const { sets, params } = buildSets(
    ROOM_COLUMN_MAP,
    input as Record<string, unknown>
  );
  params.push(id, institutionId);
  try {
    const { rows } = await query(
      `UPDATE rooms SET ${sets.join(", ")}
       WHERE id = $${params.length - 1} AND institution_id = $${params.length}
       RETURNING id, name, code, capacity, building`,
      params
    );
    if (!rows[0]) throw ApiError.notFound("Room not found");
    return rows[0];
  } catch (err) {
    if (isUniqueViolation(err))
      throw ApiError.conflict("A room with that code already exists");
    throw err;
  }
}

export async function deleteRoom(
  id: string,
  institutionId: string
): Promise<void> {
  const { rowCount } = await query(
    "DELETE FROM rooms WHERE id = $1 AND institution_id = $2",
    [id, institutionId]
  );
  if (!rowCount) throw ApiError.notFound("Room not found");
}

// --- Timetable entries ---

const ENTRY_SELECT = `
  te.id,
  te.section_id AS "sectionId",
  sec.name AS "sectionName",
  c.name AS "className",
  te.day_of_week AS "dayOfWeek",
  te.period_id AS "periodId",
  p.name AS "periodName",
  p.start_time AS "startTime",
  p.end_time AS "endTime",
  p.sort_order AS "periodOrder",
  te.subject_id AS "subjectId",
  subj.name AS "subjectName",
  te.teacher_id AS "teacherId",
  CASE WHEN t.id IS NULL THEN NULL ELSE t.first_name || ' ' || t.last_name END AS "teacherName",
  te.room_id AS "roomId",
  r.name AS "roomName"
FROM timetable_entries te
JOIN sections sec ON sec.id = te.section_id
JOIN classes c ON c.id = sec.class_id
JOIN periods p ON p.id = te.period_id
JOIN subjects subj ON subj.id = te.subject_id
LEFT JOIN teachers t ON t.id = te.teacher_id
LEFT JOIN rooms r ON r.id = te.room_id`;

export async function listEntries(
  filters: z.infer<typeof listEntriesQuerySchema>,
  institutionId: string
) {
  const params: unknown[] = [institutionId];
  const conditions = ["te.institution_id = $1"];
  for (const [key, column] of [
    ["sectionId", "te.section_id"],
    ["teacherId", "te.teacher_id"],
    ["roomId", "te.room_id"],
    ["dayOfWeek", "te.day_of_week"],
  ] as const) {
    const value = filters[key];
    if (value !== undefined) {
      params.push(value);
      conditions.push(`${column} = $${params.length}`);
    }
  }
  const { rows } = await query(
    `SELECT ${ENTRY_SELECT} WHERE ${conditions.join(" AND ")}
     ORDER BY te.day_of_week, p.sort_order, p.start_time`,
    params
  );
  return rows;
}

export async function getEntry(id: string, institutionId: string) {
  const { rows } = await query(
    `SELECT ${ENTRY_SELECT} WHERE te.id = $1 AND te.institution_id = $2`,
    [id, institutionId]
  );
  if (!rows[0]) throw ApiError.notFound("Timetable entry not found");
  return rows[0];
}

async function assertRef(
  table: "sections" | "periods" | "subjects" | "teachers" | "rooms",
  id: string,
  institutionId: string,
  label: string
): Promise<void> {
  const { rows } = await query(
    `SELECT 1 FROM ${table} WHERE id = $1 AND institution_id = $2`,
    [id, institutionId]
  );
  if (!rows[0]) throw ApiError.badRequest(`Invalid ${label}`);
}

type Slot = {
  sectionId: string;
  dayOfWeek: number;
  periodId: string;
  subjectId: string;
  teacherId?: string | null;
  roomId?: string | null;
};

/** Throws 409 if the slot clashes with an existing section/teacher/room booking. */
async function assertNoConflicts(
  slot: Slot,
  institutionId: string,
  excludeId: string | null
): Promise<void> {
  const { rows } = await query<{
    section_id: string;
    teacher_id: string | null;
    room_id: string | null;
    class_name: string;
    section_name: string;
    teacher_name: string | null;
    room_name: string | null;
    period_name: string;
    subject_name: string;
  }>(
    `SELECT te.section_id, te.teacher_id, te.room_id,
            c.name AS class_name, sec.name AS section_name,
            CASE WHEN t.id IS NULL THEN NULL ELSE t.first_name || ' ' || t.last_name END AS teacher_name,
            r.name AS room_name, p.name AS period_name, subj.name AS subject_name
     FROM timetable_entries te
     JOIN sections sec ON sec.id = te.section_id
     JOIN classes c ON c.id = sec.class_id
     JOIN periods p ON p.id = te.period_id
     JOIN subjects subj ON subj.id = te.subject_id
     LEFT JOIN teachers t ON t.id = te.teacher_id
     LEFT JOIN rooms r ON r.id = te.room_id
     WHERE te.institution_id = $1 AND te.day_of_week = $2 AND te.period_id = $3
       AND te.id <> $4
       AND ( te.section_id = $5
          OR ($6::uuid IS NOT NULL AND te.teacher_id = $6::uuid)
          OR ($7::uuid IS NOT NULL AND te.room_id = $7::uuid) )`,
    [
      institutionId,
      slot.dayOfWeek,
      slot.periodId,
      excludeId ?? NIL_UUID,
      slot.sectionId,
      slot.teacherId ?? null,
      slot.roomId ?? null,
    ]
  );

  const conflicts: string[] = [];
  for (const row of rows) {
    if (row.section_id === slot.sectionId) {
      conflicts.push(
        `${row.class_name} ${row.section_name} already has ${row.subject_name} in ${row.period_name}`
      );
    }
    if (slot.teacherId && row.teacher_id === slot.teacherId) {
      conflicts.push(
        `Teacher ${row.teacher_name} is already booked in ${row.period_name}`
      );
    }
    if (slot.roomId && row.room_id === slot.roomId) {
      conflicts.push(
        `Room ${row.room_name} is already booked in ${row.period_name}`
      );
    }
  }
  if (conflicts.length) {
    throw ApiError.conflict(conflicts.join("; "));
  }
}

export async function createEntry(
  input: z.infer<typeof createEntrySchema>,
  institutionId: string
) {
  await assertRef("sections", input.sectionId, institutionId, "section");
  await assertRef("periods", input.periodId, institutionId, "period");
  await assertRef("subjects", input.subjectId, institutionId, "subject");
  if (input.teacherId)
    await assertTeachingStaff(input.teacherId, institutionId);
  if (input.roomId)
    await assertRef("rooms", input.roomId, institutionId, "room");

  await assertNoConflicts(input, institutionId, null);

  try {
    const { rows } = await query<{ id: string }>(
      `INSERT INTO timetable_entries
         (institution_id, section_id, day_of_week, period_id, subject_id, teacher_id, room_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [
        institutionId,
        input.sectionId,
        input.dayOfWeek,
        input.periodId,
        input.subjectId,
        input.teacherId ?? null,
        input.roomId ?? null,
      ]
    );
    return getEntry(rows[0].id, institutionId);
  } catch (err) {
    if (isUniqueViolation(err))
      throw ApiError.conflict("That timetable slot is already taken");
    throw err;
  }
}

export async function updateEntry(
  id: string,
  input: z.infer<typeof updateEntrySchema>,
  institutionId: string
) {
  const existing = await query<{
    section_id: string;
    day_of_week: number;
    period_id: string;
    subject_id: string;
    teacher_id: string | null;
    room_id: string | null;
  }>(
    `SELECT section_id, day_of_week, period_id, subject_id, teacher_id, room_id
     FROM timetable_entries WHERE id = $1 AND institution_id = $2`,
    [id, institutionId]
  );
  if (!existing.rows[0]) throw ApiError.notFound("Timetable entry not found");
  const current = existing.rows[0];

  const slot: Slot = {
    sectionId: input.sectionId ?? current.section_id,
    dayOfWeek: input.dayOfWeek ?? current.day_of_week,
    periodId: input.periodId ?? current.period_id,
    subjectId: input.subjectId ?? current.subject_id,
    teacherId: input.teacherId !== undefined ? input.teacherId : current.teacher_id,
    roomId: input.roomId !== undefined ? input.roomId : current.room_id,
  };

  await assertRef("sections", slot.sectionId, institutionId, "section");
  await assertRef("periods", slot.periodId, institutionId, "period");
  await assertRef("subjects", slot.subjectId, institutionId, "subject");
  if (slot.teacherId)
    await assertRef("teachers", slot.teacherId, institutionId, "teacher");
  if (slot.roomId) await assertRef("rooms", slot.roomId, institutionId, "room");

  await assertNoConflicts(slot, institutionId, id);

  try {
    await query(
      `UPDATE timetable_entries
       SET section_id = $1, day_of_week = $2, period_id = $3, subject_id = $4,
           teacher_id = $5, room_id = $6, updated_at = now()
       WHERE id = $7 AND institution_id = $8`,
      [
        slot.sectionId,
        slot.dayOfWeek,
        slot.periodId,
        slot.subjectId,
        slot.teacherId ?? null,
        slot.roomId ?? null,
        id,
        institutionId,
      ]
    );
    return getEntry(id, institutionId);
  } catch (err) {
    if (isUniqueViolation(err))
      throw ApiError.conflict("That timetable slot is already taken");
    throw err;
  }
}

export async function deleteEntry(
  id: string,
  institutionId: string
): Promise<void> {
  const { rowCount } = await query(
    "DELETE FROM timetable_entries WHERE id = $1 AND institution_id = $2",
    [id, institutionId]
  );
  if (!rowCount) throw ApiError.notFound("Timetable entry not found");
}

/** Flat CSV of a section or teacher timetable for printing/export. */
export async function exportCsv(
  filters: { sectionId?: string; teacherId?: string },
  institutionId: string
): Promise<string> {
  const rows = await listEntries(filters, institutionId);
  const header = [
    "Day",
    "Period",
    "Start",
    "End",
    "Class",
    "Section",
    "Subject",
    "Teacher",
    "Room",
  ];
  const escape = (value: unknown) => {
    const s = value == null ? "" : String(value);
    return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
  };
  const lines = [header.join(",")];
  for (const r of rows as Array<Record<string, unknown>>) {
    lines.push(
      [
        DAY_NAMES[Number(r.dayOfWeek)] ?? r.dayOfWeek,
        r.periodName,
        r.startTime,
        r.endTime,
        r.className,
        r.sectionName,
        r.subjectName,
        r.teacherName ?? "",
        r.roomName ?? "",
      ]
        .map(escape)
        .join(",")
    );
  }
  return lines.join("\n");
}
