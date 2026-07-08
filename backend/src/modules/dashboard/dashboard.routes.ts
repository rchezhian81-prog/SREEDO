import { Router } from "express";
import { authenticate } from "../../middleware/auth";
import { requireTenant, tenantId } from "../../middleware/tenant";
import { requireStaff } from "../../utils/scope";
import { query } from "../../db/postgres";
import { cached, invalidate } from "../../cache/cache";
import { effectivePermissions } from "../../middleware/permissions";

export const dashboardRouter = Router();

// Dashboard KPIs are institution-wide (staff-only) and read-heavy — cache the
// computed payload per institution for a short window. Count-changing writes
// invalidate it explicitly (see invalidateDashboard); the short TTL bounds any
// staleness for counts not covered by an explicit invalidation hook.
const DASHBOARD_TTL_MS = 30_000;
const dashboardKey = (institutionId: string) => `dashboard:stats:${institutionId}`;

/** Drop a tenant's cached dashboard stats (call after count-changing writes). */
export function invalidateDashboard(institutionId: string): void {
  invalidate(dashboardKey(institutionId));
  invalidate(`dashboard:summary:${institutionId}`);
}

async function computeStats(inst: string) {
  const { rows } = await query<{
    active_students: string;
    active_teachers: string;
    classes: string;
    marked_today: string;
    present_today: string;
    pending_invoices: string;
    total_invoiced: string | null;
    total_collected: string | null;
  }>(
    `SELECT
       (SELECT count(*) FROM students WHERE status = 'active' AND institution_id = $1) AS active_students,
       (SELECT count(*) FROM teachers WHERE is_active = true AND institution_id = $1) AS active_teachers,
       (SELECT count(*) FROM classes WHERE institution_id = $1) AS classes,
       (SELECT count(*) FROM attendance_records
        WHERE date = CURRENT_DATE AND institution_id = $1) AS marked_today,
       (SELECT count(*) FROM attendance_records
        WHERE date = CURRENT_DATE AND status IN ('present', 'late') AND institution_id = $1) AS present_today,
       (SELECT count(*) FROM invoices
        WHERE status IN ('pending', 'partially_paid') AND institution_id = $1) AS pending_invoices,
       (SELECT sum(amount_due) FROM invoices WHERE status <> 'cancelled' AND institution_id = $1) AS total_invoiced,
       (SELECT sum(amount) FROM payments WHERE institution_id = $1) AS total_collected`,
    [inst]
  );
  const row = rows[0];
  const marked = Number(row.marked_today);
  return {
    activeStudents: Number(row.active_students),
    activeTeachers: Number(row.active_teachers),
    classes: Number(row.classes),
    attendanceToday: {
      marked,
      present: Number(row.present_today),
      rate: marked > 0 ? Number(row.present_today) / marked : null,
    },
    fees: {
      pendingInvoices: Number(row.pending_invoices),
      totalInvoiced: Number(row.total_invoiced ?? 0),
      totalCollected: Number(row.total_collected ?? 0),
    },
  };
}

/**
 * @openapi
 * /dashboard/stats:
 *   get:
 *     tags: [Dashboard]
 *     summary: Headline numbers for the dashboard (short-TTL cached per institution)
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200:
 *         description: Student/teacher counts, today's attendance rate and fee totals
 */
dashboardRouter.get("/stats", authenticate, requireTenant, async (req, res) => {
  requireStaff(req); // school-wide aggregates are staff-only
  const inst = tenantId(req);
  res.json(await cached(dashboardKey(inst), DASHBOARD_TTL_MS, () => computeStats(inst)));
});

// --- Rich tenant-admin overview summary (PR-T4) ---------------------------
//
// One tenant-scoped call backing the Tenant Admin dashboard: institution
// snapshot, academic + operations + finance + communication summaries, and a
// derived "needs attention" signal list. The full data is cached per
// institution (30s); the route filters the finance/admissions sections and the
// alert list by the caller's effective permissions so the payload never leaks
// data a role cannot see. All numbers are real (no fakes); absent data is a
// zero/null the frontend renders as "Not configured".

type SummaryData = Awaited<ReturnType<typeof computeFullSummary>>;

