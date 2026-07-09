import { query, withTransaction } from "../../db/postgres";
import { ApiError } from "../../utils/api-error";
import { paginatedResponse, type Pagination } from "../../utils/pagination";
import { childStudentIdsForUser } from "../students/students.service";
import { sendMessage } from "../communication/communication.service";
import type { z } from "zod";
import type {
  createMeetingSchema,
  updateMeetingSchema,
  listMeetingsQuerySchema,
  generateSlotsSchema,
  bookingSchema,
  updateBookingSchema,
  inviteSchema,
} from "./ptm.schema";

// Bookings in these states occupy a slot's capacity; 'cancelled' frees it.
const ACTIVE = "('booked','attended','no_show')";

async function assertRef(
  table: "sections" | "classes" | "semesters" | "batches" | "teachers" | "students",
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

const AUDIENCE_TABLE = {
  section: "sections", class: "classes", semester: "semesters", batch: "batches",
} as const;

// ---------------------------------------------------------------------------
// Meetings
// ---------------------------------------------------------------------------

const MEETING_COLS = `
  m.id, m.title, m.description, to_char(m.meeting_date, 'YYYY-MM-DD') AS "meetingDate",
  m.venue, m.mode, m.join_link AS "joinLink", m.audience_type AS "audienceType",
  m.audience_ref AS "audienceRef", m.status, m.created_at AS "createdAt", m.updated_at AS "updatedAt"`;
const MEETING_SELECT = `${MEETING_COLS} FROM ptm_meetings m`;

export async function listMeetings(
  pagination: Pagination,
  filters: z.infer<typeof listMeetingsQuerySchema>,
  institutionId: string
) {
  const params: unknown[] = [institutionId];
  const conditions = ["m.institution_id = $1"];
  if (filters.status) {
    params.push(filters.status);
    conditions.push(`m.status = $${params.length}`);
  }
  const where = `WHERE ${conditions.join(" AND ")}`;
  const count = await query<{ count: string }>(`SELECT count(*) FROM ptm_meetings m ${where}`, params);
  const { rows } = await query(
    `SELECT ${MEETING_COLS},
            (SELECT count(*) FROM ptm_slots s WHERE s.meeting_id = m.id) AS "slotCount",
            (SELECT count(*) FROM ptm_bookings b WHERE b.meeting_id = m.id AND b.status IN ${ACTIVE}) AS "bookingCount"
     FROM ptm_meetings m ${where} ORDER BY m.meeting_date DESC, m.created_at DESC
     LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, pagination.limit, pagination.offset]
  );
  return paginatedResponse(rows, Number(count.rows[0].count), pagination);
}

async function meetingRow(id: string, institutionId: string) {
  const { rows } = await query(`SELECT ${MEETING_SELECT} WHERE m.id = $1 AND m.institution_id = $2`, [id, institutionId]);
  if (!rows[0]) throw ApiError.notFound("Meeting not found");
  return rows[0] as Record<string, unknown>;
}

async function slotsFor(meetingId: string, institutionId: string) {
  const { rows } = await query(
    `SELECT s.id, s.teacher_id AS "teacherId",
            (t.first_name || ' ' || t.last_name) AS "teacherName",
            s.starts_at AS "startsAt", s.ends_at AS "endsAt", s.capacity, s.status,
            (SELECT count(*) FROM ptm_bookings b WHERE b.slot_id = s.id AND b.status IN ${ACTIVE}) AS "booked"
     FROM ptm_slots s JOIN teachers t ON t.id = s.teacher_id
     WHERE s.meeting_id = $1 AND s.institution_id = $2
     ORDER BY s.starts_at`,
    [meetingId, institutionId]
  );
  return rows;
}

async function bookingsFor(meetingId: string, institutionId: string) {
  const { rows } = await query(
    `SELECT b.id, b.slot_id AS "slotId", b.student_id AS "studentId",
            (st.first_name || ' ' || st.last_name) AS "studentName",
            b.parent_user_id AS "parentUserId", b.status, b.notes,
            s.starts_at AS "startsAt"
     FROM ptm_bookings b
     JOIN students st ON st.id = b.student_id
     JOIN ptm_slots s ON s.id = b.slot_id
     WHERE b.meeting_id = $1 AND b.institution_id = $2
     ORDER BY s.starts_at`,
    [meetingId, institutionId]
  );
  return rows;
}

export async function getMeeting(id: string, institutionId: string) {
  const meeting = await meetingRow(id, institutionId);
  return { ...meeting, slots: await slotsFor(id, institutionId), bookings: await bookingsFor(id, institutionId) };
}

export async function createMeeting(
  input: z.infer<typeof createMeetingSchema>,
  institutionId: string,
  userId: string
) {
  const audienceType = input.audienceType ?? "all_parents";
  if (audienceType !== "all_parents") {
    if (!input.audienceRef) throw ApiError.badRequest("audienceRef is required for this audience");
    await assertRef(AUDIENCE_TABLE[audienceType], input.audienceRef, institutionId, `${audienceType} audience`);
  }
  const { rows } = await query<{ id: string }>(
    `INSERT INTO ptm_meetings (institution_id, title, description, meeting_date, venue, mode, join_link, audience_type, audience_ref, created_by)
     VALUES ($1,$2,$3,$4,$5,COALESCE($6,'in_person'),$7,$8,$9,$10) RETURNING id`,
    [
      institutionId, input.title, input.description ?? null, input.meetingDate, input.venue ?? null,
      input.mode ?? null, input.joinLink ?? null, audienceType,
      audienceType === "all_parents" ? null : input.audienceRef, userId,
    ]
  );
  return getMeeting(rows[0].id, institutionId);
}

const MEETING_COLUMN_MAP: Record<string, string> = {
  title: "title", description: "description", meetingDate: "meeting_date",
  venue: "venue", mode: "mode", joinLink: "join_link", status: "status",
};

export async function updateMeeting(
  id: string,
  input: z.infer<typeof updateMeetingSchema>,
  institutionId: string
) {
  const sets: string[] = [];
  const params: unknown[] = [];
  for (const [field, col] of Object.entries(MEETING_COLUMN_MAP)) {
    const v = (input as Record<string, unknown>)[field];
    if (v !== undefined) {
      params.push(v);
      sets.push(`${col} = $${params.length}`);
    }
  }
  if (!sets.length) throw ApiError.badRequest("No fields to update");
  sets.push("updated_at = now()");
  params.push(id, institutionId);
  const { rowCount } = await query(
    `UPDATE ptm_meetings SET ${sets.join(", ")} WHERE id = $${params.length - 1} AND institution_id = $${params.length}`,
    params
  );
  if (!rowCount) throw ApiError.notFound("Meeting not found");
  return getMeeting(id, institutionId);
}

export async function deleteMeeting(id: string, institutionId: string): Promise<void> {
  const { rowCount } = await query("DELETE FROM ptm_meetings WHERE id = $1 AND institution_id = $2", [id, institutionId]);
  if (!rowCount) throw ApiError.notFound("Meeting not found");
}

export async function meetingSummary(id: string, institutionId: string) {
  await meetingRow(id, institutionId);
  const { rows } = await query<Record<string, string>>(
    `SELECT
       (SELECT count(*) FROM ptm_slots WHERE meeting_id = $1 AND institution_id = $2) AS slots,
       (SELECT count(*) FROM ptm_bookings WHERE meeting_id = $1 AND institution_id = $2 AND status IN ${ACTIVE}) AS booked,
       (SELECT count(*) FROM ptm_bookings WHERE meeting_id = $1 AND institution_id = $2 AND status = 'attended') AS attended,
       (SELECT count(*) FROM ptm_bookings WHERE meeting_id = $1 AND institution_id = $2 AND status = 'no_show') AS "noShow"`,
    [id, institutionId]
  );
  const r = rows[0];
  return { slots: Number(r.slots), booked: Number(r.booked), attended: Number(r.attended), noShow: Number(r.noShow) };
}

// ---------------------------------------------------------------------------
// Slots
// ---------------------------------------------------------------------------

export async function generateSlots(
  meetingId: string,
  input: z.infer<typeof generateSlotsSchema>,
  institutionId: string
) {
  await meetingRow(meetingId, institutionId);
  await assertRef("teachers", input.teacherId, institutionId, "teacher");
  const start = new Date(input.startsAt);
  const end = new Date(input.endsAt);
  if (!(end.getTime() > start.getTime())) throw ApiError.badRequest("End time must be after start time");
  const stepMs = (input.slotMinutes ?? Math.round((end.getTime() - start.getTime()) / 60000)) * 60000;
  if (stepMs <= 0) throw ApiError.badRequest("Invalid slot length");
  const windows: [Date, Date][] = [];
  for (let t = start.getTime(); t < end.getTime(); t += stepMs) {
    windows.push([new Date(t), new Date(Math.min(t + stepMs, end.getTime()))]);
    if (windows.length > 100) throw ApiError.badRequest("Too many slots (max 100)");
  }
  await withTransaction(async (client) => {
    for (const [s, e] of windows) {
      await client.query(
        `INSERT INTO ptm_slots (institution_id, meeting_id, teacher_id, starts_at, ends_at, capacity)
         VALUES ($1,$2,$3,$4,$5,COALESCE($6,1))`,
        [institutionId, meetingId, input.teacherId, s.toISOString(), e.toISOString(), input.capacity ?? null]
      );
    }
  });
  return { created: windows.length, slots: await slotsFor(meetingId, institutionId) };
}

export async function deleteSlot(id: string, institutionId: string): Promise<void> {
  const active = await query(
    `SELECT 1 FROM ptm_bookings WHERE slot_id = $1 AND institution_id = $2 AND status IN ${ACTIVE} LIMIT 1`,
    [id, institutionId]
  );
  if (active.rows[0]) throw ApiError.badRequest("Cannot delete a slot that has active bookings");
  const { rowCount } = await query("DELETE FROM ptm_slots WHERE id = $1 AND institution_id = $2", [id, institutionId]);
  if (!rowCount) throw ApiError.notFound("Slot not found");
}

// ---------------------------------------------------------------------------
// Bookings — shared core enforces capacity + one-active-booking-per-meeting.
// ---------------------------------------------------------------------------

async function insertBooking(opts: {
  slotId: string; studentId: string; parentUserId: string | null; createdBy: string; institutionId: string;
}) {
  const { slotId, studentId, parentUserId, createdBy, institutionId } = opts;
  return withTransaction(async (client) => {
    const slot = await client.query<{ capacity: number; status: string; meeting_id: string }>(
      "SELECT capacity, status, meeting_id FROM ptm_slots WHERE id = $1 AND institution_id = $2 FOR UPDATE",
      [slotId, institutionId]
    );
    if (!slot.rows[0]) throw ApiError.notFound("Slot not found");
    if (slot.rows[0].status !== "open") throw ApiError.badRequest("This slot is not open for booking");
    const meetingId = slot.rows[0].meeting_id;

    // One active booking per student per meeting (in any slot).
    const dup = await client.query(
      `SELECT id FROM ptm_bookings WHERE meeting_id = $1 AND student_id = $2 AND status IN ${ACTIVE}`,
      [meetingId, studentId]
    );
    if (dup.rows[0]) throw ApiError.badRequest("This student already has a booking for this meeting");

    const taken = await client.query<{ c: string }>(
      `SELECT count(*) c FROM ptm_bookings WHERE slot_id = $1 AND status IN ${ACTIVE}`,
      [slotId]
    );
    if (Number(taken.rows[0].c) >= slot.rows[0].capacity) throw ApiError.badRequest("This slot is full");

    // Reactivate a prior cancelled booking for the same (slot, student), else insert.
    const revived = await client.query<{ id: string }>(
      `UPDATE ptm_bookings SET status = 'booked', parent_user_id = $3, updated_at = now()
       WHERE slot_id = $1 AND student_id = $2 AND status = 'cancelled' RETURNING id`,
      [slotId, studentId, parentUserId]
    );
    if (revived.rows[0]) return revived.rows[0].id;

    const ins = await client.query<{ id: string }>(
      `INSERT INTO ptm_bookings (institution_id, meeting_id, slot_id, student_id, parent_user_id, created_by)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [institutionId, meetingId, slotId, studentId, parentUserId, createdBy]
    );
    return ins.rows[0].id;
  });
}

