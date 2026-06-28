import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { app, createInstitution, createUser, query, resetDb, tokenFor } from "./helpers";

const PW = "Passw0rd!";

describe("super admin — platform hardening", () => {
  let instA: string;
  let adminId: string;
  let packageId: string;
  const tok: Record<string, string> = {};

  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const get = (p: string, t: string) => request(app).get(p).set(auth(t));
  const post = (p: string, t: string, body?: unknown) =>
    request(app).post(p).set(auth(t)).send(body as object);
  const patch = (p: string, t: string, body?: unknown) =>
    request(app).patch(p).set(auth(t)).send(body as object);

  beforeEach(async () => {
    await resetDb();
    instA = await createInstitution("PLAT");
    // Platform owner: super_admin has NO institution (institution_id = null).
    await createUser({ email: "root@platform.dev", password: PW, role: "super_admin", institutionId: null });
    tok.root = await tokenFor("root@platform.dev", PW);

    const admin = await createUser({ email: "admin@plat.dev", password: PW, role: "admin", institutionId: instA });
    adminId = admin.id;
    for (const role of ["teacher", "student", "parent"] as const) {
      await createUser({ email: `${role}@plat.dev`, password: PW, role, institutionId: instA });
      tok[role] = await tokenFor(`${role}@plat.dev`, PW);
    }
    tok.admin = await tokenFor("admin@plat.dev", PW);

    packageId = (await query<{ id: string }>(
      `INSERT INTO subscription_packages (name, max_students, max_staff, price, billing_cycle)
       VALUES ('Pro', 1000, 100, 50000, 'annual') RETURNING id`,
      []
    )).rows[0].id;
  });

  it("lets the super admin list institutions; denies everyone else", async () => {
    const list = await get("/api/v1/platform/institutions", tok.root);
    expect(list.status).toBe(200);
    expect(list.body.rows.some((i: { id: string }) => i.id === instA)).toBe(true);
    expect(list.body).toHaveProperty("total");

    // Tenant admin + tenant users are all denied the platform routes.
    for (const role of ["admin", "teacher", "student", "parent"] as const) {
      expect((await get("/api/v1/platform/institutions", tok[role])).status).toBe(403);
    }
    expect((await get("/api/v1/platform/kpis", tok.admin)).status).toBe(403);
    expect((await get("/api/v1/platform/audit", tok.admin)).status).toBe(403);
    expect((await post("/api/v1/platform/impersonate", tok.admin, { userId: adminId })).status).toBe(403);
  });

  it("creates an institution and audits it", async () => {
    const created = await post("/api/v1/platform/institutions", tok.root, {
      name: "New School", code: "NEWSCH", type: "school",
    });
    expect(created.status).toBe(201);
    expect(created.body.code).toBe("NEWSCH");

    const audit = await get("/api/v1/platform/audit?action=institution.create", tok.root);
    expect(audit.body.rows.some((r: { targetId: string }) => r.targetId === created.body.id)).toBe(true);
  });

  it("suspends and activates an institution (audited)", async () => {
    const sus = await post(`/api/v1/platform/institutions/${instA}/suspend`, tok.root, { reason: "Non-payment" });
    expect(sus.status).toBe(200);
    expect(sus.body.isActive).toBe(false);

    const act = await post(`/api/v1/platform/institutions/${instA}/activate`, tok.root);
    expect(act.status).toBe(200);
    expect(act.body.isActive).toBe(true);

    const audit = await get(`/api/v1/platform/audit?institutionId=${instA}`, tok.root);
    const actions = audit.body.rows.map((r: { action: string }) => r.action);
    expect(actions).toEqual(expect.arrayContaining(["institution.suspend", "institution.activate"]));
  });

  it("updates institution profile and assigns a subscription (audited)", async () => {
    expect((await patch(`/api/v1/platform/institutions/${instA}`, tok.root, { name: "Renamed Inst" })).body.name).toBe("Renamed Inst");

    const sub = await post(`/api/v1/platform/institutions/${instA}/subscription`, tok.root, { packageId });
    expect(sub.status).toBe(201);
    expect(sub.body.packageId).toBe(packageId);

    const audit = await get(`/api/v1/platform/audit?institutionId=${instA}&action=subscription.assign`, tok.root);
    expect(audit.body.rows.length).toBeGreaterThanOrEqual(1);
  });

  it("sets per-institution feature limits (audited)", async () => {
    const res = await patch(`/api/v1/platform/institutions/${instA}/limits`, tok.root, {
      maxStudents: 500, storageLimitMb: 2048,
    });
    expect(res.status).toBe(200);
    expect(res.body.limits.maxStudents).toBe(500);
    expect(res.body.limits.storageLimitMb).toBe(2048);

    const detail = await get(`/api/v1/platform/institutions/${instA}`, tok.root);
    expect(detail.body.settings.limits.maxStudents).toBe(500);
    expect((await get(`/api/v1/platform/audit?action=limits.update`, tok.root)).body.rows.length).toBeGreaterThanOrEqual(1);
  });

  it("exposes platform-wide KPIs", async () => {
    const kpis = await get("/api/v1/platform/kpis", tok.root);
    expect(kpis.status).toBe(200);
    expect(kpis.body.totalInstitutions).toBeGreaterThanOrEqual(1);
    expect(kpis.body).toHaveProperty("activeInstitutions");
    expect(kpis.body).toHaveProperty("totalStudents");
    expect(kpis.body).toHaveProperty("storageBytes");
    expect(kpis.body.moduleAdoption).toHaveProperty("withStudents");
  });

  it("provides a read-only cross-tenant audit viewer with filters", async () => {
    await post(`/api/v1/platform/institutions/${instA}/suspend`, tok.root, {});
    const all = await get("/api/v1/platform/audit", tok.root);
    expect(all.status).toBe(200);
    expect(all.body.rows.length).toBeGreaterThanOrEqual(1);
    expect(all.body).toHaveProperty("total");
    // Filter narrows results.
    const filtered = await get("/api/v1/platform/audit?action=institution.suspend", tok.root);
    expect(filtered.body.rows.every((r: { action: string }) => r.action === "institution.suspend")).toBe(true);
  });

  it("starts an audited impersonation session without leaking secrets", async () => {
    const res = await post("/api/v1/platform/impersonate", tok.root, { userId: adminId, reason: "support ticket #42" });
    expect(res.status).toBe(200);
    expect(res.body.impersonating).toBe(true);
    expect(typeof res.body.token).toBe("string");
    expect(res.body).toHaveProperty("expiresAt");
    expect(res.body.user.id).toBe(adminId);
    // No secret fields are ever returned.
    expect(res.body.user.passwordHash).toBeUndefined();
    expect(JSON.stringify(res.body)).not.toMatch(/password/i);
    // The impersonation token actually works as the tenant user.
    const me = await get("/api/v1/auth/me", res.body.token);
    expect(me.status).toBe(200);
    expect(me.body.email).toBe("admin@plat.dev");
    // Audited.
    expect((await get("/api/v1/platform/audit?action=impersonate.start", tok.root)).body.rows.length).toBeGreaterThanOrEqual(1);
  });

  it("refuses to impersonate a super admin", async () => {
    const root = await query<{ id: string }>("SELECT id FROM users WHERE email='root@platform.dev'", []);
    expect((await post("/api/v1/platform/impersonate", tok.root, { userId: root.rows[0].id, reason: "support ticket #42" })).status).toBe(400);
  });

  it("keeps cross-tenant data off the tenant surface and exposes no secrets in detail", async () => {
    // A second institution exists, but a tenant admin can never see it — the only
    // cross-tenant surface is the super-admin platform routes (all 403 for tenants).
    await createInstitution("PLAT2");
    expect((await get("/api/v1/platform/institutions", tok.admin)).status).toBe(403);

    // Institution detail returns metadata + usage only — no password/secret fields.
    const detail = await get(`/api/v1/platform/institutions/${instA}`, tok.root);
    expect(detail.status).toBe(200);
    expect(JSON.stringify(detail.body)).not.toMatch(/password|password_hash|secret|token/i);
  });
});
