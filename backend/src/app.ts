import cors from "cors";
import express from "express";
import helmet from "helmet";
import morgan from "morgan";
import swaggerUi from "swagger-ui-express";
import { env } from "./config/env";
import { swaggerSpec } from "./config/swagger";
import { getMongoDb } from "./db/mongo";
import { pool } from "./db/postgres";
import { auditLog } from "./middleware/audit";
import { errorHandler, notFoundHandler } from "./middleware/error";
import { apiRateLimiter } from "./middleware/rate-limit";
import { academicsRouter } from "./modules/academics/academics.routes";
import { adminConsoleRouter } from "./modules/adminconsole/adminconsole.routes";
import { aiRouter } from "./modules/ai/ai.routes";
import { aiInsightsRouter } from "./modules/aiinsights/aiinsights.routes";
import { announcementsRouter } from "./modules/announcements/announcements.routes";
import { attendanceRouter } from "./modules/attendance/attendance.routes";
import { authRouter } from "./modules/auth/auth.routes";
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
import { libraryRouter } from "./modules/library/library.routes";
import { onlinePaymentsRouter } from "./modules/onlinepayments/onlinepayments.routes";
import { transportRouter } from "./modules/transport/transport.routes";
import { feeReceiptsRouter, idCardsRouter } from "./modules/pdfs/pdfs.routes";
import { payrollRouter } from "./modules/payroll/payroll.routes";
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
  app.use(morgan(env.isProduction ? "combined" : "dev"));

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
  api.use("/disciplinary", disciplinaryRouter);
  api.use("/communication", communicationRouter);
  api.use("/documents", documentsRouter);
  api.use("/homework", homeworkRouter);
  api.use("/fee-receipts", feeReceiptsRouter);
  api.use("/id-cards", idCardsRouter);
  api.use("/ai", aiRouter);
  api.use("/ai-insights", aiInsightsRouter);
  api.use("/admin", adminConsoleRouter); // super-admin platform console
  api.use("/", superAdminRouter); // /institutions, /branches, /packages
  app.use("/api/v1", api);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