async function computeFullSummary(inst: string) {
  const { rows: instRows } = await query<{
    name: string;
    type: "school" | "college";
    is_active: boolean;
    code: string;
    current_year: { id: string; name: string } | null;
  }>(
    `SELECT i.name, i.type, i.is_active, i.code,
       (SELECT json_build_object('id', ay.id, 'name', ay.name)
        FROM academic_years ay
        WHERE ay.institution_id = i.id AND ay.is_current = true LIMIT 1) AS current_year
     FROM institutions i WHERE i.id = $1`,
    [inst]
  );

  const { rows: acaRows } = await query<Record<string, string>>(
    `SELECT
       (SELECT count(*) FROM classes WHERE institution_id = $1) AS classes,
       (SELECT count(*) FROM sections WHERE institution_id = $1) AS sections,
       (SELECT count(*) FROM subjects WHERE institution_id = $1) AS subjects,
       (SELECT count(*) FROM departments WHERE institution_id = $1) AS departments,
       (SELECT count(*) FROM programs WHERE institution_id = $1) AS programs,
       (SELECT count(*) FROM semesters WHERE institution_id = $1) AS semesters,
       (SELECT count(*) FROM batches WHERE institution_id = $1) AS batches,
       (SELECT count(*) FROM students WHERE status = 'active' AND institution_id = $1) AS active_students,
       (SELECT count(*) FROM teachers WHERE is_active = true AND institution_id = $1) AS active_staff`,
    [inst]
  );

  const { rows: opsRows } = await query<Record<string, string>>(
    `SELECT
       (SELECT count(*) FROM attendance_records WHERE date = CURRENT_DATE AND institution_id = $1) AS marked,
       (SELECT count(*) FROM attendance_records WHERE date = CURRENT_DATE AND status IN ('present','late') AND institution_id = $1) AS present,
       (SELECT count(*) FROM admission_applications WHERE institution_id = $1 AND status IN ('enquiry','applied','under_review')) AS pending_admissions,
       (SELECT count(*) FROM exams WHERE institution_id = $1 AND start_date >= CURRENT_DATE) AS upcoming_exams,
       (SELECT count(*) FROM homework WHERE institution_id = $1 AND due_date >= CURRENT_DATE) AS homework_due,
       (SELECT count(*) FROM calendar_events WHERE institution_id = $1 AND event_date >= CURRENT_DATE) AS upcoming_events`,
    [inst]
  );

  const { rows: finRows } = await query<Record<string, string | null>>(
    `SELECT
       (SELECT count(*) FROM invoices WHERE status IN ('pending','partially_paid') AND institution_id = $1) AS pending_invoices,
       (SELECT sum(amount_due) FROM invoices WHERE status <> 'cancelled' AND institution_id = $1) AS total_invoiced,
       (SELECT sum(amount) FROM payments WHERE institution_id = $1) AS total_collected,
       (SELECT count(*) FROM invoices WHERE due_date < CURRENT_DATE AND status IN ('pending','partially_paid') AND institution_id = $1) AS overdue_invoices,
       (SELECT COALESCE(sum(amount), 0) FROM payments WHERE institution_id = $1 AND paid_at::date = CURRENT_DATE) AS collected_today`,
    [inst]
  );

  const { rows: annRows } = await query<{ id: string; title: string; published_at: string; is_pinned: boolean }>(
    `SELECT id, title, published_at, is_pinned FROM announcements
     WHERE institution_id = $1 AND published_at <= now()
     ORDER BY is_pinned DESC, published_at DESC LIMIT 3`,
    [inst]
  );

  // Failed communications are optional (email delivery may be unconfigured).
  let failedComms: number | null = null;
  try {
    const { rows } = await query<{ c: string }>(
      `SELECT count(*) AS c FROM email_deliveries WHERE institution_id = $1 AND status IN ('failed','bounced')`,
      [inst]
    );
    failedComms = Number(rows[0].c);
  } catch {
    failedComms = null; // table/feature unavailable — degrade gracefully
  }

  const i = instRows[0];
  const a = acaRows[0];
  const o = opsRows[0];
  const f = finRows[0];
  const marked = Number(o.marked);
  return {
    institution: {
      name: i.name,
      type: i.type,
      code: i.code,
      isActive: i.is_active,
      currentAcademicYear: i.current_year,
    },
    academic: {
      classes: Number(a.classes),
      sections: Number(a.sections),
      subjects: Number(a.subjects),
      departments: Number(a.departments),
      programs: Number(a.programs),
      semesters: Number(a.semesters),
      batches: Number(a.batches),
      activeStudents: Number(a.active_students),
      activeStaff: Number(a.active_staff),
    },
    operations: {
      attendanceToday: {
        marked,
        present: Number(o.present),
        rate: marked > 0 ? Number(o.present) / marked : null,
      },
      pendingAdmissions: Number(o.pending_admissions),
      upcomingExams: Number(o.upcoming_exams),
      homeworkDue: Number(o.homework_due),
      upcomingEvents: Number(o.upcoming_events),
    },
    finance: {
      pendingInvoices: Number(f.pending_invoices),
      totalInvoiced: Number(f.total_invoiced ?? 0),
      totalCollected: Number(f.total_collected ?? 0),
      outstanding: Math.max(0, Number(f.total_invoiced ?? 0) - Number(f.total_collected ?? 0)),
      overdueInvoices: Number(f.overdue_invoices),
      collectedToday: Number(f.collected_today ?? 0),
    },
    communication: {
      recentAnnouncements: annRows.map((r) => ({
        id: r.id,
        title: r.title,
        publishedAt: r.published_at,
        isPinned: r.is_pinned,
      })),
      failedComms,
    },
  };
}