async function bookingView(id: string, institutionId: string) {
  const { rows } = await query(
    `SELECT b.id, b.meeting_id AS "meetingId", b.slot_id AS "slotId", b.student_id AS "studentId",
            (st.first_name || ' ' || st.last_name) AS "studentName", b.parent_user_id AS "parentUserId",
            b.status, b.notes, s.starts_at AS "startsAt", s.ends_at AS "endsAt"
     FROM ptm_bookings b JOIN students st ON st.id = b.student_id JOIN ptm_slots s ON s.id = b.slot_id
     WHERE b.id = $1 AND b.institution_id = $2`,
    [id, institutionId]
  );
  if (!rows[0]) throw ApiError.notFound("Booking not found");
  return rows[0];
}

/** Staff booking (ptm:manage): any in-tenant student. */
export async function staffBook(
  input: z.infer<typeof bookingSchema>,
  institutionId: string,
  userId: string
) {
  await assertRef("students", input.studentId, institutionId, "student");
  const id = await insertBooking({ slotId: input.slotId, studentId: input.studentId, parentUserId: null, createdBy: userId, institutionId });
  return bookingView(id, institutionId);
}

/** Parent booking: the student MUST be one of the caller's linked children. */
export async function parentBook(
  input: z.infer<typeof bookingSchema>,
  institutionId: string,
  parentUserId: string
) {
  const children = await childStudentIdsForUser(parentUserId, institutionId);
  if (!children.includes(input.studentId)) throw ApiError.forbidden("You can only book for your own child");
  const id = await insertBooking({ slotId: input.slotId, studentId: input.studentId, parentUserId, createdBy: parentUserId, institutionId });
  return bookingView(id, institutionId);
}

