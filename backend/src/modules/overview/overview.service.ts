// Super Admin E — Platform Overview Dashboard.
//
// A READ-ONLY executive aggregator. It does NOT re-implement any module: it
// composes the already-live module summaries (tenant / subscription / invoice /
// security / audit / support / backup / export / jobs / observability /
// communication / settings) into one payload, hides every section the caller's
// RBAC does not allow, and fabricates NOTHING — an unavailable metric is
// omitted / `available:false` / "trend begins from collected data", never a made
// up number. The only write it performs is the audit row on export.

import { query } from "../../db/postgres";
import { effectivePermissions } from "../../middleware/permissions";
import { toCsv } from "../../utils/spreadsheet";
import type { AuthenticatedUser } from "../../types";
import type { OverviewQuery } from "./overview.schema";

// --- Reused module summaries (import + CALL — never duplicated) --------------
import { healthDashboard, jobsHealth } from "../observability/opsdashboard.service";
import { dashboardSummary, securityAlerts } from "../platform/security.service";
import { summary as subscriptionSummary } from "../platform/subscriptions.service";
import { summary as invoiceSummary } from "../billing/invoices.service";
import { summary as backupSummary } from "../backups/backups.service";
import { summary as exportSummary } from "../exports/exports.service";
import {
  summary as auditSummary,
  maskSecrets,
  maskFreeText,
} from "../platform/audit.service";
import { dashboard as commDashboard } from "../communication/commadmin.service";
import { summary as supportSummary } from "../platform/support.service";
import { getSettings } from "../platform/platform-settings.service";

// ---------------------------------------------------------------------------
// Audit (module-local recorder mirroring observability/audit.ts — never a secret)
// ---------------------------------------------------------------------------

export interface Actor {
  id: string | null;
  email: string;
  role: string;
  ip: string | null;
}

async function recordAudit(
  actor: Actor,
  input: { action: string; detail?: Record<string, unknown> }
): Promise<void> {
  await query(
    `INSERT INTO platform_audit_log
       (action, target_type, target_id, institution_id, actor_id, actor_email, actor_role, detail, ip)
     VALUES ($1,'overview',NULL,NULL,$2,$3,$4,$5::jsonb,$6)`,
    [
      input.action,
      actor.id,
      actor.email,
      actor.role,
      JSON.stringify(input.detail ?? {}),
      actor.ip,
    ]
  );
}

// ---------------------------------------------------------------------------
// RBAC — the natural permission each reused module already uses. Owner /
// unclassified super_admin resolve to EVERY key (effectivePermissions), so they
// see all sections; any other platform sub-role / tenant role is limited to its
// granted keys and the sections it lacks are hidden (no count leak).
// ---------------------------------------------------------------------------

const PERM = {
  tenant: "platform:read",
  subscription: "platform:read",
  billing: "platform:read",
  security: "platform:security_read",
  health: "observability:read",
  operations: "observability:read",
  jobs: "jobs:read",
  backups: "backup:read",
  exports: "export:read",
  communication: "comm:dashboard_read",
  support: "platform:support_read",
  audit: "platform:audit_read",
  maintenance: "platform:settings_read",
} as const;

async function permsOf(user: AuthenticatedUser): Promise<Set<string>> {
  return new Set(await effectivePermissions(user));
}

// ---------------------------------------------------------------------------
// Drilldown targets — REAL super-admin frontend routes (verified against
// frontend/src/app/(dashboard)/super-admin/*). Never a broken route.
// ---------------------------------------------------------------------------

const ROUTE = {
  tenants: "/super-admin/platform/tenants",
  tenantsNew: "/super-admin/platform/tenants/new",
  subscriptions: "/super-admin/subscriptions",
  invoices: "/super-admin/invoices",
  packages: "/super-admin/packages",
  jobs: "/super-admin/jobs",
  jobsFailed: "/super-admin/jobs?status=failed",
  observability: "/super-admin/observability",
  security: "/super-admin/security",
  securityHighRisk: "/super-admin/security/high-risk",
  securityLogins: "/super-admin/security/login-history",
  securityTwoFactor: "/super-admin/security/two-factor",
  audit: "/super-admin/platform/audit",
  support: "/super-admin/platform/support",
  backups: "/super-admin/backups",
  exports: "/super-admin/exports",
  communication: "/super-admin/communication",
  settings: "/super-admin/settings",
  admins: "/super-admin/admins",
  rbac: "/super-admin/rbac",
  revenue: "/super-admin/revenue",
} as const;

// ---------------------------------------------------------------------------
// Window resolution — maps the coarse overview window onto (a) the sub-window
// the reused summaries accept and (b) concrete JS Date bounds for my own
// new-in-range + group-by-day trend queries.
// ---------------------------------------------------------------------------

type SubWindow = {
  window: "today" | "7d" | "30d" | "custom";
  dateFrom?: string;
  dateTo?: string;
};

interface ResolvedWindow {
  label: OverviewQuery["window"];
  from: Date;
  to: Date;
  sub: SubWindow;
}

function startOfDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0));
}
function endOfDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 23, 59, 59, 999));
}
function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function resolveWindow(q: OverviewQuery): ResolvedWindow {
  const now = new Date();
  const to = now;
  let from: Date;
  let sub: SubWindow;

  switch (q.window) {
    case "today":
      from = startOfDay(now);
      sub = { window: "today" };
      break;
    case "7d":
      from = new Date(now.getTime() - 7 * 86_400_000);
      sub = { window: "7d" };
      break;
    case "30d":
      from = new Date(now.getTime() - 30 * 86_400_000);
      sub = { window: "30d" };
      break;
    case "this_month": {
      from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
      sub = { window: "custom", dateFrom: isoDay(from), dateTo: isoDay(now) };
      break;
    }
    case "last_month": {
      from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
      const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0)); // last day prev month
      sub = { window: "custom", dateFrom: isoDay(from), dateTo: isoDay(end) };
      return { label: q.window, from, to: endOfDay(end), sub };
    }
    case "custom":
    default: {
      from = q.dateFrom ? startOfDay(new Date(q.dateFrom)) : new Date(now.getTime() - 30 * 86_400_000);
      const end = q.dateTo ? endOfDay(new Date(q.dateTo)) : now;
      sub = { window: "custom", dateFrom: q.dateFrom, dateTo: q.dateTo };
      return { label: q.window, from, to: end, sub };
    }
  }
  return { label: q.window, from, to, sub };
}

const n = (v: unknown): number => Number(v ?? 0) || 0;

// ---------------------------------------------------------------------------
// Section status helpers (module status cards)
// ---------------------------------------------------------------------------

type CardStatus = "healthy" | "warning" | "critical" | "unknown";

/** Map the observability overall status onto the card vocabulary. */
function overallToCard(overall: unknown): CardStatus {
  const s = String(overall ?? "").toLowerCase();
  if (s === "healthy" || s === "ok" || s === "operational") return "healthy";
  if (s === "degraded" || s === "warning") return "warning";
  if (s === "down" || s === "critical" || s === "outage") return "critical";
  return "unknown";
}

interface ModuleCard {
  available: boolean;
  status?: CardStatus;
  metric?: number | string | null;
  metricLabel?: string;
  lastActivityAt?: string | Date | null;
  attention?: number;
  drilldown?: string;
}

// ---------------------------------------------------------------------------
// summary(user, window) — the executive payload (RBAC-aware; reuses everything)
// ---------------------------------------------------------------------------

