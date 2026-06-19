import type { PoolClient } from "pg";
import type { z } from "zod";
import { query, withTransaction } from "../../db/postgres";
import { ApiError } from "../../utils/api-error";
import type {
  actionDisciplinarySchema,
  cancelDisciplinarySchema,
  createDisciplinarySchema,
  listDisciplinaryQuerySchema,
  updateDisciplinarySchema,
} from "./disciplinary.schema";

const SELECT = `
  dr.id, dr.student_id AS "studentId",
  s.first_name || ' ' || s.last_name AS "studentName",
  dr.admission_no AS "admissionNo", dr.class_name AS "className",
  dr.section_name AS "sectionName", dr.program_name AS "programName",
  dr.semester_name AS "semesterName",
  to_char(dr.incident_date, 'YYYY-MM-DD') AS "incidentDate",
  dr.category, dr.severity, dr.description, dr.reported_by AS "reportedBy",
  dr.involved_staff AS "involvedStaff", dr.action_taken AS "actionTaken",
  to_char(dr.follow_up_date, 'YYYY-MM-DD') AS "followUpDate",
  dr.status, dr.remarks,
  dr.closed_at AS "closedAt", dr.cancelled_at AS "cancelledAt",
  dr.cancel_reason AS "cancelReason", dr.created_at AS "createdAt"`;

const TERMINAL = ["closed", "cancelled"];

/** Closed/cancelled records are immutable except via reports/history reads. */
function assertActive(status: string): void {
  if (TERMINAL.includes(status)) {
    throw ApiError.badRequest(`A ${status} record cannot be modified`);
  }
}

/** Appends an audit-trail row within the caller's transaction. */
async function logAction(
  client: PoolClient,
  institutionId: string,
  recordId: string,
  action: string,
  fromStatus: string | null,
  toStatus: string | null,
  note: string | null,
  userId: string
): Promise<void> {
  await client.query(
    `INSERT INTO disciplinary_actions
       (institution_id, record_id, action, note, from_status, to_status, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [institutionId, recordId, action, note, fromStatus, toStatus, userId]
  );
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

// --- Register CRUD ---

export async function listRecords(
  institutionId: string,
  filters: z.infer<typeof listDisciplinaryQuerySchema>,
  restrictIds: string[] | null
) {
  const params: unknown[] = [institutionId];
  const where = ["dr.institution_id = $1"];
  if (filters.status) {
    params.push(filters.status);
    where.push(`dr.status = $${params.length}`);
  }
  if (filters.severity) {
    params.push(filters.severity);
    where.push(`dr.severity = $${params.length}`);
  }
  if (filters.studentId) {
    params.push(filters.studentId);
    where.push(`dr.student_id = $${params.length}`);
  }
  if (filters.category) {
    params.push(filters.category);
    where.push(`dr.category = $${params.length}`);
  }
  if (filters.dateFrom) {
    params.push(filters.dateFrom);
    where.push(`dr.incident_date >= $${params.length}`);
  }
  if (filters.dateTo) {
    params.push(filters.dateTo);
    where.push(`dr.incident_date <= $${params.length}`);
  }
  if (restrictIds != null) {
    params.push(restrictIds);
    where.push(`dr.student_id = ANY($${params.length}::uuid[])`);
  }
  if (filters.search) {
    params.push(`%${filters.search}%`);
    where.push(
      `(dr.category ILIKE $${params.length} OR dr.description ILIKE $${params.length}` +
        ` OR s.first_name || ' ' || s.last_name ILIKE $${params.length})`
    );
  }
  const { rows } = await query(
    `SELECT ${SELECT} FROM disciplinary_records dr
     JOIN students s ON s.id = dr.student_id
     WHERE ${where.join(" AND ")} ORDER BY dr.incident_date DESC, dr.created_at DESC LIMIT 500`,
    params
  );
  return rows;
}

export async function getRecord(id: string, institutionId: string) {
  const { rows } = await query<Record<string, unknown> & { studentId: string }>(
    `SELECT ${SELECT} FROM disciplinary_records dr
     JOIN students s ON s.id = dr.student_id
     WHERE dr.id = $1 AND dr.institution_id = $2`,
    [id, institutionId]
  );
  if (!rows[0]) throw ApiError.notFound("Disciplinary record not found");
  return rows[0];
}

export async function listActions(recordId: string, institutionId: string) {
  await getRecord(recordId, institutionId); // tenant guard / 404
  const { rows } = await query(
    `SELECT a.id, a.action, a.note, a.from_status AS "fromStatus", a.to_status AS "toStatus",
            u.full_name AS "byName", a.created_at AS "createdAt"
     FROM disciplinary_actions a LEFT JOIN users u ON u.id = a.created_by
     WHERE a.record_id = $1 AND a.institution_id = $2
     ORDER BY a.created_at`,
    [recordId, institutionId]
  );
  return rows;
}

export async function createRecord(
  input: z.infer<typeof createDisciplinarySchema>,
  institutionId: string,
  userId: string
) {
  const snap = await snapshotStudent(input.studentId, institutionId);
  const id = await withTransaction(async (client) => {
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO disciplinary_records
         (institution_id, student_id, admission_no, class_name, section_name,
          program_name, semester_name, incident_date, category, severity,
          description, reported_by, involved_staff, action_taken, follow_up_date,
          remarks, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
       RETURNING id`,
      [
        institutionId,
        input.studentId,
        snap.admission_no,
        snap.class_name,
        snap.section_name,
        snap.program_name,
        snap.semester_name,
        input.incidentDate,
        input.category,
        input.severity,
        input.description ?? null,
        input.reportedBy ?? null,
        input.involvedStaff ?? null,
        input.actionTaken ?? null,
        input.followUpDate ?? null,
        input.remarks ?? null,
        userId,
      ]
    );
    await logAction(client, institutionId, rows[0].id, "logged", null, "open", null, userId);
    return rows[0].id;
  });
  return getRecord(id, institutionId);
}

