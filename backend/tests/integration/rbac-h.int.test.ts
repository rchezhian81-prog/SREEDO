import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { app, createInstitution, createUser, query, resetDb, tokenFor } from "./helpers";

// Super Admin H — RBAC custom roles + platform sub-role permission enforcement.

const PW = "Passw0rd!x";

describe("Super Admin H — RBAC + enforcement", () => {
  const tok: Record<string, string> = {};
  const id: Record<string, string> = {};

  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const get = (p: string, t: string) => request(app).get(p).set(auth(t));
  const post = (p: string, t: string, b?: unknown) => request(app).post(p).set(auth(t)).send(b ?? {});
  const put = (p: string, t: string, b: unknown) => request(app).put(p).set(auth(t)).send(b);
  const patch = (p: string, t: string, b: unknown) => request(app).patch(p).set(auth(t)).send(b);

  async function mkPlatform(email: string, platformRole: string | null): Promise<string> {
    const u = await createUser({ email, password: PW, role: "super_admin", institutionId: null });
    await query("UPDATE users SET platform_role = $2 WHERE id = $1", [u.id, platformRole]);
    return u.id;
  }

  beforeEach(async () => {
    await resetDb();
    // resetDb's `TRUNCATE users CASCADE` also clears rbac_roles (it FK-references
    // users) — a test-harness artifact; production never truncates users. The
    // built-in role GRANTS in role_permissions survive (no FK to users), so we
    // just re-seed the 6 built-in role rows to match the migration.
    // Delete any CUSTOM-role grants by denylist (rbac_roles is already wiped, so
    // we can't join it): keep only tenant roles + the 6 built-in platform roles.
    await query(
      `DELETE FROM role_permissions WHERE role NOT IN
        ('admin','teacher','accountant','student','parent','super_admin',
         'owner','platform_admin','support_operator','billing_admin','auditor','technical_admin')`
    );
    await query(
      `INSERT INTO rbac_roles (key, name, kind, is_owner, is_system) VALUES
        ('owner','Owner / Super Admin','built_in',true,true),
        ('platform_admin','Platform Admin','built_in',false,true),
        ('support_operator','Support Operator','built_in',false,true),
        ('billing_admin','Billing Admin','built_in',false,true),
        ('auditor','Read-only Auditor','built_in',false,true),
        ('technical_admin','Technical Admin','built_in',false,true)
       ON CONFLICT (key) DO NOTHING`
    );
    id.owner = await mkPlatform("owner@h.dev", "owner");
    id.auditor = await mkPlatform("auditor@h.dev", "auditor");
    id.billing = await mkPlatform("billing@h.dev", "billing_admin");
    id.support = await mkPlatform("support@h.dev", "support_operator");
    id.padmin = await mkPlatform("padmin@h.dev", "platform_admin");
    const inst = await createInstitution("HH");
    await createUser({ email: "tadmin@h.dev", password: PW, role: "admin", institutionId: inst });
    tok.owner = await tokenFor("owner@h.dev", PW);
    tok.auditor = await tokenFor("auditor@h.dev", PW);
    tok.billing = await tokenFor("billing@h.dev", PW);
    tok.support = await tokenFor("support@h.dev", PW);
    tok.padmin = await tokenFor("padmin@h.dev", PW);
    tok.tadmin = await tokenFor("tadmin@h.dev", PW);
  });

  it("seeds the 6 built-in role templates and a grouped registry", async () => {
    const roles = await get("/api/v1/platform/rbac/roles", tok.owner);
    expect(roles.status).toBe(200);
    const keys = roles.body.map((r: { key: string }) => r.key);
    for (const k of ["owner", "platform_admin", "support_operator", "billing_admin", "auditor", "technical_admin"]) {
      expect(keys).toContain(k);
    }
    expect(roles.body.find((r: { key: string }) => r.key === "owner").isOwner).toBe(true);
    const reg = await get("/api/v1/platform/rbac/registry", tok.owner);
    expect(reg.status).toBe(200);
    expect(reg.body.some((g: { group: string }) => g.group === "RBAC")).toBe(true);
    expect(JSON.stringify(reg.body)).not.toMatch(/password_hash|totp_secret/);
  });

  it("OWNER keeps full access; unclassified super_admin also full", async () => {
    // Owner reaches every guarded surface.
    expect((await get("/api/v1/platform/admins", tok.owner)).status).toBe(200);
    expect((await get("/api/v1/platform/subscriptions", tok.owner)).status).toBe(200);
    expect((await get("/api/v1/platform/rbac/matrix", tok.owner)).status).toBe(200);
    expect((await get("/api/v1/packages", tok.owner)).status).toBe(200);
    // A super_admin with NO platform_role is treated as full-access (legacy/emergency).
    await mkPlatform("legacy@h.dev", null);
    const legacy = await tokenFor("legacy@h.dev", PW);
    expect((await get("/api/v1/platform/admins", legacy)).status).toBe(200);
  });

  it("READ-ONLY AUDITOR can read but cannot mutate", async () => {
    expect((await get("/api/v1/platform/subscriptions", tok.auditor)).status).toBe(200); // platform:read
    expect((await get("/api/v1/platform/rbac/roles", tok.auditor)).status).toBe(200); // rbac_read
    // No manage keys → every mutation is 403.
    expect((await post("/api/v1/platform/rbac/roles", tok.auditor, { key: "x_role", name: "X" })).status).toBe(403);
    expect((await get("/api/v1/platform/admins", tok.auditor)).status).toBe(403); // manage_admins
    expect((await post("/api/v1/packages", tok.auditor, { name: "Nope" })).status).toBe(403); // manage_subscriptions
  });

  it("BILLING ADMIN gets billing, not RBAC / platform-admin / tenant management", async () => {
    expect((await get("/api/v1/platform/subscriptions", tok.billing)).status).toBe(200); // read
    expect((await get("/api/v1/packages", tok.billing)).status).toBe(200); // read
    expect((await get("/api/v1/platform/rbac/roles", tok.billing)).status).toBe(403); // no rbac_read
    expect((await get("/api/v1/platform/admins", tok.billing)).status).toBe(403); // no manage_admins
    // No manage_institutions → cannot create a tenant.
    expect((await post("/api/v1/institutions", tok.billing, { name: "T", code: "TBIL" })).status).toBe(403);
  });

  it("SUPPORT OPERATOR can read tenants but not manage them", async () => {
    expect((await get("/api/v1/platform/tenants", tok.support)).status).toBe(200); // read
    expect((await post("/api/v1/institutions", tok.support, { name: "T", code: "TSUP" })).status).toBe(403);
    expect((await get("/api/v1/platform/rbac/roles", tok.support)).status).toBe(403); // no rbac_read
  });

  it("creates, copies, edits and archives a custom role; enforces key rules", async () => {
    // reserved + create
    expect((await post("/api/v1/platform/rbac/roles", tok.owner, { key: "admin", name: "X" })).status).toBe(400);
    const created = await post("/api/v1/platform/rbac/roles", tok.owner, {
      key: "read_helpdesk", name: "Read Helpdesk", copyFrom: "auditor",
    });
    expect(created.status).toBe(201);
    expect(created.body.permissions.length).toBeGreaterThan(0); // copied from auditor
    // duplicate key
    expect((await post("/api/v1/platform/rbac/roles", tok.owner, { key: "read_helpdesk", name: "Y" })).status).toBe(409);
    // edit
    expect((await patch("/api/v1/platform/rbac/roles/read_helpdesk", tok.owner, { description: "updated" })).body.description).toBe("updated");
    // archive (no users assigned)
    expect((await post("/api/v1/platform/rbac/roles/read_helpdesk/archive", tok.owner, { reason: "no longer needed" })).body.status).toBe("archived");
    // built-in cannot be archived
    expect((await post("/api/v1/platform/rbac/roles/auditor/archive", tok.owner, { reason: "should fail here" })).status).toBe(400);
  });

  it("saves a permission matrix with diff; high-risk change needs a reason", async () => {
    await post("/api/v1/platform/rbac/roles", tok.owner, { key: "temp_role", name: "Temp" });
    // low-risk grant, no reason needed
    const low = await put("/api/v1/platform/rbac/roles/temp_role/permissions", tok.owner, { permissionKeys: ["platform:read"] });
    expect(low.status).toBe(200);
    expect(low.body.permissions).toContain("platform:read");
    // high-risk grant WITHOUT reason → 400
    const noReason = await put("/api/v1/platform/rbac/roles/temp_role/permissions", tok.owner, {
      permissionKeys: ["platform:read", "platform:manage_institutions"],
    });
    expect(noReason.status).toBe(400);
    // with reason → 200
    const withReason = await put("/api/v1/platform/rbac/roles/temp_role/permissions", tok.owner, {
      permissionKeys: ["platform:read", "platform:manage_institutions"], reason: "grant tenant mgmt",
    });
    expect(withReason.status).toBe(200);
    // owner role permissions are not editable
    expect((await put("/api/v1/platform/rbac/roles/owner/permissions", tok.owner, { permissionKeys: [] })).status).toBe(400);
    // audit recorded
    const audit = await get("/api/v1/platform/rbac/audit?action=rbac.matrix_saved", tok.owner);
    expect(audit.body.total).toBeGreaterThan(0);
  });

  it("assigns a role to a platform admin and updates effective permissions live", async () => {
    // padmin currently cannot manage admins.
    expect((await get("/api/v1/platform/admins", tok.padmin)).status).toBe(403);
    // Assign padmin the owner role → now full access on the next request.
    const assign = await post(`/api/v1/platform/rbac/users/${id.padmin}/role`, tok.owner, { roleKey: "owner", reason: "promoting to owner" });
    expect(assign.status).toBe(200);
    expect((await get("/api/v1/platform/admins", tok.padmin)).status).toBe(200);
    // users-in-role reflects it
    const users = await get("/api/v1/platform/rbac/roles/owner/users", tok.owner);
    expect(users.body.some((u: { email: string }) => u.email === "padmin@h.dev")).toBe(true);
  });

  it("protects the last active owner from demotion", async () => {
    // owner@h.dev is the only owner → cannot be reassigned away from owner.
    const res = await post(`/api/v1/platform/rbac/users/${id.owner}/role`, tok.owner, { roleKey: "auditor", reason: "should fail" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/last active owner/i);
  });

  it("exports the RBAC matrix as CSV (audited) and denies non-rbac roles", async () => {
    const csv = await get("/api/v1/platform/rbac/export?format=csv", tok.owner);
    expect(csv.status).toBe(200);
    expect(csv.headers["content-type"]).toMatch(/csv/);
    expect(csv.text).toMatch(/Role,Role key/);
    // billing (no rbac_read) cannot export
    expect((await get("/api/v1/platform/rbac/export?format=csv", tok.billing)).status).toBe(403);
    const audit = await get("/api/v1/platform/rbac/audit?action=rbac.matrix_exported", tok.owner);
    expect(audit.body.total).toBeGreaterThan(0);
  });

  it("denies the RBAC console to tenant users (whole router is super_admin-gated)", async () => {
    expect((await get("/api/v1/platform/rbac/roles", tok.tadmin)).status).toBe(403);
    expect((await get("/api/v1/platform/rbac/me", tok.tadmin)).status).toBe(403);
    expect((await get("/api/v1/platform/rbac/matrix", tok.tadmin)).status).toBe(403);
    // tenant users read their own effective permissions via /auth/permissions instead.
    expect((await get("/api/v1/auth/permissions", tok.tadmin)).status).toBe(200);
  });
});
