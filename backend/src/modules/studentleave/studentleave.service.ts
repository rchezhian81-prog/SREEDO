import { query } from "../../db/postgres";
import { ApiError } from "../../utils/api-error";
import { paginatedResponse, type Pagination } from "../../utils/pagination";
import { childStudentIdsForUser } from "../students/students.service";
import { sendMessage } from "../communication/communication.service";
import { bulkMark } from "../attendance/attendance.service";
import type { z } from "zod";
import type {
  createLeaveSchema,
  reviewLeaveSchema,
  listLeaveQuerySchema,
} from "./studentleave.schema";

const MAX_SPAN_DAYS = 90;

async function assertStudent(studentId: string, institutionId: string): Promise<void> {
  const { rows } = await query(
    "SELECT 1 FROM students WHERE id = $1 AND institution_id = $2",
    [studentId, institutionId]
  );
  if (!rows[0]) throw ApiError.badRequest("Invalid student");
}

/** Inclusive list of YYYY-MM-DD dates in [from, to], capped to MAX_SPAN_DAYS. */
function eachDate(from: string, to: string): string[] {
  const out: string[] = [];
  const d = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  while (d.getTime() <= end.getTime()) {
    out.push(d.toISOString().slice(0, 10));
    if (out.length > MAX_SPAN_DAYS) throw ApiError.badRequest(`Leave range exceeds ${MAX_SPAN_DAYS} days`);
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

const LEAVE_SELECT = `
  l.id, l.student_id AS "studentId",
  (st.first_name || ' ' || st.last_name) AS "studentName", st.admission_no AS "admissionNo",
  l.type, to_char(l.from_date, 'YYYY-MM-DD') AS "fromDate", to_char(l.to_date, 'YYYY-MM-DD') AS "toDate",
  (l.to_date - l.from_date + 1) AS days, l.reason, l.status,
  l.applied_by AS "appliedBy", l.reviewed_by AS "reviewedBy", l.review_note AS "reviewNote",
  l.created_at AS "createdAt", l.updated_at AS "updatedAt"
FROM student_leave_requests l JOIN students st ON st.id = l.student_id`;

export async function listRequests(
  pagination: Pagination,
  filters: z.infer<typeof listLeaveQuerySchema>,
  institutionId: string
) {
  const params: unknown[] = [institutionId];
  const conditions = ["l.institution_id = $1"];
  if (filters.status) {
    params.push(filters.status);
    conditions.push(`l.status = $${params.length}`);
  }
  if (filters.studentId) {
    params.push(filters.studentId);
    conditions.push(`l.student_id = $${params.length}`);
  }
  const where = `WHERE ${conditions.join(" AND ")}`;
  const count = await query<{ count: string }>(`SELECT count(*) FROM student_leave_requests l ${where}`, params);
  const { rows } = await query(
    `SELECT ${LEAVE_SELECT} ${where} ORDER BY l.created_at DESC
     LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, pagination.limit, pagination.offset]
  );
  return paginatedResponse(rows, Number(count.rows[0].count), pagination);
}

export async function getRequest(id: string, institutionId: string) {
  const { rows } = await query(`SELECT ${LEAVE_SELECT} WHERE l.id = $1 AND l.institution_id = $2`, [id, institutionId]);
  if (!rows[0]) throw ApiError.notFound("Leave request not found");
  return rows[0] as Record<string, unknown>;
}

interface RawReq { studentId: string; status: string; fromDate: string; toDate: string; appliedBy: string | null }
async function rawRequest(id: string, institutionId: string): Promise<RawReq> {
  const { rows } = await query<RawReq>(
    `SELECT student_id AS "studentId", status,
            to_char(from_date, 'YYYY-MM-DD') AS "fromDate", to_char(to_date, 'YYYY-MM-DD') AS "toDate",
            applied_by AS "appliedBy"
     FROM student_leave_requests WHERE id = $1 AND institution_id = $2`,
    [id, institutionId]
  );
  if (!rows[0]) throw ApiError.notFound("Leave request not found");
  return rows[0];
}

async function insertRequest(
  input: z.infer<typeof createLeaveSchema>,
  institutionId: string,
  appliedBy: string
) {
  await assertStudent(input.studentId, institutionId);
  eachDate(input.fromDate, input.toDate); // validate span up-front
  const { rows } = await query<{ id: string }>(
    `INSERT INTO student_leave_requests (institution_id, student_id, type, from_date, to_date, reason, applied_by)
     VALUES ($1,$2,COALESCE($3,'other'),$4,$5,$6,$7) RETURNING id`,
    [institutionId, input.studentId, input.type ?? null, input.fromDate, input.toDate, input.reason ?? null, appliedBy]
  );
  return getRequest(rows[0].id, institutionId);
}

/** Staff file-on-behalf (student_leave:create). */
export async function staffCreate(
  input: z.infer<typeof createLeaveSchema>,
  institutionId: string,
  userId: string
) {
  return insertRequest(input, institutionId, userId);
}

/** Guardian-scoped: a parent may only file for their linked children. */
export async function parentCreate(
  input: z.infer<typeof createLeaveSchema>,
  institutionId: string,
  parentUserId: string
) {
  const children = await childStudentIdsForUser(parentUserId, institutionId);
  if (!children.includes(input.studentId)) throw ApiError.forbidden("You can only file leave for your own child");
  return insertRequest(input, institutionId, parentUserId);
}

/** Best-effort notify the student + their guardians (never blocks the flow). */
async function notify(studentId: string, institutionId: string, senderId: string, subject: string, body: string) {
  try {
    await sendMessage(
      senderId,
      { audienceType: "student" as never, audienceRef: studentId, category: "message", subject, body },
      institutionId
    );
  } catch {
    /* communication is optional — degrade gracefully */
  }
}

/** Approve → mark 'excused' in daily attendance for each date via the existing
 *  tenant-guarded upsert (bulkMark validates the student is in-tenant). */
export async function approveRequest(
  id: string,
  input: z.infer<typeof reviewLeaveSchema>,
  institutionId: string,
  approver: { id: string }
) {
  const req = await rawRequest(id, institutionId);
  if (req.status !== "pending") throw ApiError.badRequest("Only a pending request can be approved");
  for (const date of eachDate(req.fromDate, req.toDate)) {
    await bulkMark(
      { date, records: [{ studentId: req.studentId, status: "excused", remarks: "Student leave (approved)" }] },
      approver.id,
      institutionId
    );
  }
  await query(
    `UPDATE student_leave_requests SET status='approved', reviewed_by=$1, review_note=$2, updated_at=now()
     WHERE id=$3 AND institution_id=$4`,
    [approver.id, input.reviewNote ?? null, id, institutionId]
  );
  await notify(req.studentId, institutionId, approver.id, "Student leave approved",
    `The leave request from ${req.fromDate} to ${req.toDate} has been approved. Attendance is marked as excused.`);
  return getRequest(id, institutionId);
}

export async function rejectRequest(
  id: string,
  input: z.infer<typeof reviewLeaveSchema>,
  institutionId: string,
  approver: { id: string }
) {
  const req = await rawRequest(id, institutionId);
  if (req.status !== "pending") throw ApiError.badRequest("Only a pending request can be rejected");
  await query(
    `UPDATE student_leave_requests SET status='rejected', reviewed_by=$1, review_note=$2, updated_at=now()
     WHERE id=$3 AND institution_id=$4`,
    [approver.id, input.reviewNote ?? null, id, institutionId]
  );
  await notify(req.studentId, institutionId, approver.id, "Student leave rejected",
    `The leave request from ${req.fromDate} to ${req.toDate} was not approved.`);
  return getRequest(id, institutionId);
}

/** Cancel: staff may cancel any; a parent only their own request. Cancelling an
 *  approved leave removes ONLY the 'excused' marks the approval created (a manual
 *  present/absent set later is preserved). */
export async function cancelRequest(
  id: string,
  institutionId: string,
  actor: { userId: string; isStaff: boolean }
): Promise<void> {
  const req = await rawRequest(id, institutionId);
  if (!actor.isStaff && req.appliedBy !== actor.userId) {
    throw ApiError.forbidden("You can only cancel your own leave request");
  }
  if (req.status === "cancelled") return;
  if (req.status === "approved") {
    await query(
      `DELETE FROM attendance_records
       WHERE institution_id = $1 AND student_id = $2 AND date BETWEEN $3 AND $4 AND status = 'excused'`,
      [institutionId, req.studentId, req.fromDate, req.toDate]
    );
  }
  await query(
    "UPDATE student_leave_requests SET status='cancelled', updated_at=now() WHERE id=$1 AND institution_id=$2",
    [id, institutionId]
  );
}

/** Guardian-scoped list: requests for the caller's linked children. */
export async function listForParent(parentUserId: string, institutionId: string) {
  const children = await childStudentIdsForUser(parentUserId, institutionId);
  if (!children.length) return [];
  const { rows } = await query(
    `SELECT ${LEAVE_SELECT} WHERE l.institution_id = $1 AND l.student_id = ANY($2::uuid[]) ORDER BY l.from_date DESC`,
    [institutionId, children]
  );
  return rows;
}
