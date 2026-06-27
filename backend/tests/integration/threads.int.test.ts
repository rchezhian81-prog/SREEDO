import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { app, createInstitution, createUser, resetDb, tokenFor } from "./helpers";

const PW = "Passw0rd!";

describe("threaded messaging", () => {
  let instA: string;
  const id: Record<string, string> = {};
  const tok: Record<string, string> = {};

  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const get = (p: string, t: string) => request(app).get(p).set(auth(t));
  const post = (p: string, t: string, body?: unknown) =>
    request(app).post(p).set(auth(t)).send(body as object);
  const del = (p: string, t: string) => request(app).delete(p).set(auth(t));

  beforeEach(async () => {
    await resetDb();
    instA = await createInstitution("THR");
    for (const [k, role] of [
      ["admin", "admin"],
      ["teacher", "teacher"],
      ["parent", "parent"],
      ["student", "student"],
    ] as const) {
      const u = await createUser({
        email: `${k}@thr.dev`,
        password: PW,
        role,
        institutionId: instA,
        fullName: `${k} user`,
      });
      id[k] = u.id;
      tok[k] = await tokenFor(`${k}@thr.dev`, PW);
    }
  });

  it("creates one-to-one and group threads", async () => {
    const direct = await post("/api/v1/communication/threads", tok.admin, {
      subject: "Hi teacher",
      participantIds: [id.teacher],
      body: "hello",
    });
    expect(direct.status).toBe(201);
    expect(direct.body.type).toBe("direct");
    expect(direct.body.participants).toHaveLength(2);
    expect(direct.body.messages).toHaveLength(1);

    const group = await post("/api/v1/communication/threads", tok.admin, {
      subject: "Group",
      participantIds: [id.teacher, id.parent],
      body: "hi all",
    });
    expect(group.status).toBe(201);
    expect(group.body.type).toBe("group");
    expect(group.body.participants).toHaveLength(3);
  });

  it("sends replies and tracks per-participant read state", async () => {
    const thread = (await post("/api/v1/communication/threads", tok.admin, {
      participantIds: [id.teacher],
      body: "hello",
    })).body;

    // Teacher has 1 unread (admin's opening message).
    expect((await get("/api/v1/communication/threads/unread-count", tok.teacher)).body.count).toBe(1);
    expect((await get("/api/v1/communication/threads", tok.teacher)).body[0].unreadCount).toBe(1);

    // Teacher replies → teacher now read; admin has 1 unread.
    const reply = await post(`/api/v1/communication/threads/${thread.id}/messages`, tok.teacher, {
      body: "hi back",
    });
    expect(reply.status).toBe(201);
    expect((await get("/api/v1/communication/threads/unread-count", tok.teacher)).body.count).toBe(0);
    expect((await get("/api/v1/communication/threads/unread-count", tok.admin)).body.count).toBe(1);

    // Admin marks read → 0 unread; thread now has 2 messages.
    expect((await post(`/api/v1/communication/threads/${thread.id}/read`, tok.admin)).status).toBe(200);
    expect((await get("/api/v1/communication/threads/unread-count", tok.admin)).body.count).toBe(0);
    expect((await get(`/api/v1/communication/threads/${thread.id}`, tok.admin)).body.messages).toHaveLength(2);
  });

  it("restricts access to participants only", async () => {
    const thread = (await post("/api/v1/communication/threads", tok.admin, {
      participantIds: [id.teacher],
      body: "private",
    })).body;
    // parent is not a participant.
    expect((await get(`/api/v1/communication/threads/${thread.id}`, tok.parent)).status).toBe(404);
    expect((await post(`/api/v1/communication/threads/${thread.id}/messages`, tok.parent, { body: "x" })).status).toBe(404);
  });

  it("is owner-scoped for parent/student (only their own threads)", async () => {
    const withParent = (await post("/api/v1/communication/threads", tok.admin, {
      participantIds: [id.parent],
      body: "to parent",
    })).body;
    const withStudent = (await post("/api/v1/communication/threads", tok.admin, {
      participantIds: [id.student],
      body: "to student",
    })).body;

    const parentList = (await get("/api/v1/communication/threads", tok.parent)).body;
    expect(parentList).toHaveLength(1);
    expect(parentList[0].id).toBe(withParent.id);

    const studentList = (await get("/api/v1/communication/threads", tok.student)).body;
    expect(studentList).toHaveLength(1);
    expect(studentList[0].id).toBe(withStudent.id);

    // A participant student can reply (threads:reply); read state works.
    expect((await post(`/api/v1/communication/threads/${withStudent.id}/messages`, tok.student, { body: "ok" })).status).toBe(201);
  });

  it("rejects cross-institution participants and access", async () => {
    const instB = await createInstitution("THR2");
    const bAdmin = await createUser({ email: "admin@thr2.dev", password: PW, role: "admin", institutionId: instB });
    const bTok = await tokenFor("admin@thr2.dev", PW);

    // teacher in A cannot add a participant from B.
    const bad = await post("/api/v1/communication/threads", tok.teacher, {
      participantIds: [bAdmin.id],
      body: "x",
    });
    expect(bad.status).toBe(400);

    // B admin cannot see/act on an A thread.
    const aThread = (await post("/api/v1/communication/threads", tok.admin, {
      participantIds: [id.teacher],
      body: "a-only",
    })).body;
    expect((await get(`/api/v1/communication/threads/${aThread.id}`, bTok)).status).toBe(404);
    expect((await post(`/api/v1/communication/threads/${aThread.id}/messages`, bTok, { body: "x" })).status).toBe(404);
    expect((await get("/api/v1/communication/threads", bTok)).body).toHaveLength(0);
  });

  it("enforces permission checks (student cannot start a thread)", async () => {
    expect((await post("/api/v1/communication/threads", tok.student, { participantIds: [id.admin], body: "x" })).status).toBe(403);
    // but can read its own thread list
    expect((await get("/api/v1/communication/threads", tok.student)).status).toBe(200);
  });

  it("supports archive and add-participants (manage)", async () => {
    const thread = (await post("/api/v1/communication/threads", tok.admin, {
      participantIds: [id.teacher],
      body: "hi",
    })).body;
    // admin (threads:manage) adds the parent.
    const updated = await post(`/api/v1/communication/threads/${thread.id}/participants`, tok.admin, {
      participantIds: [id.parent],
    });
    expect(updated.status).toBe(200);
    expect(updated.body.participants).toHaveLength(3);
    // teacher lacks threads:manage.
    expect((await post(`/api/v1/communication/threads/${thread.id}/participants`, tok.teacher, { participantIds: [id.student] })).status).toBe(403);
    // teacher archives the thread for themselves → no longer in their list.
    expect((await del(`/api/v1/communication/threads/${thread.id}`, tok.teacher)).status).toBe(200);
    expect((await get("/api/v1/communication/threads", tok.teacher)).body).toHaveLength(0);
  });

  it("delivers a reply even with no external notification channels (graceful)", async () => {
    const thread = (await post("/api/v1/communication/threads", tok.admin, {
      participantIds: [id.teacher],
      body: "hello",
    })).body;
    // SMTP/SMS/FCM are unconfigured in tests — the reply must still succeed.
    const reply = await post(`/api/v1/communication/threads/${thread.id}/messages`, tok.teacher, { body: "works" });
    expect(reply.status).toBe(201);
    expect(reply.body.body).toBe("works");
  });

  it("does not regress the legacy communication inbox", async () => {
    const sent = await post("/api/v1/communication/messages", tok.admin, {
      subject: "Staff notice",
      body: "legacy still works",
      audienceType: "staff",
    });
    expect(sent.status).toBe(201);
    const inbox = await get("/api/v1/communication/inbox", tok.teacher);
    expect(inbox.status).toBe(200);
    expect(inbox.body.some((m: { subject: string }) => m.subject === "Staff notice")).toBe(true);
  });
});
