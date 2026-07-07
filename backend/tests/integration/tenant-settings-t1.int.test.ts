import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { app, createInstitution, createUser, resetDb, tokenFor } from "./helpers";

// PR-T1 — unified Tenant Settings + academic-year management + the canonical
// (single-source-of-truth) school/college mode switch.
describe("Tenant Settings (T1) — settings home, academic years, mode switch", () => {
  const tok: Record<string, string> = {};
  const PW = "Passw0rd!";
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const get = (p: string, t: string) => request(app).get(p).set(auth(t));
  const post = (p: string, t: string, b?: unknown) => request(app).post(p).set(auth(t)).send(b ?? {});
  const patch = (p: string, t: string, b?: unknown) => request(app).patch(p).set(auth(t)).send(b ?? {});

  beforeEach(async () => {
    await resetDb();
    const instA = await createInstitution("AAA");
    const instB = await createInstitution("BBB");
    await createUser({ email: "admin@a.dev", password: PW, role: "admin", institutionId: instA });
    await createUser({ email: "teacher@a.dev", password: PW, role: "teacher", institutionId: instA });
    await createUser({ email: "admin@b.dev", password: PW, role: "admin", institutionId: instB });
    tok.a = await tokenFor("admin@a.dev", PW);
    tok.teacher = await tokenFor("teacher@a.dev", PW);
    tok.b = await tokenFor("admin@b.dev", PW);
  });

  // ---- settings home --------------------------------------------------------

  it("serves the unified settings home (profile read-only, mode, academic years, modules)", async () => {
    const res = await get("/api/v1/tenant-settings", tok.a);
    expect(res.status).toBe(200);
    expect(res.body.institution.code).toBe("AAA");
    expect(res.body.institution.name).toBeTruthy();
    expect(res.body.profileManagedBy).toBe("platform");
    expect(res.body.mode).toBe("school"); // default
    expect(Array.isArray(res.body.academicYears)).toBe(true);
    expect(Array.isArray(res.body.enabledModules)).toBe(true);
    expect(res.body).toHaveProperty("currentYear");
    expect(res.body).toHaveProperty("branding");
  });

  it("is admin-only (teacher gets 403 on read + mode switch)", async () => {
    expect((await get("/api/v1/tenant-settings", tok.teacher)).status).toBe(403);
    expect((await patch("/api/v1/tenant-settings/mode", tok.teacher, { type: "college" })).status).toBe(403);
  });

  // ---- canonical mode switch (single source of truth) -----------------------

  it("switches school<->college via the canonical endpoint and reflects it immediately", async () => {
    const toCollege = await patch("/api/v1/tenant-settings/mode", tok.a, { type: "college" });
    expect(toCollege.status).toBe(200);
    expect(toCollege.body.mode).toBe("college");
    // Fresh read reflects it (institutions.type is the single source; cache busted).
    expect((await get("/api/v1/tenant-settings", tok.a)).body.mode).toBe("college");
    // A college-only route now passes the institution-type guard.
    expect((await get("/api/v1/college/departments", tok.a)).status).toBe(200);
    // Switch back.
    expect((await patch("/api/v1/tenant-settings/mode", tok.a, { type: "school" })).body.mode).toBe("school");
  });

  it("rejects an invalid mode value", async () => {
    expect((await patch("/api/v1/tenant-settings/mode", tok.a, { type: "university" })).status).toBe(400);
  });

  // ---- academic-year management (create / edit / set-current) ----------------

  it("creates, edits, and sets the current academic year (reflected in settings)", async () => {
    const y1 = (await post("/api/v1/academic-years", tok.a, { name: "2025-2026", startDate: "2025-06-01", endDate: "2026-05-31" })).body;
    expect(y1.id).toBeTruthy();
    // Edit the name + dates.
    const edited = await patch(`/api/v1/academic-years/${y1.id}`, tok.a, { name: "2025-2026 (rev)" });
    expect(edited.status).toBe(200);
    expect(edited.body.name).toBe("2025-2026 (rev)");
    // Set current.
    const cur = await post(`/api/v1/academic-years/${y1.id}/current`, tok.a);
    expect(cur.status).toBe(200);
    expect(cur.body.isCurrent).toBe(true);
    // Settings currentYear reflects it.
    let s = await get("/api/v1/tenant-settings", tok.a);
    expect(s.body.currentYear?.id).toBe(y1.id);
    // A second year set current unsets the first.
    const y2 = (await post("/api/v1/academic-years", tok.a, { name: "2026-2027", startDate: "2026-06-01", endDate: "2027-05-31" })).body;
    await post(`/api/v1/academic-years/${y2.id}/current`, tok.a);
    s = await get("/api/v1/tenant-settings", tok.a);
    expect(s.body.currentYear?.id).toBe(y2.id);
    const years = s.body.academicYears as { id: string; isCurrent: boolean }[];
    expect(years.filter((y) => y.isCurrent)).toHaveLength(1);
  });

  it("academic-year edit + set-current are admin-only", async () => {
    const y = (await post("/api/v1/academic-years", tok.a, { name: "2025-2026", startDate: "2025-06-01", endDate: "2026-05-31" })).body;
    expect((await patch(`/api/v1/academic-years/${y.id}`, tok.teacher, { name: "x" })).status).toBe(403);
    expect((await post(`/api/v1/academic-years/${y.id}/current`, tok.teacher)).status).toBe(403);
  });

  // ---- tenant isolation ------------------------------------------------------

  it("cannot edit or set-current another tenant's academic year", async () => {
    const yA = (await post("/api/v1/academic-years", tok.a, { name: "2025-2026", startDate: "2025-06-01", endDate: "2026-05-31" })).body;
    // B cannot touch A's year.
    expect((await patch(`/api/v1/academic-years/${yA.id}`, tok.b, { name: "hacked" })).status).toBe(404);
    expect((await post(`/api/v1/academic-years/${yA.id}/current`, tok.b)).status).toBe(404);
    // A's mode switch does not affect B.
    await patch("/api/v1/tenant-settings/mode", tok.a, { type: "college" });
    expect((await get("/api/v1/tenant-settings", tok.b)).body.mode).toBe("school");
  });

  it("404s set-current / edit on an unknown academic-year id", async () => {
    const fake = "00000000-0000-0000-0000-000000000000";
    expect((await post(`/api/v1/academic-years/${fake}/current`, tok.a)).status).toBe(404);
    expect((await patch(`/api/v1/academic-years/${fake}`, tok.a, { name: "x" })).status).toBe(404);
  });
});
