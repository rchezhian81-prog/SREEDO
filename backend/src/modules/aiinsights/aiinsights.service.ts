import OpenAI from "openai";
import { env } from "../../config/env";
import { query } from "../../db/postgres";
import { getMongoDb } from "../../db/mongo";
import { ApiError } from "../../utils/api-error";

const openai = env.openaiApiKey ? new OpenAI({ apiKey: env.openaiApiKey }) : null;
const EMBED_MODEL = "text-embedding-3-small";

export const aiAvailable = (): boolean => openai !== null;

/** Best-effort AI usage log to Mongo (no-op when Mongo is unconfigured). */
function logUsage(kind: string, userId: string, institutionId: string): void {
  const db = getMongoDb();
  if (!db) return;
  db.collection("ai_usage")
    .insertOne({ kind, userId, institutionId, at: new Date() })
    .catch(() => undefined);
}

/** Optional narrative via OpenAI; returns null when unconfigured or on error. */
async function narrate(system: string, data: string): Promise<string | null> {
  if (!openai) return null;
  try {
    const c = await openai.chat.completions.create({
      model: env.openaiModel,
      max_tokens: 400,
      messages: [
        { role: "system", content: system },
        { role: "user", content: data },
      ],
    });
    return c.choices[0]?.message?.content ?? null;
  } catch {
    return null;
  }
}

// --- Report / KPI summaries ---

const METRIC_SQL: Record<string, string> = {
  attendance: `SELECT
      (SELECT count(*)::int FROM students WHERE institution_id = $1 AND status = 'active') AS students,
      (SELECT count(*)::int FROM attendance_records WHERE institution_id = $1 AND date = CURRENT_DATE) AS "markedToday",
      (SELECT count(*)::int FROM attendance_records WHERE institution_id = $1 AND date = CURRENT_DATE AND status IN ('present','late')) AS "presentToday",
      (SELECT count(*)::int FROM attendance_records WHERE institution_id = $1 AND date >= CURRENT_DATE - 30) AS "marked30",
      (SELECT count(*)::int FROM attendance_records WHERE institution_id = $1 AND date >= CURRENT_DATE - 30 AND status IN ('present','late')) AS "present30"`,
  fees: `SELECT
      (SELECT COALESCE(sum(amount_due),0)::float FROM invoices WHERE institution_id = $1) AS invoiced,
      (SELECT COALESCE(sum(amount_paid),0)::float FROM invoices WHERE institution_id = $1) AS collected,
      (SELECT COALESCE(sum(amount_due-amount_paid),0)::float FROM invoices WHERE institution_id = $1 AND status IN ('pending','partially_paid')) AS outstanding,
      (SELECT count(*)::int FROM invoices WHERE institution_id = $1 AND status IN ('pending','partially_paid') AND due_date < CURRENT_DATE) AS "overdueInvoices"`,
  exams: `SELECT count(*)::int AS results,
      COALESCE(round(avg(marks_obtained / NULLIF(max_marks,0) * 100), 1), 0)::float AS "avgPercent"
      FROM exam_results WHERE institution_id = $1`,
  homework: `SELECT
      (SELECT count(*)::int FROM homework WHERE institution_id = $1) AS homework,
      (SELECT count(*)::int FROM homework_submissions WHERE institution_id = $1) AS submissions`,
  payroll: `SELECT
      (SELECT count(*)::int FROM payslips WHERE institution_id = $1) AS payslips,
      (SELECT COALESCE(sum(net),0)::float FROM payslips WHERE institution_id = $1) AS "netTotal"`,
  library: `SELECT
      (SELECT count(*)::int FROM book_issues WHERE institution_id = $1 AND status = 'issued') AS issued,
      (SELECT count(*)::int FROM book_issues WHERE institution_id = $1 AND status = 'issued' AND due_date < CURRENT_DATE) AS overdue`,
  transport: `SELECT
      (SELECT count(*)::int FROM transport_routes WHERE institution_id = $1) AS routes,
      (SELECT count(*)::int FROM student_transport WHERE institution_id = $1 AND status = 'active') AS allocations`,
  hostel: `SELECT
      (SELECT COALESCE(sum(capacity),0)::int FROM hostel_rooms WHERE institution_id = $1) AS beds,
      (SELECT count(*)::int FROM hostel_allocations WHERE institution_id = $1 AND status = 'active') AS occupied`,
  inventory: `SELECT
      (SELECT count(*)::int FROM inventory_items WHERE institution_id = $1) AS items,
      (SELECT count(*)::int FROM inventory_items WHERE institution_id = $1 AND current_stock <= min_stock_level) AS "lowStock"`,
};

