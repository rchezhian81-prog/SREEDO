import { beforeEach, describe, expect, it } from "vitest";
import { app, createInstitution, createUser, resetDb, tokenFor } from "./helpers";
import request from "supertest";

// PR-T2.1 — finer assignable job-roles, delegated permissions, fees-reversal
// safety, and portal-role blocking.
describe("Tenant RBAC v2.1 (T2.1) — job-roles + delegation", () => {
  const tok: Record<string, string> = {};
  const uid: Record<string, string> = {};
  const PW = "Passw0rd!";
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const get = (p: string, t: string) => request(app).get(p).set(auth(t));
  const post = (p: string, t: string, b?: unknown) => request(app).post(p).set(auth(t)).send(b ?? {});
  const put = (p: string, t: string, b?: unknown) => request(app).put(p).set(auth(t)).send(b ?? {});
  const perms = async (t: string): Promise<string[]> =>
    (await get("/api/v1/tenant-rbac/me", t)).body.permissions;

  beforeEach(async () => {
    await resetDb();
    const a = await createInstitution("AAA");
    const b = await createInstitution("BBB");
    uid.admin = (await createUser({ email: "admin@a.dev", password: PW, role: "admin", institutionId: a })).id;
    uid.teacher = (await createUser({ email: "teacher@a.dev", password: PW, role: "teacher", institutionId: a })).id;
    uid.acct = (await createUser({ email: "acct@a.dev", password: PW, role: "accountant", institutionId: a })).id;
    uid.student = (await createUser({ email: "student@a.dev", password: PW, role: "student", institutionId: a })).id;
    uid.spare = (await createUser({ email: "spare@a.dev", password: PW, role: "teacher", institutionId: a })).id;
    await createUser({ email: "admin@b.dev", password: PW, role: "admin", institutionId: b });
    tok.admin = await tokenFor("admin@a.dev", PW);
    tok.teacher = await tokenFor("teacher@a.dev", PW);
    tok.acct = await tokenFor("acct@a.dev", PW);
    tok.student = await tokenFor("student@a.dev", PW);
    tok.b = await tokenFor("admin@b.dev", PW);
  });

  const assign = (userId: string, jobRoleKey: string | null, t = tok.admin) =>
    post(`/api/v1/tenant-rbac/users/${userId}/job-role`, t, { jobRoleKey });

  // ---- job-role registry ----------------------------------------------------

  it("lists the 19 built-in job-roles (admin-gated)", async () => {
    const res = await get("/api/v1/tenant-rbac/job-roles", tok.admin);
    expect(res.status).toBe(200);
    expect(res.body.roles).toHaveLength(19);
    expect(res.body.roles.map((r: { key: string }) => r.key)).toContain("jr_fees_officer");
    expect((await get("/api/v1/tenant-rbac/job-roles", tok.teacher)).status).toBe(403);
  });

  // ---- coarse behaviour preserved (no job role) -----------------------------

  it("preserves coarse-role effective permissions after the delegation migration", async () => {
    const admin = await perms(tok.admin);
    expect(admin).toEqual(expect.arrayContaining([
      "fees:manage", "fees:payment", "fees:reverse", "classes:manage",
      "admissions:create", "calendar:manage", "front_office:manage", "announcements:manage",
    ]));
    const acct = await perms(tok.acct);
    expect(acct).toEqual(expect.arrayContaining(["fees:manage", "fees:payment"]));
    expect(acct).not.toContain("fees:reverse");
    const teacher = await perms(tok.teacher);
    expect(teacher).toEqual(expect.arrayContaining(["announcements:manage", "attendance:mark", "exams:enter_marks"]));
    expect(teacher).not.toContain("fees:manage");
  });

  // ---- assigning a finer job-role -------------------------------------------

  it("assigns jr_fees_officer and resolves its finer permission set", async () => {
    expect((await assign(uid.spare, "jr_fees_officer")).status).toBe(200);
    const t = await tokenFor("spare@a.dev", PW);
    const p = await perms(t);
    expect(p).toEqual(expect.arrayContaining(["fees:manage", "fees:payment"]));
    expect(p).not.toContain("fees:reverse"); // reserved
    expect(p).not.toContain("exams:enter_marks"); // not a fees role
    expect(p).not.toContain("tenant_rbac:manage");
    // "Users in role" resolves job-roles via job_role_key (not the user_role enum).
    const inRole = await get("/api/v1/tenant-rbac/roles/jr_fees_officer/users", tok.admin);
    expect(inRole.status).toBe(200);
    expect(inRole.body.users.some((u: { id: string }) => u.id === uid.spare)).toBe(true);
  });

  it("delegates attendance without student management (enforced on real routes)", async () => {
    await assign(uid.spare, "jr_attendance_officer");
    const t = await tokenFor("spare@a.dev", PW);
    const p = await perms(t);
    expect(p).toContain("attendance:mark");
    expect(p).not.toContain("students:create");
    // Enforced: can reach attendance mark (guard passes), blocked from student create.
    expect((await post("/api/v1/students", t, { firstName: "A", lastName: "B" })).status).toBe(403);
    expect((await post("/api/v1/attendance", t, { date: "2026-01-10", records: [] })).status).not.toBe(403);
  });

  it("assigning sets the base coarse role; clearing removes the job-role", async () => {
    const assigned = await assign(uid.spare, "jr_fees_officer");
    expect(assigned.body.jobRoleKey).toBe("jr_fees_officer");
    expect(assigned.body.role).toBe("accountant"); // base_role applied to the coarse role
    const cleared = await assign(uid.spare, null);
    expect(cleared.status).toBe(200);
    expect(cleared.body.jobRoleKey).toBeNull();
    // Resolution falls back to the coarse role (now accountant) and still resolves.
    const p = await perms(await tokenFor("spare@a.dev", PW));
    expect(p).toContain("fees:manage"); // coarse accountant default
    expect(p).not.toContain("tenant_rbac:manage");
  });

  // ---- fees-reversal safety --------------------------------------------------

  it("fees:reverse is gated and reason-required", async () => {
    // fees_officer lacks fees:reverse -> 403 on the refund write.
    await assign(uid.spare, "jr_fees_officer");
    const officer = await tokenFor("spare@a.dev", PW);
    expect((await post("/api/v1/fee-refunds", officer, { paymentId: "00000000-0000-0000-0000-000000000000", amount: 100, reason: "x" })).status).toBe(403);
    // admin has fees:reverse but a reason is mandatory.
    expect((await post("/api/v1/fee-refunds", tok.admin, { paymentId: "00000000-0000-0000-0000-000000000000", amount: 100 })).status).toBe(400);
    // With permission + reason the guard/validation passes (404: payment not found).
    expect((await post("/api/v1/fee-refunds", tok.admin, { paymentId: "00000000-0000-0000-0000-000000000000", amount: 100, reason: "duplicate charge" })).status).not.toBe(403);
  });

  // ---- portal-role protection -----------------------------------------------

  it("never assigns a job-role to a student/parent account", async () => {
    expect((await assign(uid.student, "jr_fees_officer")).status).toBe(400);
    // student stays blocked from admin APIs.
    expect((await post("/api/v1/students", tok.student, { firstName: "A", lastName: "B" })).status).toBe(403);
    expect((await get("/api/v1/tenant-rbac/job-roles", tok.student)).status).toBe(403);
  });

  // ---- assignment safety rails ----------------------------------------------

  it("prevents an admin self-demoting out of management (self-lockout)", async () => {
    expect((await assign(uid.admin, "jr_fees_officer")).status).toBe(400);
    expect(await perms(tok.admin)).toContain("tenant_rbac:manage");
  });

  // ---- per-tenant job-role override + isolation -----------------------------

  it("supports per-tenant override on a job-role, isolated across tenants", async () => {
    await assign(uid.spare, "jr_fees_officer");
    // Grant fees:reverse to jr_fees_officer for tenant A only (high-risk -> reason).
    const role = (await get("/api/v1/tenant-rbac/roles/jr_fees_officer", tok.admin)).body;
    const granted = role.groups.flatMap((g: { permissions: { key: string; granted: boolean }[] }) =>
      g.permissions.filter((p) => p.granted).map((p) => p.key));
    const upd = await put("/api/v1/tenant-rbac/roles/jr_fees_officer", tok.admin, {
      permissions: [...new Set([...granted, "fees:reverse"])],
      reason: "Senior accountant handles reversals",
    });
    expect(upd.status).toBe(200);
    expect(await perms(await tokenFor("spare@a.dev", PW))).toContain("fees:reverse");
    // Tenant B's jr_fees_officer is unaffected.
    const bRole = (await get("/api/v1/tenant-rbac/roles/jr_fees_officer", tok.b)).body;
    const bReverse = bRole.groups.flatMap((g: { permissions: { key: string; granted: boolean }[] }) => g.permissions)
      .find((p: { key: string }) => p.key === "fees:reverse");
    expect(bReverse.granted).toBe(false);
  });
});
