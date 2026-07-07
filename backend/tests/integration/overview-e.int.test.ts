import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { app, createInstitution, createUser, query, resetDb, tokenFor } from "./helpers";
import { invalidatePermissionCache, invalidatePlatformRoleCache } from "../../src/middleware/permissions";

const PW = "Passw0rd!";
// A secret-shaped token seeded into a delivery failure reason + a platform
// announcement — it (and its gateway prefix) must NEVER reach any overview
// response or the masked export.
const SENTINEL = "SUPERSECRET1234567890";
const SECRET_RE = new RegExp(`${SENTINEL}|whsec_|sk_live|smtpPass|smtpUser|password_hash`, "i");

describe("Super Admin E — Platform Overview Dashboard", () => {
  const tok: Record<string, string> = {};
  let inst: string;

  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const get = (p: string, t: string) => request(app).get(p).set(auth(t));

  async function auditCount(action: string): Promise<number> {
    const { rows } = await query<{ n: number }>(
      `SELECT count(*)::int AS n FROM platform_audit_log WHERE action = $1`,
      [action]
    );
    return Number(rows[0].n);
  }

  beforeEach(async () => {
    await resetDb();

    // --- Users -------------------------------------------------------------
    // Full-access owner (platform_role NULL → sees everything).
    await createUser({ email: "root@e.dev", password: PW, role: "super_admin", institutionId: null });
    tok.root = await tokenFor("root@e.dev", PW);

    // Restricted platform sub-role: a custom role granted ONLY overview:read +
    // platform:read (so it can view the surface + tenant/subscription/billing,
    // but NOT security/observability/backup/export/jobs/comm/settings sections,
    // and NOT export).
    await createUser({ email: "limited@e.dev", password: PW, role: "super_admin", institutionId: null });
    await query(`UPDATE users SET platform_role = 'e2e_limited' WHERE email = 'limited@e.dev'`);
    await query(
      `INSERT INTO role_permissions (role, permission_id)
       SELECT 'e2e_limited', id FROM permissions WHERE key IN ('overview:read','platform:read')
       ON CONFLICT (role, permission_id) DO NOTHING`
    );
    invalidatePermissionCache();
    invalidatePlatformRoleCache();
    tok.limited = await tokenFor("limited@e.dev", PW);

    inst = await createInstitution("EOVR", "school");
    await createUser({ email: "admin@e.dev", password: PW, role: "admin", institutionId: inst });
    tok.tenant = await tokenFor("admin@e.dev", PW);
    await createUser({ email: "stud@e.dev", password: PW, role: "student", institutionId: inst });
    tok.user = await tokenFor("stud@e.dev", PW);

    // --- Tenant lifecycle spread (institutions.status) --------------------
    await query(
      `INSERT INTO institutions (name, code, type, status, is_active) VALUES
         ('Suspended Co','ESUS','school','suspended',false),
         ('Trial Co','ETRI','school','trial',true)`
    );

    // --- Cross-module data ------------------------------------------------
    // A package + an active subscription.
    const pkg = (
      await query<{ id: string }>(
        `INSERT INTO subscription_packages (name, price, billing_cycle, currency)
         VALUES ('E Plan', 1200, 'monthly', 'INR') RETURNING id`
      )
    ).rows[0].id;
    await query(
      `INSERT INTO institution_subscriptions (institution_id, package_id, status)
       VALUES ($1, $2, 'active')`,
      [inst, pkg]
    );

    // An overdue (issued) invoice + a paid invoice.
    await query(
      `INSERT INTO saas_invoices (institution_id, number, status, total, due_date)
       VALUES ($1, 'SINV-E-1', 'issued', 1000, CURRENT_DATE - 5)`,
      [inst]
    );
    await query(
      `INSERT INTO saas_invoices (institution_id, number, status, total, issued_at)
       VALUES ($1, 'SINV-E-2', 'paid', 500, now())`,
      [inst]
    );

    // A failed job (today).
    await query(`INSERT INTO jobs (type, status, completed_at) VALUES ('e2e_test', 'failed', now())`);

    // A failed email delivery carrying a secret-shaped failure reason.
    await query(
      `INSERT INTO email_deliveries (template_key, category, subject, recipient, institution_id, trigger_source, status, failure_reason)
       VALUES ('x','support','S','a@b.co',$1,'support','failed',$2)`,
      [inst, `SMTP whsec_${SENTINEL} rejected`]
    );

    // A high-risk audit row + a failed login (for security KPIs + trends).
    await query(
      `INSERT INTO platform_audit_log (action, target_type, actor_email, actor_role)
       VALUES ('rbac.grant','role_permission','root@e.dev','super_admin')`
    );
    await query(
      `INSERT INTO platform_audit_log (action, target_type, ip) VALUES ('auth.login.failed','auth','1.2.3.4')`
    );

    // A successful backup + a critical incident (guarantees a critical attention item).
    await query(`INSERT INTO backups (status, completed_at, size_bytes) VALUES ('success', now(), 12345)`);
    await query(`INSERT INTO incidents (title, severity, status) VALUES ('E2E outage','critical','open')`);

    // A platform announcement carrying a secret-shaped token (must be masked).
    await query(`INSERT INTO platform_settings (id) VALUES (TRUE) ON CONFLICT (id) DO NOTHING`);
    await query(
      `UPDATE platform_settings
         SET announcement_active = true,
             announcement_text = $1,
             maintenance_mode = true,
             maintenance_message = 'Planned window'
       WHERE id = TRUE`,
      [`Notice token whsec_${SENTINEL} do-not-share`]
    );
  });

  // ---- summary --------------------------------------------------------------

  it("serves the executive summary with REAL KPI values and no secrets", async () => {
    const res = await get("/api/v1/overview/summary", tok.root);
    expect(res.status).toBe(200);
    expect(res.body.generatedAt).toBeTruthy();
    expect(res.body.range.window).toBe("30d");
    expect(res.body.note).toMatch(/collected data|no history/i);

    // Tenant KPIs from institutions.status (inst active + suspended + trial).
    expect(res.body.tenant.available).toBe(true);
    expect(res.body.tenant.total).toBeGreaterThanOrEqual(3);
    expect(res.body.tenant.suspended).toBeGreaterThanOrEqual(1);
    expect(res.body.tenant.trial).toBeGreaterThanOrEqual(1);

    // Subscription + billing KPIs match seeded rows.
    expect(res.body.subscription.available).toBe(true);
    expect(res.body.subscription.active).toBeGreaterThanOrEqual(1);
    expect(res.body.billing.available).toBe(true);
    expect(res.body.billing.overdueCount).toBeGreaterThanOrEqual(1);
    expect(res.body.billing.paidCount).toBeGreaterThanOrEqual(1);

    // The announcement's secret token is masked; nothing secret leaks anywhere.
    expect(res.body.maintenance.available).toBe(true);
    expect(res.body.maintenance.announcementText).not.toMatch(SECRET_RE);
    expect(JSON.stringify(res.body)).not.toMatch(SECRET_RE);
  });

  it("integrates every module KPI section + cross-module status cards", async () => {
    const res = await get("/api/v1/overview/summary", tok.root);
    expect(res.status).toBe(200);
    // Top-level sections.
    for (const k of ["health", "tenant", "subscription", "billing", "security", "operations", "moduleStatus", "maintenance"]) {
      expect(res.body[k]).toBeDefined();
    }
    // Module status cards for each completed module.
    for (const k of ["tenants", "subscriptions", "billing", "security", "observability", "jobs", "backups", "exports", "communication", "support", "audit"]) {
      expect(res.body.moduleStatus[k]).toBeDefined();
    }
    // Drilldowns point at REAL super-admin routes.
    expect(res.body.tenant.drilldown).toBe("/super-admin/platform/tenants");
    expect(res.body.billing.drilldown).toBe("/super-admin/invoices");
    expect(res.body.moduleStatus.jobs.drilldown).toMatch(/^\/super-admin\/jobs/);
    // Security section carries KPI keys for the owner.
    expect(res.body.security.available).toBe(true);
    expect(typeof res.body.security.highRisk).toBe("number");
    expect(typeof res.body.operations.failedJobsToday).toBe("number");
  });

  // ---- RBAC section hiding --------------------------------------------------

  it("hides sections the restricted sub-role lacks perms for (no count leak)", async () => {
    const res = await get("/api/v1/overview/summary", tok.limited);
    expect(res.status).toBe(200); // has overview:read

    // Visible (platform:read): tenant / subscription / billing.
    expect(res.body.tenant.available).toBe(true);
    expect(res.body.tenant.total).toBeGreaterThanOrEqual(3);
    expect(res.body.subscription.available).toBe(true);
    expect(res.body.billing.available).toBe(true);

    // Hidden (no observability:read / security_read / settings_read): the
    // sections are available:false and DO NOT carry their counts.
    expect(res.body.security.available).toBe(false);
    expect(res.body.security.highRisk).toBeUndefined();
    expect(res.body.security.failedLoginsToday).toBeUndefined();
    expect(res.body.operations.available).toBe(false);
    expect(res.body.operations.failedJobsToday).toBeUndefined();
    expect(res.body.health.available).toBe(false);
    expect(res.body.maintenance.available).toBe(false);
    expect(res.body.maintenance.announcementText).toBeUndefined();

    // Hidden module-status cards are available:false too (no metric).
    expect(res.body.moduleStatus.security.available).toBe(false);
    expect(res.body.moduleStatus.security.metric).toBeUndefined();
    expect(res.body.moduleStatus.tenants.available).toBe(true);
  });

  it("403s tenant admins and plain users on the whole /overview surface", async () => {
    for (const t of [tok.tenant, tok.user]) {
      for (const p of [
        "/api/v1/overview/summary",
        "/api/v1/overview/attention",
        "/api/v1/overview/trends",
        "/api/v1/overview/quick-actions",
        "/api/v1/overview/modules",
      ]) {
        expect((await get(p, t)).status).toBe(403);
      }
    }
  });

  // ---- attention ------------------------------------------------------------

  it("returns a prioritized attention list (critical first) with real sources", async () => {
    const res = await get("/api/v1/overview/attention", tok.root);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.items)).toBe(true);
    expect(res.body.items.length).toBeGreaterThan(0);
    // The seeded critical incident bubbles to the top.
    expect(res.body.items[0].severity).toBe("critical");
    const rank: Record<string, number> = { critical: 0, warning: 1, info: 2 };
    for (let i = 1; i < res.body.items.length; i++) {
      expect(rank[res.body.items[i].severity]).toBeGreaterThanOrEqual(rank[res.body.items[i - 1].severity]);
    }
    // Every item carries a source module + a real action link.
    for (const it of res.body.items) {
      expect(it.sourceModule).toBeTruthy();
      expect(it.actionLink).toMatch(/^\/super-admin\//);
    }
    expect(JSON.stringify(res.body)).not.toMatch(SECRET_RE);
  });

  it("RBAC-filters the attention list for a restricted sub-role", async () => {
    const res = await get("/api/v1/overview/attention", tok.limited);
    expect(res.status).toBe(200);
    // Only billing/subscription items (platform:read); NEVER an observability /
    // security / backup item the caller can't see.
    for (const it of res.body.items) {
      expect(["billing", "subscriptions"]).toContain(it.sourceModule);
    }
    expect(res.body.items.some((i: { sourceModule: string }) => i.sourceModule === "observability")).toBe(false);
    expect(res.body.items.some((i: { sourceModule: string }) => i.sourceModule === "security")).toBe(false);
  });

  // ---- trends ---------------------------------------------------------------

  it("computes trends from real timestamps and NEVER fabricates history", async () => {
    const res = await get("/api/v1/overview/trends", tok.root);
    expect(res.status).toBe(200);
    const t = res.body.trends;

    // Seeded metrics have real points.
    expect(t.tenantGrowth.series.length).toBeGreaterThanOrEqual(1);
    expect(t.invoices.series.length).toBeGreaterThanOrEqual(1);
    expect(t.failedLogins.series.length).toBeGreaterThanOrEqual(1);

    // A metric with NO seeded history (no platform_exports) → empty series + the
    // "begins from collected data" note. Not a fabricated point.
    expect(t.exportVolume.series).toEqual([]);
    expect(t.exportVolume.note).toMatch(/begins from collected data/i);
  });

  it("RBAC-filters trend metrics for a restricted sub-role", async () => {
    const res = await get("/api/v1/overview/trends", tok.limited);
    expect(res.status).toBe(200);
    const t = res.body.trends;
    // Visible (platform:read).
    expect(t.tenantGrowth).toBeDefined();
    expect(t.invoices).toBeDefined();
    // Hidden — the caller lacks security / jobs / export perms.
    expect(t.failedLogins).toBeUndefined();
    expect(t.jobFailures).toBeUndefined();
    expect(t.exportVolume).toBeUndefined();
  });

  // ---- quick actions --------------------------------------------------------

  it("returns quick-actions with allowed flags from RBAC (owner = all allowed)", async () => {
    const res = await get("/api/v1/overview/quick-actions", tok.root);
    expect(res.status).toBe(200);
    expect(res.body.actions.length).toBeGreaterThanOrEqual(16);
    expect(res.body.actions.every((a: { allowed: boolean }) => a.allowed === true)).toBe(true);
    // Routes are real super-admin paths.
    for (const a of res.body.actions) expect(a.route).toMatch(/^\/super-admin\//);
  });

  it("reflects the restricted sub-role's RBAC in quick-action allowed flags", async () => {
    const res = await get("/api/v1/overview/quick-actions", tok.limited);
    expect(res.status).toBe(200);
    const byKey = Object.fromEntries(res.body.actions.map((a: { key: string; allowed: boolean }) => [a.key, a.allowed]));
    // platform:read actions are allowed.
    expect(byKey.invoices).toBe(true);
    expect(byKey.subscriptions).toBe(true);
    expect(byKey.packages).toBe(true);
    // Actions gated on perms the restricted role lacks are disallowed.
    expect(byKey.security).toBe(false);
    expect(byKey.jobs).toBe(false);
    expect(byKey.create_backup).toBe(false);
    expect(byKey.observability).toBe(false);
    expect(byKey.rbac).toBe(false);
  });

  // ---- modules --------------------------------------------------------------

  it("serves the module-status cards endpoint", async () => {
    const res = await get("/api/v1/overview/modules", tok.root);
    expect(res.status).toBe(200);
    expect(res.body.moduleStatus).toBeDefined();
    expect(res.body.moduleStatus.backups.available).toBe(true);
    expect(["healthy", "warning", "critical", "unknown"]).toContain(res.body.moduleStatus.backups.status);
  });

  // ---- export ---------------------------------------------------------------

  it("gates the export on overview:export (403 without it)", async () => {
    // Restricted role has overview:read but NOT overview:export.
    expect((await get("/api/v1/overview/export", tok.limited)).status).toBe(403);
    expect((await get("/api/v1/overview/export", tok.tenant)).status).toBe(403);
  });

  it("exports a MASKED CSV snapshot and audits it", async () => {
    expect(await auditCount("overview.exported")).toBe(0);
    const res = await get("/api/v1/overview/export?format=csv&reason=board%20review", tok.root).buffer(true);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/csv/);
    expect(res.text).toMatch(/Section,Metric,Value/);
    expect(res.text).not.toMatch(SECRET_RE);
    expect(await auditCount("overview.exported")).toBeGreaterThanOrEqual(1);
  });

  it("exports a MASKED JSON snapshot (no secrets in the body)", async () => {
    const res = await get("/api/v1/overview/export?format=json", tok.root).buffer(true);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/application\/json/);
    const body = JSON.parse(res.text);
    expect(body.kpis).toBeDefined();
    expect(body.attention).toBeDefined();
    expect(body.generatedBy.email).toBe("root@e.dev");
    expect(res.text).not.toMatch(SECRET_RE);
  });

  // ---- window resolution ----------------------------------------------------

  it("resolves coarse windows (this_month / custom) with sane range bounds", async () => {
    const month = await get("/api/v1/overview/summary?window=this_month", tok.root);
    expect(month.status).toBe(200);
    expect(month.body.range.window).toBe("this_month");
    expect(new Date(month.body.range.from).getTime()).toBeLessThanOrEqual(new Date(month.body.range.to).getTime());

    const custom = await get("/api/v1/overview/trends?window=custom&dateFrom=2000-01-01&dateTo=2000-01-31", tok.root);
    expect(custom.status).toBe(200);
    expect(custom.body.range.window).toBe("custom");
    // No data existed in the year 2000 → every visible series is empty + noted,
    // never back-filled with fabricated points.
    expect(custom.body.trends.tenantGrowth.series).toEqual([]);
    expect(custom.body.trends.tenantGrowth.note).toMatch(/begins from collected data/i);
  });
});
