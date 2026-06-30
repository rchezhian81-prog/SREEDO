import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { app, createUser, query, resetDb, tokenFor } from "./helpers";

const SUPER = { email: "super@test.dev", password: "Passw0rd!" };
const ADMIN = { email: "admin@test.dev", password: "Passw0rd!" };
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

describe("super admin N: global platform settings + feature flags", () => {
  let superToken: string;
  let adminToken: string;

  beforeEach(async () => {
    await resetDb();
    // New tables are outside resetDb's truncate list — reset them explicitly so
    // each test starts clean (getSettings re-seeds the singleton on first read).
    await query("DELETE FROM platform_feature_flags");
    await query("DELETE FROM platform_settings");
    await createUser({ ...SUPER, role: "super_admin" });
    await createUser({ ...ADMIN, role: "admin" });
    superToken = await tokenFor(SUPER.email, SUPER.password);
    adminToken = await tokenFor(ADMIN.email, ADMIN.password);
  });

  // --- Authorization ------------------------------------------------------
  it("blocks non-super-admins from the settings surface", async () => {
    expect((await request(app).get("/api/v1/platform/settings").set(auth(adminToken))).status).toBe(403);
    expect((await request(app).patch("/api/v1/platform/settings").set(auth(adminToken)).send({ platformName: "X" })).status).toBe(403);
    expect((await request(app).get("/api/v1/platform/feature-flags").set(auth(adminToken))).status).toBe(403);
    expect((await request(app).get("/api/v1/platform/settings").set(auth("garbage"))).status).toBe(401);
  });

  // --- Global settings load + save + validation ---------------------------
  it("loads global settings with sane defaults", async () => {
    const res = await request(app).get("/api/v1/platform/settings").set(auth(superToken));
    expect(res.status).toBe(200);
    expect(res.body.platformName).toBe("GoCampusOS");
    expect(res.body.defaultCurrency).toBe("INR");
    expect(res.body.financialYearStartMonth).toBe(4);
    expect(res.body.maintenanceMode).toBe(false);
  });

  it("saves global settings and reflects the change", async () => {
    const upd = await request(app)
      .patch("/api/v1/platform/settings")
      .set(auth(superToken))
      .send({ platformName: "Acme Platform", supportEmail: "help@acme.test", defaultCurrency: "USD" });
    expect(upd.status).toBe(200);
    expect(upd.body.platformName).toBe("Acme Platform");
    const get = await request(app).get("/api/v1/platform/settings").set(auth(superToken));
    expect(get.body.supportEmail).toBe("help@acme.test");
    expect(get.body.defaultCurrency).toBe("USD");
  });

  it("validates settings input", async () => {
    expect((await request(app).patch("/api/v1/platform/settings").set(auth(superToken)).send({ supportEmail: "not-an-email" })).status).toBe(400);
    expect((await request(app).patch("/api/v1/platform/settings").set(auth(superToken)).send({ financialYearStartMonth: 13 })).status).toBe(400);
    expect((await request(app).patch("/api/v1/platform/settings").set(auth(superToken)).send({ timeFormat: "36h" })).status).toBe(400);
    expect((await request(app).patch("/api/v1/platform/settings").set(auth(superToken)).send({})).status).toBe(400);
  });

  // --- Secrets safety -----------------------------------------------------
  it("exposes safe platform info without any secrets", async () => {
    const res = await request(app).get("/api/v1/platform/settings/info").set(auth(superToken));
    expect(res.status).toBe(200);
    expect(typeof res.body.email.configured).toBe("boolean");
    expect(typeof res.body.storage.configured).toBe("boolean");
    expect(typeof res.body.security.accessTokenTtl).toBe("string");
    const lower = JSON.stringify(res.body).toLowerCase();
    // Real secret VALUES / credentials must never appear (the safe key
    // "passwordResetTtlMinutes" is fine — only its numeric value is returned).
    expect(lower).not.toContain("test_access_secret_value_123456");
    expect(lower).not.toContain("test_refresh_secret_value_123456");
    expect(lower).not.toContain("sreedo_test"); // DB name from DATABASE_URL
    expect(lower).not.toContain("postgres:postgres"); // DB credentials
    expect(lower).not.toContain("smtppass");
    expect(lower).not.toContain("apikey");
  });

  // --- Feature flags ------------------------------------------------------
  it("lists, creates, edits and toggles feature flags (audited)", async () => {
    expect((await request(app).get("/api/v1/platform/feature-flags").set(auth(superToken))).body).toEqual([]);

    const created = await request(app)
      .post("/api/v1/platform/feature-flags")
      .set(auth(superToken))
      .send({ key: "new-dashboard", displayName: "New dashboard", scope: "global" });
    expect(created.status).toBe(201);
    expect(created.body.key).toBe("new-dashboard");
    expect(created.body.status).toBe("disabled");
    const id = created.body.id;

    // duplicate key rejected, bad key rejected
    expect((await request(app).post("/api/v1/platform/feature-flags").set(auth(superToken)).send({ key: "new-dashboard", displayName: "Dup" })).status).toBe(409);
    expect((await request(app).post("/api/v1/platform/feature-flags").set(auth(superToken)).send({ key: "bad key!", displayName: "X" })).status).toBe(400);

    const enabled = await request(app).post(`/api/v1/platform/feature-flags/${id}/status`).set(auth(superToken)).send({ status: "enabled" });
    expect(enabled.status).toBe(200);
    expect(enabled.body.status).toBe("enabled");

    const edited = await request(app).patch(`/api/v1/platform/feature-flags/${id}`).set(auth(superToken)).send({ displayName: "Renamed" });
    expect(edited.body.displayName).toBe("Renamed");

    // every change is audited
    const audit = await query("SELECT action FROM platform_audit_log WHERE target_type = 'feature_flag'");
    const actions = audit.rows.map((r: { action: string }) => r.action);
    expect(actions).toContain("platform.feature_flag_create");
    expect(actions).toContain("platform.feature_flag_status");
    expect(actions).toContain("platform.feature_flag_update");
  });

  // --- Settings history + diff + safe rollback ----------------------------
  it("records settings history with a before/after diff and rolls back safely", async () => {
    await request(app).patch("/api/v1/platform/settings").set(auth(superToken)).send({ platformName: "Acme Platform" });

    const hist = await request(app).get("/api/v1/platform/settings/history").set(auth(superToken));
    expect(hist.status).toBe(200);
    const row = hist.body.rows.find((r: { action: string }) => r.action === "platform.settings_update");
    expect(row).toBeTruthy();
    expect(row.detail.diff.platformName.from).toBe("GoCampusOS");
    expect(row.detail.diff.platformName.to).toBe("Acme Platform");

    const back = await request(app).post("/api/v1/platform/settings/rollback").set(auth(superToken)).send({ auditId: row.id });
    expect(back.status).toBe(200);
    expect(back.body.platformName).toBe("GoCampusOS");
    const after = await request(app).get("/api/v1/platform/settings").set(auth(superToken));
    expect(after.body.platformName).toBe("GoCampusOS");
    // the rollback itself is audited
    const rb = await query("SELECT 1 FROM platform_audit_log WHERE action = 'platform.settings_rollback'");
    expect(rb.rows.length).toBeGreaterThan(0);
  });

  it("refuses to roll back a non-settings change", async () => {
    const flag = await request(app).post("/api/v1/platform/feature-flags").set(auth(superToken)).send({ key: "x-flag", displayName: "X" });
    const a = await query<{ id: string }>("SELECT id FROM platform_audit_log WHERE target_type = 'feature_flag' AND target_id = $1", [flag.body.id]);
    const res = await request(app).post("/api/v1/platform/settings/rollback").set(auth(superToken)).send({ auditId: a.rows[0].id });
    expect(res.status).toBe(400);
  });

  // --- Maintenance / announcement runtime status (visibility-gated) -------
  it("surfaces maintenance + announcement via runtime-status, gated by role", async () => {
    await request(app).patch("/api/v1/platform/settings").set(auth(superToken)).send({
      maintenanceMode: true, maintenanceMessage: "Down for upgrade",
      announcementActive: true, announcementText: "Welcome", announcementVisibility: "super_admin",
    });

    const asSuper = await request(app).get("/api/v1/platform/runtime-status").set(auth(superToken));
    expect(asSuper.body.maintenance.active).toBe(true);
    expect(asSuper.body.maintenance.message).toBe("Down for upgrade");
    expect(asSuper.body.announcement?.text).toBe("Welcome");

    // super-admin-only announcement is hidden from a tenant admin (maintenance still shows)
    const asAdmin = await request(app).get("/api/v1/platform/runtime-status").set(auth(adminToken));
    expect(asAdmin.body.maintenance.active).toBe(true);
    expect(asAdmin.body.announcement).toBeNull();

    // widening visibility reveals it to the admin
    await request(app).patch("/api/v1/platform/settings").set(auth(superToken)).send({ announcementVisibility: "all_users" });
    const asAdmin2 = await request(app).get("/api/v1/platform/runtime-status").set(auth(adminToken));
    expect(asAdmin2.body.announcement?.text).toBe("Welcome");
  });

  // --- Regression: existing surfaces still work ---------------------------
  it("does not break invoice settings, tenant management, platform KPIs or auth", async () => {
    expect((await request(app).get("/api/v1/platform/invoice-settings").set(auth(superToken))).status).toBe(200);
    expect((await request(app).get("/api/v1/platform/tenants").set(auth(superToken))).status).toBe(200);
    expect((await request(app).get("/api/v1/platform/kpis").set(auth(superToken))).status).toBe(200);
    expect((await request(app).get("/api/v1/auth/me").set(auth(superToken))).status).toBe(200);
  });
});
