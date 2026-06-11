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

export async function listAcademicYears() {
  const { rows } = await query(
    `SELECT id, name, start_date AS "startDate", end_date AS "endDate",
            is_current AS "isCurrent"
     FROM academic_years ORDER BY start_date DESC`
  );
  return rows;
}

export async function createAcademicYear(
  input: z.infer<typeof createAcademicYearSchema>
) {
  return withTransaction(async (client) => {
    if (input.isCurrent) {
      await client.query("UPDATE academic_years SET is_current = false");
    }
    const { rows } = await client.query(
      `INSERT INTO academic_years (name, start_date, end_date, is_current)
       VALUES ($1, $2, $3, $4)
       RETURNING id, name, start_date AS "startDate", end_date AS "endDate",
                 is_current AS "isCurrent"`,
      [input.name, input.startDate, input.endDate, input.isCurrent ?? false]
    );
    return rows[0];
  });
}

// --- Classes and sections ---

export async function listClasses() {
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
     GROUP BY c.id
     ORDER BY c.grade_level, c.name`
  );
  return rows;
}

export async function createClass(input: z.infer<typeof createClassSchema>) {
  const { rows } = await query(
    `INSERT INTO classes (name, grade_level)
     VALUES ($1, $2)
     RETURNING id, name, grade_level AS "gradeLevel"`,
    [input.name, input.gradeLevel]
  );
  return rows[0];
}

export async function removeClass(id: string): Promise<void> {
  const { rowCount } = await query("DELETE FROM classes WHERE id = $1", [id]);
  if (!rowCount) throw ApiError.notFound("Class not found");
}

export async function createSection(
  classId: string,
  input: z.infer<typeof createSectionSchema>
) {
  const { rows: classRows } = await query(
    "SELECT id FROM classes WHERE id = $1",
    [classId]
  );
  if (!classRows[0]) throw ApiError.notFound("Class not found");

  const { rows } = await query(
    `INSERT INTO sections (class_id, name, homeroom_teacher_id, capacity)
     VALUES ($1, $2, $3, $4)
     RETURNING id, class_id AS "classId", name, capacity,
               homeroom_teacher_id AS "homeroomTeacherId"`,
    [classId, input.name, input.homeroomTeacherId ?? null, input.capacity ?? 40]
  );
  return rows[0];
}

export async function removeSection(id: string): Promise<void> {
  const { rowCount } = await query("DELETE FROM sections WHERE id = $1", [id]);
  if (!rowCount) throw ApiError.notFound("Section not found");
}

// --- Subjects ---

export async function listSubjects() {
  const { rows } = await query(
    "SELECT id, name, code FROM subjects ORDER BY name"
  );
  return rows;
}

export async function createSubject(
  input: z.infer<typeof createSubjectSchema>
) {
  const { rows } = await query(
    `INSERT INTO subjects (name, code) VALUES ($1, $2)
     RETURNING id, name, code`,
    [input.name, input.code.toUpperCase()]
  );
  return rows[0];
}

export async function removeSubject(id: string): Promise<void> {
  const { rowCount } = await query("DELETE FROM subjects WHERE id = $1", [id]);
  if (!rowCount) throw ApiError.notFound("Subject not found");
}
