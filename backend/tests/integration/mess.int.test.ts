import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { app, createInstitution, createUser, resetDb, tokenFor } from "./helpers";

const PW = "Passw0rd!";

describe("cafeteria / mess menu (/cafeteria, /portal/mess-menu)", () => {
  let instA: string;
  let instB: string;
  const tok: Record<string, string> = {};
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  beforeEach(async () => {
    await resetDb();
    instA = await createInstitution("MESS");
    instB = await createInstitution("MESS2");
    await createUser({ email: "admin@ma.dev", password: PW, role: "admin", institutionId: instA });
    await createUser({ email: "admin@mb.dev", password: PW, role: "admin", institutionId: instB });
    await createUser({ email: "stud@ma.dev", password: PW, role: "student", institutionId: instA });
    await createUser({ email: "super@m.dev", password: PW, role: "super_admin", institutionId: null });
    tok.adminA = await tokenFor("admin@ma.dev", PW);
    tok.adminB = await tokenFor("admin@mb.dev", PW);
    tok.studentA = await tokenFor("stud@ma.dev", PW);
    tok.super = await tokenFor("super@m.dev", PW);
  });

  it("requires auth + tenant context (admin routes)", async () => {
    expect((await request(app).get("/api/v1/cafeteria/menu")).status).toBe(401);
    expect((await request(app).get("/api/v1/cafeteria/menu").set(auth(tok.super))).status).toBe(403);
  });

  it("adds, lists (with day/meal filter), updates, and deletes a menu item", async () => {
    const created = await request(app)
      .post("/api/v1/cafeteria/menu")
      .set(auth(tok.adminA))
      .send({ dayOfWeek: 1, meal: "lunch", items: "Rice, Dal, Curry" });
    expect(created.status).toBe(201);
    expect(created.body.meal).toBe("lunch");
    const id = created.body.id as string;

    await request(app)
      .post("/api/v1/cafeteria/menu")
      .set(auth(tok.adminA))
      .send({ dayOfWeek: 2, meal: "breakfast", items: "Idli, Sambar" });

    const all = await request(app).get("/api/v1/cafeteria/menu").set(auth(tok.adminA));
    expect(all.body.meta.total).toBe(2);

    const byDay = await request(app)
      .get("/api/v1/cafeteria/menu?dayOfWeek=1")
      .set(auth(tok.adminA));
    expect(byDay.body.meta.total).toBe(1);
    expect(byDay.body.data[0].items).toBe("Rice, Dal, Curry");

    const byMeal = await request(app)
      .get("/api/v1/cafeteria/menu?meal=breakfast")
      .set(auth(tok.adminA));
    expect(byMeal.body.meta.total).toBe(1);

    const upd = await request(app)
      .patch(`/api/v1/cafeteria/menu/${id}`)
      .set(auth(tok.adminA))
      .send({ items: "Rice, Dal, Curry, Curd", notes: "Veg only" });
    expect(upd.body.items).toBe("Rice, Dal, Curry, Curd");
    expect(upd.body.notes).toBe("Veg only");

    expect(
      (await request(app).delete(`/api/v1/cafeteria/menu/${id}`).set(auth(tok.adminA))).status
    ).toBe(204);
  });

  it("rejects an invalid day of week / meal", async () => {
    expect(
      (await request(app).post("/api/v1/cafeteria/menu").set(auth(tok.adminA))
        .send({ dayOfWeek: 9, meal: "lunch", items: "x" })).status
    ).toBe(400);
    expect(
      (await request(app).post("/api/v1/cafeteria/menu").set(auth(tok.adminA))
        .send({ dayOfWeek: 1, meal: "brunch", items: "x" })).status
    ).toBe(400);
  });

  it("lets a student read the weekly menu via the portal (own tenant only)", async () => {
    await request(app)
      .post("/api/v1/cafeteria/menu")
      .set(auth(tok.adminA))
      .send({ dayOfWeek: 3, meal: "dinner", items: "Chapati, Paneer" });

    const portal = await request(app).get("/api/v1/portal/mess-menu").set(auth(tok.studentA));
    expect(portal.status).toBe(200);
    expect(Array.isArray(portal.body)).toBe(true);
    expect(portal.body).toHaveLength(1);
    expect(portal.body[0].items).toBe("Chapati, Paneer");

    // An admin is not a portal user.
    expect((await request(app).get("/api/v1/portal/mess-menu").set(auth(tok.adminA))).status).toBe(403);
  });

  it("isolates tenants — admin B cannot read admin A's menu item", async () => {
    const created = await request(app)
      .post("/api/v1/cafeteria/menu")
      .set(auth(tok.adminA))
      .send({ dayOfWeek: 0, meal: "snacks", items: "Tea, Biscuits" });
    const id = created.body.id as string;
    expect(
      (await request(app).get(`/api/v1/cafeteria/menu/${id}`).set(auth(tok.adminB))).status
    ).toBe(404);
  });
});
