import cors from "cors";
import express from "express";
import helmet from "helmet";
import swaggerUi from "swagger-ui-express";
import { env } from "./config/env";
import { swaggerSpec } from "./config/swagger";
import { getMongoDb } from "./db/mongo";
import { pool } from "./db/postgres";
import { auditLog } from "./middleware/audit";
import { csrfOriginGuard } from "./middleware/csrf";
import { errorHandler, notFoundHandler } from "./middleware/error";
import { apiRateLimiter } from "./middleware/rate-limit";
import { requestContext } from "./middleware/request-context";
import { requestLogger } from "./middleware/request-logger";
import { errorCapture } from "./middleware/error-capture";
import { observabilityRouter } from "./modules/observability/observability.routes";
import { liveness, readiness } from "./modules/observability/observability.service";
import { academicsRouter } from "./modules/academics/academics.routes";
import { settingsRouter } from "./modules/settings/settings.routes";
import { tenantRbacRouter } from "./modules/tenant-rbac/tenant-rbac.routes";
import { adminConsoleRouter } from "./modules/adminconsole/adminconsole.routes";
import { activityRouter } from "./modules/activity/activity.routes";
import { admissionsRouter } from "./modules/admissions/admissions.routes";
import { financeRouter } from "./modules/finance/finance.routes";
import { calendarRouter } from "./modules/calendar/calendar.routes";
import { visitorsRouter } from "./modules/visitors/visitors.routes";
import { feedbackRouter } from "./modules/feedback/feedback.routes";
import { infirmaryRouter } from "./modules/infirmary/infirmary.routes";
import { alumniRouter } from "./modules/alumni/alumni.routes";
import { messRouter } from "./modules/mess/mess.routes";
import { studyMaterialsRouter } from "./modules/studymaterials/studymaterials.routes";
import { quizzesRouter } from "./modules/quizzes/quizzes.routes";
import { reservationsRouter } from "./modules/reservations/reservations.routes";
import { biometricRouter } from "./modules/biometric/biometric.routes";
import { feeRefundsRouter } from "./modules/feerefunds/feerefunds.routes";
import { pollsRouter } from "./modules/polls/polls.routes";
import { lostFoundRouter } from "./modules/lostfound/lostfound.routes";
import { frontOfficeRouter } from "./modules/frontoffice/frontoffice.routes";
import { galleryRouter } from "./modules/gallery/gallery.routes";
import { integrationsRouter } from "./modules/integrations/integrations.routes";
import { extRouter } from "./modules/ext/ext.routes";
import { brandingRouter } from "./modules/branding/branding.routes";
import { periodAttendanceRouter } from "./modules/periodattendance/periodattendance.routes";
import { timetableGenRouter } from "./modules/timetablegen/timetablegen.routes";
import { aiRouter } from "./modules/ai/ai.routes";
import { aiInsightsRouter } from "./modules/aiinsights/aiinsights.routes";
import { announcementsRouter } from "./modules/announcements/announcements.routes";
import { attendanceRouter } from "./modules/attendance/attendance.routes";
import { authRouter } from "./modules/auth/auth.routes";
import { backupsRouter } from "./modules/backups/backups.routes";
import { collegeRouter } from "./modules/college/college.routes";
import { communicationRouter } from "./modules/communication/communication.routes";
import { commAdminRouter } from "./modules/communication/commadmin.routes";
import { customReportsRouter } from "./modules/customreports/customreports.routes";
import { dashboardRouter } from "./modules/dashboard/dashboard.routes";
import { searchRouter } from "./modules/search/search.routes";
import { dataioRouter } from "./modules/dataio/dataio.routes";
import { disciplinaryRouter } from "./modules/disciplinary/disciplinary.routes";
import { documentsRouter } from "./modules/documents/documents.routes";
import { examsRouter } from "./modules/exams/exams.routes";
import { exportsRouter } from "./modules/exports/exports.routes";
import { feesRouter } from "./modules/fees/fees.routes";
import { homeworkRouter } from "./modules/homework/homework.routes";
import { liveClassesRouter } from "./modules/liveclasses/liveclasses.routes";
import { hostelRouter } from "./modules/hostel/hostel.routes";
import { inventoryRouter } from "./modules/inventory/inventory.routes";
import { jobsRouter } from "./modules/jobs/jobs.routes";
import { jobsOpsRouter } from "./modules/jobs/jobsops.routes";
import { libraryRouter } from "./modules/library/library.routes";
import { onlinePaymentsRouter } from "./modules/onlinepayments/onlinepayments.routes";
import { transportRouter } from "./modules/transport/transport.routes";
import {
  certificatesRouter,
  feeReceiptsRouter,
  idCardsRouter,
} from "./modules/pdfs/pdfs.routes";
import { payrollRouter } from "./modules/payroll/payroll.routes";
import { couponsRouter } from "./modules/billing/coupons.routes";
import { saasPaymentsWebhookRouter } from "./modules/saaspayments/saaspayments.routes";
import { platformRouter } from "./modules/platform/platform.routes";
import { platformAuditRouter } from "./modules/platform/audit.routes";
import { platformSupportRouter } from "./modules/platform/support.routes";
import { enforceSupportScope } from "./middleware/support-scope";
import { platformExtRouter } from "./modules/platform/platform-ext.routes";
import { subscriptionsRouter } from "./modules/platform/subscriptions.routes";
import {
  platformAdminsRouter,
  platformInviteAcceptRouter,
} from "./modules/platform/platform-admins.routes";
import { platformRbacRouter } from "./modules/platform/rbac.routes";
import { platformSecurityRouter } from "./modules/platform/security.routes";
import { platformSettingsRouter } from "./modules/platform/platform-settings.routes";
import { overviewRouter } from "./modules/overview/overview.routes";
import { helpRouter } from "./modules/help/help.routes";
import { tenantRouter } from "./modules/platform/tenant.routes";
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
  // Helmet with an explicit Content-Security-Policy. The API serves JSON plus
  // the (dev-only) Swagger UI, which needs inline script/style and data: images;
  // object-src 'none', base-uri 'self' and frame-ancestors 'none' are real wins
  // regardless. The web app sets its own, stricter CSP in next.config.mjs.
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'", "'unsafe-inline'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", "data:"],
          objectSrc: ["'none'"],
          baseUri: ["'self'"],
          frameAncestors: ["'none'"],
        },
      },
    })
  );
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
  // Error Explorer capture (Super Admin L): dedupes 4xx/5xx into error_events.
  // Mounted right after requestLogger so it observes the same request set.
  app.use(errorCapture);

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
  // CSRF defense-in-depth for cookie-authenticated (portal) state changes.
  // Bearer-token and server-to-server callers pass through untouched.
  api.use(csrfOriginGuard);
  api.use(auditLog);
  // Support-access scope enforcement (Super Admin G): a strict NO-OP for any token
  // without an `imp` support claim (and for missing/invalid tokens), so it cannot
  // affect existing traffic; it only gates governed support sessions.
  api.use(enforceSupportScope);
  api.use("/auth", authRouter);
  api.use("/users", usersRouter);
  api.use("/students", studentsRouter);
  api.use("/teachers", teachersRouter);
  api.use("/", academicsRouter); // /academic-years, /classes, /sections, /subjects
  api.use("/tenant-settings", settingsRouter); // unified Tenant Settings home (T1)
  api.use("/tenant-rbac", tenantRbacRouter); // per-tenant role permissions (T2)
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
  api.use("/search", searchRouter);
  api.use("/dataio", dataioRouter);
  api.use("/portal", portalRouter);
  api.use("/reports", reportsRouter);
  api.use("/report-center", reportCenterRouter);
  api.use("/custom-reports", customReportsRouter);
  api.use("/scheduled-reports", scheduledReportsRouter);
  api.use("/jobs", jobsRouter);
  api.use("/jobs-ops", jobsOpsRouter); // super-admin Background Jobs Console / Queue Governance (M)
  api.use("/comm-admin", commAdminRouter); // super-admin Communication Admin (O) — platform email/templates/broadcasts
  api.use("/disciplinary", disciplinaryRouter);
  api.use("/communication", communicationRouter);
  api.use("/documents", documentsRouter);
  api.use("/homework", homeworkRouter);
  api.use("/live-classes", liveClassesRouter);
  api.use("/fee-receipts", feeReceiptsRouter);
  api.use("/id-cards", idCardsRouter);
  api.use("/certificates", certificatesRouter);
  api.use("/ai", aiRouter);
  api.use("/ai-insights", aiInsightsRouter);
  api.use("/observability", observabilityRouter); // super-admin platform observability
  api.use("/backups", backupsRouter); // super-admin backup / restore automation
  api.use("/exports", exportsRouter); // super-admin Data Export Center (K)
  api.use("/admin", adminConsoleRouter); // super-admin platform console
  api.use("/activity", activityRouter); // institution-admin activity log (own tenant)
  api.use("/admissions", admissionsRouter); // online admissions + public enquiry
  api.use("/finance", financeRouter); // accounting: income/expense ledger
  api.use("/calendar", calendarRouter); // events & academic calendar
  api.use("/visitors", visitorsRouter); // front office: visitor log
  api.use("/feedback", feedbackRouter); // feedback / grievance tracker
  api.use("/infirmary", infirmaryRouter); // health / infirmary visit log
  api.use("/alumni", alumniRouter); // alumni & placement directory
  api.use("/cafeteria", messRouter); // cafeteria / mess menu (admin)
  api.use("/study-materials", studyMaterialsRouter); // LMS study materials (admin/teacher)
  api.use("/quizzes", quizzesRouter); // online quizzes authoring (admin/teacher)
  api.use("/reservations", reservationsRouter); // library reservations (admin)
  api.use("/biometric", biometricRouter); // biometric / RFID attendance devices
  api.use("/fee-refunds", feeRefundsRouter); // fee refunds against payments (admin)
  api.use("/polls", pollsRouter); // polls / surveys authoring (admin/teacher)
  api.use("/lost-found", lostFoundRouter); // lost & found register (front office)
  api.use("/front-office", frontOfficeRouter); // unified front office: postal/dispatch + call register + summary
  api.use("/gallery", galleryRouter); // photo gallery (admin)
  api.use("/integrations", integrationsRouter); // API keys + webhooks (admin)
  api.use("/ext", extRouter); // external read-only API, authenticated by x-api-key
  api.use("/branding", brandingRouter); // white-labeling / branding
  api.use("/period-attendance", periodAttendanceRouter); // per-period attendance (admin/teacher)
  api.use("/timetable-gen", timetableGenRouter); // timetable auto-generation (admin)
  // Settings router first: it uses per-route guards (so /runtime-status is
  // reachable by any signed-in user) and falls through unmatched paths to the
  // super-admin-guarded routers below.
  api.use("/platform", platformSettingsRouter); // global platform settings + feature flags
  // PUBLIC Razorpay webhook for SaaS-invoice payments — mounted BEFORE the
  // super-admin-guarded routers (it matches only /platform/payments/webhook, so
  // all other /platform paths fall through). Signature + idempotency are enforced
  // in the service, so no auth middleware applies to the webhook itself.
  api.use("/platform", saasPaymentsWebhookRouter);
  // PUBLIC platform-team invite acceptance (matches only /platform/invite/accept;
  // all other /platform paths fall through to the guarded routers below).
  api.use("/platform", platformInviteAcceptRouter);
  // Governed read-only external API (X-Platform-Token, scoped). Mounted BEFORE the
  // JWT-guarded platformRouter so its token auth is reached instead of authenticate.
  api.use("/platform/ext", platformExtRouter);
  // Audit Consolidation (F) owns /platform/audit/* — mounted BEFORE the platform
  // router so it supersedes the old GET /audit + /audit/export handlers there.
  api.use("/platform/audit", platformAuditRouter);
  api.use("/platform/support", platformSupportRouter); // super-admin support-access console (before the catch-all platform routers)
  api.use("/platform", platformRouter); // super-admin platform hardening
  api.use("/platform/admins", platformAdminsRouter); // super-admin platform-team management (I)
  api.use("/platform/rbac", platformRbacRouter); // super-admin RBAC roles + permission matrix (H)
  api.use("/platform/security", platformSecurityRouter); // super-admin Security & Compliance Center (P)
  api.use("/overview", overviewRouter); // super-admin Platform Overview dashboard (E) — read-only aggregator
  api.use("/help", helpRouter); // super-admin Help / SOP / Docs / Module-Status Center (Q) — read-only curated docs
  api.use("/platform", subscriptionsRouter); // super-admin subscription management (D)
  api.use("/platform", couponsRouter); // super-admin coupon / promotion management
  api.use("/platform", tenantRouter); // super-admin tenant/institution management
  api.use("/", superAdminRouter); // /institutions, /branches, /packages
  app.use("/api/v1", api);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
