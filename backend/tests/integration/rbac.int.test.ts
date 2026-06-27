import { afterEach, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { app, createInstitution, createUser, resetDb, tokenFor } from "./helpers";

const PW = "Passw0rd!";

describe("global user-role management (RBAC console)", () => {
  let instA: string;
  const tok: Record<string, string> = {};

  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const get = (p: string, t: string) => request(app).get(p).set(auth(t));
  const post = (p: string, t: string, body?: unknown) =>
    request(app).post(p).set(auth(t)).send(body as object);

  const grant = (role: string, permissionKey: string, t = tok.root, reason?: string) =>
    post(`/api/v1/platform/roles/${role}/permissions`, t, { permissionKey, reason });
  const revoke = (role: string, permissionKey: string, t = tok.root, reason?: string) =>
    post(`/api/v1/platform/roles/${role}/permissions/revoke`, t, { permissionKey, reason });

  beforeEach(async () => {
    await resetDb();
    instA = await createInstitution("RBAC");
    await createUser({ email: "root@r.dev", password: PW, role: "super_admin", institutionId: null });
    tok.root = await tokenFor("root@r.dev", PW);
    for (const role of ["admin", "accountant", "teacher", "student", "parent"] as const) {
      await createUser({ email: `${role}@r.dev`, password: PW, role, institutionId: instA });
      tok[role] = await tokenFor(`${role}@r.dev`, PW);
    }
  });

  // role_permissions is shared (not truncated by resetDb) — undo any test grant
  // so RBAC tests never contaminate the rest of the suite.
  afterEach(async () => {
    if (tok.root) await revoke("teacher", "jobs:read", tok.root);
  });

  it("shows the permission catalogue grouped by module, with roles", async () => {
    const res = await get("/api/v1/platform/permissions", tok.root);
    expect(res.status).toBe(200);
    const modules = res.body.map((g: { module: string }) => g.module);
    expect(modules).toEqual(expect.arrayContaining(["fees", "jobs", "platform", "observability"]));
    const jobsGroup = res.body.find((g: { module: string }) => g.module === "jobs");
    const jobsRead = jobsGroup.permissions.find((p: { key: string }) => p.key === "jobs:read");
    expect(jobsRead.roles).toEqual(expect.arrayContaining(["admin", "super_admin"]));
  });

  it("shows the role → permission matrix", async () => {
    const res = await get("/api/v1/platform/roles", tok.root);
    expect(res.status).toBe(200);
    const admin = res.body.find((r: { role: string }) => r.role === "admin");
    expect(Array.isArray(admin.permissions)).toBe(true);
    expect(admin.permissions).toContain("jobs:read");
  });

  it("grants then revokes a permission, with the change taking effect immediately (cache invalidated)", async () => {
    // teacher lacks jobs:read → blocked from the jobs console.
    expect((await get("/api/v1/jobs", tok.teacher)).status).toBe(403);

    const g = await grant("teacher", "jobs:read", tok.root, "support");
    expect(g.status).toBe(200);
    expect(g.body.granted).toBe(true);
    // Same teacher token now works — no restart, cache was invalidated.
    expect((await get("/api/v1/jobs", tok.teacher)).status).toBe(200);

    const r = await revoke("teacher", "jobs:read", tok.root);
    expect(r.body.removed).toBe(true);
    expect((await get("/api/v1/jobs", tok.teacher)).status).toBe(403);
  });

  it("handles duplicate grants idempotently", async () => {
    expect((await grant("teacher", "jobs:read")).body.alreadyGranted).toBe(false);
    const dup = await grant("teacher", "jobs:read");
    expect(dup.status).toBe(200);
    expect(dup.body.alreadyGranted).toBe(true);
    // Only one row exists.
    const jobsGroup = (await get("/api/v1/platform/permissions", tok.root)).body.find(
      (g: { module: string }) => g.module === "jobs"
    );
    const jobsRead = jobsGroup.permissions.find((p: { key: string }) => p.key === "jobs:read");
    expect(jobsRead.roles.filter((x: string) => x === "teacher")).toHaveLength(1);
  });

  it("rejects granting a non-existent permission", async () => {
    expect((await grant("teacher", "does_not_exist:perm")).status).toBe(404);
  });

  it("protects super_admin's critical platform permissions from revocation", async () => {
    const res = await revoke("super_admin", "platform:rbac_manage", tok.root);
    expect(res.status).toBe(400);
    // Still present.
    const matrix = (await get("/api/v1/platform/roles", tok.root)).body.find(
      (r: { role: string }) => r.role === "super_admin"
    );
    expect(matrix.permissions).toContain("platform:rbac_manage");
  });

  it("writes a durable audit entry for grant and revoke", async () => {
    await grant("teacher", "jobs:read", tok.root, "ticket-42");
    await revoke("teacher", "jobs:read", tok.root, "done");
    const granted = await get("/api/v1/platform/audit?action=rbac.grant", tok.root);
    expect(granted.body.some((a: { detail: { role: string; permission: string } }) =>
      a.detail.role === "teacher" && a.detail.permission === "jobs:read")).toBe(true);
    const revoked = await get("/api/v1/platform/audit?action=rbac.revoke", tok.root);
    expect(revoked.body.length).toBeGreaterThanOrEqual(1);
  });

  it("denies tenant admins and all tenant users (super-admin boundary)", async () => {
    for (const role of ["admin", "accountant", "teacher", "student", "parent"] as const) {
      expect((await get("/api/v1/platform/permissions", tok[role])).status).toBe(403);
      expect((await get("/api/v1/platform/roles", tok[role])).status).toBe(403);
      expect((await grant("student", "jobs:read", tok[role])).status).toBe(403);
    }
  });

  it("leaks no secrets in catalogue, matrix, or audit output", async () => {
    await grant("teacher", "jobs:read", tok.root);
    const cat = await get("/api/v1/platform/permissions", tok.root);
    const matrix = await get("/api/v1/platform/roles", tok.root);
    const audit = await get("/api/v1/platform/audit?action=rbac.grant", tok.root);
    for (const res of [cat, matrix, audit]) {
      expect(JSON.stringify(res.body)).not.toMatch(/password|secret|token|accessToken|hash/i);
    }
  });
});
