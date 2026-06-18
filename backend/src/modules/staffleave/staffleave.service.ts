import { query, withTransaction } from "../../db/postgres";
import { ApiError } from "../../utils/api-error";
import type { z } from "zod";
import type {
  createLeaveRequestSchema,
  createLeaveTypeSchema,
  markAttendanceSchema,
  setBalanceSchema,
  updateAttendanceSchema,
  updateLeaveTypeSchema,
} from "./staffleave.schema";

function isUnique(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { code?: string }).code === "23505"
  );
}

function buildSets(
  map: Record<string, string>,
  input: Record<string, unknown>
): { sets: string[]; params: unknown[] } {
  const sets: string[] = [];
  const params: unknown[] = [];
  for (const [field, col] of Object.entries(map)) {
    if (input[field] !== undefined) {
      params.push(input[field]);
      sets.push(`${col} = $${params.length}`);
    }
  }
  if (!sets.length) throw ApiError.badRequest("No fields to update");
  return { sets, params };
}

function daysInclusive(start: string, end: string): number {
  const s = new Date(`${start}T00:00:00Z`).getTime();
  const e = new Date(`${end}T00:00:00Z`).getTime();
  return Math.round((e - s) / 86_400_000) + 1;
}

async function assertTeacher(teacherId: string, institutionId: string): Promise<void> {
  const { rows } = await query("SELECT 1 FROM teachers WHERE id = $1 AND institution_id = $2", [
    teacherId,
    institutionId,
  ]);
  if (!rows[0]) throw ApiError.badRequest("Invalid staff member");
}

/** The teacher record linked to a user login (teachers.user_id), or null. */
export async function teacherIdForUser(
  userId: string,
  institutionId: string
): Promise<string | null> {
  const { rows } = await query<{ id: string }>(
    "SELECT id FROM teachers WHERE user_id = $1 AND institution_id = $2",
    [userId, institutionId]
  );
  return rows[0]?.id ?? null;
}

// --- Staff attendance ---

export async function listAttendance(
  institutionId: string,
  filters: { date?: string; teacherId?: string; month?: string }
) {
  const params: unknown[] = [institutionId];
  const where = ["sa.institution_id = $1"];
  if (filters.date) {
    params.push(filters.date);
    where.push(`sa.date = $${params.length}`);
  }
  if (filters.month) {
    params.push(`${filters.month}-01`);
    where.push(`sa.date >= $${params.length}::date AND sa.date < ($${params.length}::date + interval '1 month')`);
  }
  if (filters.teacherId) {
    params.push(filters.teacherId);
    where.push(`sa.teacher_id = $${params.length}`);
  }
  const { rows } = await query(
    `SELECT sa.id, sa.teacher_id AS "teacherId", t.first_name || ' ' || t.last_name AS "teacherName",
            t.employee_no AS "employeeNo", sa.date, sa.status, sa.check_in AS "checkIn",
            sa.check_out AS "checkOut", sa.late, sa.early_out AS "earlyOut",
            sa.leave_type_id AS "leaveTypeId", sa.remarks
     FROM staff_attendance sa JOIN teachers t ON t.id = sa.teacher_id
     WHERE ${where.join(" AND ")}
     ORDER BY sa.date DESC, t.first_name`,
    params
  );
  return rows;
}

export async function markAttendance(
  input: z.infer<typeof markAttendanceSchema>,
  markedBy: string,
  institutionId: string
) {
  for (const e of input.entries) await assertTeacher(e.teacherId, institutionId);
  return withTransaction(async (client) => {
    let upserts = 0;
    for (const e of input.entries) {
      await client.query(
        `INSERT INTO staff_attendance (institution_id, teacher_id, date, status, check_in, check_out, late, early_out, remarks, marked_by)
         VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7, false), COALESCE($8, false), $9, $10)
         ON CONFLICT (institution_id, teacher_id, date)
         DO UPDATE SET status = EXCLUDED.status, check_in = EXCLUDED.check_in, check_out = EXCLUDED.check_out,
                       late = EXCLUDED.late, early_out = EXCLUDED.early_out, remarks = EXCLUDED.remarks,
                       marked_by = EXCLUDED.marked_by, updated_at = now()`,
        [
          institutionId,
          e.teacherId,
          input.date,
          e.status,
          e.checkIn ?? null,
          e.checkOut ?? null,
          e.late ?? null,
          e.earlyOut ?? null,
          e.remarks ?? null,
          markedBy,
        ]
      );
      upserts++;
    }
    return { date: input.date, marked: upserts };
  });
}

