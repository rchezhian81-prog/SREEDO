import { query, withTransaction } from "../../db/postgres";
import { ApiError } from "../../utils/api-error";
import type { z } from "zod";
import type {
  createAcademicYearSchema,
  createClassSchema,
  createSectionSchema,
  createSubjectSchema,
} from "./academics.schema";

// --- Academic years ---

export async function listAcademicYears(institutionId: string) {
  const { rows } = await query(
    `SELECT id, name, start_date AS "startDate", end_date AS "endDate",
            is_current AS "isCurrent"
     FROM academic_years WHERE institution_id = $1 ORDER BY start_date DESC`,
    [institutionId]
  );
  return rows;
}

export async function createAcademicYear(
  input: z.infer<typeof createAcademicYearSchema>,
  institutionId: string
) {
  return withTransaction(async (client) => {
    if (input.isCurrent) {
      await client.query(
        "UPDATE academic_years SET is_current = false WHERE institution_id = $1",
        [institutionId]
      );
    }
    const { rows } = await client.query(
      `INSERT INTO academic_years (institution_id, name, start_date, end_date, is_current)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, name, start_date AS "startDate", end_date AS "endDate",
                 is_current AS "isCurrent"`,
      [institutionId, input.name, input.startDate, input.endDate, input.isCurrent ?? false]
    );
    return rows[0];
  });
}

// --- Classes and sections ---

export async function listClasses(institutionId: string) {
  const { rows } = await query(
    `SELECT c.id, c.name, c.grade_level AS "gradeLevel",
            COALESCE(
              json_agg(
                json_build_object(
                  'id', s.id,
                  'name', s.name,
                  'capacity', s.capacity,
                  'homeroomTeacherId', s.homeroom_teacher_id,
                  'studentCount', (
                    SELECT count(*) FROM students st
                    WHERE st.section_id = s.id AND st.status = 'active'
                  )
                ) ORDER BY s.name
              ) FILTER (WHERE s.id IS NOT NULL),
              '[]'
            ) AS sections
     FROM classes c
     LEFT JOIN sections s ON s.class_id = c.id
     WHERE c.institution_id = $1
     GROUP BY c.id
     ORDER BY c.grade_level, c.name`,
    [institutionId]
  );
  return rows;
}

export async function createClass(
  input: z.infer<typeof createClassSchema>,
  institutionId: string
) {
  const { rows } = await query(
    `INSERT INTO classes (institution_id, name, grade_level)
     VALUES ($1, $2, $3)
     RETURNING id, name, grade_level AS "gradeLevel"`,
    [institutionId, input.name, input.gradeLevel]
  );
  return rows[0];
}

export async function removeClass(
  id: string,
  institutionId: string
): Promise<void> {
  const { rowCount } = await query(
    "DELETE FROM classes WHERE id = $1 AND institution_id = $2",
    [id, institutionId]
  );
  if (!rowCount) throw ApiError.notFound("Class not found");
}

export async function createSection(
  classId: string,
  input: z.infer<typeof createSectionSchema>,
  institutionId: string
) {
  const { rows: classRows } = await query(
    "SELECT id FROM classes WHERE id = $1 AND institution_id = $2",
    [classId, institutionId]
  );
  if (!classRows[0]) throw ApiError.notFound("Class not found");

  const { rows } = await query(
    `INSERT INTO sections (institution_id, class_id, name, homeroom_teacher_id, capacity)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, class_id AS "classId", name, capacity,
               homeroom_teacher_id AS "homeroomTeacherId"`,
    [institutionId, classId, input.name, input.homeroomTeacherId ?? null, input.capacity ?? 40]
  );
  return rows[0];
}

export async function removeSection(
  id: string,
  institutionId: string
): Promise<void> {
  const { rowCount } = await query(
    "DELETE FROM sections WHERE id = $1 AND institution_id = $2",
    [id, institutionId]
  );
  if (!rowCount) throw ApiError.notFound("Section not found");
}

// --- Subjects ---

export async function listSubjects(institutionId: string) {
  const { rows } = await query(
    "SELECT id, name, code FROM subjects WHERE institution_id = $1 ORDER BY name",
    [institutionId]
  );
  return rows;
}

export async function createSubject(
  input: z.infer<typeof createSubjectSchema>,
  institutionId: string
) {
  const { rows } = await query(
    `INSERT INTO subjects (institution_id, name, code) VALUES ($1, $2, $3)
     RETURNING id, name, code`,
    [institutionId, input.name, input.code.toUpperCase()]
  );
  return rows[0];
}

export async function removeSubject(
  id: string,
  institutionId: string
): Promise<void> {
  const { rowCount } = await query(
    "DELETE FROM subjects WHERE id = $1 AND institution_id = $2",
    [id, institutionId]
  );
  if (!rowCount) throw ApiError.notFound("Subject not found");
}
