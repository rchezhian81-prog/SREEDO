import OpenAI from "openai";
import { ObjectId } from "mongodb";
import { env } from "../../config/env";
import { getMongoDb } from "../../db/mongo";
import { ApiError } from "../../utils/api-error";
import { effectivePermissions } from "../../middleware/permissions";
import { getInstitutionType } from "../../middleware/institution-type";
import { maskFreeText, maskSecrets } from "../platform/audit.service";
import { getTermsForType } from "./copilot.terms";
import { routeIntent } from "./copilot.retrievers";
import type { AuthenticatedUser } from "../../types";
import type { CopilotAnswer, CopilotSource, Retriever } from "./copilot.types";

// PR-T11 — the read-only copilot turn pipeline:
//   intent → permission-gated retrieval → masked prompt assembly →
//   optional LLM phrasing (deterministic fallback) → masked audit + usage log →
//   optional Mongo history. No write path exists anywhere below.

const openai = env.openaiApiKey ? new OpenAI({ apiKey: env.openaiApiKey }) : null;

/** LLM phrasing call — swappable in unit tests (no network in CI). */
type CompletionFn = (system: string, user: string) => Promise<string | null>;
let complete: CompletionFn = async (system, user) => {
  if (!openai) return null;
  try {
    const c = await openai.chat.completions.create({
      model: env.openaiModel,
      max_tokens: env.copilotMaxTokens,
      temperature: 0.2,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    });
    return c.choices[0]?.message?.content ?? null;
  } catch {
    return null; // deterministic fallback takes over
  }
};
/** Test hook: replace the LLM call (pass null to restore the default). */
export function __setCompletionForTests(fn: CompletionFn | null): void {
  complete = fn ?? completeDefault;
}
const completeDefault = complete;

// Provider gate — overridable so tests exercise both the 200 and 503 paths
// regardless of whether the CI environment carries an OPENAI_API_KEY.
let providerOverride: boolean | null = null;
const providerConfigured = (): boolean => providerOverride ?? Boolean(env.openaiApiKey);
/** Test hook: force the provider to look configured/unconfigured (null resets). */
export function __setProviderConfiguredForTests(v: boolean | null): void {
  providerOverride = v;
}

// --- per-user daily turn budget (in-memory, single-instance like the limiters)
const dailyTurns = new Map<string, { day: string; count: number }>();
function checkDailyBudget(userId: string): void {
  const day = new Date().toISOString().slice(0, 10);
  const entry = dailyTurns.get(userId);
  if (!entry || entry.day !== day) {
    dailyTurns.set(userId, { day, count: 1 });
    return;
  }
  if (entry.count >= env.copilotMaxTurnsPerUserPerDay) {
    throw new ApiError(429, "Copilot daily quota reached for your account — try again tomorrow");
  }
  entry.count += 1;
}
/** Test hook: clear the daily budget counters. */
export function __resetDailyBudgetForTests(): void {
  dailyTurns.clear();
}

const SYSTEM_PROMPT = (modeNouns: string) =>
  `You are the GoCampus AI Copilot, a READ-ONLY assistant for school/college staff.
Hard rules you must always follow:
- You can only READ. You cannot create, update, delete, send, schedule, approve or retry anything. If asked to act, politely refuse and point to the manual screen mentioned in the facts.
- Answer ONLY from the FACTS block below. Never invent numbers, names or documents. If the facts don't cover the question, say so plainly.
- Cite sources inline using the [id] markers that appear in the facts where present.
- Use this institution's terminology: ${modeNouns}.
- Be concise: short paragraphs or bullets, no preamble.`;

const deterministicReply = (facts: string[]): string =>
  facts.length === 0
    ? "I couldn't retrieve any data your role has access to for that question. Try the dashboards directly, or ask about attendance, fees, exams, leave, jobs, or a help topic."
    : `Here is what I can see right now:\n${facts.map((f) => `• ${f}`).join("\n")}`;

// Sinks are swappable in tests so the audit/usage CONTRACT is assertable even
// where Mongo is absent (CI); the default sink is the tenant audit_logs trail.
type SinkDoc = Record<string, unknown>;
let auditSink: ((doc: SinkDoc) => void) | null = null;
let usageSink: ((doc: SinkDoc) => void) | null = null;
export function __setSinksForTests(
  audit: ((doc: SinkDoc) => void) | null,
  usage: ((doc: SinkDoc) => void) | null
): void {
  auditSink = audit;
  usageSink = usage;
}

