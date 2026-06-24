import cors from "cors";
import express from "express";
import helmet from "helmet";
import swaggerUi from "swagger-ui-express";
import { env } from "./config/env";
import { swaggerSpec } from "./config/swagger";
import { getMongoDb } from "./db/mongo";
import { pool } from "./db/postgres";
import { auditLog } from "./middleware/audit";
import { errorHandler, notFoundHandler } from "./middleware/error";
import { apiRateLimiter } from "./middleware/rate-limit";
import { requestContext } from "./middleware/request-context";
import { requestLogger } from "./middleware/request-logger";
import { observabilityRouter } from "./modules/observability/observability.routes";
import { liveness, readiness } from "./modules/observability/observability.service";
import { academicsRouter } from "./modules/academics/academics.routes";
import { adminConsoleRouter } from "./modules/adminconsole/adminconsole.routes";
import { activityRouter } from "./modules/activity/activity.routes";
import { admissionsRouter } from "./modules/admissions/admissions.routes";
import { financeRouter } from "./modules/finance/finance.routes";
import { calendarRouter } from "./modules/calendar/calendar.routes";
import { visitorsRouter } from "./modules/visitors/visitors.routes";
import { feedbackRouter } from "./modules/feedback/feedback.routes";
import { infirmaryRouter } from "./modules/infirmary/infirmary.routes";
import { aiRouter } from "./modules/ai/ai.routes";
import { aiInsightsRouter } from "./modules/aiinsights/aiinsights.routes";
import { announcementsRouter } from "./modules/announcements/announcements.routes";
import { attendanceRouter } from "./modules/attendance/attendance.routes";
import { authRouter } from "./modules/auth/auth.routes";
import { backupsRouter } from "./modules/backups/backups.routes";
import { collegeRouter } from "./modules/college/college.routes";
import { communicationRouter } from "./modules/communication/communication.routes";
import { customReportsRouter } from "./modules/customreports/customreports.routes";
import { dashboardRouter } from "./modules/dashboard/dashboard.routes";
import { disciplinaryRouter } from "./modules/disciplinary/disciplinary.routes";
import { documentsRouter } from "./modules/documents/documents.routes";
import { examsRouter } from "./modules/exams/exams.routes";
import { feesRouter } from "./modules/fees/fees.routes";
import { homeworkRouter } from "./modules/homework/homework.routes";
import { hostelRouter } from "./modules/hostel/hostel.routes";
import { inventoryRouter } from "./modules/inventory/inventory.routes";
import { jobsRouter } from "./modules/jobs/jobs.routes";
import { libraryRouter } from "./modules/library/library.routes";
import { onlinePaymentsRouter } from "./modules/onlinepayments/onlinepayments.routes";
import { transportRouter } from "./modules/transport/transport.routes";
import {
  certificatesRouter,
  feeReceiptsRouter,
  idCardsRouter,
} from "./modules/pdfs/pdfs.routes";
import { payrollRouter } from "./modules/payroll/payroll.routes";
import { platformRouter } from "./modules/platform/platform.routes";
import { portalRouter } from "./modules/portal/portal.routes";
import { reportCenterRouter } from "./modules/reportcenter/reportcenter.routes";
import { reportsRouter } from "./modules/reports/reports.routes";
import { scheduledReportsRouter } from "./modules/scheduledreports/scheduledreports.routes";
import { leaveRouter, staffAttendanceRouter } from "./modules/staffleave/staffleave.routes";
import { studentsRouter } from "./modules/students/students.routes";
import { superAdminRouter } from "./modules/superadmin/superadmin.routes";
import { teachersRouter } from "./modules/teachers/teachers.routes";
import { timetableRouter } from "./modules/timetable/timetable.routes";
import { transferCertificatesRouter } from "./modules/tc/tc.routes";
import { usersRouter } from "./modules/users/users.routes";