/** Build the caller-visible summary + "needs attention" list from cached data. */
function shapeSummary(data: SummaryData, perms: Set<string>) {
  const has = (k: string) => perms.has(k);
  const isCollege = data.institution.type === "college";
  const aca = data.academic;

  const needsAttention: { key: string; severity: "info" | "warning" | "danger"; count?: number }[] = [];
  if (!data.institution.currentAcademicYear)
    needsAttention.push({ key: "no_academic_year", severity: "warning" });
  if ((isCollege ? aca.programs : aca.classes) === 0)
    needsAttention.push({ key: isCollege ? "no_programs" : "no_classes", severity: "warning" });
  else if ((isCollege ? aca.batches : aca.sections) === 0)
    needsAttention.push({ key: isCollege ? "no_batches" : "no_sections", severity: "info" });
  if (aca.activeStudents === 0) needsAttention.push({ key: "no_students", severity: "info" });
  else if (data.operations.attendanceToday.marked === 0)
    needsAttention.push({ key: "attendance_not_marked", severity: "info" });
  if (has("fees:read") && data.finance.overdueInvoices > 0)
    needsAttention.push({ key: "overdue_fees", severity: "warning", count: data.finance.overdueInvoices });
  if (has("communication:read") && data.communication.failedComms && data.communication.failedComms > 0)
    needsAttention.push({ key: "failed_comms", severity: "danger", count: data.communication.failedComms });

  return {
    institution: data.institution,
    academic: aca,
    operations: {
      ...data.operations,
      // Admissions figures are only for admissions readers.
      pendingAdmissions: has("admissions:read") ? data.operations.pendingAdmissions : null,
    },
    // Finance is money data — omit entirely for roles without fees:read.
    finance: has("fees:read") ? data.finance : null,
    communication: {
      recentAnnouncements: data.communication.recentAnnouncements,
      failedComms: has("communication:read") ? data.communication.failedComms : null,
    },
    needsAttention,
  };
}

/**
 * @openapi
 * /dashboard/summary:
 *   get:
 *     tags: [Dashboard]
 *     summary: Tenant-admin overview — institution, academic, operations, finance, communication + needs-attention (RBAC-filtered)
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Real tenant-scoped summary; finance/admissions gated by permission }
 */
dashboardRouter.get("/summary", authenticate, requireTenant, async (req, res) => {
  requireStaff(req); // institution-wide overview is staff-only
  const inst = tenantId(req);
  const perms = new Set(await effectivePermissions(req.user!));
  const data = await cached(`dashboard:summary:${inst}`, DASHBOARD_TTL_MS, () =>
    computeFullSummary(inst)
  );
  res.json(shapeSummary(data, perms));
});

/** Chart-friendly aggregations (distributions + time series) for analytics. */
async function computeCharts(inst: string) {
  const enrollment = await query<{ label: string; value: number }>(
    `SELECT c.name AS label,
            count(s.id) FILTER (WHERE s.status = 'active')::int AS value
     FROM classes c
     LEFT JOIN sections sec ON sec.class_id = c.id
     LEFT JOIN students s ON s.section_id = sec.id AND s.institution_id = $1
     WHERE c.institution_id = $1
     GROUP BY c.id, c.name, c.grade_level
     ORDER BY c.grade_level, c.name`,
    [inst]
  );

  const attendance = await query<{ date: string; present: number; total: number }>(
    `SELECT to_char(date, 'YYYY-MM-DD') AS date,
            count(*) FILTER (WHERE status IN ('present', 'late'))::int AS present,
            count(*)::int AS total
     FROM attendance_records
     WHERE institution_id = $1 AND date >= CURRENT_DATE - INTERVAL '13 days'
     GROUP BY date ORDER BY date`,
    [inst]
  );

  const fees = await query<{ month: string; amount: number }>(
    `SELECT to_char(date_trunc('month', paid_at), 'YYYY-MM') AS month,
            COALESCE(sum(amount), 0)::float8 AS amount
     FROM payments
     WHERE institution_id = $1
       AND paid_at >= date_trunc('month', CURRENT_DATE) - INTERVAL '5 months'
     GROUP BY 1 ORDER BY 1`,
    [inst]
  );

  const gender = await query<{ label: string | null; value: number }>(
    `SELECT gender AS label, count(*)::int AS value
     FROM students
     WHERE institution_id = $1 AND status = 'active'
     GROUP BY gender`,
    [inst]
  );

  return {
    enrollmentByClass: enrollment.rows,
    attendanceTrend: attendance.rows.map((r) => ({
      date: r.date,
      rate: r.total > 0 ? r.present / r.total : 0,
      present: r.present,
      total: r.total,
    })),
    feeCollectionByMonth: fees.rows,
    studentsByGender: gender.rows.map((r) => ({
      label: r.label ?? "unspecified",
      value: r.value,
    })),
  };
}

/**
 * @openapi
 * /dashboard/charts:
 *   get:
 *     tags: [Dashboard]
 *     summary: Chart datasets — enrollment by class, attendance trend, fee collection, gender split
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Aggregated series for the analytics view }
 */
dashboardRouter.get("/charts", authenticate, requireTenant, async (req, res) => {
  requireStaff(req);
  const inst = tenantId(req);
  res.json(
    await cached(`dashboard:charts:${inst}`, DASHBOARD_TTL_MS, () => computeCharts(inst))
  );
});
