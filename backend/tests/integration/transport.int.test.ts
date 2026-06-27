import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import {
  app,
  createInstitution,
  createUser,
  query,
  resetDb,
  tokenFor,
} from "./helpers";

const PW = "Passw0rd!";

async function insertId(sql: string, params: unknown[]): Promise<string> {
  const { rows } = await query<{ id: string }>(sql, params);
  return rows[0].id;
}

describe("transport management", () => {
  let instA: string;
  let instB: string;
  let st1: string; // linked to the student user
  let st2: string;
  const tok: Record<string, string> = {};

  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const get = (p: string, t: string) => request(app).get(p).set(auth(t));
  const post = (p: string, t: string, b?: unknown) => request(app).post(p).set(auth(t)).send(b ?? {});
  const patch = (p: string, t: string, b: unknown) => request(app).patch(p).set(auth(t)).send(b);
  const del = (p: string, t: string) => request(app).delete(p).set(auth(t));

  async function makeRoute(code: string, vehicleId?: string, driverId?: string): Promise<string> {
    const res = await post("/api/v1/transport/routes", tok.admin, { name: `Route ${code}`, code, vehicleId, driverId });
    expect(res.status).toBe(201);
    return res.body.id as string;
  }
  async function makeStop(routeId: string, name: string): Promise<string> {
    const res = await post(`/api/v1/transport/routes/${routeId}/stops`, tok.admin, { name, pickupTime: "07:30", dropTime: "15:30" });
    expect(res.status).toBe(201);
    return res.body.id as string;
  }

  beforeEach(async () => {
    await resetDb();
    instA = await createInstitution("TRP");
    await createUser({ email: "admin@trp.dev", password: PW, role: "admin", institutionId: instA });
    await createUser({ email: "teacher@trp.dev", password: PW, role: "teacher", institutionId: instA });
    await createUser({ email: "accountant@trp.dev", password: PW, role: "accountant", institutionId: instA });
    const studentUser = await createUser({ email: "student@trp.dev", password: PW, role: "student", institutionId: instA });
    const parentUser = await createUser({ email: "parent@trp.dev", password: PW, role: "parent", institutionId: instA });

    st1 = await insertId(
      `INSERT INTO students (institution_id, admission_no, first_name, last_name, user_id) VALUES ($1,'TRP-1','Asha','K',$2) RETURNING id`,
      [instA, studentUser.id]
    );
    st2 = await insertId(
      `INSERT INTO students (institution_id, admission_no, first_name, last_name) VALUES ($1,'TRP-2','Bala','M') RETURNING id`,
      [instA]
    );
    await query(
      `INSERT INTO guardians (institution_id, user_id, student_id, relationship) VALUES ($1,$2,$3,'mother')`,
      [instA, parentUser.id, st1]
    );

    instB = await createInstitution("TRP2");
    await createUser({ email: "admin@trp2.dev", password: PW, role: "admin", institutionId: instB });

    for (const r of ["admin", "teacher", "accountant", "student", "parent"])
      tok[r] = await tokenFor(`${r}@trp.dev`, PW);
    tok.badmin = await tokenFor("admin@trp2.dev", PW);
  });

  it("manages vehicles, drivers, routes and stops", async () => {
    const v = await post("/api/v1/transport/vehicles", tok.admin, {
      registrationNo: "KA-01-1234", type: "Bus", capacity: 40,
      insuranceExpiry: "2026-12-31", fitnessExpiry: "2026-10-01", permitExpiry: "2027-01-01",
    });
    expect(v.status).toBe(201);
    expect((await post("/api/v1/transport/vehicles", tok.admin, { registrationNo: "KA-01-1234" })).status).toBe(409);

    const d = await post("/api/v1/transport/drivers", tok.admin, {
      name: "Ramesh", phone: "999", licenseNumber: "DL-9", licenseExpiry: "2026-09-01", helperName: "Suresh",
    });
    expect(d.status).toBe(201);

    const route = await makeRoute("R1", v.body.id, d.body.id);
    const routeList = (await get("/api/v1/transport/routes", tok.admin)).body;
    const r = routeList.find((x: { id: string }) => x.id === route);
    expect(r.vehicleNo).toBe("KA-01-1234");
    expect(r.driverName).toBe("Ramesh");

    const stop = await makeStop(route, "Main Gate");
    const stops = (await get(`/api/v1/transport/routes/${route}/stops`, tok.admin)).body;
    expect(stops).toHaveLength(1);
    const upd = await patch(`/api/v1/transport/stops/${stop}`, tok.admin, { zone: "North", stopOrder: 2 });
    expect(upd.body.zone).toBe("North");
    expect((await del(`/api/v1/transport/vehicles/${v.body.id}`, tok.admin)).status).toBe(204);
  });

  it("allocates students and exposes owner-scoped portal details", async () => {
    const route = await makeRoute("R1");
    const stop = await makeStop(route, "Park St");
    const alloc = await post("/api/v1/transport/allocations", tok.admin, {
      studentId: st1, routeId: route, stopId: stop, tripType: "both",
    });
    expect(alloc.status).toBe(201);
    // Duplicate allocation for the same student → 409.
    expect((await post("/api/v1/transport/allocations", tok.admin, { studentId: st1, routeId: route })).status).toBe(409);
    // Stop must belong to the route.
    const other = await makeRoute("R2");
    expect((await post("/api/v1/transport/allocations", tok.admin, { studentId: st2, routeId: other, stopId: stop })).status).toBe(400);

    const list = await get(`/api/v1/transport/allocations?routeId=${route}`, tok.admin);
    expect(list.body).toHaveLength(1);
    expect(list.body[0].stopName).toBe("Park St");

    // Owner-scoped portal: student sees own, parent sees child, not others.
    const own = await get(`/api/v1/transport/students/${st1}/allocation`, tok.student);
    expect(own.status).toBe(200);
    expect(own.body.routeName).toBe("Route R1");
    expect(own.body.stopName).toBe("Park St");
    expect((await get(`/api/v1/transport/students/${st1}/allocation`, tok.parent)).status).toBe(200);
    expect((await get(`/api/v1/transport/students/${st2}/allocation`, tok.student)).status).toBe(403);
  });

  it("maps fees (stop overrides route) and generates invoices idempotently", async () => {
    const route = await makeRoute("R1");
    const stopA = await makeStop(route, "Stop A");
    const stopB = await makeStop(route, "Stop B");
    await post("/api/v1/transport/allocations", tok.admin, { studentId: st1, routeId: route, stopId: stopA });
    await post("/api/v1/transport/allocations", tok.admin, { studentId: st2, routeId: route, stopId: stopB });

    // Route-level fee 500 + stop-level override 800 for Stop A.
    expect((await post("/api/v1/transport/fees", tok.accountant, { routeId: route, amount: 500 })).status).toBe(200);
    expect((await post("/api/v1/transport/fees", tok.accountant, { routeId: route, stopId: stopA, amount: 800 })).status).toBe(200);

    const gen = await post("/api/v1/transport/fees/generate", tok.accountant, { dueDate: "2026-12-31", period: "2026-07" });
    expect(gen.status).toBe(200);
    expect(gen.body).toMatchObject({ generated: 2, skipped: 0 });

    // st1 (Stop A) billed 800, st2 (Stop B → route fee) billed 500.
    const amt1 = await query<{ amount_due: string }>(
      `SELECT i.amount_due FROM transport_invoices ti JOIN invoices i ON i.id = ti.invoice_id WHERE ti.student_id = $1`,
      [st1]
    );
    const amt2 = await query<{ amount_due: string }>(
      `SELECT i.amount_due FROM transport_invoices ti JOIN invoices i ON i.id = ti.invoice_id WHERE ti.student_id = $1`,
      [st2]
    );
    expect(Number(amt1.rows[0].amount_due)).toBe(800);
    expect(Number(amt2.rows[0].amount_due)).toBe(500);

    // Re-running the same period is idempotent.
    const again = await post("/api/v1/transport/fees/generate", tok.accountant, { dueDate: "2026-12-31", period: "2026-07" });
    expect(again.body).toMatchObject({ generated: 0, skipped: 2 });

    // Fee dues report lists both outstanding transport invoices.
    const dues = await get("/api/v1/report-center/transport_fee_dues", tok.accountant);
    expect(dues.status).toBe(200);
    expect(dues.body.rows).toHaveLength(2);
  });

  it("produces transport reports", async () => {
    const v = await post("/api/v1/transport/vehicles", tok.admin, { registrationNo: "KA-9", capacity: 2, insuranceExpiry: "2020-01-01" });
    const route = await makeRoute("R1", v.body.id);
    const stop = await makeStop(route, "Stop A");
    await post("/api/v1/transport/allocations", tok.admin, { studentId: st1, routeId: route, stopId: stop });
    await post("/api/v1/transport/allocations", tok.admin, { studentId: st2, routeId: route, stopId: stop });

    const rws = await get(`/api/v1/report-center/transport_route_students?routeId=${route}`, tok.admin);
    expect(rws.status).toBe(200);
    expect(rws.body.rows).toHaveLength(2);

    const occ = await get("/api/v1/report-center/transport_occupancy", tok.admin);
    const row = occ.body.rows.find((r: { route: string }) => r.route === "Route R1");
    expect(row.allocated).toBe(2);
    expect(row.free).toBe(0); // capacity 2, allocated 2

    const exp = await get("/api/v1/report-center/transport_expiry", tok.admin);
    const ins = exp.body.rows.find((r: { document: string }) => r.document === "Insurance");
    expect(ins.status).toBe("Expired"); // 2020 insurance
  });

  it("schedules trips with one per route/date/type", async () => {
    const route = await makeRoute("R1");
    const t1 = await post("/api/v1/transport/trips", tok.admin, { routeId: route, tripDate: "2026-07-01", tripType: "pickup" });
    expect(t1.status).toBe(201);
    expect((await post("/api/v1/transport/trips", tok.admin, { routeId: route, tripDate: "2026-07-01", tripType: "pickup" })).status).toBe(409);
    const done = await patch(`/api/v1/transport/trips/${t1.body.id}`, tok.admin, { status: "completed" });
    expect(done.body.status).toBe("completed");
  });

  it("enforces permission guards", async () => {
    const route = await makeRoute("R1");
    // teacher: read yes; create/allocate/fees no.
    expect((await get("/api/v1/transport/vehicles", tok.teacher)).status).toBe(200);
    expect((await post("/api/v1/transport/vehicles", tok.teacher, { registrationNo: "X" })).status).toBe(403);
    expect((await post("/api/v1/transport/allocations", tok.teacher, { studentId: st1, routeId: route })).status).toBe(403);
    expect((await post("/api/v1/transport/fees", tok.teacher, { routeId: route, amount: 10 })).status).toBe(403);
    // accountant: fees yes; create/allocate no.
    expect((await post("/api/v1/transport/fees", tok.accountant, { routeId: route, amount: 100 })).status).toBe(200);
    expect((await post("/api/v1/transport/vehicles", tok.accountant, { registrationNo: "Y" })).status).toBe(403);
    expect((await post("/api/v1/transport/allocations", tok.accountant, { studentId: st1, routeId: route })).status).toBe(403);
    // student: no access.
    expect((await get("/api/v1/transport/vehicles", tok.student)).status).toBe(403);
  });

  it("is tenant-scoped (no cross-institution access)", async () => {
    const v = await post("/api/v1/transport/vehicles", tok.admin, { registrationNo: "KA-A" });
    const route = await makeRoute("RA");
    // B sees none of A's data.
    expect((await get("/api/v1/transport/vehicles", tok.badmin)).body).toHaveLength(0);
    expect((await get("/api/v1/transport/routes", tok.badmin)).body).toHaveLength(0);
    // B cannot mutate A's vehicle or allocate A's student.
    expect((await patch(`/api/v1/transport/vehicles/${v.body.id}`, tok.badmin, { type: "Hijack" })).status).toBe(404);
    expect((await post("/api/v1/transport/allocations", tok.badmin, { studentId: st1, routeId: route })).status).toBe(400);
  });
});
