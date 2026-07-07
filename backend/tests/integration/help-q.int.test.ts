import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { app, createInstitution, createUser, query, resetDb, tokenFor } from "./helpers";
import { invalidatePermissionCache, invalidatePlatformRoleCache } from "../../src/middleware/permissions";
import { allBundledStrings, scanForSecrets } from "../../src/modules/help/help.service";

const PW = "Passw0rd!";
// A leak scanner: any of these appearing in a help response would be a secret leak.
const SECRET_RE = /whsec_[A-Za-z0-9]{6}|sk_live_|AKIA[0-9A-Z]{6}|-----BEGIN|eyJ[A-Za-z0-9_-]{8}\.[A-Za-z0-9_-]{8}\.|password_hash|smtpPass/i;

describe("Super Admin Q — Help / SOP / Documentation / Module Status Center", () => {
  const tok: Record<string, string> = {};

  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const get = (p: string, t: string) => request(app).get(p).set(auth(t));

  async function auditCount(action: string): Promise<number> {
    const { rows } = await query<{ n: number }>(
      `SELECT count(*)::int AS n FROM platform_audit_log WHERE action = $1`,
      [action]
    );
    return Number(rows[0].n);
  }

  beforeEach(async () => {
    await resetDb();

    // Full-access owner (platform_role NULL → every perm incl. help:read/export).
    await createUser({ email: "root@q.dev", password: PW, role: "super_admin", institutionId: null });
    tok.root = await tokenFor("root@q.dev", PW);

    // Restricted platform sub-role granted ONLY help:read (NOT help:export).
    await createUser({ email: "limited@q.dev", password: PW, role: "super_admin", institutionId: null });
    await query(`UPDATE users SET platform_role = 'q_limited' WHERE email = 'limited@q.dev'`);
    await query(
      `INSERT INTO role_permissions (role, permission_id)
       SELECT 'q_limited', id FROM permissions WHERE key = 'help:read'
       ON CONFLICT (role, permission_id) DO NOTHING`
    );
    invalidatePermissionCache();
    invalidatePlatformRoleCache();
    tok.limited = await tokenFor("limited@q.dev", PW);

    // Tenant admin + plain student → must be 403 on the whole surface.
    const inst = await createInstitution("QHLP", "school");
    await createUser({ email: "admin@q.dev", password: PW, role: "admin", institutionId: inst });
    tok.tenant = await tokenFor("admin@q.dev", PW);
    await createUser({ email: "stud@q.dev", password: PW, role: "student", institutionId: inst });
    tok.user = await tokenFor("stud@q.dev", PW);
  });

  // ---- A) dashboard ---------------------------------------------------------

  it("serves the help dashboard summary with real curated counts", async () => {
    const res = await get("/api/v1/help/summary", tok.root);
    expect(res.status).toBe(200);
    expect(res.body.generatedAt).toBeTruthy();
    expect(res.body.curatedInCode).toBe(true);
    // Completion is derived from the real module-status register (17 modules).
    expect(res.body.completion.total).toBe(17);
    expect(res.body.completion.productionStable).toBeGreaterThanOrEqual(15);
    expect(res.body.completion.percentComplete).toBeGreaterThan(0);
    // Counts present and non-zero.
    for (const k of ["moduleDocs", "helpArticles", "sops", "checklists", "limitations", "releaseNotes", "playbooks", "onboardingSections"]) {
      expect(res.body.counts[k]).toBeGreaterThan(0);
    }
    expect(Array.isArray(res.body.recentlyUpdated)).toBe(true);
    expect(res.body.onboardingStatus.available).toBe(true);
    expect(res.body.lastDocumentationUpdate).toBeTruthy();
    expect(JSON.stringify(res.body)).not.toMatch(SECRET_RE);
  });

  it("reports docs-needing-review + critical runbooks as honest arrays", async () => {
    const res = await get("/api/v1/help/summary", tok.root);
    expect(Array.isArray(res.body.docsNeedingReview)).toBe(true);
    expect(Array.isArray(res.body.criticalRunbooks)).toBe(true);
  });

  // ---- B) module status center ----------------------------------------------

  it("serves the module-status center with all 17 modules + correct shipped statuses", async () => {
    const res = await get("/api/v1/help/modules", tok.root);
    expect(res.status).toBe(200);
    const mods: any[] = res.body.modules;
    expect(mods).toHaveLength(17);

    const byKey = Object.fromEntries(mods.map((m) => [m.key, m]));
    // Every completed Super Admin module present + production_stable.
    for (const k of [
      "invoice", "tenant", "settings_n", "billing_c", "subscriptions_d", "admins_i", "rbac_h",
      "security_p", "audit_f", "support_g", "backup_j", "export_k", "observability_l", "jobs_m",
      "communication_o", "overview_e",
    ]) {
      expect(byKey[k]).toBeDefined();
      expect(byKey[k].status).toBe("production_stable");
      expect(byKey[k].route).toMatch(/^\/super-admin\//);
      expect(typeof byKey[k].knownLimitationsCount).toBe("number");
    }
    // Q itself is in_progress (this PR).
    expect(byKey.help_q.status).toBe("in_progress");
  });

  it("uses ONLY real refs in module status — never fabricates PR/commit/deploy", async () => {
    const res = await get("/api/v1/help/modules", tok.root);
    const byKey = Object.fromEntries(res.body.modules.map((m: any) => [m.key, m]));
    // The four modules shipped this session carry their REAL confirmed refs.
    expect(byKey.overview_e.prNumber).toBe(141);
    expect(byKey.overview_e.prCommit).toBe("4815702");
    expect(byKey.overview_e.deployNumber).toBe(95);
    expect(byKey.communication_o.prNumber).toBe(140);
    expect(byKey.jobs_m.prNumber).toBe(139);
    expect(byKey.observability_l.prNumber).toBe(138);
    // Modules whose PR/deploy numbers are NOT confirmed stay null (not faked).
    expect(byKey.invoice.prNumber).toBeNull();
    expect(byKey.invoice.deployNumber).toBeNull();
    expect(byKey.tenant.prCommit).toBeNull();
    expect(byKey.help_q.prNumber).toBeNull();
  });

  // ---- C) help articles: list / search / filter / detail --------------------

  it("lists, searches and module-filters help articles", async () => {
    const all = await get("/api/v1/help/articles", tok.root);
    expect(all.status).toBe(200);
    expect(all.body.articles.length).toBeGreaterThanOrEqual(14);

    // Module filter narrows the set and only returns that module's articles.
    const filtered = await get("/api/v1/help/articles?module=security_p", tok.root);
    expect(filtered.status).toBe(200);
    for (const a of filtered.body.articles) expect(a.module).toBe("security_p");

    // Search matches by title/summary/body.
    const searched = await get("/api/v1/help/articles?q=tenant", tok.root);
    expect(searched.status).toBe(200);
    expect(searched.body.articles.length).toBeGreaterThan(0);

    // Detail by id (404 for unknown).
    const first = all.body.articles[0].id;
    const detail = await get(`/api/v1/help/articles/${first}`, tok.root);
    expect(detail.status).toBe(200);
    expect(detail.body.id).toBe(first);
    expect(detail.body.meta).toBeDefined();
    expect((await get("/api/v1/help/articles/does-not-exist", tok.root)).status).toBe(404);
  });

  // ---- D) SOP library -------------------------------------------------------

  it("serves the SOP library (20 SOPs) + detail", async () => {
    const res = await get("/api/v1/help/sops", tok.root);
    expect(res.status).toBe(200);
    expect(res.body.sops).toHaveLength(20);
    const id = res.body.sops[0].id;
    const detail = await get(`/api/v1/help/sops/${id}`, tok.root);
    expect(detail.status).toBe(200);
    expect(Array.isArray(detail.body.steps)).toBe(true);
    expect(detail.body.smokeTestCheck).toBeTruthy();
    expect((await get("/api/v1/help/sops/nope", tok.root)).status).toBe(404);
  });

  // ---- E) smoke-test checklist center ---------------------------------------

  it("serves the checklist center (17 checklists) + detail with risk flags", async () => {
    const res = await get("/api/v1/help/checklists", tok.root);
    expect(res.status).toBe(200);
    expect(res.body.checklists).toHaveLength(17);
    const id = res.body.checklists[0].id;
    const detail = await get(`/api/v1/help/checklists/${id}`, tok.root);
    expect(detail.status).toBe(200);
    expect(Array.isArray(detail.body.items)).toBe(true);
    for (const it of detail.body.items) {
      expect(typeof it.productionRisk).toBe("boolean");
      expect(typeof it.doNotTestOnRealData).toBe("boolean");
      expect(it.expectedResult).toBeTruthy();
    }
  });

  // ---- F) known limitations register ----------------------------------------

  it("serves the known-limitations register and filters it", async () => {
    const res = await get("/api/v1/help/limitations", tok.root);
    expect(res.status).toBe(200);
    expect(res.body.limitations.length).toBeGreaterThan(0);
    for (const l of res.body.limitations) {
      expect(["low", "medium", "high", "critical"]).toContain(l.severity);
      expect(["accepted", "planned", "fixed", "deferred", "future"]).toContain(l.status);
    }
    // Severity filter.
    const high = await get("/api/v1/help/limitations?severity=high", tok.root);
    expect(high.status).toBe(200);
    for (const l of high.body.limitations) expect(l.severity).toBe("high");
  });

  // ---- G) release notes -----------------------------------------------------

  it("serves release notes (real-or-null refs) + detail", async () => {
    const res = await get("/api/v1/help/release-notes", tok.root);
    expect(res.status).toBe(200);
    expect(res.body.releaseNotes.length).toBeGreaterThan(0);
    const e = res.body.releaseNotes.find((r: any) => r.module === "overview_e");
    expect(e.prNumber).toBe(141);
    const detail = await get(`/api/v1/help/release-notes/${res.body.releaseNotes[0].id}`, tok.root);
    expect(detail.status).toBe(200);
    expect(detail.body.changes.length).toBeGreaterThan(0);
  });

  // ---- H) onboarding + I) playbooks -----------------------------------------

  it("serves the admin onboarding guide (15 ordered sections)", async () => {
    const res = await get("/api/v1/help/onboarding", tok.root);
    expect(res.status).toBe(200);
    expect(res.body.sections).toHaveLength(15);
    for (let i = 1; i < res.body.sections.length; i++) {
      expect(res.body.sections[i].order).toBeGreaterThanOrEqual(res.body.sections[i - 1].order);
    }
  });

  it("serves the emergency playbooks (17) + detail", async () => {
    const res = await get("/api/v1/help/playbooks", tok.root);
    expect(res.status).toBe(200);
    expect(res.body.playbooks).toHaveLength(17);
    const id = res.body.playbooks[0].id;
    const detail = await get(`/api/v1/help/playbooks/${id}`, tok.root);
    expect(detail.status).toBe(200);
    expect(Array.isArray(detail.body.symptoms)).toBe(true);
    expect(Array.isArray(detail.body.recoveryChecklist)).toBe(true);
  });

  // ---- K) global search -----------------------------------------------------

  it("searches across every content type with a type filter", async () => {
    const all = await get("/api/v1/help/search?q=backup", tok.root);
    expect(all.status).toBe(200);
    expect(all.body.results.length).toBeGreaterThan(0);
    // Type filter restricts to that content type.
    const sopsOnly = await get("/api/v1/help/search?type=sop", tok.root);
    expect(sopsOnly.status).toBe(200);
    for (const r of sopsOnly.body.results) expect(r.type).toBe("sop");
  });

  // ---- L) RBAC + 403 --------------------------------------------------------

  it("lets a help:read sub-role view, and 403s tenant admins + plain users everywhere", async () => {
    // Restricted platform sub-role (help:read) can read the surface.
    for (const p of ["/api/v1/help/summary", "/api/v1/help/modules", "/api/v1/help/sops", "/api/v1/help/playbooks"]) {
      expect((await get(p, tok.limited)).status).toBe(200);
    }
    // Tenant admin + student are blocked on every endpoint (they lack help:read).
    for (const t of [tok.tenant, tok.user]) {
      for (const p of [
        "/api/v1/help/summary", "/api/v1/help/modules", "/api/v1/help/articles",
        "/api/v1/help/sops", "/api/v1/help/checklists", "/api/v1/help/limitations",
        "/api/v1/help/release-notes", "/api/v1/help/playbooks", "/api/v1/help/onboarding",
        "/api/v1/help/search", "/api/v1/help/export",
      ]) {
        expect((await get(p, t)).status).toBe(403);
      }
    }
  });

  // ---- Platform Overview link (Section K.8 / R.17) --------------------------

  it("module status links Platform Overview to its real route", async () => {
    const res = await get("/api/v1/help/modules", tok.root);
    const e = res.body.modules.find((m: any) => m.key === "overview_e");
    expect(e.route).toBe("/super-admin/platform");
  });

  // ---- Export: gated + masked + audited (M.10) ------------------------------

  it("gates export on help:export (403 for read-only sub-role + tenant)", async () => {
    expect((await get("/api/v1/help/export", tok.limited)).status).toBe(403);
    expect((await get("/api/v1/help/export", tok.tenant)).status).toBe(403);
  });

  it("exports a MASKED module-status CSV and audits it (help.exported)", async () => {
    expect(await auditCount("help.exported")).toBe(0);
    const res = await get("/api/v1/help/export?kind=modules&format=csv&reason=board%20pack", tok.root).buffer(true);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/csv/);
    expect(res.text).toMatch(/Module,Letter,Status/);
    expect(res.text).not.toMatch(SECRET_RE);
    expect(await auditCount("help.exported")).toBeGreaterThanOrEqual(1);
  });

  it("exports a MASKED checklists JSON (no secrets in the body)", async () => {
    const res = await get("/api/v1/help/export?kind=checklists&format=json", tok.root).buffer(true);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/application\/json/);
    const body = JSON.parse(res.text);
    expect(body.kind).toBe("checklists");
    expect(res.text).not.toMatch(SECRET_RE);
  });

  // ---- N) no secrets in bundled docs ----------------------------------------

  it("ships ZERO secret-shaped strings in any bundled doc", () => {
    const strings = allBundledStrings();
    expect(strings.length).toBeGreaterThan(100); // sanity: content is actually loaded
    const offenders: string[] = [];
    for (const s of strings) if (scanForSecrets(s).length) offenders.push(s.slice(0, 80));
    expect(offenders).toEqual([]);
  });

  it("scanForSecrets actually detects a planted secret (scanner is not a no-op)", () => {
    expect(scanForSecrets("token whsec_ABCDEF1234567890 here").length).toBeGreaterThan(0);
    expect(scanForSecrets("postgres://u:p4ssw0rd@db:5432/x").length).toBeGreaterThan(0);
    expect(scanForSecrets("a perfectly ordinary sentence about passwords and tokens")).toEqual([]);
  });
});
