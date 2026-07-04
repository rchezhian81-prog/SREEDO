import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { app, createInstitution, createUser, query, resetDb, tokenFor } from "./helpers";

const PW = "Passw0rd!";

// Collect a binary (CSV/XLSX) response body into a Buffer for supertest.
const binary = (res: import("http").IncomingMessage, cb: (err: Error | null, body: Buffer) => void) => {
  const chunks: Buffer[] = [];
  res.on("data", (c: Buffer) => chunks.push(c));
  res.on("end", () => cb(null, Buffer.concat(chunks)));
};

/**
 * Platform Console completion — institution directory (search/filter/sort/
 * paginate/export), audit search + export, support user search + hardening,
 * institution recent-activity, and the activeSubscriptions KPI.
 */
describe("super admin — platform console", () => {
  const tok: Record<string, string> = {};
  let instA: string;
  let adminId: string;

  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const get = (p: string, t: string) => request(app).get(p).set(auth(t));
  const post = (p: string, t: string, body?: unknown) =>
    request(app).post(p).set(auth(t)).send(body as object);

  beforeEach(async () => {
    await resetDb();
    instA = await createInstitution("ALPHA");
    await createInstitution("BETA", "college");
    await createInstitution("GAMMA");
    await createUser({ email: "root@platform.dev", password: PW, role: "super_admin", institutionId: null });
    tok.root = await tokenFor("root@platform.dev", PW);
    const admin = await createUser({ email: "admin@alpha.dev", password: PW, role: "admin", institutionId: instA, fullName: "Alice Admin" });
    adminId = admin.id;
    await createUser({ email: "teacher@alpha.dev", password: PW, role: "teacher", institutionId: instA, fullName: "Tina Teacher" });
    tok.admin = await tokenFor("admin@alpha.dev", PW);
  });

  it("paginates, searches, filters and sorts the institution directory", async () => {
    const all = await get("/api/v1/platform/institutions?page=1&pageSize=2", tok.root);
    expect(all.status).toBe(200);
    expect(all.body.total).toBe(3);
    expect(all.body.rows).toHaveLength(2);
    expect(all.body.page).toBe(1);

    // Search by code.
    const search = await get("/api/v1/platform/institutions?q=BETA", tok.root);
    expect(search.body.total).toBe(1);
    expect(search.body.rows[0].code).toBe("BETA");

    // Filter by type.
    const colleges = await get("/api/v1/platform/institutions?type=college", tok.root);
    expect(colleges.body.rows.every((r: { type: string }) => r.type === "college")).toBe(true);
    expect(colleges.body.total).toBe(1);

    // Sort by code ascending.
    const sorted = await get("/api/v1/platform/institutions?sort=code&order=asc", tok.root);
    const codes = sorted.body.rows.map((r: { code: string }) => r.code);
    expect(codes).toEqual([...codes].sort());
  });

  it("filters institutions by status after a suspension", async () => {
    await post(`/api/v1/platform/institutions/${instA}/suspend`, tok.root, { reason: "Non-payment test" });
    const suspended = await get("/api/v1/platform/institutions?status=suspended", tok.root);
    expect(suspended.body.rows.every((r: { isActive: boolean }) => r.isActive === false)).toBe(true);
    expect(suspended.body.rows.some((r: { id: string }) => r.id === instA)).toBe(true);
    const active = await get("/api/v1/platform/institutions?status=active", tok.root);
    expect(active.body.rows.some((r: { id: string }) => r.id === instA)).toBe(false);
  });

  it("exports the filtered institution directory as CSV and XLSX", async () => {
    const csv = await request(app)
      .get("/api/v1/platform/institutions/export?format=csv")
      .set(auth(tok.root))
      .buffer(true)
      .parse(binary);
    expect(csv.status).toBe(200);
    expect(csv.headers["content-type"]).toContain("text/csv");
    const csvText = csv.body.toString("utf8");
    expect(csvText).toContain("Code");
    expect(csvText).toContain("ALPHA");

    const xlsx = await request(app)
      .get("/api/v1/platform/institutions/export?format=xlsx&q=BETA")
      .set(auth(tok.root))
      .buffer(true)
      .parse(binary);
    expect(xlsx.status).toBe(200);
    expect(xlsx.headers["content-type"]).toContain("spreadsheetml");
    expect(xlsx.body.subarray(0, 2).toString()).toBe("PK"); // valid ZIP/XLSX magic
    expect(xlsx.body.length).toBeGreaterThan(200);
  });

  it("searches and exports the audit log", async () => {
    await post(`/api/v1/platform/institutions/${instA}/suspend`, tok.root, { reason: "audit search test" });
    // Free-text search matches the action.
    const q = await get("/api/v1/platform/audit?q=suspend", tok.root);
    expect(q.body.rows.some((r: { action: string }) => r.action === "institution.suspend")).toBe(true);
    expect(q.body).toHaveProperty("total");

    // Audit Consolidation (F): a broad export (no dateFrom bound) now requires a
    // governed reason. The consolidated exporter's Action column carries the action.
    const csv = await get(
      "/api/v1/platform/audit/export?format=csv&action=institution.suspend&reason=audit%20export%20test",
      tok.root
    );
    expect(csv.status).toBe(200);
    expect(csv.headers["content-type"]).toContain("text/csv");
    expect(csv.text).toContain("institution.suspend");
  });

  it("returns recent activity for one institution", async () => {
    await post(`/api/v1/platform/institutions/${instA}/suspend`, tok.root, { reason: "activity timeline test" });
    await post(`/api/v1/platform/institutions/${instA}/activate`, tok.root);
    const activity = await get(`/api/v1/platform/institutions/${instA}/activity`, tok.root);
    expect(activity.status).toBe(200);
    expect(Array.isArray(activity.body)).toBe(true);
    const actions = activity.body.map((r: { action: string }) => r.action);
    expect(actions).toEqual(expect.arrayContaining(["institution.suspend", "institution.activate"]));
  });

  it("searches impersonatable tenant users (excludes super-admins)", async () => {
    const res = await get("/api/v1/platform/users?q=alpha", tok.root);
    expect(res.status).toBe(200);
    const emails = res.body.map((u: { email: string }) => u.email);
    expect(emails).toContain("admin@alpha.dev");
    expect(emails).toContain("teacher@alpha.dev");
    expect(emails).not.toContain("root@platform.dev"); // super_admin excluded
    expect(res.body.every((u: { institutionName: string }) => !!u.institutionName)).toBe(true);

    // Filter by role.
    const teachers = await get("/api/v1/platform/users?role=teacher", tok.root);
    expect(teachers.body.every((u: { role: string }) => u.role === "teacher")).toBe(true);
  });

  it("requires a meaningful reason to start a support session", async () => {
    // No reason → 400.
    expect((await post("/api/v1/platform/impersonate", tok.root, { userId: adminId })).status).toBe(400);
    // Too-short reason → 400.
    expect((await post("/api/v1/platform/impersonate", tok.root, { userId: adminId, reason: "hi" })).status).toBe(400);
    // Valid reason → 200 with an expiry.
    const ok = await post("/api/v1/platform/impersonate", tok.root, { userId: adminId, reason: "support ticket #99" });
    expect(ok.status).toBe(200);
    expect(ok.body.impersonating).toBe(true);
    expect(ok.body.expiresAt).toBeTruthy();
    expect(new Date(ok.body.expiresAt).getTime()).toBeGreaterThan(Date.now());
  });

  it("denies the support user search and exports to non-super-admins", async () => {
    expect((await get("/api/v1/platform/users?q=a", tok.admin)).status).toBe(403);
    expect((await get("/api/v1/platform/institutions/export?format=csv", tok.admin)).status).toBe(403);
    expect((await get("/api/v1/platform/audit/export?format=csv", tok.admin)).status).toBe(403);
  });

  it("reports active subscriptions in the KPIs", async () => {
    const pkg = (
      await query<{ id: string }>(
        `INSERT INTO subscription_packages (name, price, billing_cycle)
         VALUES ('Pro PC', 1000, 'annual') RETURNING id`,
        []
      )
    ).rows[0].id;
    await post(`/api/v1/platform/institutions/${instA}/subscription`, tok.root, { packageId: pkg, status: "active" });
    const kpis = await get("/api/v1/platform/kpis", tok.root);
    expect(kpis.body).toHaveProperty("activeSubscriptions");
    expect(kpis.body.activeSubscriptions).toBeGreaterThanOrEqual(1);
  });

  it("loads platform health and SMTP status (graceful when unconfigured)", async () => {
    const health = await get("/api/v1/platform/health", tok.root);
    expect(health.status).toBe(200);
    expect(health.body).toHaveProperty("postgres");
    expect(health.body.postgres).toBe(true);
    expect(health.body).toHaveProperty("uptimeSeconds");

    const status = await get("/api/v1/platform/email/status", tok.root);
    expect(status.status).toBe(200);
    expect(status.body).toHaveProperty("configured");
    // SMTP is not configured in the test env → test send degrades to 503, never 500.
    const test = await post("/api/v1/platform/email/test", tok.root, { to: "ops@example.com" });
    expect([200, 503]).toContain(test.status);
    if (test.status === 503) expect(test.body.ok).toBe(false);
  });

  it("rounds-trips per-institution limit overrides (override wins over the plan)", async () => {
    const res = await request(app)
      .patch(`/api/v1/platform/institutions/${instA}/limits`)
      .set(auth(tok.root))
      .send({ maxStudents: 5, maxBranches: 2, reportsQuota: 10 });
    expect(res.status).toBe(200);
    const detail = await get(`/api/v1/platform/institutions/${instA}`, tok.root);
    expect(detail.status).toBe(200);
    // The effective limits (not the package) must reflect the override and expose
    // every row the detail UI renders.
    expect(detail.body.limits.maxStudents).toBe(5);
    expect(detail.body.limits.maxBranches).toBe(2);
    expect(detail.body.limits.reportsQuota).toBe(10);
    expect(detail.body.limits).toHaveProperty("branches");
  });

  it("accepts trialing subscription status and rejects an invalid one", async () => {
    const pkg = (
      await query<{ id: string }>(
        `INSERT INTO subscription_packages (name, price, billing_cycle)
         VALUES ('Trial Pkg', 0, 'monthly') RETURNING id`,
        []
      )
    ).rows[0].id;
    const ok = await post(`/api/v1/platform/institutions/${instA}/subscription`, tok.root, {
      packageId: pkg,
      status: "trialing",
    });
    expect(ok.status).toBe(201);
    // The old/incorrect UI value 'trial' must be rejected (matches the schema/DB enum).
    const bad = await post(`/api/v1/platform/institutions/${instA}/subscription`, tok.root, {
      packageId: pkg,
      status: "trial",
    });
    expect(bad.status).toBe(400);
  });

  it("enforces a single active support session (server-side) with an audited end", async () => {
    const first = await post("/api/v1/platform/impersonate", tok.root, {
      userId: adminId,
      reason: "support session one",
    });
    expect(first.status).toBe(200);

    // A second concurrent session is refused server-side (409), not just in the UI.
    const second = await post("/api/v1/platform/impersonate", tok.root, {
      userId: adminId,
      reason: "support session two",
    });
    expect(second.status).toBe(409);

    // Ending the session is audited and lets a new one start.
    const ended = await post("/api/v1/platform/impersonate/end", tok.root, {});
    expect(ended.status).toBe(200);
    expect(ended.body.ended).toBeGreaterThanOrEqual(1);

    const third = await post("/api/v1/platform/impersonate", tok.root, {
      userId: adminId,
      reason: "support session three",
    });
    expect(third.status).toBe(200);

    const audit = await get("/api/v1/platform/audit?action=impersonate.end", tok.root);
    expect(audit.body.rows.length).toBeGreaterThanOrEqual(1);
  });

  it("searches the audit log by institution name", async () => {
    await post(`/api/v1/platform/institutions/${instA}/suspend`, tok.root, { reason: "by-institution audit search" });
    // instA was created with code ALPHA → name 'Institution ALPHA'.
    const res = await get("/api/v1/platform/audit?q=ALPHA", tok.root);
    expect(res.status).toBe(200);
    expect(res.body.rows.some((r: { institutionId: string }) => r.institutionId === instA)).toBe(true);
  });
});
