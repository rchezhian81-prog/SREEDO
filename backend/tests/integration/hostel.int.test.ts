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

describe("hostel management", () => {
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

  async function makeHostel(code: string): Promise<string> {
    const res = await post("/api/v1/hostel/hostels", tok.admin, { name: `Hostel ${code}`, code, type: "boys", wardenName: "Warden W" });
    expect(res.status).toBe(201);
    return res.body.id as string;
  }
  async function makeRoom(hostelId: string, roomNumber: string, capacity: number, roomType?: string): Promise<string> {
    const res = await post(`/api/v1/hostel/hostels/${hostelId}/rooms`, tok.admin, { roomNumber, capacity, roomType });
    expect(res.status).toBe(201);
    return res.body.id as string;
  }

  beforeEach(async () => {
    await resetDb();
    instA = await createInstitution("HST");
    await createUser({ email: "admin@hst.dev", password: PW, role: "admin", institutionId: instA });
    await createUser({ email: "teacher@hst.dev", password: PW, role: "teacher", institutionId: instA });
    await createUser({ email: "accountant@hst.dev", password: PW, role: "accountant", institutionId: instA });
    const studentUser = await createUser({ email: "student@hst.dev", password: PW, role: "student", institutionId: instA });
    const parentUser = await createUser({ email: "parent@hst.dev", password: PW, role: "parent", institutionId: instA });

    st1 = await insertId(
      `INSERT INTO students (institution_id, admission_no, first_name, last_name, user_id) VALUES ($1,'HST-1','Asha','K',$2) RETURNING id`,
      [instA, studentUser.id]
    );
    st2 = await insertId(
      `INSERT INTO students (institution_id, admission_no, first_name, last_name) VALUES ($1,'HST-2','Bala','M') RETURNING id`,
      [instA]
    );
    await query(
      `INSERT INTO guardians (institution_id, user_id, student_id, relationship) VALUES ($1,$2,$3,'mother')`,
      [instA, parentUser.id, st1]
    );

    instB = await createInstitution("HST2");
    await createUser({ email: "admin@hst2.dev", password: PW, role: "admin", institutionId: instB });

    for (const r of ["admin", "teacher", "accountant", "student", "parent"])
      tok[r] = await tokenFor(`${r}@hst.dev`, PW);
    tok.badmin = await tokenFor("admin@hst2.dev", PW);
  });

  it("manages hostels, blocks and rooms", async () => {
    const hostel = await makeHostel("H1");
    expect((await post("/api/v1/hostel/hostels", tok.admin, { name: "Dup", code: "H1" })).status).toBe(409);

    const block = await post(`/api/v1/hostel/hostels/${hostel}/blocks`, tok.admin, { name: "Block A" });
    expect(block.status).toBe(201);

    const room = await post(`/api/v1/hostel/hostels/${hostel}/rooms`, tok.admin, {
      roomNumber: "101", blockId: block.body.id, floor: "1", roomType: "2-sharing", capacity: 2,
    });
    expect(room.status).toBe(201);
    const rooms = (await get(`/api/v1/hostel/hostels/${hostel}/rooms`, tok.admin)).body;
    expect(rooms[0].occupied).toBe(0);
    expect(rooms[0].availableBeds).toBe(2);
    expect(rooms[0].blockName).toBe("Block A");

    const upd = await patch(`/api/v1/hostel/rooms/${room.body.id}`, tok.admin, { status: "maintenance" });
    expect(upd.body.status).toBe("maintenance");
  });

  it("allocates students, enforces capacity, and exposes owner-scoped portal details", async () => {
    const hostel = await makeHostel("H1");
    const room = await makeRoom(hostel, "101", 1);

    const a1 = await post("/api/v1/hostel/allocations", tok.admin, { studentId: st1, hostelId: hostel, roomId: room, bedNo: "1" });
    expect(a1.status).toBe(201);
    // Room full (capacity 1) → second allocation rejected.
    expect((await post("/api/v1/hostel/allocations", tok.admin, { studentId: st2, hostelId: hostel, roomId: room })).status).toBe(409);
    // Same student already active → rejected even in another room.
    const room2 = await makeRoom(hostel, "102", 2);
    expect((await post("/api/v1/hostel/allocations", tok.admin, { studentId: st1, hostelId: hostel, roomId: room2 })).status).toBe(409);
    // Maintenance room rejects allocation.
    const mroom = await makeRoom(hostel, "103", 2);
    await patch(`/api/v1/hostel/rooms/${mroom}`, tok.admin, { status: "maintenance" });
    expect((await post("/api/v1/hostel/allocations", tok.admin, { studentId: st2, hostelId: hostel, roomId: mroom })).status).toBe(409);

    // Occupancy reflected on the room.
    const rooms = (await get(`/api/v1/hostel/hostels/${hostel}/rooms`, tok.admin)).body;
    expect(rooms.find((r: { id: string }) => r.id === room).occupied).toBe(1);

    // Owner-scoped portal.
    const own = await get(`/api/v1/hostel/students/${st1}/allocation`, tok.student);
    expect(own.status).toBe(200);
    expect(own.body.roomNumber).toBe("101");
    expect(own.body.wardenName).toBe("Warden W");
    expect((await get(`/api/v1/hostel/students/${st1}/allocation`, tok.parent)).status).toBe(200);
    expect((await get(`/api/v1/hostel/students/${st2}/allocation`, tok.student)).status).toBe(403);
  });

  it("transfers and vacates allocations", async () => {
    const hostel = await makeHostel("H1");
    const roomA = await makeRoom(hostel, "A", 1);
    const roomB = await makeRoom(hostel, "B", 1);
    const a1 = await post("/api/v1/hostel/allocations", tok.admin, { studentId: st1, hostelId: hostel, roomId: roomA });

    const transfer = await post(`/api/v1/hostel/allocations/${a1.body.id}/transfer`, tok.admin, { roomId: roomB });
    expect(transfer.status).toBe(200);
    expect(transfer.body.roomId).toBe(roomB);
    // Only one active allocation (in room B); room A freed.
    const active = await get(`/api/v1/hostel/allocations?status=active`, tok.admin);
    expect(active.body).toHaveLength(1);
    expect(active.body[0].roomNumber).toBe("B");

    const vac = await post(`/api/v1/hostel/allocations/${transfer.body.id}/vacate`, tok.admin, {});
    expect(vac.body.status).toBe("vacated");
    expect((await get(`/api/v1/hostel/allocations?status=active`, tok.admin)).body).toHaveLength(0);

    // Vacated report shows the transferred + vacated history.
    const hist = await get("/api/v1/report-center/hostel_vacated", tok.admin);
    expect(hist.body.rows.length).toBe(2);
  });

  it("maps fees (room-type overrides hostel) and generates invoices idempotently", async () => {
    const hostel = await makeHostel("H1");
    const acRoom = await makeRoom(hostel, "AC1", 1, "AC");
    const stdRoom = await makeRoom(hostel, "STD1", 1, "Non-AC");
    await post("/api/v1/hostel/allocations", tok.admin, { studentId: st1, hostelId: hostel, roomId: acRoom });
    await post("/api/v1/hostel/allocations", tok.admin, { studentId: st2, hostelId: hostel, roomId: stdRoom });

    // Hostel-level fee 1000 + room-type override 1500 for AC.
    expect((await post("/api/v1/hostel/fees", tok.accountant, { hostelId: hostel, amount: 1000 })).status).toBe(200);
    expect((await post("/api/v1/hostel/fees", tok.accountant, { hostelId: hostel, roomType: "AC", amount: 1500 })).status).toBe(200);

    const gen = await post("/api/v1/hostel/fees/generate", tok.accountant, { dueDate: "2026-12-31", period: "2026-07" });
    expect(gen.body).toMatchObject({ generated: 2, skipped: 0 });

    const amt1 = await query<{ amount_due: string }>(
      `SELECT i.amount_due FROM hostel_invoices hi JOIN invoices i ON i.id = hi.invoice_id WHERE hi.student_id = $1`,
      [st1]
    );
    const amt2 = await query<{ amount_due: string }>(
      `SELECT i.amount_due FROM hostel_invoices hi JOIN invoices i ON i.id = hi.invoice_id WHERE hi.student_id = $1`,
      [st2]
    );
    expect(Number(amt1.rows[0].amount_due)).toBe(1500); // AC room → override
    expect(Number(amt2.rows[0].amount_due)).toBe(1000); // Non-AC → hostel fee

    // Idempotent re-run.
    const again = await post("/api/v1/hostel/fees/generate", tok.accountant, { dueDate: "2026-12-31", period: "2026-07" });
    expect(again.body).toMatchObject({ generated: 0, skipped: 2 });

    const dues = await get("/api/v1/report-center/hostel_fee_dues", tok.accountant);
    expect(dues.body.rows).toHaveLength(2);
  });

  // PR-FIX1 — the fee-frequency dropdown must only offer values the schema
  // accepts. Locks the hostel fee contract to monthly/term/annual so the UI
  // (which used to also offer quarterly/one_time → 400) cannot drift again.
  it("accepts monthly/term/annual fee frequencies and rejects unsupported ones", async () => {
    const hostel = await makeHostel("HF");
    for (const frequency of ["monthly", "term", "annual"]) {
      expect(
        (await post("/api/v1/hostel/fees", tok.accountant, { hostelId: hostel, amount: 100, frequency })).status
      ).toBe(200);
    }
    for (const frequency of ["quarterly", "one_time"]) {
      expect(
        (await post("/api/v1/hostel/fees", tok.accountant, { hostelId: hostel, amount: 100, frequency })).status
      ).toBe(400);
    }
  });

  it("produces occupancy and room reports", async () => {
    const hostel = await makeHostel("H1");
    const room = await makeRoom(hostel, "101", 3);
    await post("/api/v1/hostel/allocations", tok.admin, { studentId: st1, hostelId: hostel, roomId: room });
    await post("/api/v1/hostel/allocations", tok.admin, { studentId: st2, hostelId: hostel, roomId: room });

    const occ = await get("/api/v1/report-center/hostel_occupancy", tok.admin);
    const row = occ.body.rows.find((r: { hostel: string }) => r.hostel === "Hostel H1");
    expect(row.beds).toBe(3);
    expect(row.occupied).toBe(2);
    expect(row.vacant).toBe(1);

    const ra = await get(`/api/v1/report-center/hostel_room_allocation?hostelId=${hostel}`, tok.admin);
    const rr = ra.body.rows.find((r: { room: string }) => r.room === "101");
    expect(rr.occupied).toBe(2);
    expect(rr.available).toBe(1);
  });

  it("enforces permission guards", async () => {
    const hostel = await makeHostel("H1");
    const room = await makeRoom(hostel, "101", 2);
    // teacher: read yes; create/allocate/fees no.
    expect((await get("/api/v1/hostel/hostels", tok.teacher)).status).toBe(200);
    expect((await post("/api/v1/hostel/hostels", tok.teacher, { name: "X", code: "X" })).status).toBe(403);
    expect((await post("/api/v1/hostel/allocations", tok.teacher, { studentId: st1, hostelId: hostel, roomId: room })).status).toBe(403);
    expect((await post("/api/v1/hostel/fees", tok.teacher, { hostelId: hostel, amount: 1 })).status).toBe(403);
    // accountant: fees yes; create/allocate no.
    expect((await post("/api/v1/hostel/fees", tok.accountant, { hostelId: hostel, amount: 500 })).status).toBe(200);
    expect((await post("/api/v1/hostel/hostels", tok.accountant, { name: "Y", code: "Y" })).status).toBe(403);
    expect((await post("/api/v1/hostel/allocations", tok.accountant, { studentId: st1, hostelId: hostel, roomId: room })).status).toBe(403);
    // student: no access.
    expect((await get("/api/v1/hostel/hostels", tok.student)).status).toBe(403);
  });

  it("is tenant-scoped (no cross-institution access)", async () => {
    const hostel = await makeHostel("HA");
    const room = await makeRoom(hostel, "101", 2);
    // B sees none of A's data.
    expect((await get("/api/v1/hostel/hostels", tok.badmin)).body).toHaveLength(0);
    // B cannot mutate A's hostel or allocate A's student.
    expect((await patch(`/api/v1/hostel/hostels/${hostel}`, tok.badmin, { name: "Hijack" })).status).toBe(404);
    expect((await post("/api/v1/hostel/allocations", tok.badmin, { studentId: st1, hostelId: hostel, roomId: room })).status).toBe(400);
  });
});
