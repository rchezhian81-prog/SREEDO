import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { app, createUser, resetDb, tokenFor } from "./helpers";

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
});