export async function updateAttendance(
  id: string,
  input: z.infer<typeof updateAttendanceSchema>,
  institutionId: string
) {
  const { sets, params } = buildSets(
    {
      status: "status",
      checkIn: "check_in",
      checkOut: "check_out",
      late: "late",
      earlyOut: "early_out",
      remarks: "remarks",
    },
    input as Record<string, unknown>
  );
  params.push(id, institutionId);
  const { rows } = await query(
    `UPDATE staff_attendance SET ${sets.join(", ")}
     WHERE id = $${params.length - 1} AND institution_id = $${params.length}
     RETURNING id, teacher_id AS "teacherId", date, status`,
    params
  );
  if (!rows[0]) throw ApiError.notFound("Attendance record not found");
  return rows[0];
}

export async function deleteAttendance(id: string, institutionId: string) {
  const { rowCount } = await query(
    "DELETE FROM staff_attendance WHERE id = $1 AND institution_id = $2",
    [id, institutionId]
  );
  if (!rowCount) throw ApiError.notFound("Attendance record not found");
}

/** Staff-wise monthly attendance summary (counts per status). */
export async function monthlySummary(
  institutionId: string,
  month: string,
  teacherId?: string
) {
  const params: unknown[] = [institutionId, `${month}-01`];
  let teacherFilter = "";
  if (teacherId) {
    params.push(teacherId);
    teacherFilter = ` AND t.id = $${params.length}`;
  }
  const { rows } = await query(
    `SELECT t.id AS "teacherId", t.employee_no AS "employeeNo",
            t.first_name || ' ' || t.last_name AS name,
            count(sa.id) FILTER (WHERE sa.status = 'present')::int AS present,
            count(sa.id) FILTER (WHERE sa.status = 'absent')::int AS absent,
            count(sa.id) FILTER (WHERE sa.status = 'half_day')::int AS "halfDay",
            count(sa.id) FILTER (WHERE sa.status = 'leave')::int AS leave,
            count(sa.id) FILTER (WHERE sa.status = 'holiday')::int AS holiday,
            count(sa.id) FILTER (WHERE sa.late)::int AS "lateCount"
     FROM teachers t
     LEFT JOIN staff_attendance sa ON sa.teacher_id = t.id AND sa.institution_id = $1
       AND sa.date >= $2::date AND sa.date < ($2::date + interval '1 month')
     WHERE t.institution_id = $1${teacherFilter}
     GROUP BY t.id ORDER BY name`,
    params
  );
  return rows;
}

/**
 * Payroll-attendance summary for a month: the values a Payroll module needs
 * (working/present/absent/half/paid-leave/unpaid-leave/late) per staff member.
 */
