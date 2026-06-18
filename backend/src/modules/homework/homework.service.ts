import { randomUUID } from "node:crypto";
import type { Request } from "express";
import { query } from "../../db/postgres";
import { ApiError } from "../../utils/api-error";
import { storage } from "../../utils/storage";
import { accessibleStudentIds } from "../../utils/scope";
import { assertValidFile } from "../documents/documents.service";
import { sendMessage } from "../communication/communication.service";
import type { z } from "zod";
import type {
  createHomeworkSchema,
  listHomeworkQuerySchema,
  reviewSchema,
  updateHomeworkSchema,
} from "./homework.schema";

interface UploadFile {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

const HOMEWORK_SELECT = `
  h.id, h.section_id AS "sectionId", sec.name AS "sectionName", c.name AS "className",
  h.subject_id AS "subjectId", subj.name AS "subjectName",
  h.title, h.description, h.instructions, h.due_date AS "dueDate",
  h.max_marks AS "maxMarks", h.created_by AS "createdBy", h.created_at AS "createdAt",
  (SELECT count(*)::int FROM documents d WHERE d.owner_type = 'homework' AND d.owner_id = h.id) AS "attachmentCount",
  (SELECT count(*)::int FROM homework_submissions s WHERE s.homework_id = h.id) AS "submissionCount"
FROM homework h
JOIN sections sec ON sec.id = h.section_id
JOIN classes c ON c.id = sec.class_id
JOIN subjects subj ON subj.id = h.subject_id`;

/** Section ids the caller may see homework for; null = staff (unrestricted). */
async function accessibleSectionIds(
  req: Request,
  institutionId: string
): Promise<string[] | null> {
  const studentIds = await accessibleStudentIds(req);
  if (studentIds === null) return null; // staff
  if (studentIds.length === 0) return [];
  const { rows } = await query<{ section_id: string }>(
    `SELECT DISTINCT section_id FROM students
     WHERE institution_id = $1 AND id = ANY($2::uuid[]) AND section_id IS NOT NULL`,
    [institutionId, studentIds]
  );
  return rows.map((r) => r.section_id);
}

async function attachmentsFor(
  ownerType: "homework" | "submission",
  ownerId: string,
  institutionId: string
) {
  const { rows } = await query(
    `SELECT id, original_name AS "originalName", mime_type AS "mimeType",
            size_bytes AS "sizeBytes", created_at AS "createdAt"
     FROM documents
     WHERE institution_id = $1 AND owner_type = $2 AND owner_id = $3
     ORDER BY created_at`,
    [institutionId, ownerType, ownerId]
  );
  return rows;
}

async function storeAttachment(
  ownerType: "homework" | "submission",
  ownerId: string,
  file: UploadFile,
  institutionId: string,
  uploadedBy: string
) {
  const ext = assertValidFile(file.originalname, file.mimetype, file.size);
  const safeName = `${randomUUID()}.${ext}`;
  const key = `${institutionId}/${ownerType}/${safeName}`;
  try {
    await storage.put(key, file.buffer, file.mimetype);
  } catch (err) {
    console.error("storage.put failed:", err);
    throw ApiError.serviceUnavailable("File storage is unavailable");
  }
  const { rows } = await query(
    `INSERT INTO documents
       (institution_id, owner_type, owner_id, category, original_name, safe_name,
        mime_type, size_bytes, storage_key, storage_mode, uploaded_by)
     VALUES ($1, $2, $3, 'attachment', $4, $5, $6, $7, $8, $9, $10)
     RETURNING id, original_name AS "originalName", mime_type AS "mimeType",
               size_bytes AS "sizeBytes", created_at AS "createdAt"`,
    [
      institutionId,
      ownerType,
      ownerId,
      file.originalname,
      safeName,
      file.mimetype,
      file.size,
      key,
      storage.mode,
      uploadedBy,
    ]
  );
  return rows[0];
}

async function assertRef(
  table: "sections" | "subjects",
  id: string,
  institutionId: string,
  label: string
): Promise<void> {
  const { rows } = await query(
    `SELECT 1 FROM ${table} WHERE id = $1 AND institution_id = $2`,
    [id, institutionId]
  );
  if (!rows[0]) throw ApiError.badRequest(`Invalid ${label}`);
}

// --- Homework ---

export async function listHomework(
  req: Request,
  filters: z.infer<typeof listHomeworkQuerySchema>,
  institutionId: string
) {
  const params: unknown[] = [institutionId];
  const conditions = ["h.institution_id = $1"];
  const sections = await accessibleSectionIds(req, institutionId);
  if (sections !== null) {
    params.push(sections);
    conditions.push(`h.section_id = ANY($${params.length}::uuid[])`);
  } else if (filters.sectionId) {
    params.push(filters.sectionId);
    conditions.push(`h.section_id = $${params.length}`);
  }
  if (filters.subjectId) {
    params.push(filters.subjectId);
    conditions.push(`h.subject_id = $${params.length}`);
  }
  const { rows } = await query(
    `SELECT ${HOMEWORK_SELECT} WHERE ${conditions.join(" AND ")}
     ORDER BY h.due_date DESC NULLS LAST, h.created_at DESC`,
    params
  );
  return rows;
}

export async function createHomework(
  input: z.infer<typeof createHomeworkSchema>,
  createdBy: string,
  institutionId: string
) {
  await assertRef("sections", input.sectionId, institutionId, "section");
  await assertRef("subjects", input.subjectId, institutionId, "subject");
  const { rows } = await query<{ id: string }>(
    `INSERT INTO homework
       (institution_id, section_id, subject_id, title, description, instructions, due_date, max_marks, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
    [
      institutionId,
      input.sectionId,
      input.subjectId,
      input.title,
      input.description ?? "",
      input.instructions ?? null,
      input.dueDate ?? null,
      input.maxMarks ?? null,
      createdBy,
    ]
  );
  const homework = await getHomeworkRow(rows[0].id, institutionId);
  // Notify the section (students + guardians). The in-app fan-out is awaited so
  // recipients exist immediately; external channels stay fire-and-forget inside
  // sendMessage. A notify failure must never fail homework creation.
  await sendMessage(
    createdBy,
    {
      subject: `New homework: ${homework.title}`,
      body:
        `${homework.subjectName} — ${homework.title}` +
        (homework.dueDate ? ` (due ${homework.dueDate})` : ""),
      category: "announcement",
      audienceType: "section",
      audienceRef: input.sectionId,
    },
    institutionId
  ).catch((err) => console.error("homework notify failed:", err));
  return homework;
}

async function getHomeworkRow(id: string, institutionId: string) {
  const { rows } = await query(
    `SELECT ${HOMEWORK_SELECT} WHERE h.id = $1 AND h.institution_id = $2`,
    [id, institutionId]
  );
  if (!rows[0]) throw ApiError.notFound("Homework not found");
  return rows[0] as Record<string, unknown> & {
    title: string;
    subjectName: string;
    dueDate: string | null;
    sectionId: string;
    createdBy: string | null;
  };
}

export async function getHomework(
  req: Request,
  id: string,
  institutionId: string
) {
  const homework = await getHomeworkRow(id, institutionId);
  const sections = await accessibleSectionIds(req, institutionId);
  if (sections !== null && !sections.includes(homework.sectionId)) {
    throw ApiError.forbidden("You cannot access this homework");
  }
  const attachments = await attachmentsFor("homework", id, institutionId);

  // A student also gets their own submission inline.
  let submission = null;
  if (req.user!.role === "student") {
    const { rows } = await query(
      `SELECT hs.id, hs.content, hs.status, hs.marks, hs.remarks,
              hs.submitted_at AS "submittedAt", hs.reviewed_at AS "reviewedAt"
       FROM homework_submissions hs
       JOIN students s ON s.id = hs.student_id
       WHERE hs.homework_id = $1 AND hs.institution_id = $2 AND s.user_id = $3`,
      [id, institutionId, req.user!.id]
    );
    submission = rows[0] ?? null;
  }
  return { ...homework, attachments, submission };
}

export async function updateHomework(
  id: string,
  input: z.infer<typeof updateHomeworkSchema>,
  institutionId: string
) {
  const map: Record<string, string> = {
    subjectId: "subject_id",
    title: "title",
    description: "description",
    instructions: "instructions",
    dueDate: "due_date",
    maxMarks: "max_marks",
  };
  const sets: string[] = [];
  const params: unknown[] = [];
  for (const [field, column] of Object.entries(map)) {
    const value = (input as Record<string, unknown>)[field];
    if (value !== undefined) {
      params.push(value);
      sets.push(`${column} = $${params.length}`);
    }
  }
  if (!sets.length) throw ApiError.badRequest("No fields to update");
  if (input.subjectId) await assertRef("subjects", input.subjectId, institutionId, "subject");
  sets.push("updated_at = now()");
  params.push(id, institutionId);
  const { rowCount } = await query(
    `UPDATE homework SET ${sets.join(", ")}
     WHERE id = $${params.length - 1} AND institution_id = $${params.length}`,
    params
  );
  if (!rowCount) throw ApiError.notFound("Homework not found");
  return getHomeworkRow(id, institutionId);
}

export async function deleteHomework(
  id: string,
  institutionId: string
): Promise<void> {
  const { rowCount } = await query(
    "DELETE FROM homework WHERE id = $1 AND institution_id = $2",
    [id, institutionId]
  );
  if (!rowCount) throw ApiError.notFound("Homework not found");
}

export async function addHomeworkAttachment(
  homeworkId: string,
  file: UploadFile,
  institutionId: string,
  uploadedBy: string
) {
  await getHomeworkRow(homeworkId, institutionId); // 404 if not in tenant
  return storeAttachment("homework", homeworkId, file, institutionId, uploadedBy);
}

// --- Submissions ---

export async function submitHomework(
  req: Request,
  homeworkId: string,
  content: string | undefined,
  file: UploadFile | undefined,
  institutionId: string
) {
  const homework = await getHomeworkRow(homeworkId, institutionId);

  // The caller must be a student in this homework's section.
  const { rows: studentRows } = await query<{ id: string; section_id: string | null }>(
    "SELECT id, section_id FROM students WHERE user_id = $1 AND institution_id = $2",
    [req.user!.id, institutionId]
  );
  const student = studentRows[0];
  if (!student) throw ApiError.forbidden("No student record for this account");
  if (student.section_id !== homework.sectionId) {
    throw ApiError.forbidden("This homework is not assigned to your section");
  }

  const overdue = homework.dueDate
    ? new Date() > new Date(`${homework.dueDate}T23:59:59`)
    : false;
  const status = overdue ? "late" : "submitted";

  const { rows } = await query<{ id: string }>(
    `INSERT INTO homework_submissions
       (institution_id, homework_id, student_id, content, status, submitted_at)
     VALUES ($1, $2, $3, $4, $5, now())
     ON CONFLICT (homework_id, student_id)
     DO UPDATE SET content = EXCLUDED.content, status = EXCLUDED.status,
                   submitted_at = now(), updated_at = now()
     RETURNING id`,
    [institutionId, homeworkId, student.id, content ?? null, status]
  );
  const submissionId = rows[0].id;

  let attachment = null;
  if (file) {
    attachment = await storeAttachment(
      "submission",
      submissionId,
      file,
      institutionId,
      req.user!.id
    );
  }

  // Notify the teacher who created the homework (best-effort).
  if (homework.createdBy) {
    await sendMessage(
      req.user!.id,
      {
        subject: `Homework submitted: ${homework.title}`,
        body: `A student submitted "${homework.title}".`,
        category: "message",
        audienceType: "user",
        audienceRef: homework.createdBy,
      },
      institutionId
    ).catch((err) => console.error("submit notify failed:", err));
  }

  return { id: submissionId, status, attachment };
}

export async function listSubmissions(homeworkId: string, institutionId: string) {
  await getHomeworkRow(homeworkId, institutionId);
  const { rows } = await query(
    `SELECT hs.id, hs.student_id AS "studentId",
            s.first_name || ' ' || s.last_name AS "studentName",
            s.admission_no AS "admissionNo",
            hs.content, hs.status, hs.marks, hs.remarks,
            hs.submitted_at AS "submittedAt", hs.reviewed_at AS "reviewedAt",
            (SELECT count(*)::int FROM documents d
             WHERE d.owner_type = 'submission' AND d.owner_id = hs.id) AS "attachmentCount"
     FROM homework_submissions hs
     JOIN students s ON s.id = hs.student_id
     WHERE hs.homework_id = $1 AND hs.institution_id = $2
     ORDER BY s.first_name, s.last_name`,
    [homeworkId, institutionId]
  );
  return rows;
}

export async function reviewSubmission(
  submissionId: string,
  input: z.infer<typeof reviewSchema>,
  reviewerId: string,
  institutionId: string
) {
  const { rows } = await query(
    `UPDATE homework_submissions
     SET status = $1, marks = $2, remarks = $3, reviewed_at = now(),
         reviewed_by = $4, updated_at = now()
     WHERE id = $5 AND institution_id = $6
     RETURNING id, status, marks, remarks, reviewed_at AS "reviewedAt"`,
    [
      input.status,
      input.marks ?? null,
      input.remarks ?? null,
      reviewerId,
      submissionId,
      institutionId,
    ]
  );
  if (!rows[0]) throw ApiError.notFound("Submission not found");
  return rows[0];
}

// --- Attachment download (homework + submission), access-checked ---

export async function downloadAttachment(
  req: Request,
  docId: string,
  institutionId: string
): Promise<{ buffer: Buffer; mimeType: string; originalName: string }> {
  const { rows } = await query<{
    storage_key: string;
    mime_type: string;
    original_name: string;
    owner_type: string;
    owner_id: string;
  }>(
    `SELECT storage_key, mime_type, original_name, owner_type, owner_id
     FROM documents
     WHERE id = $1 AND institution_id = $2 AND owner_type IN ('homework', 'submission')`,
    [docId, institutionId]
  );
  const doc = rows[0];
  if (!doc) throw ApiError.notFound("Attachment not found");

  const studentIds = await accessibleStudentIds(req);
  if (studentIds !== null) {
    if (doc.owner_type === "homework") {
      const sections = (await accessibleSectionIds(req, institutionId)) ?? [];
      const { rows: hw } = await query<{ section_id: string }>(
        "SELECT section_id FROM homework WHERE id = $1 AND institution_id = $2",
        [doc.owner_id, institutionId]
      );
      if (!hw[0] || !sections.includes(hw[0].section_id)) {
        throw ApiError.forbidden("You cannot access this attachment");
      }
    } else {
      // submission attachment
      const { rows: sub } = await query<{ student_id: string }>(
        "SELECT student_id FROM homework_submissions WHERE id = $1 AND institution_id = $2",
        [doc.owner_id, institutionId]
      );
      if (!sub[0] || !studentIds.includes(sub[0].student_id)) {
        throw ApiError.forbidden("You cannot access this attachment");
      }
    }
  }

  try {
    const buffer = await storage.get(doc.storage_key);
    return { buffer, mimeType: doc.mime_type, originalName: doc.original_name };
  } catch (err) {
    console.error("storage.get failed:", err);
    throw ApiError.serviceUnavailable("File storage is unavailable");
  }
}
