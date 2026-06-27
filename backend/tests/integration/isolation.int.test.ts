import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { app, createInstitution, createUser, resetDb, tokenFor } from "./helpers";

// Proves institution_id enforcement: one institution cannot see or touch
// another institution's data.
describe("cross-tenant isolation", () => {
  let tokenA: string;
  let tokenB: string;

  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  beforeEach(async () => {
    await resetDb();
    const instA = await createInstitution("AAA");
    const instB = await createInstitution("BBB");
    await createUser({
      email: "admin@a.dev",
      password: "Passw0rd!",
      role: "admin",
      institutionId: instA,
    });
    await createUser({
      email: "admin@b.dev",
      password: "Passw0rd!",
      role: "admin",
      institutionId: instB,
    });
    tokenA = await tokenFor("admin@a.dev", "Passw0rd!");
    tokenB = await tokenFor("admin@b.dev", "Passw0rd!");
  });

  async function createStudent(token: string, firstName: string) {
    const res = await request(app)
      .post("/api/v1/students")
      .set(auth(token))
      .send({ firstName, lastName: "Test" });
    expect(res.status).toBe(201);
    return res.body;
  }

  it("rejects requests without an institution context (super_admin)", async () => {
    await createUser({
      email: "super@x.dev",
      password: "Passw0rd!",
      role: "super_admin",
    });
    const superToken = await tokenFor("super@x.dev", "Passw0rd!");
    const res = await request(app).get("/api/v1/students").set(auth(superToken));
    expect(res.status).toBe(403); // requireTenant: no institution context
  });

  it("lists only the caller's institution's students", async () => {
    await createStudent(tokenA, "Alice");
    await createStudent(tokenB, "Bob");

    const listA = await request(app).get("/api/v1/students").set(auth(tokenA));
    expect(listA.body.data).toHaveLength(1);
    expect(listA.body.data[0].firstName).toBe("Alice");

    const listB = await request(app).get("/api/v1/students").set(auth(tokenB));
    expect(listB.body.data).toHaveLength(1);
    expect(listB.body.data[0].firstName).toBe("Bob");
  });

  it("cannot read, update or delete another institution's student", async () => {
    const bStudent = await createStudent(tokenB, "Bob");

    const read = await request(app)
      .get(`/api/v1/students/${bStudent.id}`)
      .set(auth(tokenA));
    expect(read.status).toBe(404);

    const update = await request(app)
      .patch(`/api/v1/students/${bStudent.id}`)
      .set(auth(tokenA))
      .send({ firstName: "Hacked" });
    expect(update.status).toBe(404);

    const del = await request(app)
      .delete(`/api/v1/students/${bStudent.id}`)
      .set(auth(tokenA));
    expect(del.status).toBe(404);

    // B's student is untouched.
    const stillThere = await request(app)
      .get(`/api/v1/students/${bStudent.id}`)
      .set(auth(tokenB));
    expect(stillThere.status).toBe(200);
    expect(stillThere.body.firstName).toBe("Bob");
  });

  it("cannot read another institution's invoice", async () => {
    const aStudent = await createStudent(tokenA, "Alice");
    const invoice = await request(app)
      .post("/api/v1/fees/invoices")
      .set(auth(tokenA))
      .send({
        studentId: aStudent.id,
        description: "Tuition",
        amountDue: 1000,
        dueDate: "2026-12-31",
      });
    expect(invoice.status).toBe(201);

    const crossRead = await request(app)
      .get(`/api/v1/fees/invoices/${invoice.body.id}`)
      .set(auth(tokenB));
    expect(crossRead.status).toBe(404);

    const listB = await request(app)
      .get("/api/v1/fees/invoices")
      .set(auth(tokenB));
    expect(listB.body.data).toHaveLength(0);
  });
});
