import { afterEach, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { app, createInstitution, createUser, query, resetDb, tokenFor } from "./helpers";
import { clearCache, resetCacheStats } from "../../src/cache/cache";

const PW = "Passw0rd!";

describe("hot-path read cache + invalidation + cache metrics", () => {
  let instA: string;
  let instB: string;
  const tok: Record<string, string> = {};

  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const get = (p: string, t: string) => request(app).get(p).set(auth(t));
  const post = (p: string, t: string, body?: unknown) =>
    request(app).post(p).set(auth(t)).send(body as object);

  const grant = (role: string, permissionKey: string, t = tok.root) =>
    post(`/api/v1/platform/roles/${role}/permissions`, t, { permissionKey });
  const revoke = (role: string, permissionKey: string, t = tok.root) =>
    post(`/api/v1/platform/roles/${role}/permissions/revoke`, t, { permissionKey });

  // Insert a student straight into the DB, bypassing the service layer (and thus
  // its cache invalidation) — lets us prove a later read was served from cache.
  const insertStudentDirect = (instId: string, admissionNo: string) =>
    query(
      `INSERT INTO students (institution_id, admission_no, first_name, last_name, status)
       VALUES ($1, $2, 'Direct', 'Insert', 'active')`,
      [instId, admissionNo]
    );

  beforeEach(async () => {
    await resetDb();
    // Start every test from an empty cache with zeroed counters so hit/miss
    // assertions are deterministic and isolated from the previous test.
    clearCache();
    resetCacheStats();
    instA = await createInstitution("CACHEA");
    instB = await createInstitution("CACHEB");
    await createUser({ email: "root@c.dev", password: PW, role: "super_admin", institutionId: null });
    tok.root = await tokenFor("root@c.dev", PW);
    await createUser({ email: "admin-a@c.dev", password: PW, role: "admin", institutionId: instA });
    tok.adminA = await tokenFor("admin-a@c.dev", PW);
    await createUser({ email: "admin-b@c.dev", password: PW, role: "admin", institutionId: instB });
    tok.adminB = await tokenFor("admin-b@c.dev", PW);
    await createUser({ email: "teacher@c.dev", password: PW, role: "teacher", institutionId: instA });
    tok.teacher = await tokenFor("teacher@c.dev", PW);
  });

  // role_permissions is shared (not truncated by resetDb) — undo any test grant
  // so these tests never contaminate the rest of the suite.
  afterEach(async () => {
    if (tok.root) await revoke("teacher", "jobs:read", tok.root);
  });

  it("serves a hot read from cache (miss then hit) without recomputing", async () => {
    // First read: cache miss → computed (no students yet).
    const first = await get("/api/v1/dashboard/stats", tok.adminA);
    expect(first.status).toBe(200);
    expect(first.body.activeStudents).toBe(0);

    // Mutate the DB behind the cache's back (no invalidation hook fires).
    await insertStudentDirect(instA, "DIRECT-A1");

    // Second read within TTL: served from cache → still the stale value.
    const second = await get("/api/v1/dashboard/stats", tok.adminA);
    expect(second.status).toBe(200);
    expect(second.body.activeStudents).toBe(0);
  });

  it("invalidates the dashboard cache after a write through the API", async () => {
    // Prime the cache (0 students).
    expect((await get("/api/v1/dashboard/stats", tok.adminA)).body.activeStudents).toBe(0);

    // Create a student through the API → invalidateDashboard fires.
    const created = await post("/api/v1/students", tok.adminA, { firstName: "Cache", lastName: "Test" });
    expect(created.status).toBe(201);

    // The next read reflects the write immediately (the entry was dropped).
    expect((await get("/api/v1/dashboard/stats", tok.adminA)).body.activeStudents).toBe(1);
  });

  it("keeps each tenant's cache isolated (invalidation is tenant-scoped)", async () => {
    // Prime both tenants' caches.
    expect((await get("/api/v1/dashboard/stats", tok.adminA)).body.activeStudents).toBe(0);
    expect((await get("/api/v1/dashboard/stats", tok.adminB)).body.activeStudents).toBe(0);

    // Quietly add a student to B (no invalidation) and create one in A via API.
    await insertStudentDirect(instB, "DIRECT-B1");
    await post("/api/v1/students", tok.adminA, { firstName: "A", lastName: "Only" });

    // A's cache was invalidated → reflects A's new student, and only A's.
    expect((await get("/api/v1/dashboard/stats", tok.adminA)).body.activeStudents).toBe(1);
    // B's cache was untouched by A's write → still the cached 0 (no leakage).
    expect((await get("/api/v1/dashboard/stats", tok.adminB)).body.activeStudents).toBe(0);
  });

  it("caches the RBAC catalogue/matrix and invalidates them on a role change", async () => {
    // Prime the catalogue cache (teacher lacks jobs:read).
    const before = await get("/api/v1/platform/permissions", tok.root);
    const jobsBefore = before.body
      .find((g: { module: string }) => g.module === "jobs")
      .permissions.find((p: { key: string }) => p.key === "jobs:read");
    expect(jobsBefore.roles).not.toContain("teacher");

    // Grant via API → invalidatePrefix("rbac:") fires.
    expect((await grant("teacher", "jobs:read")).status).toBe(200);

    // Re-read: catalogue recomputed → teacher now present (not a stale hit).
    const after = await get("/api/v1/platform/permissions", tok.root);
    const jobsAfter = after.body
      .find((g: { module: string }) => g.module === "jobs")
      .permissions.find((p: { key: string }) => p.key === "jobs:read");
    expect(jobsAfter.roles).toContain("teacher");

    // The matrix view reflects it too.
    const matrix = await get("/api/v1/platform/roles", tok.root);
    const teacherRow = matrix.body.find((r: { role: string }) => r.role === "teacher");
    expect(teacherRow.permissions).toContain("jobs:read");
  });

  it("grants no stale access after a role change (runtime permission cache invalidated)", async () => {
    // teacher is blocked from the jobs console.
    expect((await get("/api/v1/jobs", tok.teacher)).status).toBe(403);
    // Grant → immediately usable, no restart.
    await grant("teacher", "jobs:read");
    expect((await get("/api/v1/jobs", tok.teacher)).status).toBe(200);
    // Revoke → access removed immediately, no stale cached permission.
    await revoke("teacher", "jobs:read");
    expect((await get("/api/v1/jobs", tok.teacher)).status).toBe(403);
  });

  it("exposes cache hit/miss/invalidation counters via /observability/metrics", async () => {
    await get("/api/v1/dashboard/stats", tok.adminA); // miss
    await get("/api/v1/dashboard/stats", tok.adminA); // hit
    await post("/api/v1/students", tok.adminA, { firstName: "M", lastName: "Etrics" }); // invalidation

    const res = await get("/api/v1/observability/metrics", tok.root);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/plain");
    expect(res.text).toContain("cache_hits_total");
    expect(res.text).toContain("cache_misses_total");
    expect(res.text).toContain("cache_invalidations_total");
    expect(res.text).toContain("cache_entries");
    // The metrics exposition carries no secrets or tenant data.
    expect(res.text).not.toMatch(/password|secret|token/i);
  });

  it("reports cache counters in the observability overview JSON", async () => {
    await get("/api/v1/dashboard/stats", tok.adminA); // miss
    await get("/api/v1/dashboard/stats", tok.adminA); // hit

    const res = await get("/api/v1/observability/overview", tok.root);
    expect(res.status).toBe(200);
    expect(res.body.cache).toBeDefined();
    expect(res.body.cache.hits).toBeGreaterThanOrEqual(1);
    expect(res.body.cache.misses).toBeGreaterThanOrEqual(1);
    expect(typeof res.body.cache.invalidations).toBe("number");
    expect(typeof res.body.cache.size).toBe("number");
  });

  it("keeps cache endpoints behind the super-admin observability boundary", async () => {
    // Tenant users cannot read the metrics/overview that expose cache counters.
    expect((await get("/api/v1/observability/metrics", tok.adminA)).status).toBe(403);
    expect((await get("/api/v1/observability/overview", tok.teacher)).status).toBe(403);
  });
});