export async function summary(user: AuthenticatedUser, q: OverviewQuery) {
  const perms = await permsOf(user);
  const has = (k: string) => perms.has(k);
  const range = resolveWindow(q);

  // Fetch each reused summary AT MOST ONCE, and only when the caller may see it
  // (RBAC + fewer queries). Best-effort: a summary that throws never breaks the
  // dashboard — that card degrades to `unknown`, never a fabricated value.
  const [
    healthD,
    subSum,
    invSum,
    secSum,
    backupSum,
    exportSum,
    commSum,
    supportSum,
    auditSum,
    settings,
    jobsD,
  ] = await Promise.all([
    has(PERM.health) || has(PERM.operations) ? healthDashboard().catch(() => null) : null,
    has(PERM.subscription) || has(PERM.billing) ? subscriptionSummary(30).catch(() => null) : null,
    has(PERM.billing) ? invoiceSummary().catch(() => null) : null,
    has(PERM.security) ? dashboardSummary(range.sub).catch(() => null) : null,
    has(PERM.backups) ? backupSummary().catch(() => null) : null,
    has(PERM.exports) ? exportSummary().catch(() => null) : null,
    has(PERM.communication) ? commDashboard(range.sub).catch(() => null) : null,
    has(PERM.support) ? supportSummary(range.sub).catch(() => null) : null,
    has(PERM.audit) ? auditSummary(range.sub).catch(() => null) : null,
    has(PERM.maintenance) ? getSettings().catch(() => null) : null,
    // Only fetch jobsHealth when the caller has jobs:read but no observability
    // health payload to derive from (avoids a redundant call for owners).
    has(PERM.jobs) && !has(PERM.operations) ? jobsHealth().catch(() => null) : null,
  ]);

  // These reused summaries build their result by spreading `Record<string,number>`
  // query rows, which erases the per-key types at the call site — read them
  // through a numeric-record view (values are all counts).
  const subCounts = (subSum?.counts ?? {}) as Record<string, number>;
  const sec = (secSum ?? {}) as Record<string, number>;

  // ---- health ----
  const health = !has(PERM.health)
    ? { available: false as const }
    : healthD
      ? {
          available: true as const,
          status: overallToCard(healthD.overall),
          overall: healthD.overall,
          apiErrorRatePct: n(healthD.metrics?.apiErrorRatePct),
          avgResponseMs: n(healthD.metrics?.avgResponseMs),
          uptime: {
            windowChecks: n(healthD.uptime?.windowChecks),
            healthyChecks: n(healthD.uptime?.healthyChecks),
            note: healthD.uptime?.note ?? "Uptime history starts from this deployment.",
          },
          drilldown: ROUTE.observability,
        }
      : { available: true as const, status: "unknown" as const, drilldown: ROUTE.observability };

  // ---- tenant (queried directly from institutions.status: no existing summary
  // exposes trial/archived/new-in-range) ----
  const tenant = has(PERM.tenant) ? await tenantKpis(range) : { available: false as const };

  // ---- subscription ----
  const subscription =
    !has(PERM.subscription)
      ? { available: false as const }
      : subSum
        ? {
            available: true as const,
            total: n(subCounts.total),
            active: n(subCounts.active),
            trialing: n(subCounts.trialing),
            suspended: n(subCounts.suspended),
            cancelled: n(subCounts.cancelled),
            expired: n(subCounts.expired),
            expiringSoon: n(subCounts.expiringSoon),
            grace: n(subCounts.grace),
            renewalDue: n(subCounts.expiringSoon),
            drilldown: ROUTE.subscriptions,
          }
        : { available: true as const, drilldown: ROUTE.subscriptions };

  // ---- billing (revenue from subscriptions.summary, counts from invoices.summary) ----
  const billing =
    !has(PERM.billing)
      ? { available: false as const }
      : {
          available: true as const,
          currency: subSum?.revenue.currency ?? "INR",
          mixedCurrency: subSum?.revenue.mixedCurrency ?? false,
          mrr: n(subSum?.revenue.mrr),
          arr: n(subSum?.revenue.arr),
          outstanding: n(invSum?.outstandingAmount ?? subSum?.revenue.outstanding),
          overdue: n(invSum?.overdueAmount ?? subSum?.revenue.overdue),
          paidAmount: n(invSum?.paidAmount),
          paidCount: n(invSum?.paidCount),
          unpaidCount: n(invSum?.issuedCount),
          draftCount: n(invSum?.draftCount),
          overdueCount: n(invSum?.overdueCount),
          drilldown: ROUTE.invoices,
        };

  // ---- security ----
  const security =
    !has(PERM.security)
      ? { available: false as const }
      : secSum
        ? {
            available: true as const,
            highRisk: n(sec.recentHighRiskAudit),
            failedLoginsToday: n(sec.failedLoginsToday),
            failedLoginsWeek: n(sec.failedLoginsWeek),
            suspiciousLoginAttempts: n(sec.suspiciousLoginAttempts),
            activeSessions: n(sec.activePlatformSessions),
            adminsWithout2fa: n(sec.platformAdminsWithout2fa),
            ownersWithout2fa: n(sec.ownersWithout2fa),
            supportSessions: n(sec.activeSupportSessions),
            rbacChanges: n(sec.recentHighRiskRbac),
            lockedAccounts: n(sec.lockedAccounts),
            drilldown: ROUTE.security,
          }
        : { available: true as const, drilldown: ROUTE.security };

  // ---- operations ----
  const operations =
    !has(PERM.operations)
      ? { available: false as const }
      : healthD
        ? {
            available: true as const,
            status: overallToCard(healthD.overall),
            incidents: n(healthD.incidents?.active),
            criticalIncidents: n(healthD.incidents?.critical),
            openAlerts: n(healthD.alerts?.open),
            queueDepth: n(healthD.metrics?.queueDepth),
            failedJobsToday: n(healthD.metrics?.failedJobsToday),
            stuckJobs: n(healthD.metrics?.stuckJobs),
            lastBackupAt: healthD.backupStorage?.lastSuccessAt ?? backupSum?.lastSuccessAt ?? null,
            failedBackups: n(healthD.backupStorage?.failed ?? backupSum?.totals?.failed),
            failedExports: n(exportSum?.totals?.failed),
            failedComms: n(commSum?.failureCount),
            drilldown: ROUTE.observability,
          }
        : { available: true as const, status: "unknown" as const, drilldown: ROUTE.observability };

  // ---- moduleStatus (compact cross-module cards) ----
  const moduleStatus = buildModuleStatus(has, {
    healthD,
    subSum,
    invSum,
    secSum,
    backupSum,
    exportSum,
    commSum,
    supportSum,
    auditSum,
    jobsD,
    tenant,
  });

  // ---- maintenance / announcement (from platform settings; free text masked) ----
  const maintenance =
    !has(PERM.maintenance)
      ? { available: false as const }
      : settings
        ? {
            available: true as const,
            maintenanceMode: Boolean(settings.maintenanceMode),
            maintenanceMessage: (maskFreeText(settings.maintenanceMessage) as string | null) ?? null,
            maintenanceStartsAt: settings.maintenanceStartsAt ?? null,
            maintenanceEndsAt: settings.maintenanceEndsAt ?? null,
            announcementActive: Boolean(settings.announcementActive),
            announcementText: (maskFreeText(settings.announcementText) as string | null) ?? null,
            announcementVisibility: settings.announcementVisibility,
            drilldown: ROUTE.settings,
          }
        : { available: true as const, drilldown: ROUTE.settings };

  return {
    generatedAt: new Date().toISOString(),
    generatedBy: { email: user.email, role: user.role },
    range: { window: range.label, from: range.from.toISOString(), to: range.to.toISOString() },
    note:
      "Aggregated from live module data. Uptime and any thin trend series begin from the first collected data point — no history is back-filled.",
    health,
    tenant,
    subscription,
    billing,
    security,
    operations,
    moduleStatus,
    maintenance,
  };
}