export async function updateRecord(
  id: string,
  input: z.infer<typeof updateDisciplinarySchema>,
  institutionId: string,
  userId: string
) {
  await withTransaction(async (client) => {
    const { rows } = await client.query<{ status: string }>(
      "SELECT status FROM disciplinary_records WHERE id=$1 AND institution_id=$2 FOR UPDATE",
      [id, institutionId]
    );
    if (!rows[0]) throw ApiError.notFound("Disciplinary record not found");
    assertActive(rows[0].status);
    await client.query(
      `UPDATE disciplinary_records SET
         incident_date = COALESCE($3, incident_date),
         category = COALESCE($4, category),
         severity = COALESCE($5, severity),
         description = COALESCE($6, description),
         reported_by = COALESCE($7, reported_by),
         involved_staff = COALESCE($8, involved_staff),
         follow_up_date = COALESCE($9, follow_up_date),
         remarks = COALESCE($10, remarks)
       WHERE id=$1 AND institution_id=$2`,
      [
        id,
        institutionId,
        input.incidentDate ?? null,
        input.category ?? null,
        input.severity ?? null,
        input.description ?? null,
        input.reportedBy ?? null,
        input.involvedStaff ?? null,
        input.followUpDate ?? null,
        input.remarks ?? null,
      ]
    );
    await logAction(client, institutionId, id, "edited", rows[0].status, rows[0].status, null, userId);
  });
  return getRecord(id, institutionId);
}

// --- Workflow transitions ---

export async function markReview(id: string, note: string | null, institutionId: string, userId: string) {
  await withTransaction(async (client) => {
    const from = await lockStatus(client, id, institutionId);
    assertActive(from);
    await client.query(
      "UPDATE disciplinary_records SET status='under_review' WHERE id=$1 AND institution_id=$2",
      [id, institutionId]
    );
    await logAction(client, institutionId, id, "review", from, "under_review", note, userId);
  });
  return getRecord(id, institutionId);
}

export async function recordAction(
  id: string,
  input: z.infer<typeof actionDisciplinarySchema>,
  institutionId: string,
  userId: string
) {
  await withTransaction(async (client) => {
    const from = await lockStatus(client, id, institutionId);
    assertActive(from);
    await client.query(
      `UPDATE disciplinary_records SET status='action_taken', action_taken=$3,
         follow_up_date = COALESCE($4, follow_up_date)
       WHERE id=$1 AND institution_id=$2`,
      [id, institutionId, input.actionTaken, input.followUpDate ?? null]
    );
    await logAction(client, institutionId, id, "action_taken", from, "action_taken", input.note ?? input.actionTaken, userId);
  });
  return getRecord(id, institutionId);
}