export const SUMMARY_REPORTS = Object.keys(METRIC_SQL);

export async function summarize(report: string, institutionId: string, userId: string) {
  const sql = METRIC_SQL[report];
  if (!sql) throw ApiError.badRequest("Unknown summary report");
  const { rows } = await query<Record<string, number>>(sql, [institutionId]);
  const metrics = rows[0];

  // Derive a couple of useful ratios for the narrative + UI.
  if (report === "attendance") {
    const m = metrics as Record<string, number>;
    m.attendanceRate30 = m.marked30 > 0 ? Math.round((m.present30 / m.marked30) * 100) : 0;
  }

  logUsage("summarize", userId, institutionId);
  const narrative = await narrate(
    "You are a concise school operations analyst. Given these metrics, write 2-4 short bullet points covering key trends, risks, and a suggested next action. Plain text, no preamble.",
    `Report: ${report}\nMetrics: ${JSON.stringify(metrics)}`
  );
  return { report, metrics, narrative, aiAvailable: aiAvailable() };
}

// --- Attendance risk ---

export async function attendanceRisk(
  institutionId: string,
  opts: { threshold?: number; windowDays?: number; minRecords?: number },
  userId: string
) {
  const threshold = opts.threshold ?? 75;
  const windowDays = opts.windowDays ?? 60;
  const minRecords = opts.minRecords ?? 5;
  const { rows } = await query<{
    studentId: string;
    admissionNo: string;
    name: string;
    present: number;
    total: number;
  }>(
    `SELECT s.id AS "studentId", s.admission_no AS "admissionNo",
            s.first_name || ' ' || s.last_name AS name,
            count(ar.id) FILTER (WHERE ar.status IN ('present','late'))::int AS present,
            count(ar.id)::int AS total
     FROM students s
     LEFT JOIN attendance_records ar ON ar.student_id = s.id AND ar.institution_id = $1
        AND ar.date >= CURRENT_DATE - $2::int
     WHERE s.institution_id = $1 AND s.status = 'active'
     GROUP BY s.id`,
    [institutionId, windowDays]
  );
  const students = rows
    .filter((r) => r.total >= minRecords)
    .map((r) => ({ ...r, rate: Math.round((r.present / r.total) * 100) }))
    .filter((r) => r.rate < threshold)
    .sort((a, b) => a.rate - b.rate);

  logUsage("attendance_risk", userId, institutionId);
  const narrative =
    students.length > 0
      ? await narrate(
          "You are a school attendance analyst. Summarize the attendance-risk situation in 2-3 sentences and suggest a non-intrusive next action. Do not invent names.",
          `Threshold: ${threshold}% over ${windowDays} days. At-risk students: ${students.length}. Lowest: ${students
            .slice(0, 5)
            .map((s) => `${s.rate}%`)
            .join(", ")}`
        )
      : null;
  return { threshold, windowDays, count: students.length, students, narrative, aiAvailable: aiAvailable() };
}

// --- Fee pending / collection risk ---

export async function feeRisk(institutionId: string, userId: string) {
  const { rows } = await query<{
    id: string;
    invoiceNo: string;
    student: string;
    outstanding: number;
    dueDate: string | null;
    overdue: boolean;
  }>(
    `SELECT i.id, i.invoice_no AS "invoiceNo", s.first_name || ' ' || s.last_name AS student,
            (i.amount_due - i.amount_paid)::float AS outstanding, i.due_date AS "dueDate",
            (i.due_date IS NOT NULL AND i.due_date < CURRENT_DATE) AS overdue
     FROM invoices i JOIN students s ON s.id = i.student_id
     WHERE i.institution_id = $1 AND i.status IN ('pending','partially_paid')
     ORDER BY overdue DESC, i.due_date NULLS LAST
     LIMIT 100`,
    [institutionId]
  );
  const totalOutstanding = Math.round(rows.reduce((s, r) => s + Number(r.outstanding), 0) * 100) / 100;
  const overdueCount = rows.filter((r) => r.overdue).length;

  logUsage("fee_risk", userId, institutionId);
  const narrative =
    rows.length > 0
      ? await narrate(
          "You are a school finance analyst. In 2-3 sentences summarize the fee-collection risk and suggest a follow-up. Mention that reminders should be sent only on explicit action.",
          `Pending invoices: ${rows.length}, overdue: ${overdueCount}, total outstanding: ${totalOutstanding}`
        )
      : null;
  return {
    pendingCount: rows.length,
    overdueCount,
    totalOutstanding,
    invoices: rows,
    suggestedAction: rows.length > 0 ? "Send fee reminders via Communication (manual trigger)" : null,
    narrative,
    aiAvailable: aiAvailable(),
  };
}

