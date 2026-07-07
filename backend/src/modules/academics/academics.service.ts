import { query, withTransaction } from "../../db/postgres";
import { ApiError } from "../../utils/api-error";
import type { z } from "zod";
import type {
  assignSectionSubjectSchema,
  createAcademicYearSchema,
  createClassSchema,
  createSectionSchema,
  createSubjectSchema,
  updateAcademicYearSchema,
  updateClassSubjectSchema,
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

const ACADEMIC_YEAR_COLUMNS = `id, name, start_date AS "startDate",
  end_date AS "endDate", is_current AS "isCurrent"`;

/** Edit an academic year (tenant-scoped). Setting isCurrent unsets the others. */
export async function updateAcademicYear(
  id: string,
  input: z.infer<typeof updateAcademicYearSchema>,
  institutionId: string
) {
  return withTransaction(async (client) => {
    const { rows: exists } = await client.query(
      "SELECT 1 FROM academic_years WHERE id = $1 AND institution_id = $2",
      [id, institutionId]
    );
    if (!exists[0]) throw ApiError.notFound("Academic year not found");

    if (input.isCurrent) {
      await client.query(
        "UPDATE academic_years SET is_current = false WHERE institution_id = $1",
        [institutionId]
      );
    }
    const map: Record<string, string> = {
      name: "name",
      startDate: "start_date",
      endDate: "end_date",
      isCurrent: "is_current",
    };
    const sets: string[] = [];
    const params: unknown[] = [];
    for (const [field, col] of Object.entries(map)) {
      const v = (input as Record<string, unknown>)[field];
      if (v !== undefined) {
        params.push(v);
        sets.push(`${col} = $${params.length}`);
      }
    }
    if (!sets.length) throw ApiError.badRequest("No fields to update");
    params.push(id, institutionId);
    const { rows } = await client.query(
      `UPDATE academic_years SET ${sets.join(", ")}
       WHERE id = $${params.length - 1} AND institution_id = $${params.length}
       RETURNING ${ACADEMIC_YEAR_COLUMNS}`,
      params
    );
    return rows[0];
  });
}

/** Mark one academic year current for the tenant (unsets the previous one). */
export async function setCurrentAcademicYear(id: string, institutionId: string) {
  return withTransaction(async (client) => {
    const { rows: exists } = await client.query(
      "SELECT 1 FROM academic_years WHERE id = $1 AND institution_id = $2",
      [id, institutionId]
    );
    if (!exists[0]) throw ApiError.notFound("Academic year not found");
    await client.query(
      "UPDATE academic_years SET is_current = false WHERE institution_id = $1",
      [institutionId]
    );
    const { rows } = await client.query(
      `UPDATE academic_years SET is_current = true
       WHERE id = $1 AND institution_id = $2 RETURNING ${ACADEMIC_YEAR_COLUMNS}`,
      [id, institutionId]
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
                      AND st.institution_id = $1
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

// --- Section subject assignments (class_subjects) ---
// Which teacher teaches which subject to a given section.

const CLASS_SUBJECT_COLUMNS = `cs.id, cs.section_id AS "sectionId",
            cs.subject_id AS "subjectId", sub.name AS "subjectName",
            sub.code AS "subjectCode", cs.teacher_id AS "teacherId",
            CASE WHEN t.id IS NOT NULL
                 THEN t.first_name || ' ' || t.last_name END AS "teacherName"`;

async function assertSectionInTenant(
  sectionId: string,
  institutionId: string
): Promise<void> {
  const { rows } = await query(
    "SELECT id FROM sections WHERE id = $1 AND institution_id = $2",
    [sectionId, institutionId]
  );
  if (!rows[0]) throw ApiError.notFound("Section not found");
}

/** A single enriched class_subjects row, scoped to the tenant. */
async function getClassSubject(id: string, institutionId: string) {
  const { rows } = await query(
    `SELECT ${CLASS_SUBJECT_COLUMNS}
     FROM class_subjects cs
     JOIN subjects sub ON sub.id = cs.subject_id
     LEFT JOIN teachers t ON t.id = cs.teacher_id
     WHERE cs.id = $1 AND cs.institution_id = $2`,
    [id, institutionId]
  );
  if (!rows[0]) throw ApiError.notFound("Subject assignment not found");
  return rows[0];
}

export async function listSectionSubjects(
  sectionId: string,
  institutionId: string
) {
  await assertSectionInTenant(sectionId, institutionId);
  const { rows } = await query(
    `SELECT ${CLASS_SUBJECT_COLUMNS}
     FROM class_subjects cs
     JOIN subjects sub ON sub.id = cs.subject_id
     LEFT JOIN teachers t ON t.id = cs.teacher_id
     WHERE cs.section_id = $1 AND cs.institution_id = $2
     ORDER BY sub.name`,
    [sectionId, institutionId]
  );
  return rows;
}

export async function assignSectionSubject(
  sectionId: string,
  input: z.infer<typeof assignSectionSubjectSchema>,
  institutionId: string
) {
  await assertSectionInTenant(sectionId, institutionId);

  const { rows: subjectRows } = await query(
    "SELECT id FROM subjects WHERE id = $1 AND institution_id = $2",
    [input.subjectId, institutionId]
  );
  if (!subjectRows[0]) throw ApiError.notFound("Subject not found");

  if (input.teacherId) {
    const { rows: teacherRows } = await query(
      "SELECT id FROM teachers WHERE id = $1 AND institution_id = $2",
      [input.teacherId, institutionId]
    );
    if (!teacherRows[0]) throw ApiError.notFound("Teacher not found");
  }

  let id: string;
  try {
    const { rows } = await query<{ id: string }>(
      `INSERT INTO class_subjects (institution_id, section_id, subject_id, teacher_id)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [institutionId, sectionId, input.subjectId, input.teacherId ?? null]
    );
    id = rows[0].id;
  } catch (err) {
    if ((err as { code?: string }).code === "23505") {
      throw ApiError.badRequest(
        "That subject is already assigned to this section"
      );
    }
    throw err;
  }
  return getClassSubject(id, institutionId);
}

export async function updateClassSubject(
  id: string,
  input: z.infer<typeof updateClassSubjectSchema>,
  institutionId: string
) {
  if (input.teacherId) {
    const { rows: teacherRows } = await query(
      "SELECT id FROM teachers WHERE id = $1 AND institution_id = $2",
      [input.teacherId, institutionId]
    );
    if (!teacherRows[0]) throw ApiError.notFound("Teacher not found");
  }
  const { rowCount } = await query(
    "UPDATE class_subjects SET teacher_id = $1 WHERE id = $2 AND institution_id = $3",
    [input.teacherId, id, institutionId]
  );
  if (!rowCount) throw ApiError.notFound("Subject assignment not found");
  return getClassSubject(id, institutionId);
}

export async function removeClassSubject(
  id: string,
  institutionId: string
): Promise<void> {
  const { rowCount } = await query(
    "DELETE FROM class_subjects WHERE id = $1 AND institution_id = $2",
    [id, institutionId]
  );
  if (!rowCount) throw ApiError.notFound("Subject assignment not found");
}
