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

describe("biometric / RFID attendance (/biometric)", () => {
  let instA: string;
  let instB: string;
  let studentId: string;
  const tok: Record<string, string> = {};
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  beforeEach(async () => {
    await resetDb();
    instA = await createInstitution("BIO");
    instB = await createInstitution("BIO2");
    await createUser({ email: "admin@bio.dev", password: PW, role: "admin", institutionId: instA });
    await createUser({ email: "admin@bio2.dev", password: PW, role: "admin", institutionId: instB });
    await createUser({ email: "super@bio.dev", password: PW, role: "super_admin", institutionId: null });
    const s = await query<{ id: string }>(
      `INSERT INTO students (institution_id, admission_no, first_name, last_name) VALUES ($1, 'BIO-1', 'Arun', 'K') RETURNING id`,
      [instA]
    );
    studentId = s.rows[0].id;
    tok.admin = await tokenFor("admin@bio.dev", PW);
    tok.adminB = await tokenFor("admin@bio2.dev", PW);
    tok.super = await tokenFor("super@bio.dev", PW);
  });

  it("requires auth + tenant + admin role for management", async () => {
    expect((await request(app).get("/api/v1/biometric/devices")).status).toBe(401);
    expect((await request(app).get("/api/v1/biometric/devices").set(auth(tok.super))).status).toBe(403);
  });

  async function makeDevice() {
    const res = await request(app)
      .post("/api/v1/biometric/devices")
      .set(auth(tok.admin))
      .send({ name: "Main Gate", location: "Entrance" });
    expect(res.status).toBe(201);
    expect(res.body.deviceKey).toBeTruthy();
    return res.body.deviceKey as string;
  }

  it("ingests a scan, resolves the student, and marks attendance", async () => {
    const key = await makeDevice();

    // Missing / bad key is rejected.
    expect((await request(app).post("/api/v1/biometric/ingest").send({ identifier: "BIO-1" })).status).toBe(401);
    expect(
      (await request(app).post("/api/v1/biometric/ingest").set("x-device-key", "nope").send({ identifier: "BIO-1" })).status
    ).toBe(401);

    // Valid scan for a known student.
    const scan = await request(app)
      .post("/api/v1/biometric/ingest")
      .set("x-device-key", key)
      .send({ identifier: "BIO-1" });
    expect(scan.status).toBe(201);
    expect(scan.body.matched).toBe(true);
    expect(scan.body.attendanceMarked).toBe(true);

    // Attendance was recorded present for today.
    const att = await query<{ status: string }>(
      `SELECT status FROM attendance_records WHERE student_id = $1 AND date = CURRENT_DATE`,
      [studentId]
    );
    expect(att.rows[0]?.status).toBe("present");

    // A second 'in' scan does not duplicate the attendance mark.
    const scan2 = await request(app)
      .post("/api/v1/biometric/ingest")
      .set("x-device-key", key)
      .send({ identifier: "BIO-1" });
    expect(scan2.body.attendanceMarked).toBe(false);

    // Unknown identifier is recorded but unmatched.
    const unknown = await request(app)
      .post("/api/v1/biometric/ingest")
      .set("x-device-key", key)
      .send({ identifier: "GHOST" });
    expect(unknown.body.matched).toBe(false);

    // Events list shows them (student name for the matched scans).
    const events = await request(app).get("/api/v1/biometric/events").set(auth(tok.admin));
    expect(events.body.meta.total).toBe(3);
    const matched = (events.body.data as { studentName: string | null }[]).filter((e) => e.studentName);
    expect(matched.length).toBe(2);
  });

  it("rejects scans from a deactivated device", async () => {
    const key = await makeDevice();
    const devices = await request(app).get("/api/v1/biometric/devices").set(auth(tok.admin));
    const deviceId = devices.body[0].id as string;

    await request(app).patch(`/api/v1/biometric/devices/${deviceId}`).set(auth(tok.admin)).send({ isActive: false });
    expect(
      (await request(app).post("/api/v1/biometric/ingest").set("x-device-key", key).send({ identifier: "BIO-1" })).status
    ).toBe(401);
  });

  it("isolates tenants — admin B sees none of admin A's devices", async () => {
    await makeDevice();
    const list = await request(app).get("/api/v1/biometric/devices").set(auth(tok.adminB));
    expect(list.body).toHaveLength(0);
  });
});
