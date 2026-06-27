import { query, withTransaction } from "../../db/postgres";
import { ApiError } from "../../utils/api-error";
import type { z } from "zod";
import type { rosterQuerySchema, markSchema } from "./periodattendance.schema";

async function assertSectionInTenant(sectionId: string, institutionId: string) {
  const { rows } = await query<{ id: string }>(
    "SELECT id FROM sections WHERE id = $1 AND institution_id = $2",
    [sectionId, institutionId]
  );
  if (!rows[0]) throw ApiError.notFound("Section not found");
}

async function assertPeriodInTenant(periodId: string, institutionId: string) {
  const { rows } = await query<{ id: string }>(
    "SELECT id FROM periods WHERE id = $1 AND institution_id = $2",
    [periodId, institutionId]
  );
  if (!rows[0]) throw ApiError.notFound("Period not found");
}

/** The section's roster with each student's mark for the given date + period. */
export async function getRoster(
  filters: z.infer<typeof rosterQuerySchema>,
  institutionId: string
) {
  await assertSectionInTenant(filters.sectionId, institutionId);
  const { rows } = await query(
    `SELECT s.id AS "studentId",
            (s.first_name || ' ' || s.last_name) AS "name",
            s.admission_no AS "admissionNo",
            pa.status
     FROM students s
     LEFT JOIN period_attendance pa
       ON pa.student_id = s.id AND pa.date = $2 AND pa.period_id = $3
     WHERE s.section_id = $1 AND s.institution_id = $4 AND s.status = 'active'
     ORDER BY s.first_name, s.last_name`,
    [filters.sectionId, filters.date, filters.periodId, institutionId]
  );
  return { records: rows };
}

export async function markAttendance(
  input: z.infer<typeof markSchema>,
  institutionId: string,
  userId: string
) {
  await assertPeriodInTenant(input.periodId, institutionId);

  // Defence in depth: every student must belong to this tenant.
  const ids = input.entries.map((e) => e.studentId);
  const owned = await query<{ count: string }>(
    "SELECT count(*) FROM students WHERE id = ANY($1::uuid[]) AND institution_id = $2",
    [ids, institutionId]
  );
  if (Number(owned.rows[0].count) !== ids.length) {
    throw ApiError.badRequest("One or more students do not belong to this institution");
  }

  await withTransaction(async (client) => {
    for (const entry of input.entries) {
      await client.query(
        `INSERT INTO period_attendance (institution_id, student_id, date, period_id, subject_id, status, marked_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (student_id, date, period_id)
         DO UPDATE SET status = EXCLUDED.status, subject_id = EXCLUDED.subject_id,
                       marked_by = EXCLUDED.marked_by, updated_at = now()`,
        [
          institutionId,
          entry.studentId,
          input.date,
          input.periodId,
          input.subjectId ?? null,
          entry.status,
          userId,
        ]
      );
    }
  });

  return { marked: input.entries.length };
}