/** Attendance / notes (staff only). */
export async function updateBooking(
  id: string,
  input: z.infer<typeof updateBookingSchema>,
  institutionId: string
) {
  const sets: string[] = [];
  const params: unknown[] = [];
  if (input.status !== undefined) { params.push(input.status); sets.push(`status = $${params.length}`); }
  if (input.notes !== undefined) { params.push(input.notes); sets.push(`notes = $${params.length}`); }
  if (!sets.length) throw ApiError.badRequest("No fields to update");
  sets.push("updated_at = now()");
  params.push(id, institutionId);
  const { rowCount } = await query(
    `UPDATE ptm_bookings SET ${sets.join(", ")} WHERE id = $${params.length - 1} AND institution_id = $${params.length}`,
    params
  );
  if (!rowCount) throw ApiError.notFound("Booking not found");
  return bookingView(id, institutionId);
}

/** Cancel: staff may cancel any; a parent may cancel only their own booking. */
export async function cancelBooking(
  id: string,
  institutionId: string,
  actor: { userId: string; isStaff: boolean }
): Promise<void> {
  const { rows } = await query<{ parent_user_id: string | null }>(
    "SELECT parent_user_id FROM ptm_bookings WHERE id = $1 AND institution_id = $2",
    [id, institutionId]
  );
  if (!rows[0]) throw ApiError.notFound("Booking not found");
  if (!actor.isStaff && rows[0].parent_user_id !== actor.userId) {
    throw ApiError.forbidden("You can only cancel your own booking");
  }
  await query("UPDATE ptm_bookings SET status = 'cancelled', updated_at = now() WHERE id = $1 AND institution_id = $2", [id, institutionId]);
}

