import { Router } from "express";
import { authenticate } from "../../middleware/auth";
import { requireTenant, tenantId } from "../../middleware/tenant";
import { requireStaff } from "../../utils/scope";
import { query } from "../../db/postgres";
import { cached, invalidate } from "../../cache/cache";

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
