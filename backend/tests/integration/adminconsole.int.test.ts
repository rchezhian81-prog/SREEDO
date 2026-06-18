import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import {
  app,
  createInstitution,
  createUser,
  query,
  resetDb,
  tokenFor,
} from "./helpers";

const PW = "Passw0rd!";

describe("super admin console (hardening)", () => {
  let instA: string;
  let instB: string;
  const tok: Record<string, string> = {};

  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const get = (p: string, t: string) => request(app).get(p).set(auth(t));
  const post = (p: string, t: string, b?: unknown) => request(app).post(p).set(auth(t)).send(b ?? {});
  const patch = (p: string, t: string, b: unknown) => request(app).patch(p).set(auth(t)).send(b);

  beforeEach(async () => {
    await resetDb();
    instA = await createInstitution("ADM");
    instB = await createInstitution("ADM2");
    await createUser({ email: "super@adm.dev", password: PW, role: "super_admin", institutionId: null });
    await createUser({ email: "admin@adm.dev", password: PW, role: "admin", institutionId: instA });
    tok.super = await tokenFor("super@adm.dev", PW);
    tok.admin = await tokenFor("admin@adm.dev", PW);
  });

  it("lets super admin read and update institution settings (feature flags/modules)", async () => {
    const before = await get(`/api/v1/admin/institutions/${instA}/settings`, tok.super);
    expect(before.status).toBe(200);
    expect(before.body.code).toBe("ADM");

    const upd = await patch(`/api/v1/admin/institutions/${instA}/settings`, tok.super, {
      name: "Renamed Academy",
      enabledModules: ["fees", "library"],
      featureFlags: { portal: true, sms: false },
      contact: { email: "ops@adm.dev" },
    });
    expect(upd.status).toBe(200);
    expect(upd.body.name).toBe("Renamed Academy");
    expect(upd.body.settings.enabledModules).toEqual(["fees", "library"]);
    expect(upd.body.settings.featureFlags).toMatchObject({ portal: true, sms: false });
    expect(upd.body.settings.contact.email).toBe("ops@adm.dev");

    // Merge (not overwrite): a second patch keeps prior keys.
    const upd2 = await patch(`/api/v1/admin/institutions/${instA}/settings`, tok.super, { featureFlags: { portal: false } });
    expect(upd2.body.settings.enabledModules).toEqual(["fees", "library"]);
    expect(upd2.body.settings.featureFlags.portal).toBe(false);
  });

  it("blocks normal admins from the entire admin console", async () => {
    expect((await get("/api/v1/admin/institutions", tok.admin)).status).toBe(403);
    expect((await get(`/api/v1/admin/institutions/${instA}/settings`, tok.admin)).status).toBe(403);
    expect((await patch(`/api/v1/admin/institutions/${instA}/settings`, tok.admin, { name: "Hack" })).status).toBe(403);
    expect((await get(`/api/v1/admin/institutions/${instA}/limits`, tok.admin)).status).toBe(403);
    expect((await get("/api/v1/admin/audit-logs", tok.admin)).status).toBe(403);
    expect((await get("/api/v1/admin/system/health", tok.admin)).status).toBe(403);
    expect((await post(`/api/v1/admin/institutions/${instA}/export`, tok.admin, {})).status).toBe(403);
  });

  it("enforces plan student/staff limits and reports usage", async () => {
    // Tiny plan: max 1 student.
    const pkg = await query<{ id: string }>(
      "INSERT INTO subscription_packages (name, max_students, max_staff) VALUES ('Tiny', 1, 5) RETURNING id",
      []
    );
    await query(
      "INSERT INTO institution_subscriptions (institution_id, package_id, status) VALUES ($1, $2, 'active')",
      [instA, pkg.rows[0].id]
    );

    // First student OK; second hits the cap.
    expect((await post("/api/v1/students", tok.admin, { firstName: "A", lastName: "One" })).status).toBe(201);
    const second = await post("/api/v1/students", tok.admin, { firstName: "B", lastName: "Two" });
    expect(second.status).toBe(403);
    expect(second.body.error).toMatch(/limit/i);

    const limits = await get(`/api/v1/admin/institutions/${instA}/limits`, tok.super);
    expect(limits.body).toMatchObject({ packageName: "Tiny", maxStudents: 1, students: 1, maxStaff: 5 });
    expect(limits.body.withinLimits).toBe(true);
  });

  it("exposes a read-only cross-tenant snapshot, super-admin-only", async () => {
    const statsA = await get(`/api/v1/admin/institutions/${instA}/stats`, tok.super);
    expect(statsA.status).toBe(200);
    expect(statsA.body).toHaveProperty("students");
    expect(statsA.body).toHaveProperty("feesOutstanding");
    // Super admin can view another tenant too (the "switch").
    expect((await get(`/api/v1/admin/institutions/${instB}/stats`, tok.super)).status).toBe(200);
    // Normal admin cannot use the switch at all.
    expect((await get(`/api/v1/admin/institutions/${instB}/stats`, tok.admin)).status).toBe(403);
    expect((await get(`/api/v1/admin/institutions/${instA}/stats`, tok.admin)).status).toBe(403);
  });

  it("generates a safe data export (no secrets) with history", async () => {
    const exp = await post(`/api/v1/admin/institutions/${instA}/export`, tok.super, {});
    expect(exp.status).toBe(200);
    expect(exp.body.summary.institution.code).toBe("ADM");
    expect(exp.body.summary.counts).toHaveProperty("students");
    // No secrets/private keys anywhere in the export payload.
    const serialized = JSON.stringify(exp.body).toLowerCase();
    expect(serialized).not.toContain("password");
    expect(serialized).not.toContain("storage_key");
    expect(serialized).not.toContain("secret");

    const history = await get(`/api/v1/admin/exports?institutionId=${instA}`, tok.super);
    expect(history.body).toHaveLength(1);
  });

  it("serves the audit log viewer (super-admin-only; degrades when Mongo is off)", async () => {
    const logs = await get("/api/v1/admin/audit-logs?action=POST", tok.super);
    expect(logs.status).toBe(200);
    expect(logs.body).toHaveProperty("available");
    expect(Array.isArray(logs.body.rows)).toBe(true);

    const csv = await get("/api/v1/admin/audit-logs/export", tok.super);
    expect(csv.status).toBe(200);
    expect(csv.headers["content-type"]).toMatch(/csv/);

    // Normal admin denied.
    expect((await get("/api/v1/admin/audit-logs", tok.admin)).status).toBe(403);
    expect((await get("/api/v1/admin/audit-logs/export", tok.admin)).status).toBe(403);
  });

  it("reports system health (super-admin-only)", async () => {
    const health = await get("/api/v1/admin/system/health", tok.super);
    expect(health.status).toBe(200);
    expect(health.body.postgres).toBe(true);
    expect(health.body).toHaveProperty("mongo");
    expect(health.body.institutions).toBeGreaterThanOrEqual(2);
    expect((await get("/api/v1/admin/system/health", tok.admin)).status).toBe(403);
  });

  it("keeps tenant data protected (no cross-institution leakage)", async () => {
    // Settings updates are scoped to the targeted institution only.
    await patch(`/api/v1/admin/institutions/${instA}/settings`, tok.super, { name: "Only A" });
    const b = await get(`/api/v1/admin/institutions/${instB}/settings`, tok.super);
    expect(b.body.name).not.toBe("Only A");
    // A non-super user has no admin-console reach regardless of tenant.
    expect((await get("/api/v1/admin/institutions", tok.admin)).status).toBe(403);
    expect((await get("/api/v1/admin/exports", tok.admin)).status).toBe(403);
  });
});
