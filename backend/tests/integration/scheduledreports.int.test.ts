import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { app, createInstitution, createUser, query, resetDb, tokenFor } from "./helpers";

const PW = "Passw0rd!";

describe("scheduled reports", () => {
  let instA: string;
  let rosterId: string; // custom report on 'students' (reports:center:read)
  let duesId: string; // custom report on 'fee_outstanding' (fee_reports:read)
  const tok: Record<string, string> = {};
  const uid: Record<string, string> = {};

  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const get = (p: string, t: string) => request(app).get(p).set(auth(t));
  const post = (p: string, t: string, body?: unknown) =>
    request(app).post(p).set(auth(t)).send(body as object);
  const patch = (p: string, t: string, body?: unknown) =>
    request(app).patch(p).set(auth(t)).send(body as object);
  const del = (p: string, t: string) => request(app).delete(p).set(auth(t));

  const newCustomReport = (name: string, reportKey: string) =>
    post("/api/v1/custom-reports", tok.admin, {
      name,
      reportKey,
      columns: [],
      visibility: "shared",
    });

  const newSchedule = (t: string, over: Record<string, unknown> = {}) =>
    post("/api/v1/scheduled-reports", t, {
      reportId: rosterId,
      name: "Daily Roster",
      frequency: "daily",
      runTime: "06:00",
      channels: ["in_app"],
      exportFormat: "csv",
      recipients: [uid.admin],
      ...over,
    });

  beforeEach(async () => {
    await resetDb();
    instA = await createInstitution("SCHED");
    for (const role of ["admin", "accountant", "teacher", "student", "parent"] as const) {
      const u = await createUser({ email: `${role}@s.dev`, password: PW, role, institutionId: instA });
      uid[role] = u.id;
      tok[role] = await tokenFor(`${role}@s.dev`, PW);
    }
    rosterId = (await newCustomReport("Roster", "students")).body.id;
    duesId = (await newCustomReport("Dues", "fee_outstanding")).body.id;
  });

  it("creates, edits, enables/disables and deletes a schedule", async () => {
    const created = await newSchedule(tok.admin);
    expect(created.status).toBe(201);
    expect(created.body.reportName).toBe("Roster");
    expect(created.body.enabled).toBe(true);
    expect(created.body.nextRunAt).toBeTruthy();
    const id = created.body.id;

    expect((await patch(`/api/v1/scheduled-reports/${id}`, tok.admin, { name: "Weekly Roster", frequency: "weekly", dayOfWeek: 1 })).body.name).toBe("Weekly Roster");

    const disabled = await patch(`/api/v1/scheduled-reports/${id}`, tok.admin, { enabled: false });
    expect(disabled.body.enabled).toBe(false);
    expect(disabled.body.nextRunAt).toBeNull();
    const enabled = await patch(`/api/v1/scheduled-reports/${id}`, tok.admin, { enabled: true });
    expect(enabled.body.nextRunAt).toBeTruthy();

    expect((await del(`/api/v1/scheduled-reports/${id}`, tok.admin)).status).toBe(204);
    expect((await get(`/api/v1/scheduled-reports/${id}`, tok.admin)).status).toBe(404);
  });

  it("runs manually with CSV + in-app delivery and records history", async () => {
    const id = (await newSchedule(tok.admin, {
      recipients: [uid.admin, uid.accountant, uid.teacher],
    })).body.id;

    const run = await post(`/api/v1/scheduled-reports/${id}/run`, tok.admin);
    expect(run.status).toBe(200);
    expect(run.body.status).toBe("success");
    expect(run.body.exportFormat).toBe("csv");
    expect(run.body.exportBytes).toBeGreaterThan(0);
    // 'students' needs reports:center:read — admin/accountant/teacher all have it.
    expect(run.body.recipientCount).toBe(3);

    const runs = await get(`/api/v1/scheduled-reports/${id}/runs`, tok.admin);
    expect(runs.body).toHaveLength(1);
    expect(runs.body[0].status).toBe("success");

    const msgs = await query(
      "SELECT count(*)::int AS n FROM messages WHERE category='scheduled_report' AND institution_id=$1",
      [instA]
    );
    expect(Number(msgs.rows[0].n)).toBe(1);
  });

  it("supports PDF / both export formats", async () => {
    const id = (await newSchedule(tok.admin, { exportFormat: "both" })).body.id;
    const run = await post(`/api/v1/scheduled-reports/${id}/run`, tok.admin);
    expect(run.body.status).toBe("success");
    expect(run.body.exportFormat).toBe("both");
    expect(run.body.exportBytes).toBeGreaterThan(0);
  });

  it("records a failed run when the saved report was deleted", async () => {
    const id = (await newSchedule(tok.admin)).body.id;
    expect((await del(`/api/v1/custom-reports/${rosterId}`, tok.admin)).status).toBe(204);
    const run = await post(`/api/v1/scheduled-reports/${id}/run`, tok.admin);
    expect(run.status).toBe(200);
    expect(run.body.status).toBe("failed");
    expect(run.body.errorMessage).toBeTruthy();
    expect(run.body.recipientCount).toBe(0);
  });

  it("enforces the underlying custom report's permission on manual run", async () => {
    const id = (await newSchedule(tok.admin, { reportId: duesId, recipients: [uid.admin] })).body.id;
    // teacher lacks fee_reports:read → run fails, no data generated/delivered.
    const t = await post(`/api/v1/scheduled-reports/${id}/run`, tok.teacher);
    expect(t.body.status).toBe("failed");
    expect(t.body.recipientCount).toBe(0);
    // accountant has fee_reports:read → succeeds.
    const a = await post(`/api/v1/scheduled-reports/${id}/run`, tok.accountant);
    expect(a.body.status).toBe("success");
  });

  it("delivers only to recipients authorised for the underlying report", async () => {
    const id = (await newSchedule(tok.admin, {
      reportId: duesId,
      recipients: [uid.admin, uid.accountant, uid.teacher],
    })).body.id;
    const run = await post(`/api/v1/scheduled-reports/${id}/run`, tok.admin);
    expect(run.body.status).toBe("success");
    // teacher lacks fee_reports:read → excluded (no leakage).
    expect(run.body.recipientCount).toBe(2);
    const teacherMsgs = await query(
      `SELECT count(*)::int AS n FROM message_recipients mr
       JOIN messages m ON m.id = mr.message_id
       WHERE m.category='scheduled_report' AND mr.user_id=$1`,
      [uid.teacher]
    );
    expect(Number(teacherMsgs.rows[0].n)).toBe(0);
  });

  it("degrades gracefully when email is not configured", async () => {
    const id = (await newSchedule(tok.admin, { channels: ["email"], recipients: [uid.admin] })).body.id;
    const run = await post(`/api/v1/scheduled-reports/${id}/run`, tok.admin);
    expect(run.body.status).toBe("success"); // no SMTP → dispatch is a no-op, never fails
    expect(run.body.deliveryStatus).toContain("email");
  });

  it("processes due schedules as the creator (scheduler tick), gated by manage", async () => {
    const id = (await newSchedule(tok.admin, { recipients: [uid.admin] })).body.id;
    await query("UPDATE scheduled_reports SET next_run_at = now() - interval '1 hour' WHERE id=$1", [id]);

    // accountant lacks scheduled_reports:manage.
    expect((await post("/api/v1/scheduled-reports/run-due", tok.accountant)).status).toBe(403);

    const due = await post("/api/v1/scheduled-reports/run-due", tok.admin);
    expect(due.status).toBe(200);
    expect(due.body.processed).toBeGreaterThanOrEqual(1);

    const runs = await get(`/api/v1/scheduled-reports/${id}/runs`, tok.admin);
    expect(runs.body.some((r: { trigger: string; status: string }) => r.trigger === "scheduled" && r.status === "success")).toBe(true);
    // next_run_at advanced into the future.
    expect(new Date((await get(`/api/v1/scheduled-reports/${id}`, tok.admin)).body.nextRunAt).getTime()).toBeGreaterThan(Date.now());
  });

  it("blocks students/parents from scheduled-report admin features", async () => {
    const id = (await newSchedule(tok.admin)).body.id;
    expect((await get("/api/v1/scheduled-reports", tok.student)).status).toBe(403);
    expect((await newSchedule(tok.parent)).status).toBe(403);
    expect((await post(`/api/v1/scheduled-reports/${id}/run`, tok.student)).status).toBe(403);
  });

  it("is tenant-isolated and denies cross-institution access", async () => {
    const id = (await newSchedule(tok.admin)).body.id;

    const instB = await createInstitution("SCHED2");
    await createUser({ email: "admin@s2.dev", password: PW, role: "admin", institutionId: instB });
    const bAdmin = await tokenFor("admin@s2.dev", PW);

    expect((await get("/api/v1/scheduled-reports", bAdmin)).body).toHaveLength(0);
    expect((await get(`/api/v1/scheduled-reports/${id}`, bAdmin)).status).toBe(404);
    expect((await post(`/api/v1/scheduled-reports/${id}/run`, bAdmin)).status).toBe(404);
    expect((await patch(`/api/v1/scheduled-reports/${id}`, bAdmin, { name: "x" })).status).toBe(404);
    expect((await del(`/api/v1/scheduled-reports/${id}`, bAdmin)).status).toBe(404);
  });
});