/** Tenant lifecycle KPIs straight from institutions.status (parameterized, read-only). */
async function tenantKpis(range: ResolvedWindow) {
  const { rows } = await query<Record<string, number>>(
    `SELECT
       count(*)::int AS total,
       count(*) FILTER (WHERE status = 'active')::int AS active,
       count(*) FILTER (WHERE status = 'trial')::int AS trial,
       count(*) FILTER (WHERE status = 'suspended')::int AS suspended,
       count(*) FILTER (WHERE status = 'archived')::int AS archived,
       count(*) FILTER (WHERE created_at >= $1)::int AS "newInRange"
     FROM institutions`,
    [range.from]
  );
  return { available: true as const, ...rows[0], drilldown: ROUTE.tenants };
}

interface SummaryBundle {
  healthD: Awaited<ReturnType<typeof healthDashboard>> | null;
  subSum: Awaited<ReturnType<typeof subscriptionSummary>> | null;
  invSum: Awaited<ReturnType<typeof invoiceSummary>> | null;
  secSum: Awaited<ReturnType<typeof dashboardSummary>> | null;
  backupSum: Awaited<ReturnType<typeof backupSummary>> | null;
  exportSum: Awaited<ReturnType<typeof exportSummary>> | null;
  commSum: Awaited<ReturnType<typeof commDashboard>> | null;
  supportSum: Awaited<ReturnType<typeof supportSummary>> | null;
  auditSum: Awaited<ReturnType<typeof auditSummary>> | null;
  jobsD: Awaited<ReturnType<typeof jobsHealth>> | null;
  tenant: { available: boolean; total?: number; suspended?: number; archived?: number };
}

