import { query, withTransaction } from "../../db/postgres";
import { ApiError } from "../../utils/api-error";
import { paginatedResponse, type Pagination } from "../../utils/pagination";
import type { z } from "zod";
import type {
  createQuizSchema,
  updateQuizSchema,
  listQuizzesQuerySchema,
  createQuestionSchema,
  updateQuestionSchema,
  submitAttemptSchema,
} from "./quizzes.schema";

const QUIZ_SELECT = `
  q.id,
  q.class_id AS "classId",
  c.name AS "className",
  q.subject_id AS "subjectId",
  sub.name AS "subjectName",
  q.title,
  q.description,
  q.is_published AS "isPublished",
  (SELECT count(*)::int FROM quiz_questions qq WHERE qq.quiz_id = q.id) AS "questionCount",
  (SELECT coalesce(sum(qq.marks), 0)::int FROM quiz_questions qq WHERE qq.quiz_id = q.id) AS "totalMarks",
  q.created_at AS "createdAt",
  q.updated_at AS "updatedAt"
FROM quizzes q
LEFT JOIN classes c ON c.id = q.class_id
LEFT JOIN subjects sub ON sub.id = q.subject_id`;

// ---------------------------------------------------------------- staff: quizzes

export async function listQuizzes(
  pagination: Pagination,
  filters: z.infer<typeof listQuizzesQuerySchema>,
  institutionId: string
) {
  const params: unknown[] = [institutionId];
  const conditions: string[] = ["q.institution_id = $1"];
  if (filters.classId) {
    params.push(filters.classId);
    conditions.push(`q.class_id = $${params.length}`);
  }
  if (filters.subjectId) {
    params.push(filters.subjectId);
    conditions.push(`q.subject_id = $${params.length}`);
  }
  if (filters.published) {
    params.push(filters.published === "true");
    conditions.push(`q.is_published = $${params.length}`);
  }
  const where = `WHERE ${conditions.join(" AND ")}`;
  const countResult = await query<{ count: string }>(
    `SELECT count(*) FROM quizzes q ${where}`,
    params
  );
  const { rows } = await query(
    `SELECT ${QUIZ_SELECT} ${where}
     ORDER BY q.created_at DESC
     LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, pagination.limit, pagination.offset]
  );
  return paginatedResponse(rows, Number(countResult.rows[0].count), pagination);
}

async function quizHeader(id: string, institutionId: string) {
  const { rows } = await query(
    `SELECT ${QUIZ_SELECT} WHERE q.id = $1 AND q.institution_id = $2`,
    [id, institutionId]
  );
  if (!rows[0]) throw ApiError.notFound("Quiz not found");
  return rows[0];
}

/** Full quiz with questions including the correct answers (staff view). */
export async function getQuiz(id: string, institutionId: string) {
  const quiz = await quizHeader(id, institutionId);
  const { rows: questions } = await query(
    `SELECT id, question_text AS "questionText", option_a AS "optionA",
            option_b AS "optionB", option_c AS "optionC", option_d AS "optionD",
            correct_option AS "correctOption", marks, sort_order AS "sortOrder"
     FROM quiz_questions WHERE quiz_id = $1
     ORDER BY sort_order ASC, created_at ASC`,
    [id]
  );
  return { ...quiz, questions };
}

export async function createQuiz(
  input: z.infer<typeof createQuizSchema>,
  institutionId: string,
  userId: string
) {
  const { rows } = await query<{ id: string }>(
    `INSERT INTO quizzes (institution_id, class_id, subject_id, title, description, created_by)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
    [institutionId, input.classId ?? null, input.subjectId ?? null, input.title, input.description ?? null, userId]
  );
  return getQuiz(rows[0].id, institutionId);
}

const QUIZ_UPDATE_MAP: Record<string, string> = {
  title: "title",
  description: "description",
  classId: "class_id",
  subjectId: "subject_id",
  isPublished: "is_published",
};

