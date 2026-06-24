import { query, withTransaction } from "../../db/postgres";
import { ApiError } from "../../utils/api-error";
import { paginatedResponse, type Pagination } from "../../utils/pagination";
import type { z } from "zod";
import type {
  createPollSchema,
  updatePollSchema,
  listPollsQuerySchema,
} from "./polls.schema";

const POLL_SELECT = `
  p.id,
  p.class_id AS "classId",
  c.name AS "className",
  p.question,
  p.description,
  p.is_published AS "isPublished",
  p.closes_at AS "closesAt",
  (SELECT count(*)::int FROM poll_votes v WHERE v.poll_id = p.id) AS "totalVotes",
  p.created_at AS "createdAt",
  p.updated_at AS "updatedAt"
FROM polls p
LEFT JOIN classes c ON c.id = p.class_id`;

async function optionsWithCounts(pollId: string) {
  const { rows } = await query(
    `SELECT o.id, o.label, o.sort_order AS "sortOrder",
            (SELECT count(*)::int FROM poll_votes v WHERE v.option_id = o.id) AS "votes"
     FROM poll_options o WHERE o.poll_id = $1
     ORDER BY o.sort_order ASC, o.created_at ASC`,
    [pollId]
  );
  return rows;
}

// ------------------------------------------------------------------ staff side