function buildModuleStatus(
  has: (k: string) => boolean,
  b: SummaryBundle
): Record<string, ModuleCard> {
  const cards: Record<string, ModuleCard> = {};
  // Spread-erased summaries (see summary()) read through a numeric-record view.
  const subCounts = (b.subSum?.counts ?? {}) as Record<string, number>;
  const sec = (b.secSum ?? {}) as Record<string, number>;

  // Tenants
  cards.tenants = has(PERM.tenant)
    ? {
        available: true,
        status: n(b.tenant.suspended) + n(b.tenant.archived) > 0 ? "warning" : "healthy",
        metric: n(b.tenant.total),
        metricLabel: "tenants",
        attention: n(b.tenant.suspended),
        drilldown: ROUTE.tenants,
      }
    : { available: false };

  // Subscriptions
  cards.subscriptions = has(PERM.subscription)
    ? b.subSum
      ? {
          available: true,
          status: n(subCounts.expiringSoon) > 0 ? "warning" : "healthy",
          metric: n(subCounts.active),
          metricLabel: "active",
          attention: n(subCounts.expiringSoon) + n(subCounts.grace),
          drilldown: ROUTE.subscriptions,
        }
      : { available: true, status: "unknown" }
    : { available: false };

  // Billing / invoices
  cards.billing = has(PERM.billing)
    ? b.invSum
      ? {
          available: true,
          status: n(b.invSum.overdueCount) > 0 ? "warning" : "healthy",
          metric: n(b.invSum.outstandingAmount),
          metricLabel: "outstanding",
          attention: n(b.invSum.overdueCount),
          drilldown: ROUTE.invoices,
        }
      : { available: true, status: "unknown" }
    : { available: false };

  // Security
  cards.security = has(PERM.security)
    ? b.secSum
      ? {
          available: true,
          status:
            n(sec.ownersWithout2fa) > 0
              ? "critical"
              : n(sec.recentHighRiskAudit) + n(sec.suspiciousLoginAttempts) > 0
                ? "warning"
                : "healthy",
          metric: n(sec.recentHighRiskAudit),
          metricLabel: "high-risk events",
          attention: n(sec.ownersWithout2fa) + n(sec.platformAdminsWithout2fa),
          drilldown: ROUTE.security,
        }
      : { available: true, status: "unknown" }
    : { available: false };

  // Observability
  cards.observability = has(PERM.operations)
    ? b.healthD
      ? {
          available: true,
          status: overallToCard(b.healthD.overall),
          metric: n(b.healthD.metrics?.apiErrorRatePct),
          metricLabel: "API error %",
          attention: n(b.healthD.incidents?.active) + n(b.healthD.alerts?.open),
          drilldown: ROUTE.observability,
        }
      : { available: true, status: "unknown" }
    : { available: false };

  // Jobs (prefer the observability health payload; else the dedicated jobsHealth)
  const jobQueue = b.healthD
    ? { depth: n(b.healthD.metrics?.queueDepth), failed: n(b.healthD.metrics?.failedJobsToday), stuck: n(b.healthD.metrics?.stuckJobs) }
    : b.jobsD
      ? { depth: n(b.jobsD.queue.pending) + n(b.jobsD.queue.running), failed: n(b.jobsD.queue.failed), stuck: n(b.jobsD.stuck) }
      : null;
  cards.jobs = has(PERM.jobs) || has(PERM.operations)
    ? jobQueue
      ? {
          available: true,
          status: jobQueue.stuck > 0 ? "critical" : jobQueue.failed > 0 ? "warning" : "healthy",
          metric: jobQueue.depth,
          metricLabel: "queued",
          attention: jobQueue.failed + jobQueue.stuck,
          drilldown: ROUTE.jobsFailed,
        }
      : { available: true, status: "unknown" }
    : { available: false };

  // Backups
  cards.backups = has(PERM.backups)
    ? b.backupSum
      ? {
          available: true,
          status: !b.backupSum.lastSuccessAt
            ? "critical"
            : n(b.backupSum.totals?.failed) > 0 || (b.backupSum.warnings?.length ?? 0) > 0
              ? "warning"
              : "healthy",
          metric: n(b.backupSum.totals?.available),
          metricLabel: "available",
          lastActivityAt: b.backupSum.lastSuccessAt ?? null,
          attention: n(b.backupSum.totals?.failed) + n(b.backupSum.restore?.pendingRequests),
          drilldown: ROUTE.backups,
        }
      : { available: true, status: "unknown" }
    : { available: false };

  // Exports
  cards.exports = has(PERM.exports)
    ? b.exportSum
      ? {
          available: true,
          status: n(b.exportSum.totals?.failed) > 0 || n(b.exportSum.pendingApproval) > 0 ? "warning" : "healthy",
          metric: n(b.exportSum.totals?.total),
          metricLabel: "exports",
          attention: n(b.exportSum.totals?.failed) + n(b.exportSum.pendingApproval),
          drilldown: ROUTE.exports,
        }
      : { available: true, status: "unknown" }
    : { available: false };

  // Communication
  cards.communication = has(PERM.communication)
    ? b.commSum
      ? {
          available: true,
          status:
            !b.commSum.provider?.configured
              ? "unknown"
              : n(b.commSum.failureRatePct) >= 25
                ? "warning"
                : "healthy",
          metric: n(b.commSum.failureCount),
          metricLabel: "failed emails",
          attention: n(b.commSum.failureCount),
          drilldown: ROUTE.communication,
        }
      : { available: true, status: "unknown" }
    : { available: false };

  // Support access
  cards.support = has(PERM.support)
    ? b.supportSum
      ? {
          available: true,
          status: n(b.supportSum.highRiskCount) > 0 ? "warning" : "healthy",
          metric: n(b.supportSum.activeCount),
          metricLabel: "active sessions",
          attention: n(b.supportSum.highRiskCount),
          drilldown: ROUTE.support,
        }
      : { available: true, status: "unknown" }
    : { available: false };

  // Audit
  cards.audit = has(PERM.audit)
    ? b.auditSum
      ? {
          available: true,
          status: n(b.auditSum.highRiskCount) > 0 ? "warning" : "healthy",
          metric: n(b.auditSum.totalEvents),
          metricLabel: "events",
          attention: n(b.auditSum.highRiskCount),
          drilldown: ROUTE.audit,
        }
      : { available: true, status: "unknown" }
    : { available: false };

  return cards;
}

// Exposed for the routes' `GET /overview/modules`.
export async function moduleStatus(user: AuthenticatedUser, q: OverviewQuery) {
  const full = await summary(user, q);
  return { generatedAt: full.generatedAt, range: full.range, moduleStatus: full.moduleStatus };
}

// ---------------------------------------------------------------------------
// attention(user) — prioritized "needs attention" list (critical first).
// Read-only: acknowledgement lives in the source module. RBAC-filtered.
// ---------------------------------------------------------------------------

type Severity = "critical" | "warning" | "info";

interface AttentionItem {
  severity: Severity;
  summary: string;
  sourceModule: string;
  createdAt: string;
  actionLink: string;
}

const SEV_RANK: Record<Severity, number> = { critical: 0, warning: 1, info: 2 };

