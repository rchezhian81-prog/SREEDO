import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { app, createUser, query, resetDb, tokenFor } from "./helpers";

const SUPER = { email: "super@test.dev", password: "Passw0rd!" };
const ADMIN = { email: "admin@test.dev", password: "Passw0rd!" };
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

describe("super admin C: package / plan management", () => {
  let superToken: string;
  let adminToken: string;

  beforeEach(async () => {
    await resetDb();
    await createUser({ ...SUPER, role: "super_admin" });
    await createUser({ ...ADMIN, role: "admin" });
    superToken = await tokenFor(SUPER.email, SUPER.password);
    adminToken = await tokenFor(ADMIN.email, ADMIN.password);
  });

  const createPkg = (body: Record<string, unknown>) =>
    request(app).post("/api/v1/packages").set(auth(superToken)).send(body);

  it("blocks non-super-admins", async () => {
    expect((await request(app).get("/api/v1/packages").set(auth(adminToken))).status).toBe(403);
    expect((await request(app).post("/api/v1/packages").set(auth(adminToken)).send({ name: "X" })).status).toBe(403);
  });

  it("creates, reads, lists and filters packages", async () => {
    const created = await createPkg({
      name: "Pro", description: "Top plan", currency: "USD", price: 2500, billingCycle: "annual",
      status: "active", visibility: "public", applicableTypes: ["college"], maxStudents: 1000,
      limits: { storageMb: 5000, smsQuota: 1000 }, features: { modules: { fees: true } },
      taxPercent: 18, isTrial: false,
    });
    expect(created.status).toBe(201);
    expect(created.body.currency).toBe("USD");
    expect(created.body.status).toBe("active");
    expect(created.body.applicableTypes).toEqual(["college"]);
    expect(created.body.limits.storageMb).toBe(5000);
    const id = created.body.id;

    const got = await request(app).get(`/api/v1/packages/${id}`).set(auth(superToken));
    expect(got.status).toBe(200);
    expect(got.body.name).toBe("Pro");

    await createPkg({ name: "Lite", price: 0, status: "draft" });
    const list = await request(app).get("/api/v1/packages").set(auth(superToken));
    expect(list.body.length).toBe(2);
    // GET /packages stays an array (backward compatible)
    expect(Array.isArray(list.body)).toBe(true);

    const filtered = await request(app).get("/api/v1/packages?status=active").set(auth(superToken));
    expect(filtered.body.map((p: { name: string }) => p.name)).toEqual(["Pro"]);
    const byType = await request(app).get("/api/v1/packages?institutionType=school").set(auth(superToken));
    // Pro applies to college only; Lite has no restriction → only Lite matches school
    expect(byType.body.map((p: { name: string }) => p.name)).toEqual(["Lite"]);
  });

  it("validates input", async () => {
    expect((await createPkg({})).status).toBe(400); // name required
    expect((await createPkg({ name: "Bad", billingCycle: "weekly" })).status).toBe(400);
    expect((await createPkg({ name: "Bad2", taxPercent: 250 })).status).toBe(400);
  });

  it("edits a package and records a versioned before/after diff + audit", async () => {
    const id = (await createPkg({ name: "Base", price: 100 })).body.id;
    const upd = await request(app).patch(`/api/v1/packages/${id}`).set(auth(superToken)).send({ price: 250, badge: "Popular" });
    expect(upd.status).toBe(200);
    expect(Number(upd.body.price)).toBe(250);

    const history = await request(app).get(`/api/v1/packages/${id}/history`).set(auth(superToken));
    expect(history.status).toBe(200);
    const updateRow = history.body.find((r: { action: string }) => r.action === "updated");
    expect(updateRow.diff.price).toBeTruthy();
    expect(Number(updateRow.diff.price.to)).toBe(250);

    const audit = await query("SELECT action FROM platform_audit_log WHERE target_type = 'package'");
    const actions = audit.rows.map((r: { action: string }) => r.action);
    expect(actions).toContain("package.created");
    expect(actions).toContain("package.updated");
  });

  it("saves feature matrix, limits, billing and trial config", async () => {
    const id = (await createPkg({ name: "Cfg" })).body.id;
    const fm = await request(app).patch(`/api/v1/packages/${id}`).set(auth(superToken))
      .send({ features: { modules: { fees: true, library: false }, supportLevel: "priority" } });
    expect(fm.body.features.supportLevel).toBe("priority");
    const lim = await request(app).patch(`/api/v1/packages/${id}`).set(auth(superToken))
      .send({ maxStudents: 500, limits: { storageMb: 2048, apiRequests: 100000 } });
    expect(lim.body.maxStudents).toBe(500);
    expect(lim.body.limits.apiRequests).toBe(100000);
    const bill = await request(app).patch(`/api/v1/packages/${id}`).set(auth(superToken))
      .send({ taxPercent: 12, invoiceDueDays: 15, paymentTerms: "Net 15", billingStartRule: "after_trial" });
    expect(Number(bill.body.taxPercent)).toBe(12);
    expect(bill.body.billingStartRule).toBe("after_trial");
    const trial = await request(app).patch(`/api/v1/packages/${id}`).set(auth(superToken))
      .send({ isTrial: true, trialDays: 14, trialExpiryBehavior: "suspend" });
    expect(trial.body.isTrial).toBe(true);
    expect(trial.body.trialDays).toBe(14);
  });

  it("duplicates a package (copy starts as draft; duplicate name rejected)", async () => {
    const id = (await createPkg({ name: "Source", price: 999, status: "active" })).body.id;
    const dup = await request(app).post(`/api/v1/packages/${id}/duplicate`).set(auth(superToken)).send({ name: "Source Copy" });
    expect(dup.status).toBe(201);
    expect(dup.body.name).toBe("Source Copy");
    expect(dup.body.status).toBe("draft");
    expect(Number(dup.body.price)).toBe(999);
    const again = await request(app).post(`/api/v1/packages/${id}/duplicate`).set(auth(superToken)).send({ name: "Source Copy" });
    expect(again.status).toBe(409);
  });

  it("archives instead of hard-deleting; assigned packages are never removed", async () => {
    const inst = await request(app).post("/api/v1/institutions").set(auth(superToken)).send({ name: "Riverside", code: "RVR", type: "school" });
    const pkgId = (await createPkg({ name: "Assigned", status: "active" })).body.id;
    const sub = await request(app).post(`/api/v1/institutions/${inst.body.id}/subscription`).set(auth(superToken)).send({ packageId: pkgId });
    expect(sub.status).toBe(201);

    // no hard-delete endpoint exists
    expect((await request(app).delete(`/api/v1/packages/${pkgId}`).set(auth(superToken))).status).toBe(404);

    // archive requires a reason
    expect((await request(app).post(`/api/v1/packages/${pkgId}/status`).set(auth(superToken)).send({ status: "archived" })).status).toBe(400);
    const arch = await request(app).post(`/api/v1/packages/${pkgId}/status`).set(auth(superToken)).send({ status: "archived", reason: "End of life" });
    expect(arch.status).toBe(200);
    expect(arch.body.status).toBe("archived");
    expect(arch.body.isActive).toBe(false);

    // row preserved + subscription intact
    expect((await query("SELECT 1 FROM subscription_packages WHERE id = $1", [pkgId])).rows).toHaveLength(1);
    expect((await query("SELECT 1 FROM institution_subscriptions WHERE package_id = $1", [pkgId])).rows.length).toBeGreaterThan(0);
    const audit = await query("SELECT 1 FROM platform_audit_log WHERE target_id = $1 AND action = 'package.status_change'", [pkgId]);
    expect(audit.rows.length).toBeGreaterThan(0);
  });

  it("enforces institution-type applicability with a super-admin override", async () => {
    const inst = await request(app).post("/api/v1/institutions").set(auth(superToken)).send({ name: "School A", code: "SCHA", type: "school" });
    const pkgId = (await createPkg({ name: "College Only", status: "active", applicableTypes: ["college"] })).body.id;

    const blocked = await request(app).post(`/api/v1/institutions/${inst.body.id}/subscription`).set(auth(superToken)).send({ packageId: pkgId });
    expect(blocked.status).toBe(400);

    const overridden = await request(app).post(`/api/v1/institutions/${inst.body.id}/subscription`).set(auth(superToken))
      .send({ packageId: pkgId, override: true, reason: "VIP school" });
    expect(overridden.status).toBe(201);
    const audit = await query("SELECT 1 FROM platform_audit_log WHERE action = 'package.assign_override' AND target_id = $1", [pkgId]);
    expect(audit.rows.length).toBeGreaterThan(0);
  });

  it("reports usage, impact and comparison", async () => {
    const inst = await request(app).post("/api/v1/institutions").set(auth(superToken)).send({ name: "Used", code: "USED", type: "college" });
    const a = (await createPkg({ name: "Plan A", price: 100, status: "active" })).body.id;
    const b = (await createPkg({ name: "Plan B", price: 200, status: "active" })).body.id;
    await request(app).post(`/api/v1/institutions/${inst.body.id}/subscription`).set(auth(superToken)).send({ packageId: a });

    const report = await request(app).get("/api/v1/packages-report").set(auth(superToken));
    expect(report.status).toBe(200);
    const rowA = report.body.find((r: { id: string }) => r.id === a);
    expect(rowA.tenants).toBe(1);
    expect(rowA.active).toBe(1);

    const impact = await request(app).get(`/api/v1/packages/${a}/impact`).set(auth(superToken));
    expect(impact.body.tenants).toHaveLength(1);
    expect(impact.body.activeSubscriptions).toBe(1);

    const compare = await request(app).get(`/api/v1/packages-compare?ids=${a},${b}`).set(auth(superToken));
    expect(compare.body.map((p: { name: string }) => p.name).sort()).toEqual(["Plan A", "Plan B"]);
  });

  it("exports the package list and usage report", async () => {
    await createPkg({ name: "Exp", price: 100 });
    const csv = await request(app).get("/api/v1/packages-export?format=csv").set(auth(superToken));
    expect(csv.status).toBe(200);
    expect(csv.headers["content-type"]).toContain("csv");
    const xlsx = await request(app).get("/api/v1/packages-report?format=xlsx").set(auth(superToken));
    expect(xlsx.status).toBe(200);
    expect(xlsx.headers["content-type"]).toContain("spreadsheet");
  });

  it("does not break tenant assignment, subscriptions, invoice settings, settings or auth", async () => {
    expect((await request(app).get("/api/v1/platform/subscriptions").set(auth(superToken))).status).toBe(200);
    expect((await request(app).get("/api/v1/platform/invoice-settings").set(auth(superToken))).status).toBe(200);
    expect((await request(app).get("/api/v1/platform/settings").set(auth(superToken))).status).toBe(200);
    expect((await request(app).get("/api/v1/auth/me").set(auth(superToken))).status).toBe(200);
  });
});