// ---------------------------------------------------------------------------
// Invites — reuse the communication surface (in-app inbox + best-effort external).
// ---------------------------------------------------------------------------

export async function sendInvite(
  meetingId: string,
  input: z.infer<typeof inviteSchema>,
  institutionId: string,
  senderId: string
) {
  const m = await meetingRow(meetingId, institutionId);
  const subject = input.subject ?? `Parent-Teacher Meeting: ${m.title as string}`;
  const body =
    input.message ??
    `You are invited to "${m.title as string}" on ${m.meetingDate as string}` +
      `${m.venue ? ` at ${m.venue as string}` : ""}. Please book a slot with the teacher.`;
  // Reuse communication.sendMessage: it writes the in-app inbox and best-effort
  // external delivery (never blocks/fails), so invites degrade gracefully.
  const result = await sendMessage(
    senderId,
    {
      audienceType: m.audienceType as never,
      audienceRef: (m.audienceRef as string | null) ?? undefined,
      category: "message",
      subject,
      body,
    },
    institutionId
  );
  return { sent: true, recipients: result.recipientCount };
}

// ---------------------------------------------------------------------------
// Parent-facing (guardian-scoped) views
// ---------------------------------------------------------------------------

async function childContext(childIds: string[], institutionId: string) {
  if (!childIds.length) return { sectionIds: [], classIds: [], semesterIds: [], batchIds: [] };
  const sec = await query<{ section_id: string | null; class_id: string | null }>(
    `SELECT s.section_id, sec.class_id FROM students s
     LEFT JOIN sections sec ON sec.id = s.section_id
     WHERE s.id = ANY($1::uuid[]) AND s.institution_id = $2`,
    [childIds, institutionId]
  );
  const enr = await query<{ semester_id: string | null; batch_id: string | null }>(
    `SELECT semester_id, batch_id FROM enrollments
     WHERE student_id = ANY($1::uuid[]) AND institution_id = $2 AND status = 'active'`,
    [childIds, institutionId]
  );
  const nn = <T>(a: (T | null)[]) => [...new Set(a.filter((x): x is T => x !== null))];
  return {
    sectionIds: nn(sec.rows.map((r) => r.section_id)),
    classIds: nn(sec.rows.map((r) => r.class_id)),
    semesterIds: nn(enr.rows.map((r) => r.semester_id)),
    batchIds: nn(enr.rows.map((r) => r.batch_id)),
  };
}