export async function updateQuiz(
  id: string,
  input: z.infer<typeof updateQuizSchema>,
  institutionId: string
) {
  const sets: string[] = [];
  const params: unknown[] = [];
  for (const [field, column] of Object.entries(QUIZ_UPDATE_MAP)) {
    const value = (input as Record<string, unknown>)[field];
    if (value !== undefined) {
      params.push(value);
      sets.push(`${column} = $${params.length}`);
    }
  }
  if (!sets.length) throw ApiError.badRequest("No fields to update");
  sets.push("updated_at = now()");
  params.push(id, institutionId);
  const { rowCount } = await query(
    `UPDATE quizzes SET ${sets.join(", ")}
     WHERE id = $${params.length - 1} AND institution_id = $${params.length}`,
    params
  );
  if (!rowCount) throw ApiError.notFound("Quiz not found");
  return getQuiz(id, institutionId);
}

export async function deleteQuiz(id: string, institutionId: string): Promise<void> {
  const { rowCount } = await query(
    "DELETE FROM quizzes WHERE id = $1 AND institution_id = $2",
    [id, institutionId]
  );
  if (!rowCount) throw ApiError.notFound("Quiz not found");
}

// -------------------------------------------------------------- staff: questions

/** Confirms the quiz exists in the tenant (used to scope question writes). */
async function assertQuizInTenant(quizId: string, institutionId: string) {
  const { rows } = await query<{ id: string }>(
    "SELECT id FROM quizzes WHERE id = $1 AND institution_id = $2",
    [quizId, institutionId]
  );
  if (!rows[0]) throw ApiError.notFound("Quiz not found");
}