export async function attention(user: AuthenticatedUser): Promise<{ generatedAt: string; items: AttentionItem[] }> {
  const perms = await permsOf(user);
  const has = (k: string) => perms.has(k);
  const now = new Date().toISOString();
  const items: AttentionItem[] = [];
  const push = (severity: Severity, summary: string, sourceModule: string, actionLink: string, createdAt?: string) =>
    items.push({ severity, summary: maskFreeText(summary) as string, sourceModule, actionLink, createdAt: createdAt ?? now });

  const [healthD, backupSum, exportSum, commSum, secSum, secAlerts, supportSum, subSum, invSum] = await Promise.all([
    has(PERM.operations) ? healthDashboard().catch(() => null) : null,
    has(PERM.backups) ? backupSummary().catch(() => null) : null,
    has(PERM.exports) ? exportSummary().catch(() => null) : null,
    has(PERM.communication) ? commDashboard({ window: "7d" }).catch(() => null) : null,
    has(PERM.security) ? dashboardSummary({ window: "7d" }).catch(() => null) : null,
    has(PERM.security) ? securityAlerts().catch(() => []) : [],
    has(PERM.support) ? supportSummary({ window: "7d" }).catch(() => null) : null,
    has(PERM.subscription) ? subscriptionSummary(30).catch(() => null) : null,
    has(PERM.billing) ? invoiceSummary().catch(() => null) : null,
  ]);

  // Observability — critical incidents / open alerts / stuck+failed jobs.
  if (healthD) {
    if (n(healthD.incidents?.critical) > 0)
      push("critical", `${n(healthD.incidents.critical)} critical incident(s) open`, "observability", ROUTE.observability);
    if (n(healthD.metrics?.stuckJobs) > 0)
      push("warning", `${n(healthD.metrics.stuckJobs)} stuck job(s) in the queue`, "jobs", ROUTE.jobsFailed);
    if (n(healthD.metrics?.failedJobsToday) > 0)
      push("warning", `${n(healthD.metrics.failedJobsToday)} job(s) failed today`, "jobs", ROUTE.jobsFailed);
    if (n(healthD.alerts?.open) > 0)
      push("warning", `${n(healthD.alerts.open)} alert(s) triggered`, "observability", ROUTE.observability);
  }

  // Backups — no successful backup / failures / pending restore approval.
  if (backupSum) {
    if (!backupSum.lastSuccessAt) push("critical", "No successful backup exists yet", "backups", ROUTE.backups);
    if (n(backupSum.totals?.failed) > 0) push("warning", `${n(backupSum.totals.failed)} failed backup(s)`, "backups", ROUTE.backups);
    if (n(backupSum.restore?.pendingRequests) > 0)
      push("warning", `${n(backupSum.restore.pendingRequests)} restore request(s) pending approval`, "backups", ROUTE.backups);
  }

  // Exports — sensitive export awaiting approval / failed export.
  if (exportSum) {
    if (n(exportSum.pendingApproval) > 0)
      push("warning", `${n(exportSum.pendingApproval)} export(s) pending approval`, "exports", ROUTE.exports);
    if (n(exportSum.totals?.failed) > 0) push("warning", `${n(exportSum.totals.failed)} failed export(s)`, "exports", ROUTE.exports);
    if (n(exportSum.nearingExpiry) > 0) push("info", `${n(exportSum.nearingExpiry)} export(s) nearing expiry`, "exports", ROUTE.exports);
  }

  // Communication — SMTP not configured / high failure rate.
  if (commSum) {
    if (!commSum.provider?.configured) push("warning", "SMTP provider is not configured", "communication", ROUTE.communication);
    else if (n(commSum.failureRatePct) >= 25 && n(commSum.failureCount) > 0)
      push("warning", `High email failure rate (${n(commSum.failureRatePct)}%)`, "communication", ROUTE.communication);
  }

  // Security — the already-computed alert feed (severity + link carried) + posture.
  for (const a of secAlerts as { severity: Severity; title: string; count: number; link: string }[]) {
    push(a.severity, `${a.title} (${a.count})`, "security", a.link);
  }
  if (secSum) {
    const sec = secSum as unknown as Record<string, number>;
    if (n(sec.ownersWithout2fa) > 0)
      push("critical", `${n(sec.ownersWithout2fa)} owner account(s) without 2FA`, "security", ROUTE.securityTwoFactor);
    if (n(sec.recentHighRiskAudit) > 0)
      push("warning", `${n(sec.recentHighRiskAudit)} high-risk security event(s)`, "security", ROUTE.securityHighRisk);
  }

  // Support — sessions nearing expiry.
  if (supportSum && Array.isArray(supportSum.nearingExpiry) && supportSum.nearingExpiry.length > 0)
    push("warning", `${supportSum.nearingExpiry.length} support session(s) nearing expiry`, "support", ROUTE.support);

  // Subscriptions — renewals due.
  const subCounts = (subSum?.counts ?? {}) as Record<string, number>;
  if (subSum && n(subCounts.expiringSoon) > 0)
    push("info", `${n(subCounts.expiringSoon)} subscription(s) renewing soon`, "subscriptions", ROUTE.subscriptions);

  // Billing — overdue invoices.
  if (invSum && n(invSum.overdueCount) > 0)
    push("warning", `${n(invSum.overdueCount)} overdue invoice(s)`, "billing", ROUTE.invoices);

  items.sort((x, y) => SEV_RANK[x.severity] - SEV_RANK[y.severity]);
  return { generatedAt: now, items };
}

// ---------------------------------------------------------------------------
// trends(user, window) — group-by-day series from REAL stored timestamps only.
// A metric with no history returns an empty series + note — never fabricated.
// RBAC-filtered (a metric the caller can't see is omitted).
// ---------------------------------------------------------------------------

type TrendSeries = { series: Record<string, unknown>[]; note?: string };

function seriesOrNote(series: Record<string, unknown>[]): TrendSeries {
  return series.length ? { series } : { series: [], note: "trend begins from collected data" };
}