// --- Document search (semantic when configured, else keyword) ---

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0;
}

interface DocResult {
  id: string;
  name: string;
  category: string;
  ownerType: string;
}

export async function documentSearch(q: string, institutionId: string, userId: string) {
  // Semantic: embed the query + recent documents' metadata, rank by cosine.
  // Strictly tenant-scoped; uses metadata only (never file contents/keys).
  if (openai) {
    try {
      const { rows } = await query<DocResult & { text: string }>(
        `SELECT id, original_name AS name, category, owner_type AS "ownerType",
                original_name || ' ' || category || ' ' || owner_type AS text
         FROM documents WHERE institution_id = $1 ORDER BY created_at DESC LIMIT 200`,
        [institutionId]
      );
      if (rows.length > 0) {
        const emb = await openai.embeddings.create({
          model: EMBED_MODEL,
          input: [q, ...rows.map((r) => r.text)],
        });
        const vectors = emb.data.map((d) => d.embedding as number[]);
        const qv = vectors[0];
        const ranked = rows
          .map((r, i) => ({
            id: r.id,
            name: r.name,
            category: r.category,
            ownerType: r.ownerType,
            score: Math.round(cosine(qv, vectors[i + 1]) * 1000) / 1000,
          }))
          .sort((a, b) => b.score - a.score)
          .slice(0, 20);
        logUsage("document_search", userId, institutionId);
        return { mode: "semantic" as const, results: ranked };
      }
    } catch {
      // fall through to keyword search
    }
  }
  // Keyword fallback (always available).
  const { rows } = await query<DocResult>(
    `SELECT id, original_name AS name, category, owner_type AS "ownerType"
     FROM documents
     WHERE institution_id = $1 AND (original_name ILIKE $2 OR category ILIKE $2)
     ORDER BY created_at DESC LIMIT 20`,
    [institutionId, `%${q}%`]
  );
  logUsage("document_search", userId, institutionId);
  return { mode: "keyword" as const, results: rows };
}

// --- Workflow suggestions (deterministic, tenant-scoped) ---

export async function workflowSuggestions(institutionId: string) {
  const { rows } = await query<Record<string, number>>(
    `SELECT
       (SELECT count(*)::int FROM invoices WHERE institution_id = $1 AND status IN ('pending','partially_paid')) AS "feeDues",
       (SELECT count(*)::int FROM leave_requests WHERE institution_id = $1 AND status = 'pending') AS "pendingLeave",
       (SELECT count(*)::int FROM book_issues WHERE institution_id = $1 AND status = 'issued' AND due_date < CURRENT_DATE) AS "overdueBooks",
       (SELECT count(*)::int FROM inventory_items WHERE institution_id = $1 AND current_stock <= min_stock_level) AS "lowStock",
       (SELECT count(*)::int FROM transport_invoices ti JOIN invoices i ON i.id = ti.invoice_id
        WHERE ti.institution_id = $1 AND i.status IN ('pending','partially_paid')) AS "transportDues",
       (SELECT count(*)::int FROM hostel_invoices hi JOIN invoices i ON i.id = hi.invoice_id
        WHERE hi.institution_id = $1 AND i.status IN ('pending','partially_paid')) AS "hostelDues"`,
    [institutionId]
  );
  const m = rows[0];
  const defs: Array<{ key: string; count: number; label: string; href: string }> = [
    { key: "fee_reminders", count: m.feeDues, label: "Send fee reminders", href: "/communication" },
    { key: "pending_leave", count: m.pendingLeave, label: "Review pending leave approvals", href: "/leave/approvals" },
    { key: "overdue_books", count: m.overdueBooks, label: "Follow up overdue library books", href: "/library/circulation" },
    { key: "low_stock", count: m.lowStock, label: "Review low-stock inventory", href: "/inventory/items" },
    { key: "transport_dues", count: m.transportDues, label: "Check transport fee dues", href: "/transport/fees" },
    { key: "hostel_dues", count: m.hostelDues, label: "Check hostel fee dues", href: "/hostel/fees" },
  ];
  const suggestions = defs.filter((d) => d.count > 0);
  return { suggestions };
}