async function writeAudit(
  user: AuthenticatedUser,
  ip: string | null,
  message: string,
  retrieversUsed: string[],
  aiAvailable: boolean,
  replyChars: number
): Promise<void> {
  // Same collection + core shape as middleware/audit.ts so the tenant /activity
  // viewer lists it; action/detail are the copilot-specific extension.
  const doc = {
    method: "POST",
    path: "/api/v1/ai/copilot",
    module: "ai",
    action: "ai.copilot.query",
    statusCode: 200,
    userId: user.id,
    userRole: user.role,
    institutionId: user.institutionId ?? null,
    ip,
    detail: maskSecrets({
      promptMasked: maskFreeText(message),
      retrieversUsed,
      aiAvailable,
      replyChars,
    }),
    createdAt: new Date(),
  };
  auditSink?.(doc);
  const db = getMongoDb();
  if (!db) return;
  await db.collection("audit_logs").insertOne(doc).catch(() => undefined);
}

function logUsage(userId: string, institutionId: string): void {
  const doc = { kind: "copilot", userId, institutionId, at: new Date() };
  usageSink?.(doc);
  const db = getMongoDb();
  if (!db) return;
  db.collection("ai_usage").insertOne(doc).catch(() => undefined);
}

export async function answer(
  user: AuthenticatedUser,
  institutionId: string,
  ip: string | null,
  message: string,
  conversationId?: string
): Promise<CopilotAnswer> {
  if (!providerConfigured()) {
    // Safe refusal: the conversational surface needs the provider; the
    // deterministic /ai-insights reads stay available on their own routes.
    throw ApiError.serviceUnavailable("AI Copilot is not configured (missing OPENAI_API_KEY)");
  }
  checkDailyBudget(user.id);

  const [mode, permList] = await Promise.all([
    getInstitutionType(institutionId),
    effectivePermissions(user),
  ]);
  const perms = new Set(permList);
  const allowed = (r: Retriever): boolean =>
    (!r.adminOnly || user.role === "admin") && r.perms.every((p) => perms.has(p));

  // Deterministic, allow-listed routing — a prompt cannot widen this set, and a
  // retriever the caller lacks permission for is OMITTED (the model never sees it).
  const candidates = routeIntent(message);
  const runnable = candidates.filter(allowed);

  const facts: string[] = [];
  const sources: CopilotSource[] = [];
  const retrieversUsed: string[] = [];
  const results = await Promise.allSettled(
    runnable.map((r) => r.run({ institutionId, userId: user.id, message, mode }))
  );
  results.forEach((res, i) => {
    if (res.status === "fulfilled") {
      retrieversUsed.push(runnable[i].key);
      facts.push(...res.value.facts);
      sources.push(...res.value.sources);
    }
  });

  // Mask the compacted facts before anything reaches the model or the audit row.
  const maskedFacts = facts.map((f) => String(maskFreeText(f)));

  const terms = getTermsForType(mode);
  let reply: string | null = null;
  let aiAvailable = true;
  if (maskedFacts.length > 0) {
    reply = await complete(
      SYSTEM_PROMPT(terms),
      `FACTS:\n${maskedFacts.map((f) => `- ${f}`).join("\n")}\n\nQUESTION: ${message}`
    );
  }
  if (reply === null) {
    aiAvailable = maskedFacts.length > 0 ? false : true;
    reply = deterministicReply(maskedFacts);
  }

  await writeAudit(user, ip, message, retrieversUsed, aiAvailable, reply.length);
  logUsage(user.id, institutionId);
  const convId = await persistTurn(user.id, institutionId, message, reply, conversationId);

  return { reply, sources, retrieversUsed, aiAvailable, conversationId: convId };
}

// --- optional Mongo history (separate collection from the legacy assistant,
// so /assistant's conversation list is untouched) --------------------------

async function persistTurn(
  userId: string,
  institutionId: string,
  message: string,
  reply: string,
  conversationId?: string
): Promise<string | null> {
  const db = getMongoDb();
  if (!db) return null;
  const now = new Date();
  const turns = [
    { role: "user", content: message, createdAt: now },
    { role: "assistant", content: reply, createdAt: now },
  ];
  if (conversationId) {
    const id = new ObjectId(conversationId);
    const existing = await db.collection("ai_copilot_conversations").findOne({ _id: id, userId });
    if (!existing) throw ApiError.notFound("Conversation not found");
    await db.collection("ai_copilot_conversations").updateOne(
      { _id: id },
      { $push: { messages: { $each: turns } } as never, $set: { updatedAt: now } }
    );
    return conversationId;
  }
  const inserted = await db.collection("ai_copilot_conversations").insertOne({
    userId,
    institutionId,
    title: message.slice(0, 80),
    messages: turns,
    createdAt: now,
    updatedAt: now,
  });
  return inserted.insertedId.toHexString();
}
