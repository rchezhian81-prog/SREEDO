import type { z } from "zod";
import { query, withTransaction } from "../../db/postgres";
import { ApiError } from "../../utils/api-error";
import { tcPdf } from "../pdfs/pdfs.pdf";
import { institutionLogo } from "../pdfs/pdfs.service";
import type {
  cancelTcSchema,
  createTcSchema,
  issueTcSchema,
  listTcQuerySchema,
  updateTcSchema,
} from "./tc.schema";

const TC_SELECT = `
  tc.id, tc.tc_no AS "tcNo", tc.student_id AS "studentId",
  s.first_name || ' ' || s.last_name AS "studentName",
  tc.admission_no AS "admissionNo", tc.class_name AS "className",
  tc.section_name AS "sectionName", tc.program_name AS "programName",
  tc.semester_name AS "semesterName", tc.academic_year AS "academicYear",
  tc.date_of_issue AS "dateOfIssue", tc.last_attendance_date AS "lastAttendanceDate",
  tc.leaving_reason AS "leavingReason", tc.conduct,
  tc.fee_dues_status AS "feeDuesStatus", tc.library_dues_status AS "libraryDuesStatus",
  tc.transport_dues_status AS "transportDuesStatus", tc.hostel_dues_status AS "hostelDuesStatus",
  tc.dues_override AS "duesOverride", tc.dues_override_reason AS "duesOverrideReason",
  tc.remarks, tc.status, tc.issued_at AS "issuedAt", tc.cancelled_at AS "cancelledAt",
  tc.cancel_reason AS "cancelReason", tc.created_at AS "createdAt"`;

// --- Dues check ---

export interface Dues {
  fee: { amount: number; count: number };
  transport: { amount: number };
  hostel: { amount: number };
  library: { books: number; fines: number };
  hasDues: boolean;
}

export async function computeDues(studentId: string, institutionId: string): Promise<Dues> {
  const { rows } = await query<{
    fee_amount: number;
    fee_count: number;
    transport_amount: number;
    hostel_amount: number;
    library_books: number;
    library_fines: number;
  }>(
    `SELECT
       (SELECT COALESCE(sum(amount_due-amount_paid),0)::float FROM invoices
         WHERE institution_id=$1 AND student_id=$2 AND status IN ('pending','partially_paid')) AS fee_amount,
       (SELECT count(*)::int FROM invoices
         WHERE institution_id=$1 AND student_id=$2 AND status IN ('pending','partially_paid')) AS fee_count,
       (SELECT COALESCE(sum(i.amount_due-i.amount_paid),0)::float FROM transport_invoices ti
         JOIN invoices i ON i.id=ti.invoice_id
         WHERE ti.institution_id=$1 AND ti.student_id=$2 AND i.status IN ('pending','partially_paid')) AS transport_amount,
       (SELECT COALESCE(sum(i.amount_due-i.amount_paid),0)::float FROM hostel_invoices hi
         JOIN invoices i ON i.id=hi.invoice_id
         WHERE hi.institution_id=$1 AND hi.student_id=$2 AND i.status IN ('pending','partially_paid')) AS hostel_amount,
       (SELECT count(*)::int FROM book_issues bi JOIN library_members lm ON lm.id=bi.member_id
         WHERE bi.institution_id=$1 AND lm.student_id=$2 AND bi.status='issued') AS library_books,
       (SELECT COALESCE(sum(bi.fine_amount),0)::float FROM book_issues bi JOIN library_members lm ON lm.id=bi.member_id
         WHERE bi.institution_id=$1 AND lm.student_id=$2 AND bi.fine_status='pending') AS library_fines`,
    [institutionId, studentId]
  );
  const r = rows[0];
  return {
    fee: { amount: r.fee_amount, count: r.fee_count },
    transport: { amount: r.transport_amount },
    hostel: { amount: r.hostel_amount },
    library: { books: r.library_books, fines: r.library_fines },
    hasDues: r.fee_amount > 0 || r.library_books > 0 || r.library_fines > 0,
  };
}

