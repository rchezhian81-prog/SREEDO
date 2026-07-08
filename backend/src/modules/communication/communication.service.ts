import { query } from "../../db/postgres";
import { ApiError } from "../../utils/api-error";
import { dispatchExternal } from "./communication.channels";
import {
  absenceAlertMessage,
  feeReminderMessage,
} from "./communication.templates";
import type { z } from "zod";
import type {
  sendMessageSchema,
  updateNotificationPreferencesSchema,
} from "./communication.schema";

type AudienceType = z.infer<typeof sendMessageSchema>["audienceType"];

const PREFERENCE_SELECT = `COALESCE(np.email_enabled, true) AS "emailEnabled",
       COALESCE(np.sms_enabled, true) AS "smsEnabled",
       COALESCE(np.push_enabled, true) AS "pushEnabled"`;

/** The caller's notification channel preferences (defaults to all enabled). */
export async function getNotificationPreferences(
  userId: string,
  institutionId: string
) {
  const { rows } = await query(
    `SELECT ${PREFERENCE_SELECT}
     FROM users u
     LEFT JOIN notification_preferences np ON np.user_id = u.id
     WHERE u.id = $1 AND u.institution_id = $2`,
    [userId, institutionId]
  );
  if (!rows[0]) throw ApiError.notFound("User not found");
  return rows[0];
}

/** Upsert the caller's preferences; omitted channels keep their current value. */
export async function updateNotificationPreferences(
  userId: string,
  institutionId: string,
  input: z.infer<typeof updateNotificationPreferencesSchema>
) {
  const { rows } = await query(
    `INSERT INTO notification_preferences
       (user_id, institution_id, email_enabled, sms_enabled, push_enabled)
     VALUES ($1, $2, COALESCE($3, true), COALESCE($4, true), COALESCE($5, true))
     ON CONFLICT (user_id) DO UPDATE SET
       email_enabled = COALESCE($3, notification_preferences.email_enabled),
       sms_enabled = COALESCE($4, notification_preferences.sms_enabled),
       push_enabled = COALESCE($5, notification_preferences.push_enabled),
       updated_at = now()
     RETURNING email_enabled AS "emailEnabled", sms_enabled AS "smsEnabled",
               push_enabled AS "pushEnabled"`,
    [
      userId,
      institutionId,
      input.emailEnabled ?? null,
      input.smsEnabled ?? null,
      input.pushEnabled ?? null,
    ]
  );
  return rows[0];
}

/** Resolves an audience to a de-duplicated set of recipient user ids (tenant-scoped). */
export async function resolveAudience(
  audienceType: AudienceType,
  audienceRef: string | undefined,
  institutionId: string
): Promise<string[]> {
  let sql: string;
  let params: unknown[];
  switch (audienceType) {
    case "all_students":
      sql = `SELECT id FROM users WHERE institution_id = $1 AND role = 'student'`;
      params = [institutionId];
      break;
    case "all_parents":
      sql = `SELECT id FROM users WHERE institution_id = $1 AND role = 'parent'`;
      params = [institutionId];
      break;
    case "staff":
      sql = `SELECT id FROM users WHERE institution_id = $1 AND role IN ('admin','teacher','accountant')`;
      params = [institutionId];
      break;
    case "section":
      sql = `SELECT u.id FROM users u JOIN students s ON s.user_id = u.id
             WHERE s.institution_id = $1 AND s.section_id = $2
             UNION
             SELECT g.user_id FROM guardians g JOIN students s ON s.id = g.student_id
             WHERE g.institution_id = $1 AND s.section_id = $2`;
      params = [institutionId, audienceRef];
      break;
    case "class":
      sql = `SELECT u.id FROM users u JOIN students s ON s.user_id = u.id
             JOIN sections sec ON sec.id = s.section_id
             WHERE s.institution_id = $1 AND sec.class_id = $2
             UNION
             SELECT g.user_id FROM guardians g JOIN students s ON s.id = g.student_id
             JOIN sections sec ON sec.id = s.section_id
             WHERE g.institution_id = $1 AND sec.class_id = $2`;
      params = [institutionId, audienceRef];
      break;
    case "semester":
      // College cohort: students actively enrolled in the semester (+ guardians).
      sql = `SELECT u.id FROM users u JOIN students s ON s.user_id = u.id
             JOIN enrollments e ON e.student_id = s.id
             WHERE e.institution_id = $1 AND e.semester_id = $2 AND e.status = 'active'
             UNION
             SELECT g.user_id FROM guardians g JOIN students s ON s.id = g.student_id
             JOIN enrollments e ON e.student_id = s.id
             WHERE g.institution_id = $1 AND e.semester_id = $2 AND e.status = 'active'`;
      params = [institutionId, audienceRef];
      break;
    case "student":
      sql = `SELECT user_id AS id FROM students
             WHERE id = $2 AND institution_id = $1 AND user_id IS NOT NULL
             UNION
             SELECT g.user_id AS id FROM guardians g
             WHERE g.student_id = $2 AND g.institution_id = $1`;
      params = [institutionId, audienceRef];
      break;
    case "parent":
    case "user":
      sql = `SELECT id FROM users WHERE id = $2 AND institution_id = $1`;
      params = [institutionId, audienceRef];
      break;
    default:
      return [];
  }
  const { rows } = await query<{ id: string }>(sql, params);
  return [...new Set(rows.map((r) => r.id))];
}

