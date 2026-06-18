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

describe("communication & notifications", () => {
  let instA: string;
  let st1: string;
  let st2: string;
  let secB: string;
  const tok: Record<string, string> = {};

  const post = (path: string, token: string, body?: unknown) =>
    request(app).post(path).set("Authorization", `Bearer ${token}`).send(body ?? {});
  const get = (path: string, token: string) =>
    request(app).get(path).set("Authorization", `Bearer ${token}`);

  beforeEach(async () => {
    await resetDb();
    instA = await createInstitution("CA");
    for (const role of ["admin", "teacher", "accountant"] as const) {
      await createUser({ email: `${role}@c.dev`, password: PW, role, institutionId: instA });
    }
    const classId = await insertId(
      `INSERT INTO classes (institution_id, name, grade_level) VALUES ($1, 'Grade 1', 1) RETURNING id`,
      [instA]
    );
    const sectionA = await insertId(
      `INSERT INTO sections (institution_id, class_id, name) VALUES ($1, $2, 'A') RETURNING id`,
      [instA, classId]
    );
    st1 = await insertId(
      `INSERT INTO students (institution_id, admission_no, first_name, last_name, section_id) VALUES ($1, 'C1', 'Ava', 'One', $2) RETURNING id`,
      [instA, sectionA]
    );
    st2 = await insertId(
      `INSERT INTO students (institution_id, admission_no, first_name, last_name, section_id) VALUES ($1, 'C2', 'Ben', 'Two', $2) RETURNING id`,
      [instA, sectionA]
    );

    const su1 = await createUser({ email: "st1@c.dev", password: PW, role: "student", institutionId: instA });
    await query(`UPDATE students SET user_id = $1 WHERE id = $2`, [su1.id, st1]);
    const su2 = await createUser({ email: "st2@c.dev", password: PW, role: "student", institutionId: instA });
    await query(`UPDATE students SET user_id = $1 WHERE id = $2`, [su2.id, st2]);
    const pu1 = await createUser({ email: "parent@c.dev", password: PW, role: "parent", institutionId: instA });
    for (const sid of [st1, st2]) {
      await query(
        `INSERT INTO guardians (institution_id, user_id, student_id, relationship) VALUES ($1, $2, $3, 'mother')`,
        [instA, pu1.id, sid]
      );
    }

    // st1: outstanding invoice + an absence on a fixed date.
    await query(
      `INSERT INTO invoices (institution_id, invoice_no, student_id, description, amount_due, due_date) VALUES ($1, 'INV-C1', $2, 'Tuition', 1000, '2026-12-31')`,
      [instA, st1]
    );
    await query(
      `INSERT INTO attendance_records (institution_id, student_id, date, status) VALUES ($1, $2, '2026-03-02', 'absent')`,
      [instA, st1]
    );

    // Institution B (cross-tenant).
    const instB = await createInstitution("CB");
    await createUser({ email: "badmin@c.dev", password: PW, role: "admin", institutionId: instB });
    await createUser({ email: "bstudent@c.dev", password: PW, role: "student", institutionId: instB });
    const classB = await insertId(
      `INSERT INTO classes (institution_id, name, grade_level) VALUES ($1, 'GB', 1) RETURNING id`,
      [instB]
    );
    secB = await insertId(
      `INSERT INTO sections (institution_id, class_id, name) VALUES ($1, $2, 'A') RETURNING id`,
      [instB, classB]
    );

    for (const e of ["admin", "teacher", "accountant"]) tok[e] = await tokenFor(`${e}@c.dev`, PW);
    tok.st1 = await tokenFor("st1@c.dev", PW);
    tok.st2 = await tokenFor("st2@c.dev", PW);
    tok.parent = await tokenFor("parent@c.dev", PW);
    tok.badmin = await tokenFor("badmin@c.dev", PW);
    tok.bstudent = await tokenFor("bstudent@c.dev", PW);
  });

  it("sends an in-app message to an audience and delivers to the inbox", async () => {
    const sent = await post("/api/v1/communication/messages", tok.admin, {
      subject: "Holiday notice",
      body: "School closed Friday.",
      audienceType: "all_students",
    });
    expect(sent.status).toBe(201);
    expect(sent.body.recipientCount).toBe(2); // st1 + st2 student users

    const inbox = await get("/api/v1/communication/inbox", tok.st1);
    expect(inbox.status).toBe(200);
    expect(inbox.body).toHaveLength(1);
    expect(inbox.body[0].subject).toBe("Holiday notice");
    expect(inbox.body[0].senderName).toBeTruthy();
  });

  it("targets recipients by role and scopes inboxes to the owner", async () => {
    // Parents only.
    await post("/api/v1/communication/messages", tok.admin, {
      subject: "PTM",
      body: "Parent-teacher meeting Saturday.",
      audienceType: "all_parents",
    }).expect(201);
    expect((await get("/api/v1/communication/inbox", tok.parent)).body).toHaveLength(1);
    expect((await get("/api/v1/communication/inbox", tok.st1)).body).toHaveLength(0);

    // A message to st2 only must not land in st1's inbox.
    await post("/api/v1/communication/messages", tok.admin, {
      subject: "For Ben",
      body: "Private note.",
      audienceType: "student",
      audienceRef: st2,
    }).expect(201);
    expect((await get("/api/v1/communication/inbox", tok.st1)).body).toHaveLength(0);
    const benInbox = await get("/api/v1/communication/inbox", tok.st2);
    expect(benInbox.body.some((m: { subject: string }) => m.subject === "For Ben")).toBe(true);
  });

  it("denies cross-institution delivery and targeting", async () => {
    await post("/api/v1/communication/messages", tok.admin, {
      subject: "A only",
      body: "Institution A students.",
      audienceType: "all_students",
    }).expect(201);
    // Institution B's student receives nothing.
    expect((await get("/api/v1/communication/inbox", tok.bstudent)).body).toHaveLength(0);

    // Admin A targeting B's section resolves to zero recipients.
    const cross = await post("/api/v1/communication/messages", tok.admin, {
      subject: "x",
      body: "y",
      audienceType: "section",
      audienceRef: secB,
    });
    expect(cross.status).toBe(201);
    expect(cross.body.recipientCount).toBe(0);
  });

  it("generates fee reminders to the student and guardians", async () => {
    const res = await post("/api/v1/communication/fee-reminders", tok.accountant);
    expect(res.status).toBe(200);
    expect(res.body.students).toBe(1); // only st1 has dues
    expect(res.body.recipients).toBeGreaterThanOrEqual(2); // st1 user + parent

    const parentInbox = await get("/api/v1/communication/inbox", tok.parent);
    expect(parentInbox.body.some((m: { category: string }) => m.category === "fee_reminder")).toBe(true);
  });

  it("generates absence alerts and de-duplicates per student/date", async () => {
    const first = await post("/api/v1/communication/absence-alerts", tok.teacher, {
      date: "2026-03-02",
    });
    expect(first.status).toBe(200);
    expect(first.body.students).toBe(1);

    const parentInbox = await get("/api/v1/communication/inbox", tok.parent);
    expect(parentInbox.body.some((m: { category: string }) => m.category === "absence_alert")).toBe(true);

    // Re-running the same date sends nothing (deduped)…
    const again = await post("/api/v1/communication/absence-alerts", tok.teacher, {
      date: "2026-03-02",
    });
    expect(again.body.students).toBe(0);

    // …unless forced.
    const forced = await post("/api/v1/communication/absence-alerts", tok.teacher, {
      date: "2026-03-02",
      force: true,
    });
    expect(forced.body.students).toBe(1);
  });

  it("registers a device token and still sends when FCM/SMS/SMTP are unconfigured", async () => {
    const reg = await post("/api/v1/communication/device-tokens", tok.st1, {
      token: "demo-device-token-123456",
      platform: "android",
    });
    expect(reg.status).toBe(201);
    // With a token present but no FCM/SMS/SMTP configured, sending must still succeed.
    const sent = await post("/api/v1/communication/messages", tok.admin, {
      subject: "Ping",
      body: "Adapters degrade gracefully.",
      audienceType: "all_students",
    });
    expect(sent.status).toBe(201);
    expect(sent.body.recipientCount).toBe(2);
  });

  it("enforces permission guards", async () => {
    // student cannot compose/send
    expect(
      (await post("/api/v1/communication/messages", tok.st1, {
        subject: "x",
        body: "y",
        audienceType: "all_students",
      })).status
    ).toBe(403);
    // student cannot trigger notifications
    expect((await post("/api/v1/communication/fee-reminders", tok.st1)).status).toBe(403);
    // student cannot view sent history
    expect((await get("/api/v1/communication/messages", tok.st1)).status).toBe(403);
    // student CAN read their own inbox
    expect((await get("/api/v1/communication/inbox", tok.st1)).status).toBe(200);
    // accountant can trigger fee reminders
    expect((await post("/api/v1/communication/fee-reminders", tok.accountant)).status).toBe(200);
  });

  it("tracks read/unread status", async () => {
    await post("/api/v1/communication/messages", tok.admin, {
      subject: "Read me",
      body: "Body.",
      audienceType: "all_students",
    }).expect(201);

    expect((await get("/api/v1/communication/inbox/unread-count", tok.st1)).body.count).toBe(1);
    const inbox = await get("/api/v1/communication/inbox", tok.st1);
    const messageId = inbox.body[0].id;
    expect(inbox.body[0].readAt).toBeNull();

    const read = await post(`/api/v1/communication/inbox/${messageId}/read`, tok.st1);
    expect(read.status).toBe(204);
    expect((await get("/api/v1/communication/inbox/unread-count", tok.st1)).body.count).toBe(0);

    // Marking a message that isn't in your inbox → 404 (parent wasn't a recipient).
    expect((await post(`/api/v1/communication/inbox/${messageId}/read`, tok.parent)).status).toBe(404);
  });
});