// --- Insights dashboard ---

export async function insightsDashboard(institutionId: string) {
  const headline = (await query<Record<string, number>>(
    `SELECT
       (SELECT count(*)::int FROM students WHERE institution_id = $1 AND status = 'active') AS students,
       (SELECT count(*)::int FROM teachers WHERE institution_id = $1 AND is_active = true) AS staff,
       (SELECT COALESCE(sum(amount_due-amount_paid),0)::float FROM invoices WHERE institution_id = $1 AND status IN ('pending','partially_paid')) AS "feesOutstanding",
       (SELECT count(*)::int FROM attendance_records WHERE institution_id = $1 AND date >= CURRENT_DATE - 30) AS "marked30",
       (SELECT count(*)::int FROM attendance_records WHERE institution_id = $1 AND date >= CURRENT_DATE - 30 AND status IN ('present','late')) AS "present30"`,
    [institutionId]
  )).rows[0];
  const attendanceRate = headline.marked30 > 0 ? Math.round((headline.present30 / headline.marked30) * 100) : null;
  const { suggestions } = await workflowSuggestions(institutionId);
  return {
    aiAvailable: aiAvailable(),
    headline: {
      students: headline.students,
      staff: headline.staff,
      feesOutstanding: headline.feesOutstanding,
      attendanceRate,
    },
    suggestionCount: suggestions.length,
    suggestions,
  };
}

// --- Per-student performance analysis ---

interface PerfFlag {
  key: string;
  severity: "low" | "medium" | "high";
  detail: string;
  hint: string;
}

/**
 * Combines one student's attendance, exam, homework, fee and disciplinary signals
 * into a performance snapshot with deterministic risk flags + intervention hints.
 * The flags/hints are always computed locally; OpenAI only adds an optional
 * narrative. Tenant-scoped (404 if the student isn't in this institution).
 */