export async function payrollSummary(
  institutionId: string,
  month: string,
  teacherId?: string
) {
  const params: unknown[] = [institutionId, `${month}-01`];
  let teacherFilter = "";
  if (teacherId) {
    params.push(teacherId);
    teacherFilter = ` AND t.id = $${params.length}`;
  }
  const { rows } = await query(
    `SELECT t.id AS "teacherId", t.employee_no AS "employeeNo",
            t.first_name || ' ' || t.last_name AS name,
            count(sa.id) FILTER (WHERE sa.status IN ('present','absent','half_day','leave'))::int AS "workingDays",
            count(sa.id) FILTER (WHERE sa.status = 'present')::int AS "presentDays",
            count(sa.id) FILTER (WHERE sa.status = 'absent')::int AS "absentDays",
            count(sa.id) FILTER (WHERE sa.status = 'half_day')::int AS "halfDays",
            count(sa.id) FILTER (WHERE sa.status = 'leave' AND lt.is_paid)::int AS "paidLeave",
            count(sa.id) FILTER (WHERE sa.status = 'leave' AND (lt.is_paid IS NULL OR lt.is_paid = false))::int AS "unpaidLeave",
            count(sa.id) FILTER (WHERE sa.late)::int AS "lateCount"
     FROM teachers t
     LEFT JOIN staff_attendance sa ON sa.teacher_id = t.id AND sa.institution_id = $1
       AND sa.date >= $2::date AND sa.date < ($2::date + interval '1 month')
     LEFT JOIN leave_types lt ON lt.id = sa.leave_type_id
     WHERE t.institution_id = $1${teacherFilter}
     GROUP BY t.id ORDER BY name`,
    params
  );
  return rows;
}

// --- Leave types ---

export async function listLeaveTypes(institutionId: string) {
  const { rows } = await query(
    `SELECT id, name, code, is_paid AS "isPaid", default_balance AS "defaultBalance", is_active AS "isActive"
     FROM leave_types WHERE institution_id = $1 ORDER BY name`,
    [institutionId]
  );
  return rows;
}

export async function createLeaveType(
  input: z.infer<typeof createLeaveTypeSchema>,
  institutionId: string
) {
  try {
    const { rows } = await query(
      `INSERT INTO leave_types (institution_id, name, code, is_paid, default_balance)
       VALUES ($1, $2, $3, COALESCE($4, true), COALESCE($5, 0))
       RETURNING id, name, code, is_paid AS "isPaid", default_balance AS "defaultBalance"`,
      [institutionId, input.name, input.code, input.isPaid ?? null, input.defaultBalance ?? null]
    );
    return rows[0];
  } catch (err) {
    if (isUnique(err)) throw ApiError.conflict("A leave type with that code exists");
    throw err;
  }
}

export async function updateLeaveType(
  id: string,
  input: z.infer<typeof updateLeaveTypeSchema>,
  institutionId: string
) {
  const { sets, params } = buildSets(
    { name: "name", code: "code", isPaid: "is_paid", defaultBalance: "default_balance" },
    input as Record<string, unknown>
  );
  params.push(id, institutionId);
  try {
    const { rows } = await query(
      `UPDATE leave_types SET ${sets.join(", ")}
       WHERE id = $${params.length - 1} AND institution_id = $${params.length}
       RETURNING id, name, code, is_paid AS "isPaid", default_balance AS "defaultBalance"`,
      params
    );
    if (!rows[0]) throw ApiError.notFound("Leave type not found");
    return rows[0];
  } catch (err) {
    if (isUnique(err)) throw ApiError.conflict("A leave type with that code exists");
    throw err;
  }
}

export async function deleteLeaveType(id: string, institutionId: string) {
  const { rowCount } = await query(
    "DELETE FROM leave_types WHERE id = $1 AND institution_id = $2",
    [id, institutionId]
  );
  if (!rowCount) throw ApiError.notFound("Leave type not found");
}

// --- Leave balances ---

export async function listBalances(institutionId: string, teacherId?: string) {
  const params: unknown[] = [institutionId];
  let where = "b.institution_id = $1";
  if (teacherId) {
    params.push(teacherId);
    where += ` AND b.teacher_id = $${params.length}`;
  }
  const { rows } = await query(
    `SELECT b.id, b.teacher_id AS "teacherId", t.first_name || ' ' || t.last_name AS "teacherName",
            b.leave_type_id AS "leaveTypeId", lt.name AS "leaveTypeName", lt.is_paid AS "isPaid", b.balance
     FROM leave_balances b
     JOIN teachers t ON t.id = b.teacher_id
     JOIN leave_types lt ON lt.id = b.leave_type_id
     WHERE ${where} ORDER BY t.first_name, lt.name`,
    params
  );
  return rows;
}

