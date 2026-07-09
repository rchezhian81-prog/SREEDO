import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { app, createInstitution, createUser, query, resetDb, tokenFor } from "./helpers";

// PR-T8 — PTM / Parent Meetings. Staff schedule meetings + slots and record
// attendance (ptm:*); parents book guardian-scoped slots for their own children;
// invites reuse the communication surface. Covers CRUD, capacity/one-per-meeting
// guards, guardian scoping, school (section) + college (batch) targeting, RBAC,
// tenant isolation, audit, and the T5 export.

const PW = "Passw0rd!";
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
const num = async (sql: string, p: unknown[]) =>
  Number((await query<{ c: string }>(sql, p)).rows[0].c);

describe("PR-T8 parent-teacher meetings", () => {
  let instA: string;
  let instB: string;
  let sectionId: string;
  let teacherId: string;
  let child: string; // parentA's linked child
  let other: string; // a different student
  const tok: Record<string, string> = {};

  beforeEach(async () => {
    await resetDb();
    instA = await createInstitution("PMA", "school");
    instB = await createInstitution("PMB", "school");
    await createUser({ email: "admin@pma.dev", password: PW, role: "admin", institutionId: instA });
    await createUser({ email: "student@pma.dev", password: PW, role: "student", institutionId: instA });
    const parent = await createUser({ email: "parent@pma.dev", password: PW, role: "parent", institutionId: instA });
    await createUser({ email: "admin@pmb.dev", password: PW, role: "admin", institutionId: instB });
    tok.adminA = await tokenFor("admin@pma.dev", PW);
    tok.studentA = await tokenFor("student@pma.dev", PW);
    tok.parentA = await tokenFor("parent@pma.dev", PW);
    tok.adminB = await tokenFor("admin@pmb.dev", PW);

    const classId = (await query<{ id: string }>(
      `INSERT INTO classes (institution_id, name, grade_level) VALUES ($1,'G5',5) RETURNING id`, [instA]
    )).rows[0].id;
    sectionId = (await query<{ id: string }>(
      `INSERT INTO sections (institution_id, class_id, name) VALUES ($1,$2,'A') RETURNING id`, [instA, classId]
    )).rows[0].id;
    teacherId = (await request(app).post("/api/v1/teachers").set(auth(tok.adminA))
      .send({ firstName: "Tara", lastName: "Teacher" })).body.id;
    child = (await request(app).post("/api/v1/students").set(auth(tok.adminA))
      .send({ firstName: "Kiran", lastName: "Kid", sectionId })).body.id;
    other = (await request(app).post("/api/v1/students").set(auth(tok.adminA))
      .send({ firstName: "Ravi", lastName: "Roll", sectionId })).body.id;
    // Link parentA to `child` only.
    await query(`INSERT INTO guardians (institution_id, user_id, student_id, relationship) VALUES ($1,$2,$3,'father')`,
      [instA, parent.id, child]);
  });

  const scheduleMeeting = async (body: Record<string, unknown> = {}) => {
    const m = await request(app).post("/api/v1/ptm/meetings").set(auth(tok.adminA))
      .send({ title: "Term 1 PTM", meetingDate: "2026-08-01", audienceType: "section", audienceRef: sectionId, ...body });
    await request(app).patch(`/api/v1/ptm/meetings/${m.body.id}`).set(auth(tok.adminA)).send({ status: "scheduled" });
    return m.body.id as string;
  };
  const addSlots = (meetingId: string, extra: Record<string, unknown> = {}) =>
    request(app).post(`/api/v1/ptm/meetings/${meetingId}/slots`).set(auth(tok.adminA))
      .send({ teacherId, startsAt: "2026-08-01T10:00", endsAt: "2026-08-01T10:30", slotMinutes: 15, capacity: 1, ...extra });

  it("schedules a meeting, generates slots, books a student and records attendance", async () => {
    const meetingId = await scheduleMeeting();
    const slots = await addSlots(meetingId);
    expect(slots.status).toBe(201);
    expect(slots.body.created).toBe(2); // 30 min / 15 = 2 slots
    const slotId = slots.body.slots[0].id;

    const booking = await request(app).post("/api/v1/ptm/bookings").set(auth(tok.adminA))
      .send({ slotId, studentId: child });
    expect(booking.status).toBe(201);

    const att = await request(app).patch(`/api/v1/ptm/bookings/${booking.body.id}`).set(auth(tok.adminA))
      .send({ status: "attended", notes: "Discussed progress" });
    expect(att.status).toBe(200);
    expect(att.body.status).toBe("attended");

    const summary = await request(app).get(`/api/v1/ptm/meetings/${meetingId}/summary`).set(auth(tok.adminA));
    expect(summary.body).toMatchObject({ slots: 2, booked: 1, attended: 1 });
  });

  it("enforces slot capacity and one active booking per student per meeting", async () => {
    const meetingId = await scheduleMeeting();
    const { body } = await addSlots(meetingId);
    const [s1, s2] = body.slots;

    expect((await request(app).post("/api/v1/ptm/bookings").set(auth(tok.adminA)).send({ slotId: s1.id, studentId: child })).status).toBe(201);
    // Same student, another slot in the same meeting → rejected.
    expect((await request(app).post("/api/v1/ptm/bookings").set(auth(tok.adminA)).send({ slotId: s2.id, studentId: child })).status).toBe(400);
    // Different student into the full slot 1 (capacity 1) → rejected.
    expect((await request(app).post("/api/v1/ptm/bookings").set(auth(tok.adminA)).send({ slotId: s1.id, studentId: other })).status).toBe(400);
    // Different student into the open slot 2 → ok.
    expect((await request(app).post("/api/v1/ptm/bookings").set(auth(tok.adminA)).send({ slotId: s2.id, studentId: other })).status).toBe(201);
  });

  it("lets a parent book only their own child (guardian-scoped) and cancel their booking", async () => {
    const meetingId = await scheduleMeeting();
    const { body } = await addSlots(meetingId);
    const slotId = body.slots[0].id;

    const mine = await request(app).get("/api/v1/ptm/my").set(auth(tok.parentA));
    expect(mine.body.meetings.map((m: { id: string }) => m.id)).toContain(meetingId);

    const slots = await request(app).get(`/api/v1/ptm/my/meetings/${meetingId}/slots`).set(auth(tok.parentA));
    expect(slots.status).toBe(200);

    const book = await request(app).post("/api/v1/ptm/my/bookings").set(auth(tok.parentA)).send({ slotId, studentId: child });
    expect(book.status).toBe(201);

    // Cannot book a student who is not their child.
    const { body: b2 } = await addSlots(meetingId, { startsAt: "2026-08-01T11:00", endsAt: "2026-08-01T11:15" });
    const badBook = await request(app).post("/api/v1/ptm/my/bookings").set(auth(tok.parentA)).send({ slotId: b2.slots[0].id, studentId: other });
    expect(badBook.status).toBe(403);

    // Cancels their own booking.
    expect((await request(app).delete(`/api/v1/ptm/my/bookings/${book.body.id}`).set(auth(tok.parentA))).status).toBe(204);
  });

  it("sends invites through the communication surface (degrades gracefully)", async () => {
    const meetingId = await scheduleMeeting();
    const invite = await request(app).post(`/api/v1/ptm/meetings/${meetingId}/invite`).set(auth(tok.adminA)).send({});
    expect(invite.status).toBe(200);
    expect(invite.body.sent).toBe(true);
    // parentA is a guardian of a section student → at least one recipient resolved.
    expect(invite.body.recipients).toBeGreaterThanOrEqual(1);
  });

  it("supports college (batch) audience targeting", async () => {
    const deptId = (await query<{ id: string }>(`INSERT INTO departments (institution_id, name, code) VALUES ($1,'Science','SCI') RETURNING id`, [instA])).rows[0].id;
    const progId = (await query<{ id: string }>(`INSERT INTO programs (institution_id, department_id, name, code, duration_semesters) VALUES ($1,$2,'BSc','BSC',6) RETURNING id`, [instA, deptId])).rows[0].id;
    const batchId = (await query<{ id: string }>(`INSERT INTO batches (institution_id, program_id, name, start_year) VALUES ($1,$2,'2026',2026) RETURNING id`, [instA, progId])).rows[0].id;
    const m = await request(app).post("/api/v1/ptm/meetings").set(auth(tok.adminA))
      .send({ title: "Sem 1 PTM", meetingDate: "2026-08-05", audienceType: "batch", audienceRef: batchId });
    expect(m.status).toBe(201);
    expect(m.body.audienceType).toBe("batch");
    // An invalid audienceRef for a batch audience is rejected.
    const bad = await request(app).post("/api/v1/ptm/meetings").set(auth(tok.adminA))
      .send({ title: "X", meetingDate: "2026-08-05", audienceType: "batch", audienceRef: "00000000-0000-0000-0000-000000000000" });
    expect(bad.status).toBe(400);
  });

  it("enforces RBAC (ptm:* for staff; parents cannot schedule)", async () => {
    // student role lacks ptm:* → 403 on read + write.
    expect((await request(app).get("/api/v1/ptm/meetings").set(auth(tok.studentA))).status).toBe(403);
    expect((await request(app).post("/api/v1/ptm/meetings").set(auth(tok.studentA)).send({ title: "X", meetingDate: "2026-08-01" })).status).toBe(403);
    // parent cannot schedule (no ptm:manage) …
    expect((await request(app).post("/api/v1/ptm/meetings").set(auth(tok.parentA)).send({ title: "X", meetingDate: "2026-08-01" })).status).toBe(403);
    // … but admin can.
    expect((await request(app).get("/api/v1/ptm/meetings").set(auth(tok.adminA))).status).toBe(200);
  });

  it("keeps meetings tenant-isolated", async () => {
    const meetingId = await scheduleMeeting();
    expect((await request(app).get("/api/v1/ptm/meetings").set(auth(tok.adminB))).body.meta.total).toBe(0);
    expect((await request(app).get(`/api/v1/ptm/meetings/${meetingId}`).set(auth(tok.adminB))).status).toBe(404);
  });

  it("audits meeting scheduling, attendance and invites", async () => {
    const meetingId = await scheduleMeeting();
    const { body } = await addSlots(meetingId);
    const booking = await request(app).post("/api/v1/ptm/bookings").set(auth(tok.adminA)).send({ slotId: body.slots[0].id, studentId: child });
    await request(app).patch(`/api/v1/ptm/bookings/${booking.body.id}`).set(auth(tok.adminA)).send({ status: "attended" });
    await request(app).post(`/api/v1/ptm/meetings/${meetingId}/invite`).set(auth(tok.adminA)).send({});

    expect(await num(`SELECT count(*) c FROM platform_audit_log WHERE institution_id=$1 AND action='ptm.meeting.create'`, [instA])).toBe(1);
    expect(await num(`SELECT count(*) c FROM platform_audit_log WHERE institution_id=$1 AND action='ptm.attendance.record'`, [instA])).toBe(1);
    expect(await num(`SELECT count(*) c FROM platform_audit_log WHERE institution_id=$1 AND action='ptm.invite.send'`, [instA])).toBe(1);
  });

  it("exports PTM attendance through the T5 center (sensitive → reason-gated)", async () => {
    const meetingId = await scheduleMeeting();
    const { body } = await addSlots(meetingId);
    const booking = await request(app).post("/api/v1/ptm/bookings").set(auth(tok.adminA)).send({ slotId: body.slots[0].id, studentId: child });
    await request(app).patch(`/api/v1/ptm/bookings/${booking.body.id}`).set(auth(tok.adminA)).send({ status: "attended", notes: "Good" });

    // Sensitive dataset → reason required.
    expect((await request(app).get("/api/v1/dataio/export/ptm_attendance?format=csv").set(auth(tok.adminA))).status).toBe(400);
    const exp = await request(app).get("/api/v1/dataio/export/ptm_attendance?format=csv&reason=T8%20review").set(auth(tok.adminA));
    expect(exp.status).toBe(200);
    expect(exp.text).toContain("Term 1 PTM");
    expect(exp.text).toContain("Kiran Kid");
  });
});