export async function studentPerformance(
  studentId: string,
  institutionId: string,
  userId: string,
  opts: { windowDays?: number } = {}
) {
  const windowDays = opts.windowDays ?? 90;

  const { rows: srows } = await query<{
    id: string;
    admissionNo: string;
    name: string;
    className: string | null;
    sectionName: string | null;
    sectionId: string | null;
  }>(
    `SELECT s.id, s.admission_no AS "admissionNo",
            s.first_name || ' ' || s.last_name AS name,
            c.name AS "className", sec.name AS "sectionName", s.section_id AS "sectionId"
     FROM students s
     LEFT JOIN sections sec ON sec.id = s.section_id
     LEFT JOIN classes c ON c.id = sec.class_id
     WHERE s.id = $1 AND s.institution_id = $2`,
    [studentId, institutionId]
  );
  const student = srows[0];
  if (!student) throw ApiError.notFound("Student not found");

  const { rows: mrows } = await query<{
    attPresent: number;
    attTotal: number;
    examAvg: number | null;
    examCount: number;
    hwSubmitted: number;
    hwAssigned: number;
    feeOutstanding: number;
    disciplineOpen: number;
    disciplineTotal: number;
  }>(
    `SELECT
       (SELECT count(*) FILTER (WHERE status IN ('present','late'))::int FROM attendance_records
          WHERE student_id = $1 AND institution_id = $2 AND date >= CURRENT_DATE - $3::int) AS "attPresent",
       (SELECT count(*)::int FROM attendance_records
          WHERE student_id = $1 AND institution_id = $2 AND date >= CURRENT_DATE - $3::int) AS "attTotal",
       (SELECT round(avg(marks_obtained / NULLIF(max_marks,0) * 100), 1)::float FROM exam_results
          WHERE student_id = $1 AND institution_id = $2) AS "examAvg",
       (SELECT count(*)::int FROM exam_results WHERE student_id = $1 AND institution_id = $2) AS "examCount",
       (SELECT count(*)::int FROM homework_submissions WHERE student_id = $1 AND institution_id = $2) AS "hwSubmitted",
       (SELECT count(*)::int FROM homework WHERE institution_id = $2 AND section_id = $4) AS "hwAssigned",
       (SELECT COALESCE(sum(amount_due - amount_paid),0)::float FROM invoices
          WHERE student_id = $1 AND institution_id = $2 AND status IN ('pending','partially_paid')) AS "feeOutstanding",
       (SELECT count(*)::int FROM disciplinary_records
          WHERE student_id = $1 AND institution_id = $2 AND status NOT IN ('closed','cancelled')) AS "disciplineOpen",
       (SELECT count(*)::int FROM disciplinary_records WHERE student_id = $1 AND institution_id = $2) AS "disciplineTotal"`,
    [studentId, institutionId, windowDays, student.sectionId]
  );
  const m = mrows[0];

  const attendanceRate = m.attTotal > 0 ? Math.round((m.attPresent / m.attTotal) * 100) : null;
  const homeworkRate =
    m.hwAssigned > 0 ? Math.min(100, Math.round((m.hwSubmitted / m.hwAssigned) * 100)) : null;
  const examAvg = m.examAvg;
  const feeOutstanding = Math.round(m.feeOutstanding * 100) / 100;

  const flags: PerfFlag[] = [];
  if (attendanceRate !== null && attendanceRate < 75) {
    flags.push({
      key: "attendance",
      severity: attendanceRate < 60 ? "high" : "medium",
      detail: `Attendance ${attendanceRate}% over the last ${windowDays} days`,
      hint: "Contact the guardian and check for a pattern of absences.",
    });
  }
  if (examAvg !== null && m.examCount > 0 && examAvg < 40) {
    flags.push({
      key: "academics",
      severity: examAvg < 33 ? "high" : "medium",
      detail: `Average exam score ${examAvg}% across ${m.examCount} result(s)`,
      hint: "Consider remedial support or a parent-teacher discussion.",
    });
  }
  if (homeworkRate !== null && homeworkRate < 60) {
    flags.push({
      key: "homework",
      severity: "medium",
      detail: `Homework submission rate ${homeworkRate}% (${m.hwSubmitted}/${m.hwAssigned})`,
      hint: "Follow up on missing submissions and the study routine.",
    });
  }
  if (feeOutstanding > 0) {
    flags.push({
      key: "fees",
      severity: "low",
      detail: `Outstanding fees of ${feeOutstanding}`,
      hint: "Coordinate a fee reminder via Communication (manual trigger).",
    });
  }
  if (m.disciplineOpen > 0) {
    flags.push({
      key: "discipline",
      severity: m.disciplineOpen > 1 ? "high" : "medium",
      detail: `${m.disciplineOpen} open disciplinary record(s)`,
      hint: "Review the disciplinary timeline and plan a counselling step.",
    });
  }

  logUsage("student_performance", userId, institutionId);
  const narrative = await narrate(
    "You are a supportive student-support analyst. Given one student's metrics and risk flags, write 2-4 short bullet points: overall standing, the most important concern, and concrete intervention hints. Use only the data given; never invent numbers or names.",
    `Metrics: ${JSON.stringify({
      attendanceRate,
      examAvg,
      examCount: m.examCount,
      homeworkRate,
      feeOutstanding,
      disciplineOpen: m.disciplineOpen,
      windowDays,
    })}\nFlags: ${JSON.stringify(flags)}`
  );

  return {
    student: {
      id: student.id,
      admissionNo: student.admissionNo,
      name: student.name,
      className: student.className,
      sectionName: student.sectionName,
    },
    windowDays,
    attendance: { present: m.attPresent, total: m.attTotal, rate: attendanceRate },
    exams: { average: examAvg, count: m.examCount },
    homework: { submitted: m.hwSubmitted, assigned: m.hwAssigned, rate: homeworkRate },
    fees: { outstanding: feeOutstanding },
    discipline: { open: m.disciplineOpen, total: m.disciplineTotal },
    flags,
    narrative,
    aiAvailable: aiAvailable(),
  };
}