export async function setBalance(
  input: z.infer<typeof setBalanceSchema>,
  institutionId: string
) {
  await assertTeacher(input.teacherId, institutionId);
  const { rows } = await query(
    `INSERT INTO leave_balances (institution_id, teacher_id, leave_type_id, balance)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (institution_id, teacher_id, leave_type_id)
     DO UPDATE SET balance = EXCLUDED.balance, updated_at = now()
     RETURNING id, teacher_id AS "teacherId", leave_type_id AS "leaveTypeId", balance`,
    [institutionId, input.teacherId, input.leaveTypeId, input.balance]
  );
  return rows[0];
}

// --- Leave requests ---

export async function listRequests(
  institutionId: string,
  filters: { status?: string; teacherId?: string }
) {
  const params: unknown[] = [institutionId];
  const where = ["r.institution_id = $1"];
  if (filters.status) {
    params.push(filters.status);
    where.push(`r.status = $${params.length}`);
  }
  if (filters.teacherId) {
    params.push(filters.teacherId);
    where.push(`r.teacher_id = $${params.length}`);
  }
  const { rows } = await query(
    `SELECT r.id, r.teacher_id AS "teacherId", t.first_name || ' ' || t.last_name AS "teacherName",
            r.leave_type_id AS "leaveTypeId", lt.name AS "leaveTypeName", lt.is_paid AS "isPaid",
            r.start_date AS "startDate", r.end_date AS "endDate", r.days, r.reason, r.status,
            r.decided_at AS "decidedAt", r.decision_note AS "decisionNote"
     FROM leave_requests r
     JOIN teachers t ON t.id = r.teacher_id
     LEFT JOIN leave_types lt ON lt.id = r.leave_type_id
     WHERE ${where.join(" AND ")}
     ORDER BY r.created_at DESC`,
    params
  );
  return rows;
}

export async function createRequest(
  input: z.infer<typeof createLeaveRequestSchema>,
  teacherId: string,
  institutionId: string
) {
  await assertTeacher(teacherId, institutionId);
  const { rows: lt } = await query(
    "SELECT 1 FROM leave_types WHERE id = $1 AND institution_id = $2",
    [input.leaveTypeId, institutionId]
  );
  if (!lt[0]) throw ApiError.badRequest("Invalid leave type");
  const days = daysInclusive(input.startDate, input.endDate);
  if (days <= 0) throw ApiError.badRequest("End date must be on or after start date");
  const { rows } = await query(
    `INSERT INTO leave_requests (institution_id, teacher_id, leave_type_id, start_date, end_date, days, reason)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id, teacher_id AS "teacherId", leave_type_id AS "leaveTypeId",
               start_date AS "startDate", end_date AS "endDate", days, status`,
    [institutionId, teacherId, input.leaveTypeId, input.startDate, input.endDate, days, input.reason ?? null]
  );
  return rows[0];
}

