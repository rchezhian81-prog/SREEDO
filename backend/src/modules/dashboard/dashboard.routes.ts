import { Router } from "express";
import { authenticate } from "../../middleware/auth";
import { query } from "../../db/postgres";

export const dashboardRouter = Router();

/**
 * @openapi
 * /dashboard/stats:
 *   get:
 *     tags: [Dashboard]
 *     summary: Headline numbers for the dashboard
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200:
 *         description: Student/teacher counts, today's attendance rate and fee totals
 */
dashboardRouter.get("/stats", authenticate, async (_req, res) => {
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
       (SELECT count(*) FROM students WHERE status = 'active') AS active_students,
       (SELECT count(*) FROM teachers WHERE is_active = true) AS active_teachers,
       (SELECT count(*) FROM classes) AS classes,
       (SELECT count(*) FROM attendance_records WHERE date = CURRENT_DATE) AS marked_today,
       (SELECT count(*) FROM attendance_records
        WHERE date = CURRENT_DATE AND status IN ('present', 'late')) AS present_today,
       (SELECT count(*) FROM invoices
        WHERE status IN ('pending', 'partially_paid')) AS pending_invoices,
       (SELECT sum(amount_due) FROM invoices WHERE status <> 'cancelled') AS total_invoiced,
       (SELECT sum(amount) FROM payments) AS total_collected`
  );
  const row = rows[0];
  const marked = Number(row.marked_today);
  res.json({
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
  });
});