async function insertMessage(opts: {
  institutionId: string;
  senderId: string | null;
  category: string;
  subject: string;
  body: string;
  audienceType: string | null;
  audienceRef: string | null;
  userIds: string[];
}): Promise<{ messageId: string; recipientCount: number }> {
  const { rows } = await query<{ id: string }>(
    `INSERT INTO messages (institution_id, sender_id, category, subject, body, audience_type, audience_ref)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [
      opts.institutionId,
      opts.senderId,
      opts.category,
      opts.subject,
      opts.body,
      opts.audienceType,
      opts.audienceRef,
    ]
  );
  const messageId = rows[0].id;
  if (opts.userIds.length > 0) {
    await query(
      `INSERT INTO message_recipients (institution_id, message_id, user_id)
       SELECT $1, $2, unnest($3::uuid[])
       ON CONFLICT (message_id, user_id) DO NOTHING`,
      [opts.institutionId, messageId, opts.userIds]
    );
  }
  return { messageId, recipientCount: opts.userIds.length };
}

export async function sendMessage(
  senderId: string,
  input: z.infer<typeof sendMessageSchema>,
  institutionId: string
) {
  const userIds = await resolveAudience(
    input.audienceType,
    input.audienceRef,
    institutionId
  );
  const result = await insertMessage({
    institutionId,
    senderId,
    category: input.category ?? "message",
    subject: input.subject,
    body: input.body,
    audienceType: input.audienceType,
    audienceRef: input.audienceRef ?? null,
    userIds,
  });
  // Best-effort external delivery (never blocks/fails the request).
  void dispatchExternal(institutionId, userIds, input.subject, input.body);
  return result;
}

// --- Inbox (owner-scoped to the caller) ---

export async function listInbox(
  userId: string,
  institutionId: string,
  opts: { unread?: boolean; limit?: number }
) {
  const params: unknown[] = [institutionId, userId];
  let where = "mr.institution_id = $1 AND mr.user_id = $2";
  if (opts.unread) where += " AND mr.read_at IS NULL";
  params.push(opts.limit ?? 50);
  const { rows } = await query(
    `SELECT mr.message_id AS "id", mr.read_at AS "readAt",
            m.category, m.subject, m.body, m.created_at AS "createdAt",
            CASE WHEN u.id IS NULL THEN NULL ELSE u.full_name END AS "senderName"
     FROM message_recipients mr
     JOIN messages m ON m.id = mr.message_id
     LEFT JOIN users u ON u.id = m.sender_id
     WHERE ${where}
     ORDER BY m.created_at DESC
     LIMIT $${params.length}`,
    params
  );
  return rows;
}

export async function unreadCount(
  userId: string,
  institutionId: string
): Promise<{ count: number }> {
  const { rows } = await query<{ count: number }>(
    `SELECT count(*)::int AS count FROM message_recipients
     WHERE institution_id = $1 AND user_id = $2 AND read_at IS NULL`,
    [institutionId, userId]
  );
  return { count: rows[0].count };
}

export async function markRead(
  messageId: string,
  userId: string,
  institutionId: string
): Promise<void> {
  const { rowCount } = await query(
    `UPDATE message_recipients SET read_at = COALESCE(read_at, now())
     WHERE message_id = $1 AND user_id = $2 AND institution_id = $3`,
    [messageId, userId, institutionId]
  );
  if (!rowCount) throw ApiError.notFound("Message not found in your inbox");
}

// --- Sent history / delivery status (staff) ---

export async function listSent(
  institutionId: string,
  opts: { limit?: number }
) {
  const { rows } = await query(
    `SELECT m.id, m.category, m.subject, m.audience_type AS "audienceType",
            m.created_at AS "createdAt",
            CASE WHEN u.id IS NULL THEN NULL ELSE u.full_name END AS "senderName",
            (SELECT count(*)::int FROM message_recipients r WHERE r.message_id = m.id) AS "recipientCount",
            (SELECT count(*)::int FROM message_recipients r WHERE r.message_id = m.id AND r.read_at IS NOT NULL) AS "readCount"
     FROM messages m LEFT JOIN users u ON u.id = m.sender_id
     WHERE m.institution_id = $1
     ORDER BY m.created_at DESC
     LIMIT $2`,
    [institutionId, opts.limit ?? 100]
  );
  return rows;
}

export async function deleteMessage(
  id: string,
  institutionId: string
): Promise<void> {
  const { rowCount } = await query(
    "DELETE FROM messages WHERE id = $1 AND institution_id = $2",
    [id, institutionId]
  );
  if (!rowCount) throw ApiError.notFound("Message not found");
}

// --- Device tokens (caller registers their own) ---

export async function registerDeviceToken(
  userId: string,
  institutionId: string,
  token: string,
  platform: string | undefined
) {
  await query(
    `INSERT INTO device_tokens (institution_id, user_id, token, platform)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (token)
     DO UPDATE SET user_id = EXCLUDED.user_id,
                   institution_id = EXCLUDED.institution_id,
                   platform = EXCLUDED.platform`,
    [institutionId, userId, token, platform ?? null]
  );
  return { ok: true };
}

export async function removeDeviceToken(
  token: string,
  userId: string,
  institutionId: string
): Promise<void> {
  await query(
    "DELETE FROM device_tokens WHERE token = $1 AND user_id = $2 AND institution_id = $3",
    [token, userId, institutionId]
  );
}

// --- Generated notifications ---

async function institutionName(institutionId: string): Promise<string> {
  const { rows } = await query<{ name: string }>(
    "SELECT name FROM institutions WHERE id = $1",
    [institutionId]
  );
  return rows[0]?.name ?? "School";
}

/** Fee reminders to the students (and their guardians) with outstanding invoices. */
export async function generateFeeReminders(
  institutionId: string,
  actorId: string,
  opts: { studentId?: string }
): Promise<{ students: number; recipients: number }> {
  const params: unknown[] = [institutionId];
  let filter = "";
  if (opts.studentId) {
    params.push(opts.studentId);
    filter = `AND s.id = $${params.length}`;
  }
  const { rows: due } = await query<{
    id: string;
    first_name: string;
    last_name: string;
    outstanding: number;
  }>(
    `SELECT s.id, s.first_name, s.last_name,
            SUM(i.amount_due - i.amount_paid)::float AS outstanding
     FROM students s JOIN invoices i ON i.student_id = s.id
     WHERE s.institution_id = $1 AND i.institution_id = $1
       AND i.status IN ('pending', 'partially_paid') ${filter}
     GROUP BY s.id, s.first_name, s.last_name
     HAVING SUM(i.amount_due - i.amount_paid) > 0`,
    params
  );

  const inst = await institutionName(institutionId);
  let recipients = 0;
  for (const s of due) {
    const userIds = await resolveAudience("student", s.id, institutionId);
    if (userIds.length === 0) continue;
    const { subject, body } = feeReminderMessage({
      studentName: `${s.first_name} ${s.last_name}`,
      amount: Number(s.outstanding),
      institutionName: inst,
    });
    await insertMessage({
      institutionId,
      senderId: actorId,
      category: "fee_reminder",
      subject,
      body,
      audienceType: "student",
      audienceRef: s.id,
      userIds,
    });
    void dispatchExternal(institutionId, userIds, subject, body);
    recipients += userIds.length;
  }
  return { students: due.length, recipients };
}

/** Absence alerts for a date's absentees; de-duplicated per student/date unless forced. */
export async function generateAbsenceAlerts(
  institutionId: string,
  actorId: string,
  date: string,
  force: boolean
): Promise<{ students: number; recipients: number }> {
  const { rows: absent } = await query<{
    id: string;
    first_name: string;
    last_name: string;
  }>(
    `SELECT s.id, s.first_name, s.last_name
     FROM attendance_records ar JOIN students s ON s.id = ar.student_id
     WHERE ar.institution_id = $1 AND ar.date = $2 AND ar.status = 'absent'`,
    [institutionId, date]
  );

  const inst = await institutionName(institutionId);
  let alerted = 0;
  let recipients = 0;
  for (const s of absent) {
    const dedupeKey = `absence:${s.id}:${date}`;
    if (!force) {
      const { rowCount } = await query(
        `INSERT INTO notification_log (institution_id, kind, dedupe_key, channel, status)
         VALUES ($1, 'absence_alert', $2, 'in_app', 'sent')
         ON CONFLICT (institution_id, dedupe_key) WHERE dedupe_key IS NOT NULL
         DO NOTHING`,
        [institutionId, dedupeKey]
      );
      if (!rowCount) continue; // already alerted for this student/date
    } else {
      await query(
        `INSERT INTO notification_log (institution_id, kind, dedupe_key, channel, status)
         VALUES ($1, 'absence_alert', $2, 'in_app', 'sent')
         ON CONFLICT (institution_id, dedupe_key) WHERE dedupe_key IS NOT NULL
         DO NOTHING`,
        [institutionId, dedupeKey]
      );
    }
    const userIds = await resolveAudience("student", s.id, institutionId);
    if (userIds.length === 0) continue;
    const { subject, body } = absenceAlertMessage({
      studentName: `${s.first_name} ${s.last_name}`,
      date,
      institutionName: inst,
    });
    await insertMessage({
      institutionId,
      senderId: actorId,
      category: "absence_alert",
      subject,
      body,
      audienceType: "student",
      audienceRef: s.id,
      userIds,
    });
    void dispatchExternal(institutionId, userIds, subject, body);
    alerted += 1;
    recipients += userIds.length;
  }
  return { students: alerted, recipients };
}
