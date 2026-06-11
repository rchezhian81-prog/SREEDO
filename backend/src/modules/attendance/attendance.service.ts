import { withTransaction, query } from "../../db/postgres";
import type { z } from "zod";
import type { bulkMarkAttendanceSchema } from "./attendance.schema";

export async function bulkMark(
  input: z.infer<typeof bulkMarkAttendanceSchema>,
  markedBy: string
) {
  return withTransaction(async (client) => {
    let upserted = 0;
    for (const record of input.records) {
      await client.query(
        `INSERT INTO attendance_records (student_id, date, status, remarks, marked_by)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (student_id, date)
         DO UPDATE SET status = EXCLUDED.status,
                       remarks = EXCLUDED.remarks,
                       marked_by = EXCLUDED.marked_by`,
        [
          record.studentId,
          input.date,
          record.status,
          record.remarks ?? null,
          markedBy,
        ]
      );
      upserted += 1;
    }
    return { date: input.date, upserted };
  });
}

export async function listByDate(filters: {
  sectionId?: string;
  date?: string;
}) {
  const date = filters.date ?? new Date().toISOString().slice(0, 10);
  const params: unknown[] = [date];
  let sectionFilter = "";
  if (filters.sectionId) {
    params.push(filters.sectionId);
    sectionFilter = `AND s.section_id = $2`;
  }
  const { rows } = await query(
    `SELECT s.id AS "studentId",
            s.admission_no AS "admissionNo",
            s.first_name AS "firstName",
            s.last_name AS "lastName",
            s.section_id AS "sectionId",
            ar.status,
            ar.remarks
     FROM students s
     LEFT JOIN attendance_records ar
       ON ar.student_id = s.id AND ar.date = $1
     WHERE s.status = 'active' ${sectionFilter}
     ORDER BY s.first_name, s.last_name`,
    params
  );
  return { date, records: rows };
}

export async function studentHistory(
  studentId: string,
  range: { from?: string; to?: string }
) {
  const params: unknown[] = [studentId];
  const conditions: string[] = ["student_id = $1"];
  if (range.from) {
    params.push(range.from);
    conditions.push(`date >= $${params.length}`);
  }
  if (range.to) {
    params.push(range.to);
    conditions.push(`date <= $${params.length}`);
  }
  const where = conditions.join(" AND ");

  const { rows } = await query(
    `SELECT date, status, remarks
     FROM attendance_records
     WHERE ${where}
     ORDER BY date DESC`,
    params
  );
  const summaryResult = await query<{ status: string; count: string }>(
    `SELECT status, count(*) FROM attendance_records
     WHERE ${where}
     GROUP BY status`,
    params
  );
  const summary = Object.fromEntries(
    summaryResult.rows.map((row) => [row.status, Number(row.count)])
  );
  return { records: rows, summary };
}
