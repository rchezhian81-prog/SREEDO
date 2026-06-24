import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { app, createInstitution, createUser, resetDb, tokenFor } from "./helpers";

const PW = "Passw0rd!";

describe("calendar / events (/calendar)", () => {
  let instA: string;
  let instB: string;
  const tok: Record<string, string> = {};
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  beforeEach(async () => {
    await resetDb();
    instA = await createInstitution("CAL");
    instB = await createInstitution("CAL2");
    await createUser({ email: "admin@ca.dev", password: PW, role: "admin", institutionId: instA });
    await createUser({ email: "admin@cb.dev", password: PW, role: "admin", institutionId: instB });
    await createUser({ email: "super@c.dev", password: PW, role: "super_admin", institutionId: null });
    tok.adminA = await tokenFor("admin@ca.dev", PW);
    tok.adminB = await tokenFor("admin@cb.dev", PW);
    tok.super = await tokenFor("super@c.dev", PW);
  });

  it("requires auth + tenant context", async () => {
    expect((await request(app).get("/api/v1/calendar/events")).status).toBe(401);
    expect(
      (await request(app).get("/api/v1/calendar/events").set(auth(tok.super))).status
    ).toBe(403);
  });

  it("creates, lists (with type + date filters), updates, and deletes events", async () => {
    const created = await request(app)
      .post("/api/v1/calendar/events")
      .set(auth(tok.adminA))
      .send({ title: "Independence Day", eventDate: "2026-08-15", type: "holiday" });
    expect(created.status).toBe(201);
    expect(created.body.type).toBe("holiday");
    const id = created.body.id as string;

    await request(app)
      .post("/api/v1/calendar/events")
      .set(auth(tok.adminA))
      .send({ title: "PTM", eventDate: "2026-08-20", type: "meeting" });

    const all = await request(app).get("/api/v1/calendar/events").set(auth(tok.adminA));
    expect(all.status).toBe(200);
    expect(all.body.length).toBe(2);

    const holidays = await request(app)
      .get("/api/v1/calendar/events?type=holiday")
      .set(auth(tok.adminA));
    expect(holidays.body.length).toBe(1);

    const ranged = await request(app)
      .get("/api/v1/calendar/events?dateFrom=2026-08-18&dateTo=2026-08-31")
      .set(auth(tok.adminA));
    expect(ranged.body.length).toBe(1); // only PTM falls in range

    const upd = await request(app)
      .patch(`/api/v1/calendar/events/${id}`)
      .set(auth(tok.adminA))
      .send({ title: "Independence Day (Holiday)" });
    expect(upd.body.title).toBe("Independence Day (Holiday)");

    expect(
      (await request(app).delete(`/api/v1/calendar/events/${id}`).set(auth(tok.adminA))).status
    ).toBe(204);
  });

  it("isolates tenants — admin B cannot read admin A's event", async () => {
    const created = await request(app)
      .post("/api/v1/calendar/events")
      .set(auth(tok.adminA))
      .send({ title: "X", eventDate: "2026-08-15" });
    const id = created.body.id as string;
    expect(
      (await request(app).get(`/api/v1/calendar/events/${id}`).set(auth(tok.adminB))).status
    ).toBe(404);
  });
});