/** Scheduled meetings whose audience includes at least one of the parent's children. */
export async function listMeetingsForParent(parentUserId: string, institutionId: string) {
  const childIds = await childStudentIdsForUser(parentUserId, institutionId);
  if (!childIds.length) return { meetings: [], bookings: [] };
  const ctx = await childContext(childIds, institutionId);
  const { rows: meetings } = await query(
    `SELECT ${MEETING_SELECT}
     WHERE m.institution_id = $1 AND m.status = 'scheduled' AND (
       m.audience_type = 'all_parents'
       OR (m.audience_type = 'section'  AND m.audience_ref = ANY($2::uuid[]))
       OR (m.audience_type = 'class'    AND m.audience_ref = ANY($3::uuid[]))
       OR (m.audience_type = 'semester' AND m.audience_ref = ANY($4::uuid[]))
       OR (m.audience_type = 'batch'    AND m.audience_ref = ANY($5::uuid[]))
     ) ORDER BY m.meeting_date`,
    [institutionId, ctx.sectionIds, ctx.classIds, ctx.semesterIds, ctx.batchIds]
  );
  const { rows: bookings } = await query(
    `SELECT b.id, b.meeting_id AS "meetingId", b.slot_id AS "slotId", b.student_id AS "studentId",
            (st.first_name || ' ' || st.last_name) AS "studentName", b.status,
            s.starts_at AS "startsAt", s.ends_at AS "endsAt"
     FROM ptm_bookings b JOIN students st ON st.id = b.student_id JOIN ptm_slots s ON s.id = b.slot_id
     WHERE b.institution_id = $1 AND b.parent_user_id = $2 AND b.status IN ${ACTIVE}
     ORDER BY s.starts_at`,
    [institutionId, parentUserId]
  );
  return { meetings, bookings };
}

/** Open slots for a meeting the parent's child is targeted by (guardian-gated). */
export async function parentMeetingSlots(meetingId: string, parentUserId: string, institutionId: string) {
  const childIds = await childStudentIdsForUser(parentUserId, institutionId);
  if (!childIds.length) throw ApiError.forbidden("No linked students");
  const ctx = await childContext(childIds, institutionId);
  const allowed = await query(
    `SELECT 1 FROM ptm_meetings m
     WHERE m.id = $1 AND m.institution_id = $2 AND m.status = 'scheduled' AND (
       m.audience_type = 'all_parents'
       OR (m.audience_type = 'section'  AND m.audience_ref = ANY($3::uuid[]))
       OR (m.audience_type = 'class'    AND m.audience_ref = ANY($4::uuid[]))
       OR (m.audience_type = 'semester' AND m.audience_ref = ANY($5::uuid[]))
       OR (m.audience_type = 'batch'    AND m.audience_ref = ANY($6::uuid[]))
     )`,
    [meetingId, institutionId, ctx.sectionIds, ctx.classIds, ctx.semesterIds, ctx.batchIds]
  );
  if (!allowed.rows[0]) throw ApiError.forbidden("This meeting is not open to your children");
  return slotsFor(meetingId, institutionId);
}
