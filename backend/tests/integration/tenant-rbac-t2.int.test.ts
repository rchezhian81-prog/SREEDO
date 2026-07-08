import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { app, createInstitution, createUser, resetDb, tokenFor } from "./helpers";

// PR-T2 — Tenant RBAC v2: per-tenant role permission overrides, server-side
// enforcement, isolation, safety rails and audit.
describe("Tenant RBAC v2 (T2)", () => {
  const tok: Record<string, string> = {};
  const PW = "Passw0rd!";
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const get = (p: string, t: string) => request(app).get(p).set(auth(t));
  const post = (p: string, t: string, b?: unknown) =>
    request(app).post(p).set(auth(t)).send(b ?? {});
  const put = (p: string, t: string, b?: unknown) =>
    request(app).put(p).set(auth(t)).send(b ?? {});

  // Flatten a role-detail payload to the set of currently-granted registry keys.
  const grantedKeys = (roleDetail: {
    groups: { permissions: { key: string; granted: boolean }[] }[];
  }): string[] =>
    roleDetail.groups.flatMap((g) =>
      g.permissions.filter((p) => p.granted).map((p) => p.key)
    );

  beforeEach(async () => {
    await resetDb();
    const a = await createInstitution("AAA");
    const b = await createInstitution("BBB");
    await createUser({ email: "admin@a.dev", password: PW, role: "admin", institutionId: a });
    await createUser({ email: "teacher@a.dev", password: PW, role: "teacher", institutionId: a });
    await createUser({ email: "acct@a.dev", password: PW, role: "accountant", institutionId: a });
    await createUser({ email: "student@a.dev", password: PW, role: "student", institutionId: a });
    await createUser({ email: "parent@a.dev", password: PW, role: "parent", institutionId: a });
    await createUser({ email: "admin@b.dev", password: PW, role: "admin", institutionId: b });
    await createUser({ email: "teacher@b.dev", password: PW, role: "teacher", institutionId: b });
    tok.a = await tokenFor("admin@a.dev", PW);
    tok.teacher = await tokenFor("teacher@a.dev", PW);
    tok.acct = await tokenFor("acct@a.dev", PW);
    tok.student = await tokenFor("student@a.dev", PW);
    tok.parent = await tokenFor("parent@a.dev", PW);
    tok.b = await tokenFor("admin@b.dev", PW);
    tok.bTeacher = await tokenFor("teacher@b.dev", PW);
  });

  // ---- registry + roles -----------------------------------------------------

  it("serves the registry and the five built-in roles", async () => {
    const res = await get("/api/v1/tenant-rbac/registry", tok.a);
    expect(res.status).toBe(200);
    expect(res.body.roles.map((r: { key: string }) => r.key).sort()).toEqual(
      ["accountant", "admin", "parent", "student", "teacher"].sort()
    );
    expect(res.body.groups.length).toBeGreaterThan(10);
    expect(res.body.highRiskKeys).toContain("tenant_rbac:manage");
  });

  it("is read-gated by tenant_rbac:read (teacher/student get 403, admin 200)", async () => {
    expect((await get("/api/v1/tenant-rbac/roles", tok.a)).status).toBe(200);
    expect((await get("/api/v1/tenant-rbac/roles", tok.teacher)).status).toBe(403);
    expect((await get("/api/v1/tenant-rbac/roles", tok.student)).status).toBe(403);
    expect((await get("/api/v1/tenant-rbac/registry", tok.parent)).status).toBe(403);
  });

  // ---- effective permissions (zero-override defaults) -----------------------

  it("resolves correct default effective permissions per role (no overrides)", async () => {
    const admin = (await get("/api/v1/tenant-rbac/me", tok.a)).body;
    expect(admin.role).toBe("admin");
    expect(admin.permissions).toEqual(
      expect.arrayContaining([
        "tenant_rbac:manage",
        "users:manage",
        "students:create",
        "teachers:manage",
        "exams:manage",
      ])
    );
    const teacher = (await get("/api/v1/tenant-rbac/me", tok.teacher)).body;
    expect(teacher.permissions).toEqual(
      expect.arrayContaining(["attendance:mark", "exams:enter_marks"])
    );
    expect(teacher.permissions).not.toContain("tenant_rbac:manage");
    expect(teacher.permissions).not.toContain("students:create");
    expect(teacher.permissions).not.toContain("teachers:manage");
  });

  // ---- server-side enforcement ---------------------------------------------

  it("enforces students:create — admin 201, teacher 403 (missing permission → 403)", async () => {
    const okBody = { firstName: "Ann", lastName: "Lee" };
    expect((await post("/api/v1/students", tok.a, okBody)).status).toBe(201);
    expect((await post("/api/v1/students", tok.teacher, okBody)).status).toBe(403);
    expect((await post("/api/v1/students", tok.student, okBody)).status).toBe(403);
  });

  it("teachers directory is staff-only (student/parent 403 — PII fix), staff 200", async () => {
    expect((await get("/api/v1/teachers", tok.a)).status).toBe(200);
    expect((await get("/api/v1/teachers", tok.teacher)).status).toBe(200);
    expect((await get("/api/v1/teachers", tok.acct)).status).toBe(200);
    expect((await get("/api/v1/teachers", tok.student)).status).toBe(403);
    expect((await get("/api/v1/teachers", tok.parent)).status).toBe(403);
  });

  it("accountant is blocked from exam marks entry and RBAC management", async () => {
    // Non-existent exam id — the permission guard runs before the handler, so a
    // lack of permission is a 403 regardless of the body/id.
    const fakeExam = "00000000-0000-0000-0000-000000000000";
    expect(
      (await post(`/api/v1/exams/${fakeExam}/results`, tok.acct, { results: [] })).status
    ).toBe(403);
    expect((await put("/api/v1/tenant-rbac/roles/teacher", tok.acct, { permissions: [] })).status).toBe(403);
  });

  // ---- per-tenant override + isolation -------------------------------------

  it("grants a per-tenant permission that is enforced and isolated to the tenant", async () => {
    const teacherRole = (await get("/api/v1/tenant-rbac/roles/teacher", tok.a)).body;
    const desired = [...new Set([...grantedKeys(teacherRole), "students:create"])];
    const upd = await put("/api/v1/tenant-rbac/roles/teacher", tok.a, { permissions: desired });
    expect(upd.status).toBe(200);

    // A's teacher can now create students; effective + matrix reflect it.
    expect((await post("/api/v1/students", tok.teacher, { firstName: "Jo", lastName: "Ng" })).status).toBe(201);
    expect((await get("/api/v1/tenant-rbac/me", tok.teacher)).body.permissions).toContain("students:create");
    const matrix = (await get("/api/v1/tenant-rbac/matrix", tok.a)).body;
    expect(matrix.effective.teacher).toContain("students:create");

    // B's teacher is completely unaffected (per-tenant isolation).
    expect((await post("/api/v1/students", tok.bTeacher, { firstName: "No", lastName: "Pe" })).status).toBe(403);
    expect((await get("/api/v1/tenant-rbac/me", tok.bTeacher)).body.permissions).not.toContain("students:create");
  });

  it("revokes (denies) a default permission for the tenant", async () => {
    // teacher has attendance:mark by default — remove it for this tenant only.
    const teacherRole = (await get("/api/v1/tenant-rbac/roles/teacher", tok.a)).body;
    const desired = grantedKeys(teacherRole).filter((k) => k !== "attendance:mark");
    const res = await put("/api/v1/tenant-rbac/roles/teacher", tok.a, {
      permissions: desired,
    });
    expect(res.status).toBe(200);
    expect((await get("/api/v1/tenant-rbac/me", tok.teacher)).body.permissions).not.toContain("attendance:mark");
    // B's teacher still has it.
    expect((await get("/api/v1/tenant-rbac/me", tok.bTeacher)).body.permissions).toContain("attendance:mark");
  });

  // ---- safety rails ---------------------------------------------------------

  it("requires a reason for high-risk permission changes", async () => {
    const teacherRole = (await get("/api/v1/tenant-rbac/roles/teacher", tok.a)).body;
    // students:delete is high-risk and admin-only by default, so this is a real
    // high-risk grant for the teacher role.
    const desired = [...new Set([...grantedKeys(teacherRole), "students:delete"])];
    // 400 without a reason.
    expect((await put("/api/v1/tenant-rbac/roles/teacher", tok.a, { permissions: desired })).status).toBe(400);
    // With a reason it succeeds.
    const ok = await put("/api/v1/tenant-rbac/roles/teacher", tok.a, {
      permissions: desired,
      reason: "Registrar delegated student archival",
    });
    expect(ok.status).toBe(200);
  });

  it("prevents locking the admin role out of RBAC / user management", async () => {
    const adminRole = (await get("/api/v1/tenant-rbac/roles/admin", tok.a)).body;
    const desired = grantedKeys(adminRole).filter((k) => k !== "tenant_rbac:manage");
    const res = await put("/api/v1/tenant-rbac/roles/admin", tok.a, {
      permissions: desired,
      reason: "attempt",
    });
    expect(res.status).toBe(400);
    // admin still has it.
    expect((await get("/api/v1/tenant-rbac/me", tok.a)).body.permissions).toContain("tenant_rbac:manage");
  });

  it("refuses to grant admin permissions to a portal role (student/parent)", async () => {
    const studentRole = (await get("/api/v1/tenant-rbac/roles/student", tok.a)).body;
    const desired = [...new Set([...grantedKeys(studentRole), "students:create"])];
    const res = await put("/api/v1/tenant-rbac/roles/student", tok.a, {
      permissions: desired,
      reason: "nope",
    });
    expect(res.status).toBe(400);
  });

  // ---- reset + audit --------------------------------------------------------

  it("resets a role to its global defaults", async () => {
    const teacherRole = (await get("/api/v1/tenant-rbac/roles/teacher", tok.a)).body;
    const desired = [...new Set([...grantedKeys(teacherRole), "students:create"])];
    await put("/api/v1/tenant-rbac/roles/teacher", tok.a, { permissions: desired });
    expect((await get("/api/v1/tenant-rbac/me", tok.teacher)).body.permissions).toContain("students:create");

    const reset = await post("/api/v1/tenant-rbac/roles/teacher/reset", tok.a);
    expect(reset.status).toBe(200);
    expect((await get("/api/v1/tenant-rbac/me", tok.teacher)).body.permissions).not.toContain("students:create");
  });

  it("audits permission changes and keeps the trail tenant-scoped", async () => {
    const teacherRole = (await get("/api/v1/tenant-rbac/roles/teacher", tok.a)).body;
    const desired = [...new Set([...grantedKeys(teacherRole), "students:create"])];
    await put("/api/v1/tenant-rbac/roles/teacher", tok.a, { permissions: desired });

    const auditA = (await get("/api/v1/tenant-rbac/audit", tok.a)).body;
    expect(auditA.total).toBeGreaterThanOrEqual(1);
    expect(auditA.data[0].action).toBe("role.permissions.updated");
    expect(auditA.data[0].targetRole).toBe("teacher");
    // B never changed anything — its trail is empty.
    expect((await get("/api/v1/tenant-rbac/audit", tok.b)).body.total).toBe(0);
  });

  it("404s an unknown tenant role", async () => {
    expect((await get("/api/v1/tenant-rbac/roles/superhero", tok.a)).status).toBe(404);
    expect((await put("/api/v1/tenant-rbac/roles/superhero", tok.a, { permissions: [] })).status).toBe(404);
  });
});
