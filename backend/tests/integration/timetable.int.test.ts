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

describe("timetable management", () => {
  let institutionId: string;
  let adminToken: string;
  let teacherToken: string;
  let sectionA: string;
  let sectionB: string;
  let subjMath: string;
  let subjEng: string;
  let teacherX: string;
  let teacherY: string;
  let period1: string;
  let period2: string;
  let room1: string;
  let room2: string;

  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const post = (path: string, token: string, body: unknown) =>
    request(app).post(path).set(auth(token)).send(body);
  const get = (path: string, token: string) =>
    request(app).get(path).set(auth(token));

  // Default conflict-free entry; override fields per test.
  const entry = (over: Record<string, unknown> = {}) => ({
    sectionId: sectionA,
    dayOfWeek: 1,
    periodId: period1,
    subjectId: subjMath,
    teacherId: teacherX,
    roomId: room1,
    ...over,
  });

  beforeEach(async () => {
    await resetDb();
    institutionId = await createInstitution("TTA");
    await createUser({ email: "admin@tt.dev", password: PW, role: "admin", institutionId });
    await createUser({ email: "teacher@tt.dev", password: PW, role: "teacher", institutionId });
    adminToken = await tokenFor("admin@tt.dev", PW);
    teacherToken = await tokenFor("teacher@tt.dev", PW);

    const classId = await insertId(
      `INSERT INTO classes (institution_id, name, grade_level) VALUES ($1, 'Grade 1', 1) RETURNING id`,
      [institutionId]
    );
    sectionA = await insertId(
      `INSERT INTO sections (institution_id, class_id, name) VALUES ($1, $2, 'A') RETURNING id`,
      [institutionId, classId]
    );
    sectionB = await insertId(
      `INSERT INTO sections (institution_id, class_id, name) VALUES ($1, $2, 'B') RETURNING id`,
      [institutionId, classId]
    );
    subjMath = await insertId(
      `INSERT INTO subjects (institution_id, name, code) VALUES ($1, 'Mathematics', 'MATH') RETURNING id`,
      [institutionId]
    );
    subjEng = await insertId(
      `INSERT INTO subjects (institution_id, name, code) VALUES ($1, 'English', 'ENG') RETURNING id`,
      [institutionId]
    );
    teacherX = await insertId(
      `INSERT INTO teachers (institution_id, employee_no, first_name, last_name) VALUES ($1, 'EMP-X', 'Xavier', 'Teach') RETURNING id`,
      [institutionId]
    );
    teacherY = await insertId(
      `INSERT INTO teachers (institution_id, employee_no, first_name, last_name) VALUES ($1, 'EMP-Y', 'Yara', 'Teach') RETURNING id`,
      [institutionId]
    );

    period1 = (await post("/api/v1/timetable/periods", adminToken, {
      name: "Period 1",
      startTime: "08:00",
      endTime: "08:45",
      sortOrder: 1,
    }).expect(201)).body.id;
    period2 = (await post("/api/v1/timetable/periods", adminToken, {
      name: "Period 2",
      startTime: "08:45",
      endTime: "09:30",
      sortOrder: 2,
    }).expect(201)).body.id;
    room1 = (await post("/api/v1/timetable/rooms", adminToken, {
      name: "Room 101",
      code: "R101",
    }).expect(201)).body.id;
    room2 = (await post("/api/v1/timetable/rooms", adminToken, {
      name: "Room 102",
      code: "R102",
    }).expect(201)).body.id;
  });

  it("creates a timetable entry and lists it with names", async () => {
    const res = await post("/api/v1/timetable/entries", adminToken, entry());
    expect(res.status).toBe(201);
    expect(res.body.subjectName).toBe("Mathematics");
    expect(res.body.teacherName).toBe("Xavier Teach");
    expect(res.body.roomName).toBe("Room 101");

    const list = await get(
      `/api/v1/timetable/entries?sectionId=${sectionA}`,
      adminToken
    );
    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(1);
    expect(list.body[0].periodName).toBe("Period 1");
  });

  it("prevents the same section being double-booked in a slot", async () => {
    await post("/api/v1/timetable/entries", adminToken, entry()).expect(201);
    const clash = await post(
      "/api/v1/timetable/entries",
      adminToken,
      entry({ subjectId: subjEng, teacherId: teacherY, roomId: room2 })
    );
    expect(clash.status).toBe(409);
    expect(clash.body.error).toMatch(/already has/i);
  });

  it("prevents teacher double-booking across sections", async () => {
    await post("/api/v1/timetable/entries", adminToken, entry()).expect(201);
    // Same teacher, same slot, different section + room.
    const clash = await post(
      "/api/v1/timetable/entries",
      adminToken,
      entry({ sectionId: sectionB, subjectId: subjEng, roomId: room2 })
    );
    expect(clash.status).toBe(409);
    expect(clash.body.error).toMatch(/teacher/i);
  });

  it("prevents room double-booking across sections", async () => {
    await post("/api/v1/timetable/entries", adminToken, entry()).expect(201);
    // Same room, same slot, different section + teacher.
    const clash = await post(
      "/api/v1/timetable/entries",
      adminToken,
      entry({ sectionId: sectionB, subjectId: subjEng, teacherId: teacherY })
    );
    expect(clash.status).toBe(409);
    expect(clash.body.error).toMatch(/room/i);
  });

  it("allows the same teacher and room in a different period", async () => {
    await post("/api/v1/timetable/entries", adminToken, entry()).expect(201);
    const ok = await post(
      "/api/v1/timetable/entries",
      adminToken,
      entry({ sectionId: sectionB, periodId: period2 })
    );
    expect(ok.status).toBe(201);
  });

  it("re-checks conflicts on update", async () => {
    await post("/api/v1/timetable/entries", adminToken, entry()).expect(201);
    const second = await post(
      "/api/v1/timetable/entries",
      adminToken,
      entry({ sectionId: sectionB, periodId: period2, roomId: room2 })
    ).expect(201);
    // Move the second entry onto the first's teacher slot.
    const clash = await request(app)
      .patch(`/api/v1/timetable/entries/${second.body.id}`)
      .set(auth(adminToken))
      .send({ periodId: period1 });
    expect(clash.status).toBe(409);
    expect(clash.body.error).toMatch(/teacher|already/i);
  });

  it("enforces tenant isolation", async () => {
    await post("/api/v1/timetable/entries", adminToken, entry()).expect(201);

    const instB = await createInstitution("TTB");
    await createUser({ email: "admin@b.dev", password: PW, role: "admin", institutionId: instB });
    const bToken = await tokenFor("admin@b.dev", PW);

    // B sees none of A's entries.
    const bList = await get("/api/v1/timetable/entries", bToken);
    expect(bList.status).toBe(200);
    expect(bList.body).toHaveLength(0);

    // B cannot create an entry referencing A's section/period/subject.
    const cross = await post("/api/v1/timetable/entries", bToken, entry());
    expect(cross.status).toBe(400); // invalid section (not in B's tenant)
  });

  it("enforces permissions (teacher read-only)", async () => {
    // Teacher can read.
    const readable = await get("/api/v1/timetable/periods", teacherToken);
    expect(readable.status).toBe(200);

    // Teacher cannot create periods or entries.
    const noPeriod = await post("/api/v1/timetable/periods", teacherToken, {
      name: "P9",
      startTime: "10:00",
      endTime: "10:45",
    });
    expect(noPeriod.status).toBe(403);

    const noEntry = await post("/api/v1/timetable/entries", teacherToken, entry());
    expect(noEntry.status).toBe(403);

    // Teacher can export (has timetable:export).
    const csv = await get(
      `/api/v1/timetable/export?sectionId=${sectionA}`,
      teacherToken
    );
    expect(csv.status).toBe(200);
    expect(csv.headers["content-type"]).toMatch(/csv/);
  });
});
