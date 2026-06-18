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

describe("staff attendance + leave", () => {
  let instA: string;
  let t1: string; // linked to the teacher user
  let t2: string; // unlinked
  const tok: Record<string, string> = {};

  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const get = (p: string, t: string) => request(app).get(p).set(auth(t));
  const post = (p: string, t: string, b?: unknown) => request(app).post(p).set(auth(t)).send(b ?? {});

  async function makeLeaveType(code: string, isPaid = true): Promise<string> {
    const res = await post("/api/v1/leave/types", tok.admin, { name: `Type ${code}`, code, isPaid });
    expect(res.status).toBe(201);
    return res.body.id as string;
  }

  beforeEach(async () => {
    await resetDb();
    instA = await createInstitution("STL");
    await createUser({ email: "admin@stl.dev", password: PW, role: "admin", institutionId: instA });
    const teacherUser = await createUser({ email: "teacher@stl.dev", password: PW, role: "teacher", institutionId: instA });
    await createUser({ email: "accountant@stl.dev", password: PW, role: "accountant", institutionId: instA });
    await createUser({ email: "student@stl.dev", password: PW, role: "student", institutionId: instA });

    t1 = await insertId(
      `INSERT INTO teachers (institution_id, employee_no, first_name, last_name, user_id) VALUES ($1,'EMP-1','Asha','K',$2) RETURNING id`,
      [instA, teacherUser.id]
    );
    t2 = await insertId(
      `INSERT INTO teachers (institution_id, employee_no, first_name, last_name) VALUES ($1,'EMP-2','Bala','M') RETURNING id`,
      [instA]
    );

    const instB = await createInstitution("STL2");
    await createUser({ email: "admin@stl2.dev", password: PW, role: "admin", institutionId: instB });

    for (const r of ["admin", "teacher", "accountant", "student"]) tok[r] = await tokenFor(`${r}@stl.dev`, PW);
    tok.badmin = await tokenFor("admin@stl2.dev", PW);
  });

  it("bulk-marks staff attendance (upsert) and summarizes monthly", async () => {
    const mark = await post("/api/v1/staff/attendance", tok.admin, {
      date: "2026-07-10",
      entries: [
        { teacherId: t1, status: "present", checkIn: "09:00", late: true },
        { teacherId: t2, status: "absent" },
      ],
    });
    expect(mark.status).toBe(200);
    expect(mark.body.marked).toBe(2);

    // Re-mark (upsert) t1 → no duplicate row, status updated.
    await post("/api/v1/staff/attendance", tok.admin, { date: "2026-07-10", entries: [{ teacherId: t1, status: "half_day" }] });
    const day = (await get("/api/v1/staff/attendance?date=2026-07-10", tok.admin)).body;
    expect(day).toHaveLength(2);
    expect(day.find((r: { teacherId: string }) => r.teacherId === t1).status).toBe("half_day");

    const summary = (await get("/api/v1/staff/attendance/summary?month=2026-07", tok.admin)).body;
    const asha = summary.find((r: { teacherId: string }) => r.teacherId === t1);
    expect(asha.halfDay).toBe(1);
    expect(summary.find((r: { teacherId: string }) => r.teacherId === t2).absent).toBe(1);
  });

  it("runs the leave request → approve flow (deducts balance, marks attendance)", async () => {
    const cl = await makeLeaveType("CL", true);
    expect((await post("/api/v1/leave/balances", tok.admin, { teacherId: t1, leaveTypeId: cl, balance: 5 })).status).toBe(200);

    // Teacher requests for themselves (own t1 resolved from the linked user).
    const reqRes = await post("/api/v1/leave/requests", tok.teacher, {
      leaveTypeId: cl, startDate: "2026-07-01", endDate: "2026-07-02", reason: "Personal",
    });
    expect(reqRes.status).toBe(201);
    expect(reqRes.body.teacherId).toBe(t1);
    expect(Number(reqRes.body.days)).toBe(2);

    const approve = await post(`/api/v1/leave/requests/${reqRes.body.id}/approve`, tok.admin, {});
    expect(approve.status).toBe(200);
    expect(approve.body.status).toBe("approved");

    // Balance deducted 5 → 3.
    const bal = (await get("/api/v1/leave/balances", tok.teacher)).body;
    expect(Number(bal.find((b: { leaveTypeId: string }) => b.leaveTypeId === cl).balance)).toBe(3);

    // Two 'leave' attendance rows auto-created in the range.
    const att = (await get("/api/v1/staff/attendance?teacherId=" + t1 + "&month=2026-07", tok.admin)).body;
    expect(att.filter((r: { status: string }) => r.status === "leave")).toHaveLength(2);

    // Payroll summary counts them as paid leave.
    const pay = (await get("/api/v1/staff/attendance/payroll-summary?month=2026-07", tok.admin)).body;
    const asha = pay.find((r: { teacherId: string }) => r.teacherId === t1);
    expect(asha.paidLeave).toBe(2);
    expect(asha.unpaidLeave).toBe(0);
  });

  it("rejects a leave request without touching balance/attendance", async () => {
    const cl = await makeLeaveType("CL", true);
    await post("/api/v1/leave/balances", tok.admin, { teacherId: t1, leaveTypeId: cl, balance: 5 });
    const req = await post("/api/v1/leave/requests", tok.teacher, { leaveTypeId: cl, startDate: "2026-07-01", endDate: "2026-07-03" });
    const rej = await post(`/api/v1/leave/requests/${req.body.id}/reject`, tok.admin, { note: "Busy week" });
    expect(rej.body.status).toBe("rejected");
    const bal = (await get("/api/v1/leave/balances", tok.teacher)).body;
    expect(Number(bal[0].balance)).toBe(5);
    expect((await get("/api/v1/staff/attendance?teacherId=" + t1, tok.admin)).body).toHaveLength(0);
  });

  it("blocks approval when the leave balance is insufficient", async () => {
    const cl = await makeLeaveType("CL", true);
    await post("/api/v1/leave/balances", tok.admin, { teacherId: t1, leaveTypeId: cl, balance: 1 });
    const req = await post("/api/v1/leave/requests", tok.teacher, { leaveTypeId: cl, startDate: "2026-07-01", endDate: "2026-07-03" });
    expect((await post(`/api/v1/leave/requests/${req.body.id}/approve`, tok.admin, {})).status).toBe(409);
  });

  it("cancels an approved leave (restores balance, removes attendance)", async () => {
    const cl = await makeLeaveType("CL", true);
    await post("/api/v1/leave/balances", tok.admin, { teacherId: t1, leaveTypeId: cl, balance: 5 });
    const req = await post("/api/v1/leave/requests", tok.teacher, { leaveTypeId: cl, startDate: "2026-07-01", endDate: "2026-07-02" });
    await post(`/api/v1/leave/requests/${req.body.id}/approve`, tok.admin, {});

    const cancel = await post(`/api/v1/leave/requests/${req.body.id}/cancel`, tok.admin, {});
    expect(cancel.body.status).toBe("cancelled");
    const bal = (await get("/api/v1/leave/balances", tok.teacher)).body;
    expect(Number(bal[0].balance)).toBe(5); // restored
    expect((await get("/api/v1/staff/attendance?teacherId=" + t1, tok.admin)).body).toHaveLength(0);
  });

  it("owner-scopes staff to their own attendance/leave", async () => {
    const cl = await makeLeaveType("CL", true);
    // Admin files a request for t2; teacher files their own (t1).
    await post("/api/v1/leave/requests", tok.admin, { teacherId: t2, leaveTypeId: cl, startDate: "2026-07-01", endDate: "2026-07-01" });
    const ownReq = await post("/api/v1/leave/requests", tok.teacher, { teacherId: t2, leaveTypeId: cl, startDate: "2026-07-05", endDate: "2026-07-05" });
    // Teacher's teacherId is forced to their own (t2 ignored).
    expect(ownReq.body.teacherId).toBe(t1);

    // Teacher sees only their own request.
    const mine = (await get("/api/v1/leave/requests", tok.teacher)).body;
    expect(mine).toHaveLength(1);
    expect(mine[0].teacherId).toBe(t1);
    // Admin sees both.
    expect((await get("/api/v1/leave/requests", tok.admin)).body).toHaveLength(2);

    // Teacher attendance view is own-only.
    await post("/api/v1/staff/attendance", tok.admin, {
      date: "2026-07-10", entries: [{ teacherId: t1, status: "present" }, { teacherId: t2, status: "present" }],
    });
    const teacherView = (await get("/api/v1/staff/attendance?date=2026-07-10", tok.teacher)).body;
    expect(teacherView).toHaveLength(1);
    expect(teacherView[0].teacherId).toBe(t1);
  });

  it("surfaces leave + payroll reports in the Reports Center", async () => {
    const cl = await makeLeaveType("CL", true);
    await post("/api/v1/leave/balances", tok.admin, { teacherId: t1, leaveTypeId: cl, balance: 5 });
    const req = await post("/api/v1/leave/requests", tok.teacher, { leaveTypeId: cl, startDate: "2026-07-01", endDate: "2026-07-02" });

    // Pending report (accountant has leave:reports).
    const pending = await get("/api/v1/report-center/leave_pending", tok.accountant);
    expect(pending.status).toBe(200);
    expect(pending.body.rows).toHaveLength(1);

    await post(`/api/v1/leave/requests/${req.body.id}/approve`, tok.admin, {});
    const register = await get("/api/v1/report-center/leave_register", tok.accountant);
    expect(register.body.rows[0].status).toBe("approved");

    const payroll = await get("/api/v1/report-center/payroll_attendance_summary?month=2026-07", tok.accountant);
    const asha = payroll.body.rows.find((r: { employeeNo: string }) => r.employeeNo === "EMP-1");
    expect(asha.paidLeave).toBe(2);
  });

  it("enforces permission guards", async () => {
    const cl = await makeLeaveType("CL", true);
    const req = await post("/api/v1/leave/requests", tok.teacher, { leaveTypeId: cl, startDate: "2026-07-01", endDate: "2026-07-01" });
    // teacher: cannot mark attendance, create types, or approve.
    expect((await post("/api/v1/staff/attendance", tok.teacher, { date: "2026-07-10", entries: [{ teacherId: t1, status: "present" }] })).status).toBe(403);
    expect((await post("/api/v1/leave/types", tok.teacher, { name: "X", code: "X" })).status).toBe(403);
    expect((await post(`/api/v1/leave/requests/${req.body.id}/approve`, tok.teacher, {})).status).toBe(403);
    // accountant: read yes, mark/approve no.
    expect((await get("/api/v1/staff/attendance?date=2026-07-10", tok.accountant)).status).toBe(200);
    expect((await post("/api/v1/staff/attendance", tok.accountant, { date: "2026-07-10", entries: [{ teacherId: t1, status: "present" }] })).status).toBe(403);
    expect((await post(`/api/v1/leave/requests/${req.body.id}/approve`, tok.accountant, {})).status).toBe(403);
    // student: no access.
    expect((await get("/api/v1/staff/attendance", tok.student)).status).toBe(403);
    expect((await get("/api/v1/leave/requests", tok.student)).status).toBe(403);
  });

  it("is tenant-scoped (no cross-institution access)", async () => {
    const cl = await makeLeaveType("CL", true);
    const req = await post("/api/v1/leave/requests", tok.admin, { teacherId: t1, leaveTypeId: cl, startDate: "2026-07-01", endDate: "2026-07-01" });
    await post("/api/v1/staff/attendance", tok.admin, { date: "2026-07-10", entries: [{ teacherId: t1, status: "present" }] });

    // B sees none of A's data.
    expect((await get("/api/v1/staff/attendance?date=2026-07-10", tok.badmin)).body).toHaveLength(0);
    expect((await get("/api/v1/leave/requests", tok.badmin)).body).toHaveLength(0);
    // B cannot mark A's teacher or approve A's request.
    expect((await post("/api/v1/staff/attendance", tok.badmin, { date: "2026-07-10", entries: [{ teacherId: t1, status: "present" }] })).status).toBe(400);
    expect((await post(`/api/v1/leave/requests/${req.body.id}/approve`, tok.badmin, {})).status).toBe(404);
  });
});
