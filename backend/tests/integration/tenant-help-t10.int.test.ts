import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { app, createInstitution, createUser, resetDb, tokenFor } from "./helpers";
import { allBundledStrings, scanForSecrets } from "../../src/modules/tenanthelp/tenanthelp.service";
import { gettingStartedSections } from "../../src/modules/tenanthelp/content/getting-started";
import { tenantHelpArticles } from "../../src/modules/tenanthelp/content/articles";
import { tenantSops } from "../../src/modules/tenanthelp/content/sops";

// PR-T10 — Tenant Help/SOP Center. Read-only curated docs gated by
// tenant_help:read: every STAFF principal (admin/teacher/accountant + jr_*)
// can read, student/parent never can, content is filtered to the caller's
// institution type, and the platform /help surface stays platform-only.

const PW = "Passw0rd!";
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
const ids = (rows: { id: string }[]) => rows.map((r) => r.id);

describe("PR-T10 tenant help center", () => {
  let school: string;
  const tok: Record<string, string> = {};

  beforeEach(async () => {
    await resetDb();
    school = await createInstitution("THA", "school");
    await createUser({ email: "admin@tha.dev", password: PW, role: "admin", institutionId: school });
    await createUser({ email: "teacher@tha.dev", password: PW, role: "teacher", institutionId: school });
    await createUser({ email: "acct@tha.dev", password: PW, role: "accountant", institutionId: school });
    await createUser({ email: "student@tha.dev", password: PW, role: "student", institutionId: school });
    await createUser({ email: "parent@tha.dev", password: PW, role: "parent", institutionId: school });
    tok.admin = await tokenFor("admin@tha.dev", PW);
    tok.teacher = await tokenFor("teacher@tha.dev", PW);
    tok.acct = await tokenFor("acct@tha.dev", PW);
    tok.student = await tokenFor("student@tha.dev", PW);
    tok.parent = await tokenFor("parent@tha.dev", PW);
  });

  it("serves the full surface to a tenant admin (incl. detail + 404 for unknown id)", async () => {
    const summary = await request(app).get("/api/v1/tenant-help/summary").set(auth(tok.admin));
    expect(summary.status).toBe(200);
    expect(summary.body.curatedInCode).toBe(true);
    expect(summary.body.articles).toBeGreaterThan(5);
    expect(summary.body.sops).toBeGreaterThan(3);

    const gs = await request(app).get("/api/v1/tenant-help/getting-started").set(auth(tok.admin));
    expect(gs.status).toBe(200);
    expect(gs.body.length).toBeGreaterThan(0);

    const articles = await request(app).get("/api/v1/tenant-help/articles").set(auth(tok.admin));
    expect(articles.status).toBe(200);
    const one = await request(app)
      .get(`/api/v1/tenant-help/articles/${articles.body[0].id}`)
      .set(auth(tok.admin));
    expect(one.status).toBe(200);
    expect(one.body.body.length).toBeGreaterThan(100);

    const sops = await request(app).get("/api/v1/tenant-help/sops").set(auth(tok.admin));
    expect(sops.status).toBe(200);
    const sop = await request(app)
      .get(`/api/v1/tenant-help/sops/${sops.body[0].id}`)
      .set(auth(tok.admin));
    expect(sop.status).toBe(200);
    expect(sop.body.steps.length).toBeGreaterThan(2);

    expect(
      (await request(app).get("/api/v1/tenant-help/articles/nope-does-not-exist").set(auth(tok.admin))).status
    ).toBe(404);
  });

  it("lets NON-ADMIN staff read (teacher + accountant → 200, the Phase-5 smoke requirement)", async () => {
    for (const t of [tok.teacher, tok.acct]) {
      expect((await request(app).get("/api/v1/tenant-help/summary").set(auth(t))).status).toBe(200);
      expect((await request(app).get("/api/v1/tenant-help/articles").set(auth(t))).status).toBe(200);
      expect((await request(app).get("/api/v1/tenant-help/sops").set(auth(t))).status).toBe(200);
    }
  });

  it("blocks student and parent everywhere (403) and unauthenticated (401)", async () => {
    const paths = [
      "/api/v1/tenant-help/summary",
      "/api/v1/tenant-help/getting-started",
      "/api/v1/tenant-help/articles",
      "/api/v1/tenant-help/sops",
      "/api/v1/tenant-help/search?q=fees",
    ];
    for (const p of paths) {
      expect((await request(app).get(p).set(auth(tok.student))).status).toBe(403);
      expect((await request(app).get(p).set(auth(tok.parent))).status).toBe(403);
    }
    expect((await request(app).get("/api/v1/tenant-help/summary")).status).toBe(401);
  });

  it("keeps the PLATFORM help center platform-only (tenant admin still 403 on /help)", async () => {
    expect((await request(app).get("/api/v1/help/summary").set(auth(tok.admin))).status).toBe(403);
    expect((await request(app).get("/api/v1/help/articles").set(auth(tok.admin))).status).toBe(403);
    expect((await request(app).get("/api/v1/help/sops").set(auth(tok.teacher))).status).toBe(403);
  });

  it("filters content to the institution type (school vs college)", async () => {
    const college = await createInstitution("THC", "college");
    await createUser({ email: "admin@thc.dev", password: PW, role: "admin", institutionId: college });
    const tokC = await tokenFor("admin@thc.dev", PW);

    const schoolArts = ids((await request(app).get("/api/v1/tenant-help/articles").set(auth(tok.admin))).body);
    const collegeArts = ids((await request(app).get("/api/v1/tenant-help/articles").set(auth(tokC))).body);
    expect(schoolArts).toContain("art-school-structure");
    expect(schoolArts).not.toContain("art-college-structure");
    expect(collegeArts).toContain("art-college-structure");
    expect(collegeArts).not.toContain("art-school-structure");
    // "both" docs appear for each mode
    expect(schoolArts).toContain("art-students-basics");
    expect(collegeArts).toContain("art-students-basics");

    const schoolSops = ids((await request(app).get("/api/v1/tenant-help/sops").set(auth(tok.admin))).body);
    const collegeSops = ids((await request(app).get("/api/v1/tenant-help/sops").set(auth(tokC))).body);
    expect(schoolSops).not.toContain("sop-semester-opening");
    expect(collegeSops).toContain("sop-semester-opening");

    const gsSchool = ids((await request(app).get("/api/v1/tenant-help/getting-started").set(auth(tok.admin))).body);
    const gsCollege = ids((await request(app).get("/api/v1/tenant-help/getting-started").set(auth(tokC))).body);
    expect(gsSchool).toContain("gs-school-setup");
    expect(gsSchool).not.toContain("gs-college-setup");
    expect(gsCollege).toContain("gs-college-setup");
    expect(gsCollege).not.toContain("gs-school-setup");

    // an out-of-mode doc is absent by id too (404, not just filtered from lists)
    expect(
      (await request(app).get("/api/v1/tenant-help/articles/art-college-structure").set(auth(tok.admin))).status
    ).toBe(404);
  });

  it("searches across types with snippets, honouring q, type filter and mode", async () => {
    const res = await request(app).get("/api/v1/tenant-help/search?q=excused").set(auth(tok.teacher));
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThan(0);
    for (const hit of res.body) {
      expect(["article", "sop", "getting-started"]).toContain(hit.type);
      expect(hit.id).toBeTruthy();
      expect(hit.snippet.length).toBeGreaterThan(0);
    }
    const sopsOnly = await request(app).get("/api/v1/tenant-help/search?q=leave&type=sop").set(auth(tok.teacher));
    expect(sopsOnly.body.every((h: { type: string }) => h.type === "sop")).toBe(true);
    // college-only docs never surface in a school tenant's search
    const all = await request(app).get("/api/v1/tenant-help/search").set(auth(tok.admin));
    expect(ids(all.body)).not.toContain("art-college-structure");

    const filtered = await request(app)
      .get("/api/v1/tenant-help/articles?q=guardian&category=students")
      .set(auth(tok.admin));
    expect(filtered.status).toBe(200);
    expect(filtered.body.length).toBeGreaterThan(0);
    expect(filtered.body.every((a: { category: string }) => a.category === "students")).toBe(true);
  });

  it("ships a hygienic corpus: unique stable ids, complete fields, no secrets", () => {
    const allIds = [
      ...gettingStartedSections.map((g) => g.id),
      ...tenantHelpArticles.map((a) => a.id),
      ...tenantSops.map((s) => s.id),
    ];
    expect(new Set(allIds).size).toBe(allIds.length);
    for (const a of tenantHelpArticles) {
      expect(a.id).toMatch(/^art-[a-z0-9-]+$/);
      expect(a.title.length).toBeGreaterThan(5);
      expect(a.body.length).toBeGreaterThan(100);
      expect(["school", "college", "both"]).toContain(a.appliesTo);
    }
    for (const s of tenantSops) {
      expect(s.id).toMatch(/^sop-[a-z0-9-]+$/);
      expect(s.steps.length).toBeGreaterThan(2);
      expect(s.safetyWarnings.length).toBeGreaterThan(0);
      expect(s.auditExpectation.length).toBeGreaterThan(10);
      expect(["school", "college", "both"]).toContain(s.appliesTo);
    }
    expect(allBundledStrings().length).toBeGreaterThan(50);
    expect(scanForSecrets()).toEqual([]);
  });
});
