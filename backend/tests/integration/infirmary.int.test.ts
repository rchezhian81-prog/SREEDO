import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { app, createInstitution, createUser, resetDb, tokenFor } from "./helpers";

const PW = "Passw0rd!";

describe("infirmary / health (/infirmary)", () => {
  let instA: string;
  let instB: string;
  const tok: Record<string, string> = {};
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  beforeEach(async () => {
    await resetDb();
    instA = await createInstitution("INF");
    instB = await createInstitution("INF2");
    await createUser({ email: "admin@ia.dev", password: PW, role: "admin", institutionId: instA });
    await createUser({ email: "admin@ib.dev", password: PW, role: "admin", institutionId: instB });
    await createUser({ email: "super@i.dev", password: PW, role: "super_admin", institutionId: null });
    tok.adminA = await tokenFor("admin@ia.dev", PW);
    tok.adminB = await tokenFor("admin@ib.dev", PW);
    tok.super = await tokenFor("super@i.dev", PW);
  });

  it("requires auth + tenant context", async () => {
    expect((await request(app).get("/api/v1/infirmary/visits")).status).toBe(401);
    expect((await request(app).get("/api/v1/infirmary/visits").set(auth(tok.super))).status).toBe(403);
  });

  it("records, lists (with date filter), updates, and deletes a visit", async () => {
    const created = await request(app)
      .post("/api/v1/infirmary/visits")
      .set(auth(tok.adminA))
      .send({ patientName: "Asha", visitDate: "2026-06-10", complaint: "Fever", temperature: "100.4" });
    expect(created.status).toBe(201);
    expect(created.body.visitDate).toBe("2026-06-10");
    const id = created.body.id as string;

    await request(app)
      .post("/api/v1/infirmary/visits")
      .set(auth(tok.adminA))
      .send({ patientName: "Ravi", visitDate: "2026-07-01", complaint: "Headache" });

    const all = await request(app).get("/api/v1/infirmary/visits").set(auth(tok.adminA));
    expect(all.body.meta.total).toBe(2);

    const ranged = await request(app)
      .get("/api/v1/infirmary/visits?dateFrom=2026-06-01&dateTo=2026-06-30")
      .set(auth(tok.adminA));
    expect(ranged.body.meta.total).toBe(1);

    const upd = await request(app)
      .patch(`/api/v1/infirmary/visits/${id}`)
      .set(auth(tok.adminA))
      .send({ treatment: "Paracetamol" });
    expect(upd.body.treatment).toBe("Paracetamol");

    expect(
      (await request(app).delete(`/api/v1/infirmary/visits/${id}`).set(auth(tok.adminA))).status
    ).toBe(204);
  });

  it("isolates tenants — admin B cannot read admin A's visit", async () => {
    const created = await request(app)
      .post("/api/v1/infirmary/visits")
      .set(auth(tok.adminA))
      .send({ patientName: "X", visitDate: "2026-06-10" });
    const id = created.body.id as string;
    expect(
      (await request(app).get(`/api/v1/infirmary/visits/${id}`).set(auth(tok.adminB))).status
    ).toBe(404);
  });
});
