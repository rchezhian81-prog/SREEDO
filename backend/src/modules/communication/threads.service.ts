import type { z } from "zod";
import { query, withTransaction } from "../../db/postgres";
import { ApiError } from "../../utils/api-error";
import { dispatchExternal } from "./communication.channels";
import type {
  addParticipantsSchema,
  createThreadSchema,
  replySchema,
} from "./threads.schema";

/** Same-institution users for the given ids (filters out cross-tenant ids). */
async function validUserIds(ids: string[], institutionId: string): Promise<string[]> {
  if (ids.length === 0) return [];
  const { rows } = await query<{ id: string }>(
    "SELECT id FROM users WHERE id = ANY($1::uuid[]) AND institution_id = $2",
    [ids, institutionId]
  );
  return rows.map((r) => r.id);
}

/** Throws notFound unless the user participates in the thread (also tenant guard). */
async function assertParticipant(threadId: string, userId: string, institutionId: string) {
  const { rows } = await query(
    `SELECT 1 FROM thread_participants
     WHERE thread_id = $1 AND user_id = $2 AND institution_id = $3`,
    [threadId, userId, institutionId]
  );
  if (!rows[0]) throw ApiError.notFound("Thread not found");
}

/** Other participants' user ids (for notifications), excluding the actor. */
async function otherParticipantIds(threadId: string, excludeUserId: string): Promise<string[]> {
  const { rows } = await query<{ user_id: string }>(
    "SELECT user_id FROM thread_participants WHERE thread_id = $1 AND user_id <> $2 AND archived_at IS NULL",
    [threadId, excludeUserId]
  );
  return rows.map((r) => r.user_id);
}

export async function createThread(
  input: z.infer<typeof createThreadSchema>,
  userId: string,
  institutionId: string
) {
  // Tenant guard: every participant must belong to the caller's institution.
  const requested = await validUserIds(input.participantIds, institutionId);
  if (requested.length !== new Set(input.participantIds).size) {
    throw ApiError.badRequest("One or more participants are not in your institution");
  }
  const participants = Array.from(new Set([...requested, userId]));
  if (participants.length < 2) {
    throw ApiError.badRequest("Add at least one other participant");
  }
  const type = participants.length > 2 ? "group" : "direct";

  const threadId = await withTransaction(async (client) => {
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO threads (institution_id, subject, type, created_by)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [institutionId, input.subject ?? null, type, userId]
    );
    const id = rows[0].id;
    for (const pid of participants) {
      // The creator has implicitly read the thread they just started.
      await client.query(
        `INSERT INTO thread_participants (institution_id, thread_id, user_id, added_by, last_read_at)
         VALUES ($1, $2, $3, $4, $5)`,
        [institutionId, id, pid, userId, pid === userId ? new Date() : null]
      );
    }
    if (input.body) {
      await client.query(
        "INSERT INTO thread_messages (institution_id, thread_id, sender_id, body) VALUES ($1,$2,$3,$4)",
        [institutionId, id, userId, input.body]
      );
      await client.query("UPDATE threads SET last_message_at = now() WHERE id = $1", [id]);
    }
    return id;
  });

  if (input.body) {
    const others = await otherParticipantIds(threadId, userId);
    void dispatchExternal(institutionId, others, input.subject ?? "New message", input.body);
  }
  return getThread(threadId, userId, institutionId);
}

export async function listThreads(userId: string, institutionId: string) {
  const { rows } = await query(
    `SELECT t.id, t.subject, t.type, t.last_message_at AS "lastMessageAt",
            t.created_at AS "createdAt",
            (SELECT body FROM thread_messages m WHERE m.thread_id = t.id
             ORDER BY m.created_at DESC LIMIT 1) AS "lastMessage",
            (SELECT count(*)::int FROM thread_messages m
             WHERE m.thread_id = t.id AND m.sender_id <> $1
               AND (tp.last_read_at IS NULL OR m.created_at > tp.last_read_at)) AS "unreadCount",
            (SELECT string_agg(u.full_name, ', ' ORDER BY u.full_name)
             FROM thread_participants p JOIN users u ON u.id = p.user_id
             WHERE p.thread_id = t.id AND p.user_id <> $1) AS "participants"
     FROM threads t
     JOIN thread_participants tp ON tp.thread_id = t.id AND tp.user_id = $1
     WHERE t.institution_id = $2 AND tp.archived_at IS NULL
     ORDER BY t.last_message_at DESC LIMIT 200`,
    [userId, institutionId]
  );
  return rows;
}