function duesStrings(d: Dues) {
  return {
    fee: d.fee.amount > 0 ? `Pending ${d.fee.amount.toFixed(2)} (${d.fee.count} invoice(s))` : "Cleared",
    library:
      d.library.books > 0 || d.library.fines > 0
        ? `Pending: ${d.library.books} book(s)` +
          (d.library.fines > 0 ? `, fine ${d.library.fines.toFixed(2)}` : "")
        : "Cleared",
    transport: d.transport.amount > 0 ? `Pending ${d.transport.amount.toFixed(2)}` : "Cleared",
    hostel: d.hostel.amount > 0 ? `Pending ${d.hostel.amount.toFixed(2)}` : "Cleared",
  };
}

export async function studentDues(studentId: string, institutionId: string) {
  // Confirm the student belongs to the tenant (avoids cross-tenant probing).
  const { rows } = await query("SELECT 1 FROM students WHERE id=$1 AND institution_id=$2", [
    studentId,
    institutionId,
  ]);
  if (!rows[0]) throw ApiError.notFound("Student not found");
  return computeDues(studentId, institutionId);
}

// --- Register CRUD ---

export async function listTcs(
  institutionId: string,
  filters: z.infer<typeof listTcQuerySchema>,
  restrictIds: string[] | null
) {
  const params: unknown[] = [institutionId];
  const where = ["tc.institution_id = $1"];
  if (filters.status) {
    params.push(filters.status);
    where.push(`tc.status = $${params.length}`);
  }
  if (filters.studentId) {
    params.push(filters.studentId);
    where.push(`tc.student_id = $${params.length}`);
  }
  if (restrictIds != null) {
    params.push(restrictIds);
    where.push(`tc.student_id = ANY($${params.length}::uuid[])`);
  }
  if (filters.search) {
    params.push(`%${filters.search}%`);
    where.push(
      `(tc.tc_no ILIKE $${params.length} OR tc.admission_no ILIKE $${params.length} OR s.first_name || ' ' || s.last_name ILIKE $${params.length})`
    );
  }
  const { rows } = await query(
    `SELECT ${TC_SELECT} FROM transfer_certificates tc
     JOIN students s ON s.id = tc.student_id
     WHERE ${where.join(" AND ")} ORDER BY tc.created_at DESC LIMIT 500`,
    params
  );
  return rows;
}

export async function getTc(id: string, institutionId: string) {
  const { rows } = await query<Record<string, unknown> & { studentId: string }>(
    `SELECT ${TC_SELECT} FROM transfer_certificates tc
     JOIN students s ON s.id = tc.student_id
     WHERE tc.id = $1 AND tc.institution_id = $2`,
    [id, institutionId]
  );
  if (!rows[0]) throw ApiError.notFound("Transfer certificate not found");
  return rows[0];
}

async function snapshotStudent(studentId: string, institutionId: string) {
  const { rows } = await query<{
    admission_no: string;
    class_name: string | null;
    section_name: string | null;
    program_name: string | null;
    semester_name: string | null;
  }>(
    `SELECT s.admission_no, c.name AS class_name, sec.name AS section_name,
            p.name AS program_name, sm.name AS semester_name
     FROM students s
     LEFT JOIN sections sec ON sec.id = s.section_id
     LEFT JOIN classes c ON c.id = sec.class_id
     LEFT JOIN enrollments e ON e.student_id = s.id AND e.institution_id = $1
     LEFT JOIN programs p ON p.id = e.program_id
     LEFT JOIN semesters sm ON sm.id = e.semester_id
     WHERE s.id = $2 AND s.institution_id = $1`,
    [institutionId, studentId]
  );
  if (!rows[0]) throw ApiError.notFound("Student not found");
  return rows[0];
}