export async function addQuestion(
  quizId: string,
  input: z.infer<typeof createQuestionSchema>,
  institutionId: string
) {
  await assertQuizInTenant(quizId, institutionId);
  await query(
    `INSERT INTO quiz_questions (
       quiz_id, question_text, option_a, option_b, option_c, option_d,
       correct_option, marks, sort_order
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [
      quizId,
      input.questionText,
      input.optionA,
      input.optionB,
      input.optionC ?? null,
      input.optionD ?? null,
      input.correctOption,
      input.marks ?? 1,
      input.sortOrder ?? 0,
    ]
  );
  return getQuiz(quizId, institutionId);
}

const QUESTION_UPDATE_MAP: Record<string, string> = {
  questionText: "question_text",
  optionA: "option_a",
  optionB: "option_b",
  optionC: "option_c",
  optionD: "option_d",
  correctOption: "correct_option",
  marks: "marks",
  sortOrder: "sort_order",
};

export async function updateQuestion(
  questionId: string,
  input: z.infer<typeof updateQuestionSchema>,
  institutionId: string
) {
  // Resolve the owning quiz and confirm it is in the tenant.
  const owner = await query<{ quiz_id: string }>(
    `SELECT qq.quiz_id FROM quiz_questions qq
     JOIN quizzes q ON q.id = qq.quiz_id
     WHERE qq.id = $1 AND q.institution_id = $2`,
    [questionId, institutionId]
  );
  if (!owner.rows[0]) throw ApiError.notFound("Question not found");

  const sets: string[] = [];
  const params: unknown[] = [];
  for (const [field, column] of Object.entries(QUESTION_UPDATE_MAP)) {
    const value = (input as Record<string, unknown>)[field];
    if (value !== undefined) {
      params.push(value);
      sets.push(`${column} = $${params.length}`);
    }
  }
  if (!sets.length) throw ApiError.badRequest("No fields to update");
  params.push(questionId);
  await query(`UPDATE quiz_questions SET ${sets.join(", ")} WHERE id = $${params.length}`, params);
  return getQuiz(owner.rows[0].quiz_id, institutionId);
}

export async function deleteQuestion(questionId: string, institutionId: string): Promise<void> {
  const { rowCount } = await query(
    `DELETE FROM quiz_questions qq
     USING quizzes q
     WHERE qq.id = $1 AND qq.quiz_id = q.id AND q.institution_id = $2`,
    [questionId, institutionId]
  );
  if (!rowCount) throw ApiError.notFound("Question not found");
}

// --------------------------------------------------------- student / portal side

// A student may see a quiz when it's published and either school-wide or for
// their own class.
const STUDENT_SCOPE = `q.is_published = true AND (
  q.class_id IS NULL OR q.class_id = (
    SELECT sec.class_id FROM students st
    JOIN sections sec ON sec.id = st.section_id
    WHERE st.id = $2 AND st.institution_id = $1
  )
)`;

export async function listStudentQuizzes(studentId: string, institutionId: string) {
  const { rows } = await query(
    `SELECT q.id, q.title, q.description, c.name AS "className", sub.name AS "subjectName",
            (SELECT count(*)::int FROM quiz_questions qq WHERE qq.quiz_id = q.id) AS "questionCount",
            (SELECT coalesce(sum(qq.marks), 0)::int FROM quiz_questions qq WHERE qq.quiz_id = q.id) AS "totalMarks",
            qa.score AS "score", qa.total AS "total", (qa.id IS NOT NULL) AS "attempted"
     FROM quizzes q
     LEFT JOIN classes c ON c.id = q.class_id
     LEFT JOIN subjects sub ON sub.id = q.subject_id
     LEFT JOIN quiz_attempts qa ON qa.quiz_id = q.id AND qa.student_id = $2
     WHERE q.institution_id = $1 AND ${STUDENT_SCOPE}
     ORDER BY q.created_at DESC`,
    [institutionId, studentId]
  );
  return rows;
}

async function assertQuizVisibleToStudent(quizId: string, studentId: string, institutionId: string) {
  const { rows } = await query(
    `SELECT q.id FROM quizzes q WHERE q.id = $3 AND q.institution_id = $1 AND ${STUDENT_SCOPE}`,
    [institutionId, studentId, quizId]
  );
  if (!rows[0]) throw ApiError.notFound("Quiz not found");
}

/**
 * Quiz for a student. Before attempting, correct answers are withheld; once the
 * student has submitted, the result is returned (answers + score) for review.
 */
export async function getQuizForStudent(quizId: string, studentId: string, institutionId: string) {
  await assertQuizVisibleToStudent(quizId, studentId, institutionId);
  const header = await query(
    `SELECT q.id, q.title, q.description, c.name AS "className", sub.name AS "subjectName"
     FROM quizzes q
     LEFT JOIN classes c ON c.id = q.class_id
     LEFT JOIN subjects sub ON sub.id = q.subject_id
     WHERE q.id = $1`,
    [quizId]
  );
  const attempt = await query<{ score: number; total: number; answers: Record<string, string> }>(
    `SELECT score, total, answers FROM quiz_attempts WHERE quiz_id = $1 AND student_id = $2`,
    [quizId, studentId]
  );
  const attempted = attempt.rows.length > 0;
  const { rows: questions } = await query(
    `SELECT id, question_text AS "questionText", option_a AS "optionA",
            option_b AS "optionB", option_c AS "optionC", option_d AS "optionD",
            marks, sort_order AS "sortOrder"
            ${attempted ? `, correct_option AS "correctOption"` : ""}
     FROM quiz_questions WHERE quiz_id = $1
     ORDER BY sort_order ASC, created_at ASC`,
    [quizId]
  );
  return {
    ...header.rows[0],
    attempted,
    result: attempted
      ? { score: attempt.rows[0].score, total: attempt.rows[0].total, answers: attempt.rows[0].answers }
      : null,
    questions,
  };
}

export async function submitAttempt(
  quizId: string,
  studentId: string,
  institutionId: string,
  input: z.infer<typeof submitAttemptSchema>
) {
  await assertQuizVisibleToStudent(quizId, studentId, institutionId);

  return withTransaction(async (client) => {
    const existing = await client.query(
      "SELECT id FROM quiz_attempts WHERE quiz_id = $1 AND student_id = $2",
      [quizId, studentId]
    );
    if (existing.rows[0]) throw ApiError.conflict("You have already attempted this quiz");

    const { rows: questions } = await client.query<{
      id: string;
      correct_option: string;
      marks: number;
    }>(
      `SELECT id, correct_option, marks FROM quiz_questions WHERE quiz_id = $1`,
      [quizId]
    );
    if (!questions.length) throw ApiError.badRequest("This quiz has no questions yet");

    let score = 0;
    let total = 0;
    for (const q of questions) {
      total += q.marks;
      if (input.answers[q.id] && input.answers[q.id] === q.correct_option) {
        score += q.marks;
      }
    }

    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO quiz_attempts (quiz_id, institution_id, student_id, score, total, answers)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [quizId, institutionId, studentId, score, total, JSON.stringify(input.answers)]
    );
    return { attemptId: rows[0].id, score, total };
  });
}
