import OpenAI from "openai";
import { ObjectId } from "mongodb";
import { env } from "../../config/env";
import { query } from "../../db/postgres";
import { getMongoDb } from "../../db/mongo";
import { ApiError } from "../../utils/api-error";

const openai = env.openaiApiKey
  ? new OpenAI({ apiKey: env.openaiApiKey })
  : null;

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  createdAt: Date;
}

/**
 * Builds a live snapshot of school data so the assistant can answer
 * operational questions (counts, attendance, fees) with real numbers.
 *
 * Every figure is scoped to the caller's institution. `invoices`, `payments`
 * and `attendance_records` carry no `institution_id` of their own, so they are
 * scoped through `students.institution_id`. Without this scoping the assistant
 * would leak cross-tenant aggregates (and send them to the model provider).
 */
async function schoolContext(institutionId: string): Promise<string> {
  const { rows } = await query<Record<string, string | null>>(
    `SELECT
       (SELECT count(*) FROM students
          WHERE status = 'active' AND institution_id = $1) AS active_students,
       (SELECT count(*) FROM teachers
          WHERE is_active = true AND institution_id = $1) AS active_teachers,
       (SELECT count(*) FROM classes WHERE institution_id = $1) AS classes,
       (SELECT count(*) FROM attendance_records ar
          JOIN students s ON s.id = ar.student_id
          WHERE ar.date = CURRENT_DATE AND ar.status IN ('present', 'late')
            AND s.institution_id = $1) AS present_today,
       (SELECT count(*) FROM attendance_records ar
          JOIN students s ON s.id = ar.student_id
          WHERE ar.date = CURRENT_DATE AND s.institution_id = $1) AS marked_today,
       (SELECT count(*) FROM invoices i
          JOIN students s ON s.id = i.student_id
          WHERE i.status IN ('pending', 'partially_paid')
            AND s.institution_id = $1) AS pending_invoices,
       (SELECT coalesce(sum(p.amount), 0)::text FROM payments p
          JOIN invoices i ON i.id = p.invoice_id
          JOIN students s ON s.id = i.student_id
          WHERE s.institution_id = $1) AS total_collected`,
    [institutionId]
  );
  const stats = rows[0];
  return [
    `Active students: ${stats.active_students}`,
    `Active teachers: ${stats.active_teachers}`,
    `Classes: ${stats.classes}`,
    `Attendance marked today: ${stats.marked_today} (present or late: ${stats.present_today})`,
    `Invoices pending payment: ${stats.pending_invoices}`,
    `Total fees collected to date: ${stats.total_collected}`,
  ].join("\n");
}

export async function chat(
  userId: string,
  institutionId: string,
  message: string,
  conversationId?: string
) {
  if (!openai) {
    throw ApiError.serviceUnavailable(
      "AI assistant is not configured (missing OPENAI_API_KEY)"
    );
  }

  const db = getMongoDb();
  let history: ChatMessage[] = [];
  let convId: ObjectId | null = null;

  if (db && conversationId) {
    convId = new ObjectId(conversationId);
    const existing = await db
      .collection("ai_conversations")
      .findOne({ _id: convId, userId });
    if (!existing) throw ApiError.notFound("Conversation not found");
    history = (existing.messages as ChatMessage[]).slice(-20);
  }

  const context = await schoolContext(institutionId);
  const completion = await openai.chat.completions.create({
    model: env.openaiModel,
    max_tokens: 1000,
    messages: [
      {
        role: "system",
        content:
          "You are the SRE EDU OS assistant, helping school staff with " +
          "administration questions. Be concise and factual. Current live " +
          `school statistics:\n${context}`,
      },
      ...history.map(({ role, content }) => ({ role, content })),
      { role: "user", content: message },
    ],
  });
  const reply = completion.choices[0]?.message?.content ?? "";

  if (db) {
    const now = new Date();
    const newMessages: ChatMessage[] = [
      { role: "user", content: message, createdAt: now },
      { role: "assistant", content: reply, createdAt: now },
    ];
    if (convId) {
      await db.collection("ai_conversations").updateOne(
        { _id: convId },
        {
          $push: { messages: { $each: newMessages } } as never,
          $set: { updatedAt: now },
        }
      );
    } else {
      const inserted = await db.collection("ai_conversations").insertOne({
        userId,
        institutionId,
        title: message.slice(0, 80),
        messages: newMessages,
        createdAt: now,
        updatedAt: now,
      });
      convId = inserted.insertedId;
    }
  }

  return { reply, conversationId: convId ? convId.toHexString() : null };
}

export async function listConversations(userId: string) {
  const db = getMongoDb();
  if (!db) return [];
  const docs = await db
    .collection("ai_conversations")
    .find({ userId }, { projection: { messages: 0 } })
    .sort({ updatedAt: -1 })
    .limit(50)
    .toArray();
  return docs.map((doc) => ({
    id: doc._id.toHexString(),
    title: doc.title,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  }));
}

export async function getConversation(userId: string, conversationId: string) {
  const db = getMongoDb();
  if (!db) throw ApiError.notFound("Conversation not found");
  const doc = await db
    .collection("ai_conversations")
    .findOne({ _id: new ObjectId(conversationId), userId });
  if (!doc) throw ApiError.notFound("Conversation not found");
  return {
    id: doc._id.toHexString(),
    title: doc.title,
    messages: doc.messages,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}
