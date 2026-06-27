import { query } from "../../db/postgres";
import { getStudent } from "../students/students.service";
import { listEntries } from "../timetable/timetable.service";

/** Accessible children/self as compact cards (for the portal child selector). */
export async function listChildren(
  ids: string[],
  userId: string,
  institutionId: string
) {
  if (ids.length === 0) return [];
  const { rows } = await query(
    `SELECT s.id, s.admission_no AS "admissionNo", s.first_name AS "firstName",
            s.last_name AS "lastName", s.section_id AS "sectionId",
            sec.name AS "sectionName", c.name AS "className",
            (SELECT relationship FROM guardians g
             WHERE g.student_id = s.id AND g.user_id = $3) AS relationship
     FROM students s
     LEFT JOIN sections sec ON sec.id = s.section_id
     LEFT JOIN classes c ON c.id = sec.class_id
     WHERE s.institution_id = $1 AND s.id = ANY($2::uuid[])
     ORDER BY s.first_name, s.last_name`,
    [institutionId, ids, userId]
  );
  return rows;
}

interface AttRow {
  total: number;
  present: number;
  absent: number;
  late: number;
  excused: number;
}
interface FeeRow {
  due: number;
  paid: number;
  pending: number;
}

/** Profile + attendance + fee summary for one student (already access-checked). */
export async function studentSummary(studentId: string, institutionId: string) {
  const profile = await getStudent(studentId, institutionId);

  const att = await query<AttRow>(
    `SELECT count(*)::int AS total,
            count(*) FILTER (WHERE status = 'present')::int AS present,
            count(*) FILTER (WHERE status = 'absent')::int AS absent,
            count(*) FILTER (WHERE status = 'late')::int AS late,
            count(*) FILTER (WHERE status = 'excused')::int AS excused
     FROM attendance_records WHERE student_id = $1 AND institution_id = $2`,
    [studentId, institutionId]
  );
  const a = att.rows[0];
  const attended = a.present + a.late;
  const rate = a.total > 0 ? Math.round((attended / a.total) * 100) : null;

  const fee = await query<FeeRow>(
    `SELECT COALESCE(SUM(amount_due), 0)::float AS due,
            COALESCE(SUM(amount_paid), 0)::float AS paid,
            count(*) FILTER (WHERE status IN ('pending', 'partially_paid'))::int AS pending
     FROM invoices
     WHERE student_id = $1 AND institution_id = $2 AND status <> 'cancelled'`,
    [studentId, institutionId]
  );
  const f = fee.rows[0];

  return {
    profile,
    attendance: {
      total: a.total,
      present: a.present,
      absent: a.absent,
      late: a.late,
      excused: a.excused,
      rate,
    },
    fees: {
      totalDue: f.due,
      totalPaid: f.paid,
      outstanding: f.due - f.paid,
      pendingInvoices: f.pending,
    },
  };
}

/** The student's class timetable (by their section); access-checked by caller. */
export async function studentTimetable(
  studentId: string,
  institutionId: string
) {
  const profile = await getStudent(studentId, institutionId);
  const sectionId = (profile as { sectionId: string | null }).sectionId;
  if (!sectionId) return [];
  return listEntries({ sectionId }, institutionId);
}