export async function createTc(
  input: z.infer<typeof createTcSchema>,
  institutionId: string,
  userId: string
) {
  const snap = await snapshotStudent(input.studentId, institutionId);
  // Atomic, collision-free TC number (dedicated sequence, like admission numbers).
  const { rows: numRows } = await query<{ tc_no: string }>(
    `SELECT 'TC-' || to_char(CURRENT_DATE,'YYYY') || '-' ||
            lpad(nextval('transfer_certificate_seq')::text, 5, '0') AS tc_no`,
    []
  );
  const { rows } = await query<{ id: string }>(
    `INSERT INTO transfer_certificates
       (institution_id, tc_no, student_id, admission_no, class_name, section_name,
        program_name, semester_name, academic_year, last_attendance_date,
        leaving_reason, conduct, remarks, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
     RETURNING id`,
    [
      institutionId,
      numRows[0].tc_no,
      input.studentId,
      snap.admission_no,
      snap.class_name,
      snap.section_name,
      snap.program_name,
      snap.semester_name,
      input.academicYear ?? null,
      input.lastAttendanceDate ?? null,
      input.leavingReason ?? null,
      input.conduct ?? null,
      input.remarks ?? null,
      userId,
    ]
  );
  return getTc(rows[0].id, institutionId);
}

export async function updateTc(
  id: string,
  input: z.infer<typeof updateTcSchema>,
  institutionId: string
) {
  const tc = await getTc(id, institutionId);
  if (tc.status !== "draft") throw ApiError.badRequest("Only draft TCs can be edited");
  await query(
    `UPDATE transfer_certificates SET
       leaving_reason = COALESCE($3, leaving_reason),
       conduct = COALESCE($4, conduct),
       academic_year = COALESCE($5, academic_year),
       last_attendance_date = COALESCE($6, last_attendance_date),
       date_of_issue = COALESCE($7, date_of_issue),
       remarks = COALESCE($8, remarks)
     WHERE id = $1 AND institution_id = $2`,
    [
      id,
      institutionId,
      input.leavingReason ?? null,
      input.conduct ?? null,
      input.academicYear ?? null,
      input.lastAttendanceDate ?? null,
      input.dateOfIssue ?? null,
      input.remarks ?? null,
    ]
  );
  return getTc(id, institutionId);
}

export async function issueTc(
  id: string,
  input: z.infer<typeof issueTcSchema>,
  userId: string,
  institutionId: string,
  canOverride: boolean
) {
  await withTransaction(async (client) => {
    const { rows } = await client.query<{ status: string; student_id: string }>(
      "SELECT status, student_id FROM transfer_certificates WHERE id=$1 AND institution_id=$2 FOR UPDATE",
      [id, institutionId]
    );
    const tc = rows[0];
    if (!tc) throw ApiError.notFound("Transfer certificate not found");
    if (tc.status !== "draft") throw ApiError.badRequest("Only draft TCs can be issued");

    const dues = await computeDues(tc.student_id, institutionId);
    let override = false;
    let overrideReason: string | null = null;
    if (dues.hasDues) {
      if (!input.overrideDues) {
        throw ApiError.badRequest(
          "Student has pending dues; clear them or issue with an explicit dues override"
        );
      }
      if (!canOverride) {
        throw ApiError.forbidden("You do not have permission to override pending dues");
      }
      if (!input.overrideReason) throw ApiError.badRequest("A dues-override reason is required");
      override = true;
      overrideReason = input.overrideReason;
    }
    const s = duesStrings(dues);

    await client.query(
      `UPDATE transfer_certificates SET
         status='issued',
         date_of_issue = COALESCE($3::date, date_of_issue, CURRENT_DATE),
         last_attendance_date = COALESCE($4::date, last_attendance_date),
         fee_dues_status=$5, library_dues_status=$6, transport_dues_status=$7, hostel_dues_status=$8,
         dues_override=$9, dues_override_reason=$10,
         issued_at=now(), issued_by=$11
       WHERE id=$1 AND institution_id=$2`,
      [
        id,
        institutionId,
        input.dateOfIssue ?? null,
        input.lastAttendanceDate ?? null,
        s.fee,
        s.library,
        s.transport,
        s.hostel,
        override,
        overrideReason,
        userId,
      ]
    );

    // Lifecycle: mark the student transferred (data is retained, never deleted).
    if (input.markTransferred !== false) {
      await client.query(
        "UPDATE students SET status='transferred' WHERE id=$1 AND institution_id=$2",
        [tc.student_id, institutionId]
      );
    }
  });
  // Re-read after commit (a pooled read inside the txn would see stale data).
  return getTc(id, institutionId);
}