export function createApp(): express.Express {
  const app = express();

  // Behind nginx in production; needed for correct client IPs in rate limiting.
  app.set("trust proxy", 1);

  // Correlation id first, so every log line + response carries it.
  app.use(requestContext);
  app.use(helmet());
  app.use(cors({ origin: env.corsOrigin, credentials: true }));
  app.use(
    express.json({
      limit: "1mb",
      // Capture the raw bytes so payment webhooks can verify their HMAC signature.
      verify: (req, _res, buf) => {
        (req as express.Request).rawBody = buf;
      },
    })
  );
  app.use(requestLogger);

  app.get("/health", async (_req, res) => {
    let postgres = false;
    try {
      await pool.query("SELECT 1");
      postgres = true;
    } catch {
      // reported in the response body below
    }
    res.status(postgres ? 200 : 503).json({
      status: postgres ? "ok" : "degraded",
      postgres,
      mongo: getMongoDb() !== null,
      uptime: process.uptime(),
    });
  });

  // Readiness probe — 503 until critical deps (DB + migrations) are ready. Public
  // (k8s probes don't authenticate); returns only check flags, never secrets.
  app.get("/ready", async (_req, res) => {
    const result = await readiness();
    res.status(result.ready ? 200 : 503).json(result);
  });

  // Liveness — cheapest possible "process is up" probe.
  app.get("/live", (_req, res) => {
    res.json(liveness());
  });

  // Swagger is disabled in production by default (see env.enableApiDocs) so the
  // API surface is not publicly browsable; set ENABLE_API_DOCS=true to expose it.
  if (env.enableApiDocs) {
    app.use("/api/docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));
    app.get("/api/docs.json", (_req, res) => {
      res.json(swaggerSpec);
    });
  }

  const api = express.Router();
  api.use(apiRateLimiter);
  api.use(auditLog);
  api.use("/auth", authRouter);
  api.use("/users", usersRouter);
  api.use("/students", studentsRouter);
  api.use("/teachers", teachersRouter);
  api.use("/", academicsRouter); // /academic-years, /classes, /sections, /subjects
  api.use("/attendance", attendanceRouter);
  api.use("/timetable", timetableRouter);
  api.use("/exams", examsRouter);
  api.use("/fees", feesRouter);
  api.use("/online-payments", onlinePaymentsRouter);
  api.use("/transfer-certificates", transferCertificatesRouter);
  api.use("/college", collegeRouter);
  api.use("/library", libraryRouter);
  api.use("/transport", transportRouter);
  api.use("/hostel", hostelRouter);
  api.use("/inventory", inventoryRouter);
  api.use("/staff", staffAttendanceRouter);
  api.use("/leave", leaveRouter);
  api.use("/payroll", payrollRouter);
  api.use("/announcements", announcementsRouter);
  api.use("/dashboard", dashboardRouter);
  api.use("/portal", portalRouter);
  api.use("/reports", reportsRouter);
  api.use("/report-center", reportCenterRouter);
  api.use("/custom-reports", customReportsRouter);
  api.use("/scheduled-reports", scheduledReportsRouter);
  api.use("/jobs", jobsRouter);
  api.use("/disciplinary", disciplinaryRouter);
  api.use("/communication", communicationRouter);
  api.use("/documents", documentsRouter);
  api.use("/homework", homeworkRouter);
  api.use("/fee-receipts", feeReceiptsRouter);
  api.use("/id-cards", idCardsRouter);
  api.use("/certificates", certificatesRouter);
  api.use("/ai", aiRouter);
  api.use("/ai-insights", aiInsightsRouter);
  api.use("/observability", observabilityRouter); // super-admin platform observability
  api.use("/backups", backupsRouter); // super-admin backup / restore automation
  api.use("/admin", adminConsoleRouter); // super-admin platform console
  api.use("/activity", activityRouter); // institution-admin activity log (own tenant)
  api.use("/admissions", admissionsRouter); // online admissions + public enquiry
  api.use("/finance", financeRouter); // accounting: income/expense ledger
  api.use("/calendar", calendarRouter); // events & academic calendar
  api.use("/visitors", visitorsRouter); // front office: visitor log
  api.use("/feedback", feedbackRouter); // feedback / grievance tracker
  api.use("/infirmary", infirmaryRouter); // health / infirmary visit log
  api.use("/platform", platformRouter); // super-admin platform hardening
  api.use("/", superAdminRouter); // /institutions, /branches, /packages
  app.use("/api/v1", api);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