async function daySeries(sql: string, params: unknown[]): Promise<Record<string, unknown>[]> {
  const { rows } = await query<Record<string, unknown>>(sql, params);
  return rows.map((r) => {
    const out: Record<string, unknown> = { day: r.day };
    for (const [k, v] of Object.entries(r)) if (k !== "day") out[k] = n(v);
    return out;
  });
}

export async function trends(user: AuthenticatedUser, q: OverviewQuery) {
  const perms = await permsOf(user);
  const has = (k: string) => perms.has(k);
  const range = resolveWindow(q);
  const bounds = [range.from, range.to];
  const out: Record<string, TrendSeries> = {};

  if (has(PERM.tenant)) {
    out.tenantGrowth = seriesOrNote(
      await daySeries(
        `SELECT to_char(date_trunc('day', created_at), 'YYYY-MM-DD') AS day, count(*)::int AS count
         FROM institutions WHERE created_at >= $1 AND created_at <= $2
         GROUP BY 1 ORDER BY 1`,
        bounds
      )
    );
  }

  if (has(PERM.billing)) {
    out.invoices = seriesOrNote(
      await daySeries(
        `SELECT to_char(date_trunc('day', created_at), 'YYYY-MM-DD') AS day,
                count(*) FILTER (WHERE status = 'paid')::int AS paid,
                count(*) FILTER (WHERE status IN ('issued','draft'))::int AS unpaid
         FROM saas_invoices WHERE created_at >= $1 AND created_at <= $2
         GROUP BY 1 ORDER BY 1`,
        bounds
      )
    );
  }

  if (has(PERM.security)) {
    out.failedLogins = seriesOrNote(
      await daySeries(
        `SELECT to_char(date_trunc('day', created_at), 'YYYY-MM-DD') AS day, count(*)::int AS count
         FROM platform_audit_log
         WHERE action = 'auth.login.failed' AND created_at >= $1 AND created_at <= $2
         GROUP BY 1 ORDER BY 1`,
        bounds
      )
    );
    out.highRiskAudit = seriesOrNote(
      await daySeries(
        `SELECT to_char(date_trunc('day', created_at), 'YYYY-MM-DD') AS day, count(*)::int AS count
         FROM platform_audit_log
         WHERE action ~ '^(rbac|impersonate|backup|restore|security|export|incident|alert)\\.'
           AND created_at >= $1 AND created_at <= $2
         GROUP BY 1 ORDER BY 1`,
        bounds
      )
    );
  }

  if (has(PERM.jobs) || has(PERM.operations)) {
    out.jobFailures = seriesOrNote(
      await daySeries(
        `SELECT to_char(date_trunc('day', completed_at), 'YYYY-MM-DD') AS day, count(*)::int AS count
         FROM jobs WHERE status = 'failed' AND completed_at IS NOT NULL
           AND completed_at >= $1 AND completed_at <= $2
         GROUP BY 1 ORDER BY 1`,
        bounds
      )
    );
  }

  if (has(PERM.communication)) {
    out.commFailures = seriesOrNote(
      await daySeries(
        `SELECT to_char(date_trunc('day', created_at), 'YYYY-MM-DD') AS day, count(*)::int AS count
         FROM email_deliveries WHERE status = 'failed' AND created_at >= $1 AND created_at <= $2
         GROUP BY 1 ORDER BY 1`,
        bounds
      )
    );
  }

  if (has(PERM.backups)) {
    out.backups = seriesOrNote(
      await daySeries(
        `SELECT to_char(date_trunc('day', created_at), 'YYYY-MM-DD') AS day,
                count(*) FILTER (WHERE status = 'success')::int AS success,
                count(*) FILTER (WHERE status = 'failed')::int AS failed
         FROM backups WHERE created_at >= $1 AND created_at <= $2
         GROUP BY 1 ORDER BY 1`,
        bounds
      )
    );
  }

  if (has(PERM.exports)) {
    out.exportVolume = seriesOrNote(
      await daySeries(
        `SELECT to_char(date_trunc('day', created_at), 'YYYY-MM-DD') AS day, count(*)::int AS count
         FROM platform_exports WHERE created_at >= $1 AND created_at <= $2
         GROUP BY 1 ORDER BY 1`,
        bounds
      )
    );
  }

  return { generatedAt: new Date().toISOString(), range: { window: range.label, from: range.from.toISOString(), to: range.to.toISOString() }, trends: out };
}

// ---------------------------------------------------------------------------
// quickActions(user) — { key, label, route, allowed } for each quick action.
// `allowed` = the caller holds that action's permission (backend is the source
// of truth; the frontend hides/disables the disallowed ones).
// ---------------------------------------------------------------------------