export async function approveRequest(
  id: string,
  approverId: string,
  note: string | null | undefined,
  institutionId: string
) {
  return withTransaction(async (client) => {
    const r = await client.query<{
      teacher_id: string;
      leave_type_id: string | null;
      start_date: string;
      end_date: string;
      days: string;
    }>(
      `SELECT teacher_id, leave_type_id, start_date, end_date, days
       FROM leave_requests WHERE id = $1 AND institution_id = $2 AND status = 'pending' FOR UPDATE`,
      [id, institutionId]
    );
    const req = r.rows[0];
    if (!req) throw ApiError.notFound("Pending leave request not found");

    // Deduct from a configured balance (if any); enforce sufficiency.
    if (req.leave_type_id) {
      const bal = await client.query<{ id: string; balance: string }>(
        "SELECT id, balance FROM leave_balances WHERE institution_id = $1 AND teacher_id = $2 AND leave_type_id = $3 FOR UPDATE",
        [institutionId, req.teacher_id, req.leave_type_id]
      );
      if (bal.rows[0]) {
        if (Number(bal.rows[0].balance) < Number(req.days))
          throw ApiError.conflict("Insufficient leave balance");
        await client.query(
          "UPDATE leave_balances SET balance = balance - $1, updated_at = now() WHERE id = $2",
          [req.days, bal.rows[0].id]
        );
      }
    }

    // Auto-link: mark each date in range as 'leave' on the staff attendance.
    await client.query(
      `INSERT INTO staff_attendance (institution_id, teacher_id, date, status, leave_type_id, marked_by)
       SELECT $1, $2, d::date, 'leave', $3, $4
       FROM generate_series($5::date, $6::date, interval '1 day') d
       ON CONFLICT (institution_id, teacher_id, date)
       DO UPDATE SET status = 'leave', leave_type_id = EXCLUDED.leave_type_id,
                     marked_by = EXCLUDED.marked_by, updated_at = now()`,
      [institutionId, req.teacher_id, req.leave_type_id, approverId, req.start_date, req.end_date]
    );

    const { rows } = await client.query(
      `UPDATE leave_requests SET status = 'approved', approver_id = $2, decided_at = now(), decision_note = $3
       WHERE id = $1 RETURNING id, status, days, decided_at AS "decidedAt"`,
      [id, approverId, note ?? null]
    );
    return rows[0];
  });
}

export async function rejectRequest(
  id: string,
  approverId: string,
  note: string | null | undefined,
  institutionId: string
) {
  const { rows } = await query(
    `UPDATE leave_requests SET status = 'rejected', approver_id = $2, decided_at = now(), decision_note = $3
     WHERE id = $1 AND institution_id = $4 AND status = 'pending'
     RETURNING id, status, decided_at AS "decidedAt"`,
    [id, approverId, note ?? null, institutionId]
  );
  if (!rows[0]) throw ApiError.notFound("Pending leave request not found");
  return rows[0];
}

/**
 * Cancels a pending request, or reverses an approved one (restores the balance
 * and removes the auto-created leave attendance in its range).
 */
export async function cancelRequest(
  id: string,
  institutionId: string,
  restrictTeacherId?: string
) {
  return withTransaction(async (client) => {
    const r = await client.query<{
      teacher_id: string;
      leave_type_id: string | null;
      start_date: string;
      end_date: string;
      days: string;
      status: string;
    }>(
      "SELECT teacher_id, leave_type_id, start_date, end_date, days, status FROM leave_requests WHERE id = $1 AND institution_id = $2 FOR UPDATE",
      [id, institutionId]
    );
    const req = r.rows[0];
    if (!req) throw ApiError.notFound("Leave request not found");
    // A staff member may only cancel their own request.
    if (restrictTeacherId && req.teacher_id !== restrictTeacherId)
      throw ApiError.forbidden();
    if (req.status !== "pending" && req.status !== "approved")
      throw ApiError.badRequest(`Cannot cancel a ${req.status} request`);

    if (req.status === "approved") {
      if (req.leave_type_id) {
        await client.query(
          "UPDATE leave_balances SET balance = balance + $1, updated_at = now() WHERE institution_id = $2 AND teacher_id = $3 AND leave_type_id = $4",
          [req.days, institutionId, req.teacher_id, req.leave_type_id]
        );
      }
      await client.query(
        `DELETE FROM staff_attendance
         WHERE institution_id = $1 AND teacher_id = $2 AND status = 'leave'
           AND date >= $3::date AND date <= $4::date`,
        [institutionId, req.teacher_id, req.start_date, req.end_date]
      );
    }
    const { rows } = await client.query(
      "UPDATE leave_requests SET status = 'cancelled' WHERE id = $1 RETURNING id, status",
      [id]
    );
    return rows[0];
  });
}
