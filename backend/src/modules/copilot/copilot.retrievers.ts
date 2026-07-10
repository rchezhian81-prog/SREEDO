import {
  attendanceRisk,
  feeRisk,
  insightsDashboard,
  summarize,
  workflowSuggestions,
} from "../aiinsights/aiinsights.service";
import { listJobs } from "../jobs/jobs.service";
import { listAuditLogs } from "../adminconsole/adminconsole.service";
import { listRequests as listLeaveRequests } from "../studentleave/studentleave.service";
import * as tenanthelp from "../tenanthelp/tenanthelp.service";
import type { Retriever, RetrieverResult } from "./copilot.types";

// The ENTIRE data surface of the copilot. Every entry wraps an EXISTING
// read-only, tenant-scoped service function and declares the permission keys
// the caller must hold for it to run. Adding a write here is the one thing a
// reviewer must never allow — the no-mutation tests assert row counts are
// unchanged across a full turn.

const money = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;

/** Search terms for help docs: strip filler words from the user message. */
const searchTerms = (message: string): string[] =>
  message
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 3 && !["what", "how", "does", "with", "this", "that", "have", "help", "need", "please", "about", "show", "safely"].includes(w))
    .slice(0, 4);

export const RETRIEVERS: Retriever[] = [
  {
    key: "needs_attention",
    perms: ["ai:workflow_suggestions"],
    async run({ institutionId }): Promise<RetrieverResult> {
      const { suggestions } = await workflowSuggestions(institutionId);
      if (suggestions.length === 0) {
        return { facts: ["Nothing is currently flagged as needing attention."], sources: [] };
      }
      return {
        facts: suggestions.map((s) => `${s.label}: ${s.count} pending (manual action at ${s.href})`),
        sources: suggestions.map((s) => ({ type: "metric" as const, id: s.key, label: s.label, href: s.href })),
      };
    },
  },
  {
    key: "pending_leave",
    perms: ["student_leave:read"],
    async run({ institutionId }): Promise<RetrieverResult> {
      const page = await listLeaveRequests({ page: 1, limit: 1, offset: 0 }, { status: "pending" }, institutionId);
      const total = page.meta.total;
      return {
        facts: [`Pending student-leave requests awaiting review: ${total}`],
        sources: [{ type: "metric", id: "student_leave.pending", label: "Student leave queue", href: "/student-leave" }],
      };
    },
  },
  {
    key: "attendance_summary",
    perms: ["ai:summarize"],
    async run({ institutionId, userId }): Promise<RetrieverResult> {
      const { metrics } = await summarize("attendance", institutionId, userId);
      const m = metrics as Record<string, number>;
      return {
        facts: [
          `Attendance today: ${m.markedToday ?? 0} marked.`,
          `Last 30 days: attendance rate ${m.attendanceRate30 ?? 0}% (${m.present30 ?? 0} present of ${m.marked30 ?? 0} marked).`,
        ],
        sources: [{ type: "metric", id: "summary.attendance", label: "Attendance summary", href: "/ai-insights" }],
      };
    },
  },
  {
    key: "attendance_risk",
    perms: ["ai:risk_alerts"],
    async run({ institutionId, userId }): Promise<RetrieverResult> {
      const risk = await attendanceRisk(institutionId, {}, userId);
      const worst = risk.students.slice(0, 5).map((s) => `${s.name} (${s.rate}%)`);
      return {
        facts: [
          `Students below the ${risk.threshold}% attendance threshold (last ${risk.windowDays} days): ${risk.count}.`,
          ...(worst.length ? [`Lowest: ${worst.join(", ")}.`] : []),
        ],
        sources: [{ type: "metric", id: "attendance.risk", label: "Attendance risk", href: "/ai-insights/attendance-risk" }],
      };
    },
  },
  {
    key: "fees_summary",
    perms: ["ai:summarize", "fee_schedules:read"],
    async run({ institutionId, userId }): Promise<RetrieverResult> {
      const { metrics } = await summarize("fees", institutionId, userId);
      const m = metrics as Record<string, number>;
      return {
        facts: [`Fees: ${JSON.stringify(m)
          .replace(/[{}"]/g, "")
          .replace(/,/g, ", ")}`],
        sources: [{ type: "metric", id: "summary.fees", label: "Fees summary", href: "/ai-insights" }],
      };
    },
  },
  {
    key: "fee_risk",
    perms: ["ai:risk_alerts", "fee_schedules:read"],
    async run({ institutionId, userId }): Promise<RetrieverResult> {
      const risk = await feeRisk(institutionId, userId);
      return {
        facts: [
          `Pending invoices: ${risk.pendingCount} (${risk.overdueCount} overdue); total outstanding ${money(risk.totalOutstanding)}.`,
          ...(risk.suggestedAction ? [`Suggested manual action: ${risk.suggestedAction}.`] : []),
        ],
        sources: [{ type: "metric", id: "fees.risk", label: "Fee risk", href: "/ai-insights/fee-risk" }],
      };
    },
  },
  {
    key: "exams_summary",
    perms: ["ai:summarize"],
    async run({ institutionId, userId }): Promise<RetrieverResult> {
      const { metrics } = await summarize("exams", institutionId, userId);
      return {
        facts: [`Exams: ${JSON.stringify(metrics).replace(/[{}"]/g, "").replace(/,/g, ", ")}`],
        sources: [{ type: "metric", id: "summary.exams", label: "Exams summary", href: "/exams" }],
      };
    },
  },
  {
    key: "health_snapshot",
    perms: ["ai:read"],
    async run({ institutionId }): Promise<RetrieverResult> {
      const d = await insightsDashboard(institutionId);
      return {
        facts: [
          `Institution health: ${d.headline.students} active students, ${d.headline.staff} active staff, ` +
            `fees outstanding ${money(d.headline.feesOutstanding)}, 30-day attendance rate ${d.headline.attendanceRate ?? "n/a"}%.`,
        ],
        sources: [{ type: "metric", id: "insights.dashboard", label: "Insights dashboard", href: "/ai-insights" }],
      };
    },
  },
  {
    key: "failed_jobs",
    perms: ["jobs:read"],
    async run({ institutionId }): Promise<RetrieverResult> {
      const rows = (await listJobs(institutionId, { status: "failed", limit: 10 })) as Array<
        Record<string, unknown>
      >;
      if (rows.length === 0) return { facts: ["No failed background jobs for this institution."], sources: [] };
      return {
        facts: rows.slice(0, 5).map((j) => {
          const err = String(j.lastError ?? j.last_error ?? "no error detail");
          return `Failed job ${String(j.type)}: ${err.slice(0, 160)} (retry manually from /jobs)`;
        }),
        sources: [{ type: "link", id: "/jobs", label: "Background jobs", href: "/jobs" }],
      };
    },
  },
  {
    key: "audit_events",
    perms: [],
    adminOnly: true,
    async run({ institutionId }): Promise<RetrieverResult> {
      const res = await listAuditLogs({ institutionId, limit: 15 });
      if (!res.available) {
        return { facts: ["The activity trail is unavailable (audit store not configured)."], sources: [] };
      }
      if (res.rows.length === 0) return { facts: ["No recent audit events recorded."], sources: [] };
      return {
        facts: res.rows
          .slice(0, 8)
          .map((r) => `Audit: ${r.method} ${r.path} (status ${r.statusCode ?? "?"}) at ${String(r.createdAt ?? "")}`.trim()),
        sources: [{ type: "link", id: "/activity", label: "Activity log", href: "/activity" }],
      };
    },
  },
  {
    key: "help_docs",
    perms: ["tenant_help:read"],
    async run({ institutionId, message }): Promise<RetrieverResult> {
      // The corpus search is substring-based, so try the joined phrase first
      // and then fall back to individual terms, deduping by doc id.
      const terms = searchTerms(message);
      const queries = [terms.join(" "), ...terms].filter(Boolean);
      const seen = new Map<string, Awaited<ReturnType<typeof tenanthelp.search>>[number]>();
      for (const q of queries) {
        if (seen.size >= 3) break;
        for (const hit of await tenanthelp.search(institutionId, q)) {
          if (!seen.has(hit.id)) seen.set(hit.id, hit);
        }
      }
      const top = [...seen.values()].slice(0, 3);
      if (top.length === 0) {
        return { facts: [`No help article or SOP matches "${terms.join(" ")}".`], sources: [] };
      }
      const facts: string[] = [];
      for (const hit of top) {
        facts.push(`${hit.type === "sop" ? "SOP" : hit.type === "article" ? "Article" : "Guide"} [${hit.id}] "${hit.title}": ${hit.snippet}`);
      }
      // Include the top hit's steps/body so the answer can be substantive.
      const first = top[0];
      if (first.type === "sop") {
        const sop = await tenanthelp.getSop(institutionId, first.id);
        facts.push(`Steps of [${sop.id}]: ${sop.steps.map((s, i) => `${i + 1}) ${s}`).join(" ")}`);
        if (sop.safetyWarnings.length) facts.push(`Safety: ${sop.safetyWarnings.join(" | ")}`);
      } else if (first.type === "article") {
        const art = await tenanthelp.getArticle(institutionId, first.id);
        facts.push(`From [${art.id}]: ${art.body.replace(/\s+/g, " ").slice(0, 600)}`);
      }
      return {
        facts,
        sources: top.map((h) => ({ type: "doc" as const, id: h.id, label: h.title, href: "/help" })),
      };
    },
  },
  {
    key: "comm_draft",
    perms: ["communication:read"],
    async run(): Promise<RetrieverResult> {
      // Deliberately reads NOTHING: the draft is a template with placeholders,
      // so no student/guardian PII ever enters the prompt. The user fills the
      // placeholders in the existing composer and sends manually.
      return {
        facts: [
          "DRAFT REQUEST: produce a short, polite parent-communication draft for the topic the user asked about. " +
            "Use placeholders like [Student Name], [Class/Program], [Date] instead of real data. " +
            "End by reminding the user to review and send it manually from the Communication screen.",
        ],
        sources: [{ type: "link", id: "/communication", label: "Communication composer", href: "/communication" }],
      };
    },
  },
];