export async function closeRecord(id: string, note: string | null, institutionId: string, userId: string) {
  await withTransaction(async (client) => {
    const from = await lockStatus(client, id, institutionId);
    assertActive(from);
    await client.query(
      "UPDATE disciplinary_records SET status='closed', closed_at=now(), closed_by=$3 WHERE id=$1 AND institution_id=$2",
      [id, institutionId, userId]
    );
    await logAction(client, institutionId, id, "closed", from, "closed", note, userId);
  });
  return getRecord(id, institutionId);
}

export async function cancelRecord(
  id: string,
  input: z.infer<typeof cancelDisciplinarySchema>,
  institutionId: string,
  userId: string
) {
  await withTransaction(async (client) => {
    const from = await lockStatus(client, id, institutionId);
    assertActive(from);
    await client.query(
      `UPDATE disciplinary_records SET status='cancelled', cancelled_at=now(),
         cancelled_by=$3, cancel_reason=$4 WHERE id=$1 AND institution_id=$2`,
      [id, institutionId, userId, input.reason ?? null]
    );
    await logAction(client, institutionId, id, "cancelled", from, "cancelled", input.reason ?? null, userId);
  });
  return getRecord(id, institutionId);
}

export async function deleteRecord(id: string, institutionId: string) {
  const { rowCount } = await query(
    "DELETE FROM disciplinary_records WHERE id=$1 AND institution_id=$2",
    [id, institutionId]
  );
  if (!rowCount) throw ApiError.notFound("Disciplinary record not found");
}

async function lockStatus(client: PoolClient, id: string, institutionId: string): Promise<string> {
  const { rows } = await client.query<{ status: string }>(
    "SELECT status FROM disciplinary_records WHERE id=$1 AND institution_id=$2 FOR UPDATE",
    [id, institutionId]
  );
  if (!rows[0]) throw ApiError.notFound("Disciplinary record not found");
  return rows[0].status;
}

// --- Student history (staff + portal share this query) ---

export async function studentHistory(studentId: string, institutionId: string) {
  // Confirm the student belongs to the tenant (avoids cross-tenant probing).
  const { rows: exists } = await query("SELECT 1 FROM students WHERE id=$1 AND institution_id=$2", [
    studentId,
    institutionId,
  ]);
  if (!exists[0]) throw ApiError.notFound("Student not found");
  const { rows } = await query(
    `SELECT ${SELECT} FROM disciplinary_records dr
     JOIN students s ON s.id = dr.student_id
     WHERE dr.student_id = $1 AND dr.institution_id = $2
     ORDER BY dr.incident_date DESC, dr.created_at DESC`,
    [studentId, institutionId]
  );
  return rows;
}

// --- Portal visibility (institution feature flag; OFF by default) ---

export async function portalEnabled(institutionId: string): Promise<boolean> {
  const { rows } = await query<{ flag: boolean | null }>(
    `SELECT (settings->'featureFlags'->>'disciplinaryPortal')::boolean AS flag
     FROM institutions WHERE id = $1`,
    [institutionId]
  );
  return rows[0]?.flag === true;
}

export async function getPortalSettings(institutionId: string) {
  return { portalEnabled: await portalEnabled(institutionId) };
}

export async function setPortalSettings(institutionId: string, enabled: boolean) {
  await query(
    `UPDATE institutions SET settings =
       COALESCE(settings, '{}'::jsonb)
       || jsonb_build_object('featureFlags',
            COALESCE(settings->'featureFlags', '{}'::jsonb)
            || jsonb_build_object('disciplinaryPortal', $2::boolean))
     WHERE id = $1`,
    [institutionId, enabled]
  );
  return { portalEnabled: enabled };
}

/**
 * Portal read of a student's records. Safe default: returns 403 unless the
 * institution has explicitly enabled portal visibility. Owner-scoping (the
 * caller may only ask for an accessible student) is enforced by the route.
 */
export async function portalStudentRecords(studentId: string, institutionId: string) {
  if (!(await portalEnabled(institutionId))) {
    throw ApiError.forbidden("Disciplinary records are not available in the portal");
  }
  return studentHistory(studentId, institutionId);
}