export async function listPolls(
  pagination: Pagination,
  filters: z.infer<typeof listPollsQuerySchema>,
  institutionId: string
) {
  const params: unknown[] = [institutionId];
  const conditions: string[] = ["p.institution_id = $1"];
  if (filters.classId) {
    params.push(filters.classId);
    conditions.push(`p.class_id = $${params.length}`);
  }
  if (filters.published) {
    params.push(filters.published === "true");
    conditions.push(`p.is_published = $${params.length}`);
  }
  const where = `WHERE ${conditions.join(" AND ")}`;
  const countResult = await query<{ count: string }>(
    `SELECT count(*) FROM polls p ${where}`,
    params
  );
  const { rows } = await query(
    `SELECT ${POLL_SELECT} ${where}
     ORDER BY p.created_at DESC
     LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, pagination.limit, pagination.offset]
  );
  return paginatedResponse(rows, Number(countResult.rows[0].count), pagination);
}

async function pollHeader(id: string, institutionId: string) {
  const { rows } = await query(
    `SELECT ${POLL_SELECT} WHERE p.id = $1 AND p.institution_id = $2`,
    [id, institutionId]
  );
  if (!rows[0]) throw ApiError.notFound("Poll not found");
  return rows[0];
}

export async function getPoll(id: string, institutionId: string) {
  const poll = await pollHeader(id, institutionId);
  return { ...poll, options: await optionsWithCounts(id) };
}

export async function createPoll(
  input: z.infer<typeof createPollSchema>,
  institutionId: string,
  userId: string
) {
  const id = await withTransaction(async (client) => {
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO polls (institution_id, class_id, question, description, closes_at, created_by)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [institutionId, input.classId ?? null, input.question, input.description ?? null, input.closesAt ?? null, userId]
    );
    const pollId = rows[0].id;
    for (let i = 0; i < input.options.length; i++) {
      await client.query(
        "INSERT INTO poll_options (poll_id, label, sort_order) VALUES ($1,$2,$3)",
        [pollId, input.options[i], i]
      );
    }
    return pollId;
  });
  return getPoll(id, institutionId);
}

const POLL_UPDATE_MAP: Record<string, string> = {
  question: "question",
  description: "description",
  classId: "class_id",
  closesAt: "closes_at",
  isPublished: "is_published",
};

export async function updatePoll(
  id: string,
  input: z.infer<typeof updatePollSchema>,
  institutionId: string
) {
  const sets: string[] = [];
  const params: unknown[] = [];
  for (const [field, column] of Object.entries(POLL_UPDATE_MAP)) {
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
    `UPDATE polls SET ${sets.join(", ")}
     WHERE id = $${params.length - 1} AND institution_id = $${params.length}`,
    params
  );
  if (!rowCount) throw ApiError.notFound("Poll not found");
  return getPoll(id, institutionId);
}

export async function deletePoll(id: string, institutionId: string): Promise<void> {
  const { rowCount } = await query(
    "DELETE FROM polls WHERE id = $1 AND institution_id = $2",
    [id, institutionId]
  );
  if (!rowCount) throw ApiError.notFound("Poll not found");
}

// --------------------------------------------------------------- student side

const STUDENT_SCOPE = `p.is_published = true AND (
  p.class_id IS NULL OR p.class_id = (
    SELECT sec.class_id FROM students st
    JOIN sections sec ON sec.id = st.section_id
    WHERE st.id = $2 AND st.institution_id = $1
  )
)`;

export async function listStudentPolls(studentId: string, institutionId: string) {
  const { rows } = await query(
    `SELECT p.id, p.question, p.description, c.name AS "className", p.closes_at AS "closesAt",
            (SELECT count(*)::int FROM poll_votes v WHERE v.poll_id = p.id) AS "totalVotes",
            (vote.id IS NOT NULL) AS "voted"
     FROM polls p
     LEFT JOIN classes c ON c.id = p.class_id
     LEFT JOIN poll_votes vote ON vote.poll_id = p.id AND vote.student_id = $2
     WHERE p.institution_id = $1 AND ${STUDENT_SCOPE}
     ORDER BY p.created_at DESC`,
    [institutionId, studentId]
  );
  return rows;
}

async function assertPollVisible(pollId: string, studentId: string, institutionId: string) {
  const { rows } = await query(
    `SELECT p.id, p.closes_at AS "closesAt" FROM polls p
     WHERE p.id = $3 AND p.institution_id = $1 AND ${STUDENT_SCOPE}`,
    [institutionId, studentId, pollId]
  );
  if (!rows[0]) throw ApiError.notFound("Poll not found");
  return rows[0] as { id: string; closesAt: string | null };
}

export async function getPollForStudent(pollId: string, studentId: string, institutionId: string) {
  await assertPollVisible(pollId, studentId, institutionId);
  const header = await query(
    `SELECT p.id, p.question, p.description, c.name AS "className", p.closes_at AS "closesAt"
     FROM polls p LEFT JOIN classes c ON c.id = p.class_id WHERE p.id = $1`,
    [pollId]
  );
  const myVote = await query<{ option_id: string }>(
    "SELECT option_id FROM poll_votes WHERE poll_id = $1 AND student_id = $2",
    [pollId, studentId]
  );
  const voted = myVote.rows.length > 0;
  // Reveal counts once the student has voted (or the poll has closed).
  const closed = !!header.rows[0].closesAt && new Date(header.rows[0].closesAt) < new Date();
  const showResults = voted || closed;
  const { rows: options } = await query(
    `SELECT o.id, o.label, o.sort_order AS "sortOrder"
            ${showResults ? `, (SELECT count(*)::int FROM poll_votes v WHERE v.option_id = o.id) AS "votes"` : ""}
     FROM poll_options o WHERE o.poll_id = $1 ORDER BY o.sort_order ASC, o.created_at ASC`,
    [pollId]
  );
  return {
    ...header.rows[0],
    voted,
    closed,
    myOptionId: voted ? myVote.rows[0].option_id : null,
    options,
  };
}

export async function vote(
  pollId: string,
  studentId: string,
  institutionId: string,
  optionId: string
) {
  const poll = await assertPollVisible(pollId, studentId, institutionId);
  if (poll.closesAt && new Date(poll.closesAt) < new Date()) {
    throw ApiError.badRequest("This poll is closed");
  }
  return withTransaction(async (client) => {
    const opt = await client.query(
      "SELECT id FROM poll_options WHERE id = $1 AND poll_id = $2",
      [optionId, pollId]
    );
    if (!opt.rows[0]) throw ApiError.badRequest("Invalid option for this poll");

    const existing = await client.query(
      "SELECT id FROM poll_votes WHERE poll_id = $1 AND student_id = $2",
      [pollId, studentId]
    );
    if (existing.rows[0]) throw ApiError.conflict("You have already voted in this poll");

    await client.query(
      `INSERT INTO poll_votes (poll_id, option_id, institution_id, student_id)
       VALUES ($1,$2,$3,$4)`,
      [pollId, optionId, institutionId, studentId]
    );
    return { voted: true };
  });
}
