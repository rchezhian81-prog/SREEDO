import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { app, createUser, query, resetDb, tokenFor } from "./helpers";

const SUPER = { email: "super@test.dev", password: "Passw0rd!" };
const ADMIN = { email: "admin@test.dev", password: "Passw0rd!" };

describe("super admin: tenancy management", () => {
  let superToken: string;
  let adminToken: string;

  beforeEach(async () => {
    await resetDb();
    await createUser({ ...SUPER, role: "super_admin" });
    await createUser({ ...ADMIN, role: "admin" });
    superToken = await tokenFor(SUPER.email, SUPER.password);
    adminToken = await tokenFor(ADMIN.email, ADMIN.password);
  });

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  it("blocks non-super-admins from tenancy endpoints", async () => {
    const res = await request(app)
      .get("/api/v1/institutions")
      .set(auth(adminToken));
    expect(res.status).toBe(403);
  });

  it("creates and reads institutions", async () => {
    const created = await request(app)
      .post("/api/v1/institutions")
      .set(auth(superToken))
      .send({ name: "Greenwood High", code: "grnwd", type: "school" });
    expect(created.status).toBe(201);
    expect(created.body.code).toBe("GRNWD"); // upper-cased
    expect(created.body.branches).toEqual([]);

    const list = await request(app)
      .get("/api/v1/institutions")
      .set(auth(superToken));
    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(1);
    expect(Number(list.body[0].branchCount)).toBe(0);
  });

  it("rejects duplicate institution codes", async () => {
    await request(app)
      .post("/api/v1/institutions")
      .set(auth(superToken))
      .send({ name: "A", code: "DUP" });
    const dup = await request(app)
      .post("/api/v1/institutions")
      .set(auth(superToken))
      .send({ name: "B", code: "DUP" });
    expect(dup.status).toBe(409);
  });

  it("validates the institution body", async () => {
    const res = await request(app)
      .post("/api/v1/institutions")
      .set(auth(superToken))
      .send({ name: "No Code" });
    expect(res.status).toBe(400);
  });

  it("manages branches, packages and subscriptions", async () => {
    const inst = await request(app)
      .post("/api/v1/institutions")
      .set(auth(superToken))
      .send({ name: "Riverside", code: "RVR" });
    const institutionId = inst.body.id;

    const branch = await request(app)
      .post(`/api/v1/institutions/${institutionId}/branches`)
      .set(auth(superToken))
      .send({ name: "North Campus", address: "12 River Rd" });
    expect(branch.status).toBe(201);
    expect(branch.body.institutionId).toBe(institutionId);

    const pkg = await request(app)
      .post("/api/v1/packages")
      .set(auth(superToken))
      .send({ name: "Pro", maxStudents: 500, price: 25000, billingCycle: "annual" });
    expect(pkg.status).toBe(201);

    const sub = await request(app)
      .post(`/api/v1/institutions/${institutionId}/subscription`)
      .set(auth(superToken))
      .send({ packageId: pkg.body.id, status: "active" });
    expect(sub.status).toBe(201);

    const detail = await request(app)
      .get(`/api/v1/institutions/${institutionId}`)
      .set(auth(superToken));
    expect(detail.status).toBe(200);
    expect(detail.body.branches).toHaveLength(1);
    expect(detail.body.subscription.packageName).toBe("Pro");
  });

  it("syncs institution_type with the structural type on legacy create + update", async () => {
    const inst = await request(app)
      .post("/api/v1/institutions")
      .set(auth(superToken))
      .send({ name: "Sync", code: "SYNC", type: "college" });
    const id = inst.body.id;
    expect(inst.body.type).toBe("college");
    // new tenant detail must see institution_type = college (no school/college mismatch)
    const t1 = await request(app).get(`/api/v1/platform/tenants/${id}`).set(auth(superToken));
    expect(t1.body.institutionType).toBe("college");
    // update back to school keeps both in lock-step
    await request(app).patch(`/api/v1/institutions/${id}`).set(auth(superToken)).send({ type: "school" });
    const t2 = await request(app).get(`/api/v1/platform/tenants/${id}`).set(auth(superToken));
    expect(t2.body.type).toBe("school");
    expect(t2.body.institutionType).toBe("school");
  });

  it("disables legacy hard delete — archives instead (reason required, audited, data preserved)", async () => {
    const inst = await request(app)
      .post("/api/v1/institutions")
      .set(auth(superToken))
      .send({ name: "Legacy", code: "LEG", type: "school" });
    const id = inst.body.id;

    // DELETE without a reason is refused, and the row is NOT removed
    const noReason = await request(app).delete(`/api/v1/institutions/${id}`).set(auth(superToken));
    expect(noReason.status).toBe(400);
    expect((await request(app).get(`/api/v1/institutions/${id}`).set(auth(superToken))).status).toBe(200);

    // a tenant admin cannot reach the endpoint at all
    expect((await request(app).delete(`/api/v1/institutions/${id}`).set(auth(adminToken)).send({ reason: "x" })).status).toBe(403);

    // DELETE with a reason SOFT-ARCHIVES — row preserved, status archived, inactive
    const archived = await request(app)
      .delete(`/api/v1/institutions/${id}`)
      .set(auth(superToken))
      .send({ reason: "Account closed at customer request" });
    expect(archived.status).toBe(200);
    expect(archived.body.archived).toBe(true);

    const still = await request(app).get(`/api/v1/platform/tenants/${id}`).set(auth(superToken));
    expect(still.status).toBe(200);
    expect(still.body.status).toBe("archived");
    expect(still.body.isActive).toBe(false);

    // the institutions row still exists (no hard delete) and the archive is audited
    const exists = await query<{ id: string }>("SELECT id FROM institutions WHERE id = $1", [id]);
    expect(exists.rows).toHaveLength(1);
    const audit = await query("SELECT 1 FROM platform_audit_log WHERE institution_id = $1 AND action = 'tenant.archived'", [id]);
    expect(audit.rows.length).toBeGreaterThan(0);
  });

  it("disables branch hard delete — deactivates with a reason + audit, row preserved", async () => {
    const inst = await request(app).post("/api/v1/institutions").set(auth(superToken)).send({ name: "BranchCo", code: "BRC" });
    const branch = await request(app).post(`/api/v1/institutions/${inst.body.id}/branches`).set(auth(superToken)).send({ name: "Main Campus" });
    const branchId = branch.body.id;
    // no reason → 400, branch preserved
    expect((await request(app).delete(`/api/v1/branches/${branchId}`).set(auth(superToken))).status).toBe(400);
    expect((await query("SELECT 1 FROM branches WHERE id = $1", [branchId])).rows).toHaveLength(1);
    // with reason → soft-deactivate (is_active=false), row preserved, audited
    const arch = await request(app).delete(`/api/v1/branches/${branchId}`).set(auth(superToken)).send({ reason: "Campus merged" });
    expect(arch.status).toBe(200);
    expect(arch.body.archived).toBe(true);
    const row = await query<{ is_active: boolean }>("SELECT is_active FROM branches WHERE id = $1", [branchId]);
    expect(row.rows).toHaveLength(1);
    expect(row.rows[0].is_active).toBe(false);
    const audit = await query("SELECT 1 FROM platform_audit_log WHERE target_id = $1 AND action = 'tenant.branch_archived'", [branchId]);
    expect(audit.rows.length).toBeGreaterThan(0);
  });
});