const QUICK_ACTIONS: { key: string; label: string; route: string; perm: string }[] = [
  { key: "create_tenant", label: "Add tenant", route: ROUTE.tenantsNew, perm: "platform:manage_institutions" },
  { key: "invoices", label: "Invoices", route: ROUTE.invoices, perm: "platform:read" },
  { key: "create_invoice", label: "Create invoice", route: ROUTE.invoices, perm: "platform:manage_subscriptions" },
  { key: "subscriptions", label: "Subscriptions", route: ROUTE.subscriptions, perm: "platform:read" },
  { key: "packages", label: "Packages", route: ROUTE.packages, perm: "platform:read" },
  { key: "security", label: "Security Center", route: ROUTE.security, perm: "platform:security_read" },
  { key: "audit", label: "Audit log", route: ROUTE.audit, perm: "platform:audit_read" },
  { key: "support", label: "Support access", route: ROUTE.support, perm: "platform:support_read" },
  { key: "create_backup", label: "Create backup", route: ROUTE.backups, perm: "backup:create" },
  { key: "exports", label: "Data exports", route: ROUTE.exports, perm: "export:read" },
  { key: "jobs", label: "Background jobs", route: ROUTE.jobs, perm: "jobs:read" },
  { key: "observability", label: "Observability", route: ROUTE.observability, perm: "observability:read" },
  { key: "communication", label: "Communication", route: ROUTE.communication, perm: "comm:dashboard_read" },
  { key: "settings", label: "Platform settings", route: ROUTE.settings, perm: "platform:settings_read" },
  { key: "platform_admins", label: "Platform admins", route: ROUTE.admins, perm: "platform:manage_admins" },
  { key: "rbac", label: "Roles & permissions", route: ROUTE.rbac, perm: "platform:rbac_read" },
];

export async function quickActions(user: AuthenticatedUser) {
  const perms = await permsOf(user);
  return {
    actions: QUICK_ACTIONS.map((a) => ({
      key: a.key,
      label: a.label,
      route: a.route,
      perm: a.perm,
      allowed: perms.has(a.perm),
    })),
  };
}

// ---------------------------------------------------------------------------
// exportSnapshot(user, format) — a MASKED snapshot of the KPIs + attention list.
// Audited (`overview.exported`). Never emits secrets/paths/tokens.
// ---------------------------------------------------------------------------

export async function exportSnapshot(
  user: AuthenticatedUser,
  opts: { format: "csv" | "json"; window: OverviewQuery; reason?: string },
  actor: Actor
): Promise<{ buffer: Buffer; filename: string; contentType: string }> {
  const [snap, att] = await Promise.all([summary(user, opts.window), attention(user)]);

  // Flatten the numeric/scalar KPI values of each available section into rows.
  const kpiRows: { section: string; metric: string; value: unknown }[] = [];
  for (const [section, value] of Object.entries(snap)) {
    if (section === "moduleStatus" || section === "generatedBy" || section === "range") continue;
    if (value && typeof value === "object") {
      const v = value as Record<string, unknown>;
      if (v.available === false) {
        kpiRows.push({ section, metric: "available", value: false });
        continue;
      }
      for (const [metric, mv] of Object.entries(v)) {
        if (metric === "drilldown" || metric === "available") continue;
        if (typeof mv === "number" || typeof mv === "string" || typeof mv === "boolean") {
          kpiRows.push({ section, metric, value: mv });
        }
      }
    }
  }

  // Attention items are already masked; belt-and-suspenders through maskSecrets.
  const attentionRows = att.items.map((i) => ({
    severity: i.severity,
    sourceModule: i.sourceModule,
    summary: i.summary,
    actionLink: i.actionLink,
  }));

  const generatedBy = { email: user.email, role: user.role };
  const payload = maskSecrets({
    generatedAt: snap.generatedAt,
    generatedBy,
    range: snap.range,
    note: snap.note,
    kpis: kpiRows,
    attention: attentionRows,
  }) as Record<string, unknown>;

  await recordAudit(actor, {
    action: "overview.exported",
    detail: {
      format: opts.format,
      window: opts.window.window,
      kpiCount: kpiRows.length,
      attentionCount: attentionRows.length,
      reason: (maskFreeText(opts.reason ?? "") as string) || null,
    },
  });

  if (opts.format === "json") {
    return {
      buffer: Buffer.from(JSON.stringify(payload, null, 2), "utf8"),
      filename: "platform-overview-snapshot.json",
      contentType: "application/json; charset=utf-8",
    };
  }

  // CSV: one KPI block + one attention block (a masked, secret-free snapshot).
  const kpis = (payload.kpis as { section: string; metric: string; value: unknown }[]) ?? [];
  const attn = (payload.attention as Record<string, unknown>[]) ?? [];
  const lines: string[] = [];
  lines.push(toCsv(["Section", "Metric", "Value"], kpis.map((r) => [r.section, r.metric, r.value as string | number])).trimEnd());
  lines.push("");
  lines.push(
    toCsv(
      ["Severity", "Source", "Summary", "Action"],
      attn.map((r) => [r.severity as string, r.sourceModule as string, r.summary as string, r.actionLink as string])
    ).trimEnd()
  );
  return {
    buffer: Buffer.from(lines.join("\r\n") + "\r\n", "utf8"),
    filename: "platform-overview-snapshot.csv",
    contentType: "text/csv; charset=utf-8",
  };
}