export async function cancelTc(
  id: string,
  input: z.infer<typeof cancelTcSchema>,
  userId: string,
  institutionId: string
) {
  const tc = await getTc(id, institutionId);
  if (tc.status === "cancelled") throw ApiError.badRequest("TC is already cancelled");
  await query(
    `UPDATE transfer_certificates SET status='cancelled', cancelled_at=now(),
       cancelled_by=$3, cancel_reason=$4 WHERE id=$1 AND institution_id=$2`,
    [id, institutionId, userId, input.reason ?? null]
  );
  return getTc(id, institutionId);
}

// --- PDF ---

export async function tcBuffer(id: string, institutionId: string): Promise<Buffer> {
  const { rows } = await query<{
    tc_no: string;
    status: string;
    student_name: string;
    admission_no: string | null;
    class_name: string | null;
    section_name: string | null;
    program_name: string | null;
    semester_name: string | null;
    date_of_birth: string | null;
    guardian_name: string | null;
    joining_date: string | null;
    date_of_issue: string | null;
    last_attendance_date: string | null;
    leaving_reason: string | null;
    conduct: string | null;
    academic_year: string | null;
    fee_dues_status: string | null;
    library_dues_status: string | null;
    transport_dues_status: string | null;
    hostel_dues_status: string | null;
    remarks: string | null;
    institution_name: string;
  }>(
    `SELECT tc.tc_no, tc.status,
            s.first_name || ' ' || s.last_name AS student_name,
            tc.admission_no, tc.class_name, tc.section_name, tc.program_name, tc.semester_name,
            to_char(s.date_of_birth, 'YYYY-MM-DD') AS date_of_birth,
            s.guardian_name,
            to_char(s.enrolled_at, 'YYYY-MM-DD') AS joining_date,
            to_char(tc.date_of_issue, 'YYYY-MM-DD') AS date_of_issue,
            to_char(tc.last_attendance_date, 'YYYY-MM-DD') AS last_attendance_date,
            tc.leaving_reason, tc.conduct, tc.academic_year,
            tc.fee_dues_status, tc.library_dues_status, tc.transport_dues_status, tc.hostel_dues_status,
            tc.remarks, inst.name AS institution_name
     FROM transfer_certificates tc
     JOIN students s ON s.id = tc.student_id
     JOIN institutions inst ON inst.id = tc.institution_id
     WHERE tc.id = $1 AND tc.institution_id = $2`,
    [id, institutionId]
  );
  const r = rows[0];
  if (!r) throw ApiError.notFound("Transfer certificate not found");

  const logo = await institutionLogo(institutionId);
  return tcPdf({
    institutionName: r.institution_name,
    logo,
    tcNo: r.tc_no,
    status: r.status,
    studentName: r.student_name,
    admissionNo: r.admission_no ?? "",
    className: r.class_name,
    sectionName: r.section_name,
    programName: r.program_name,
    semesterName: r.semester_name,
    dateOfBirth: r.date_of_birth,
    guardianName: r.guardian_name,
    joiningDate: r.joining_date,
    leavingDate: r.date_of_issue,
    lastAttendanceDate: r.last_attendance_date,
    leavingReason: r.leaving_reason,
    conduct: r.conduct,
    academicYear: r.academic_year,
    feeDuesStatus: r.fee_dues_status,
    libraryDuesStatus: r.library_dues_status,
    transportDuesStatus: r.transport_dues_status,
    hostelDuesStatus: r.hostel_dues_status,
    remarks: r.remarks,
  });
}