export async function getThread(threadId: string, userId: string, institutionId: string) {
  await assertParticipant(threadId, userId, institutionId);
  const { rows: tRows } = await query(
    `SELECT t.id, t.subject, t.type, t.created_by AS "createdBy",
            t.last_message_at AS "lastMessageAt", t.created_at AS "createdAt"
     FROM threads t WHERE t.id = $1 AND t.institution_id = $2`,
    [threadId, institutionId]
  );
  if (!tRows[0]) throw ApiError.notFound("Thread not found");

  const participants = await query(
    `SELECT p.user_id AS "userId", u.full_name AS "name", u.role,
            p.last_read_at AS "lastReadAt"
     FROM thread_participants p JOIN users u ON u.id = p.user_id
     WHERE p.thread_id = $1 ORDER BY u.full_name`,
    [threadId]
  );
  const messages = await query(
    `SELECT m.id, m.sender_id AS "senderId", u.full_name AS "senderName",
            m.body, m.created_at AS "createdAt"
     FROM thread_messages m LEFT JOIN users u ON u.id = m.sender_id
     WHERE m.thread_id = $1 ORDER BY m.created_at`,
    [threadId]
  );
  return { ...tRows[0], participants: participants.rows, messages: messages.rows };
}

export async function reply(
  threadId: string,
  input: z.infer<typeof replySchema>,
  userId: string,
  institutionId: string
) {
  await assertParticipant(threadId, userId, institutionId);
  const { rows } = await query(
    `INSERT INTO thread_messages (institution_id, thread_id, sender_id, body)
     VALUES ($1,$2,$3,$4)
     RETURNING id, sender_id AS "senderId", body, created_at AS "createdAt"`,
    [institutionId, threadId, userId, input.body]
  );
  await query("UPDATE threads SET last_message_at = now() WHERE id = $1", [threadId]);
  // The sender has implicitly read up to their own message.
  await query(
    "UPDATE thread_participants SET last_read_at = now() WHERE thread_id = $1 AND user_id = $2",
    [threadId, userId]
  );

  const subject = await query<{ subject: string | null }>(
    "SELECT subject FROM threads WHERE id = $1",
    [threadId]
  );
  const others = await otherParticipantIds(threadId, userId);
  void dispatchExternal(institutionId, others, subject.rows[0]?.subject ?? "New reply", input.body);
  return rows[0];
}

export async function markRead(threadId: string, userId: string, institutionId: string) {
  await assertParticipant(threadId, userId, institutionId);
  await query(
    "UPDATE thread_participants SET last_read_at = now() WHERE thread_id = $1 AND user_id = $2",
    [threadId, userId]
  );
  return { ok: true };
}

export async function unreadCount(userId: string, institutionId: string) {
  const { rows } = await query<{ count: number }>(
    `SELECT count(*)::int AS count
     FROM thread_messages m
     JOIN thread_participants tp ON tp.thread_id = m.thread_id AND tp.user_id = $1
     WHERE m.institution_id = $2 AND tp.archived_at IS NULL AND m.sender_id <> $1
       AND (tp.last_read_at IS NULL OR m.created_at > tp.last_read_at)`,
    [userId, institutionId]
  );
  return { count: rows[0]?.count ?? 0 };
}

export async function archiveThread(threadId: string, userId: string, institutionId: string) {
  await assertParticipant(threadId, userId, institutionId);
  await query(
    "UPDATE thread_participants SET archived_at = now() WHERE thread_id = $1 AND user_id = $2",
    [threadId, userId]
  );
  return { ok: true };
}

export async function addParticipants(
  threadId: string,
  input: z.infer<typeof addParticipantsSchema>,
  userId: string,
  institutionId: string
) {
  await assertParticipant(threadId, userId, institutionId);
  const valid = await validUserIds(input.participantIds, institutionId);
  if (valid.length !== new Set(input.participantIds).size) {
    throw ApiError.badRequest("One or more participants are not in your institution");
  }
  for (const pid of valid) {
    await query(
      `INSERT INTO thread_participants (institution_id, thread_id, user_id, added_by)
       VALUES ($1,$2,$3,$4) ON CONFLICT (thread_id, user_id) DO NOTHING`,
      [institutionId, threadId, pid, userId]
    );
  }
  // A group thread once it has more than two participants.
  await query(
    `UPDATE threads SET type = 'group'
     WHERE id = $1 AND (SELECT count(*) FROM thread_participants WHERE thread_id = $1) > 2`,
    [threadId]
  );
  return getThread(threadId, userId, institutionId);
}