export const RETRIEVER_BY_KEY: Record<string, Retriever> = Object.fromEntries(
  RETRIEVERS.map((r) => [r.key, r])
);

// Deterministic intent router — first matching rule wins; no LLM involvement,
// so a prompt-injection attempt cannot widen the retrieval surface.
const INTENT_RULES: Array<{ pattern: RegExp; retrievers: string[] }> = [
  { pattern: /\b(how (do|to|can)|sop|procedure|guide|steps?|help doc|rollover|onboard)/i, retrievers: ["help_docs"] },
  { pattern: /\b(draft|compose|write (a |an )?(message|letter|email|note))/i, retrievers: ["comm_draft"] },
  { pattern: /\b(job|jobs|error|failed|failure|stuck)\b/i, retrievers: ["failed_jobs"] },
  { pattern: /\b(audit|security|suspicious|login history|permission change)/i, retrievers: ["audit_events"] },
  { pattern: /\b(fee|fees|dues?|outstanding|invoice|collect)/i, retrievers: ["fees_summary", "fee_risk"] },
  { pattern: /\b(attendance|absent|absence|present)\b/i, retrievers: ["attendance_summary", "attendance_risk"] },
  { pattern: /\b(exam|marks|result|report card|grade sheet)/i, retrievers: ["exams_summary"] },
  { pattern: /\bleave\b/i, retrievers: ["pending_leave"] },
  { pattern: /\b(weekly|report|digest|briefing)\b/i, retrievers: ["health_snapshot", "attendance_summary", "fees_summary", "exams_summary"] },
  { pattern: /\b(health|overview|status|summar)/i, retrievers: ["health_snapshot", "needs_attention"] },
];
const DEFAULT_INTENT = ["needs_attention", "pending_leave", "health_snapshot"];
const MAX_RETRIEVERS_PER_TURN = 4;

/** Map a user message to the allow-listed retrievers it may draw on. */
export function routeIntent(message: string): Retriever[] {
  const rule = INTENT_RULES.find((r) => r.pattern.test(message));
  const keys = (rule?.retrievers ?? DEFAULT_INTENT).slice(0, MAX_RETRIEVERS_PER_TURN);
  return keys.map((k) => RETRIEVER_BY_KEY[k]).filter(Boolean);
}
