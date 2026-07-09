import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { app, createInstitution, createUser, query, resetDb, tokenFor } from "./helpers";

// PR-T7 — Front-Office unification. Two NEW registers (postal/dispatch + call)
// plus a cross-surface summary, and the existing visitors/feedback/lost-found
// surfaces unified under the shared front_office:* RBAC namespace. Covers CRUD,
// status defaults, the summary aggregate, tenant isolation, the RBAC swap (admin
// keeps access, roles without front_office are 403'd), the new "enquiry" type,
// T5 export governance, and audit of the accountable actions.

const PW = "Passw0rd!";
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
const num = async (sql: string, p: unknown[]) =>
  Number((await query<{ c: string }>(sql, p)).rows[0].c);
const today = () => new Date().toISOString().slice(0, 10);

describe("PR-T7 front office (unified)", () => {
  let instA: string;
  let instB: string;
  const tok: Record<string, string> = {};

  beforeEach(async () => {
    await resetDb();
    instA = await createInstitution("FOA", "school");
    instB = await createInstitution("FOB", "school");
    await createUser({ email: "admin@foa.dev", password: PW, role: "admin", institutionId: instA });
    await createUser({ email: "teacher@foa.dev", password: PW, role: "teacher", institutionId: instA });
    await createUser({ email: "admin@fob.dev", password: PW, role: "admin", institutionId: instB });
    tok.adminA = await tokenFor("admin@foa.dev", PW);
    tok.teacherA = await tokenFor("teacher@foa.dev", PW);
    tok.adminB = await tokenFor("admin@fob.dev", PW);
  });

  it("logs postal dispatches with direction-based status defaults, then lists/updates/deletes", async () => {
    const inbound = await request(app).post("/api/v1/front-office/postal").set(auth(tok.adminA))
      .send({ direction: "inbound", partyName: "India Post", itemType: "parcel" });
    expect(inbound.status).toBe(201);
    expect(inbound.body.status).toBe("received"); // inbound default

    const outbound = await request(app).post("/api/v1/front-office/postal").set(auth(tok.adminA))
      .send({ direction: "outbound", partyName: "Parent A", refNo: "OUT-1" });
    expect(outbound.status).toBe(201);
    expect(outbound.body.status).toBe("dispatched"); // outbound default

    const list = await request(app).get("/api/v1/front-office/postal").set(auth(tok.adminA));
    expect(list.body.meta.total).toBe(2);

    const filtered = await request(app).get("/api/v1/front-office/postal?direction=inbound").set(auth(tok.adminA));
    expect(filtered.body.data.length).toBe(1);

    const upd = await request(app).patch(`/api/v1/front-office/postal/${inbound.body.id}`).set(auth(tok.adminA))
      .send({ status: "collected" });
    expect(upd.status).toBe(200);
    expect(upd.body.status).toBe("collected");

    // Duplicate ref_no within a tenant is rejected.
    const dup = await request(app).post("/api/v1/front-office/postal").set(auth(tok.adminA))
      .send({ direction: "outbound", partyName: "Parent B", refNo: "OUT-1" });
    expect(dup.status).toBe(400);

    const del = await request(app).delete(`/api/v1/front-office/postal/${outbound.body.id}`).set(auth(tok.adminA));
    expect(del.status).toBe(204);
    expect(await num(`SELECT count(*) c FROM postal_dispatches WHERE institution_id = $1`, [instA])).toBe(1);
  });

  it("logs calls, filters by topic, updates follow-up and deletes", async () => {
    const call = await request(app).post("/api/v1/front-office/calls").set(auth(tok.adminA))
      .send({ direction: "incoming", callerName: "Ravi", phone: "999", relatedTo: "admission", purpose: "Fees query" });
    expect(call.status).toBe(201);
    expect(call.body.relatedTo).toBe("admission");

    await request(app).post("/api/v1/front-office/calls").set(auth(tok.adminA))
      .send({ direction: "outgoing", callerName: "Office", relatedTo: "transport" });

    const byTopic = await request(app).get("/api/v1/front-office/calls?relatedTo=admission").set(auth(tok.adminA));
    expect(byTopic.body.data.length).toBe(1);
    expect(byTopic.body.data[0].callerName).toBe("Ravi");

    const upd = await request(app).patch(`/api/v1/front-office/calls/${call.body.id}`).set(auth(tok.adminA))
      .send({ followUpDate: today() });
    expect(upd.status).toBe(200);
    expect(upd.body.followUpDate).toBe(today());

    expect((await request(app).delete(`/api/v1/front-office/calls/${call.body.id}`).set(auth(tok.adminA))).status).toBe(204);
  });

  it("summarises all five front-office surfaces for the tenant", async () => {
    await request(app).post("/api/v1/visitors").set(auth(tok.adminA)).send({ visitorName: "Guest" });
    await request(app).post("/api/v1/feedback").set(auth(tok.adminA)).send({ type: "complaint", subject: "Noise", message: "Loud" });
    await request(app).post("/api/v1/lost-found").set(auth(tok.adminA)).send({ type: "found", title: "Umbrella" });
    await request(app).post("/api/v1/front-office/postal").set(auth(tok.adminA)).send({ direction: "inbound", partyName: "Courier" });
    await request(app).post("/api/v1/front-office/calls").set(auth(tok.adminA)).send({ direction: "incoming", callerName: "Caller", followUpDate: today() });

    const s = await request(app).get("/api/v1/front-office/summary").set(auth(tok.adminA));
    expect(s.status).toBe(200);
    expect(s.body).toMatchObject({
      visitorsInside: 1,
      openComplaints: 1,
      openLostFound: 1,
      dispatchesToday: 1,
      callsToday: 1,
      followUpsDue: 1,
    });

    // Tenant B, having created nothing, sees an all-zero summary.
    const sB = await request(app).get("/api/v1/front-office/summary").set(auth(tok.adminB));
    expect(sB.body).toMatchObject({ visitorsInside: 0, openComplaints: 0, dispatchesToday: 0, callsToday: 0 });
  });

  it("keeps the new registers tenant-isolated", async () => {
    const d = await request(app).post("/api/v1/front-office/postal").set(auth(tok.adminA))
      .send({ direction: "inbound", partyName: "Secret" });
    // Tenant B cannot list or fetch tenant A's dispatch.
    expect((await request(app).get("/api/v1/front-office/postal").set(auth(tok.adminB))).body.meta.total).toBe(0);
    expect((await request(app).get(`/api/v1/front-office/postal/${d.body.id}`).set(auth(tok.adminB))).status).toBe(404);
  });

  it("rejects a handledBy that is not an in-tenant staff member", async () => {
    // A random UUID (or another tenant's staff) is not a valid handledBy.
    const bad = await request(app).post("/api/v1/front-office/postal").set(auth(tok.adminA))
      .send({ direction: "inbound", partyName: "X", handledBy: "00000000-0000-0000-0000-000000000000" });
    expect(bad.status).toBe(400);
  });

  it("gates the whole hub on front_office — incl. feedback + lost-found after the RBAC swap", async () => {
    // admin holds front_office:* (0107 grant) → the unified surfaces all work.
    expect((await request(app).get("/api/v1/front-office/postal").set(auth(tok.adminA))).status).toBe(200);
    expect((await request(app).get("/api/v1/front-office/calls").set(auth(tok.adminA))).status).toBe(200);
    expect((await request(app).get("/api/v1/feedback").set(auth(tok.adminA))).status).toBe(200);
    expect((await request(app).get("/api/v1/lost-found").set(auth(tok.adminA))).status).toBe(200);

    // teacher lacks front_office → every hub read + write is 403 (incl. the two
    // surfaces that previously used authorize("admin")).
    expect((await request(app).get("/api/v1/front-office/postal").set(auth(tok.teacherA))).status).toBe(403);
    expect((await request(app).get("/api/v1/front-office/calls").set(auth(tok.teacherA))).status).toBe(403);
    expect((await request(app).get("/api/v1/feedback").set(auth(tok.teacherA))).status).toBe(403);
    expect((await request(app).get("/api/v1/lost-found").set(auth(tok.teacherA))).status).toBe(403);
    expect((await request(app).post("/api/v1/front-office/postal").set(auth(tok.teacherA))
      .send({ direction: "inbound", partyName: "Y" })).status).toBe(403);
  });

  it("accepts the new 'enquiry' feedback type end-to-end", async () => {
    const created = await request(app).post("/api/v1/feedback").set(auth(tok.adminA))
      .send({ type: "enquiry", subject: "Admission timings?", message: "When do admissions open?" });
    expect(created.status).toBe(201);
    expect(created.body.type).toBe("enquiry");
    const list = await request(app).get("/api/v1/feedback?type=enquiry").set(auth(tok.adminA));
    expect(list.body.data.map((r: { subject: string }) => r.subject)).toContain("Admission timings?");
  });

  it("exports front-office datasets through the T5 center (non-sensitive open; sensitive reason-gated + audited)", async () => {
    await request(app).post("/api/v1/front-office/postal").set(auth(tok.adminA))
      .send({ direction: "outbound", partyName: "Blue Dart", carrier: "BlueDart" });
    await request(app).post("/api/v1/front-office/calls").set(auth(tok.adminA))
      .send({ direction: "incoming", callerName: "Meera", phone: "12345" });

    // Non-sensitive (no contact column) → no reason needed.
    const postalExp = await request(app).get("/api/v1/dataio/export/fo_postal?format=csv").set(auth(tok.adminA));
    expect(postalExp.status).toBe(200);
    expect(postalExp.text).toContain("Blue Dart");

    // Sensitive (phone) → reason required.
    const noReason = await request(app).get("/api/v1/dataio/export/fo_calls?format=csv").set(auth(tok.adminA));
    expect(noReason.status).toBe(400);

    const withReason = await request(app)
      .get("/api/v1/dataio/export/fo_calls?format=csv&reason=T7%20audit%20check").set(auth(tok.adminA));
    expect(withReason.status).toBe(200);
    expect(withReason.text).toContain("Meera");
    // The sensitive export is audited.
    expect(await num(
      `SELECT count(*) c FROM platform_audit_log WHERE institution_id = $1 AND detail->>'entity' = 'fo_calls'`,
      [instA]
    )).toBeGreaterThanOrEqual(1);
  });

  it("audits dispatch/call/complaint changes but not visitor check-in", async () => {
    const d = await request(app).post("/api/v1/front-office/postal").set(auth(tok.adminA))
      .send({ direction: "inbound", partyName: "Reg Post" });
    await request(app).post("/api/v1/front-office/calls").set(auth(tok.adminA))
      .send({ direction: "incoming", callerName: "Sam" });
    const fb = await request(app).post("/api/v1/feedback").set(auth(tok.adminA))
      .send({ type: "complaint", subject: "Fan broken", message: "Fix" });
    await request(app).patch(`/api/v1/feedback/${fb.body.id}`).set(auth(tok.adminA)).send({ status: "resolved", resolution: "Fixed" });
    // A visitor check-in is high-volume/low-sensitivity → not audited.
    await request(app).post("/api/v1/visitors").set(auth(tok.adminA)).send({ visitorName: "Walkin" });

    expect(await num(`SELECT count(*) c FROM platform_audit_log WHERE institution_id = $1 AND action = 'frontoffice.dispatch.create'`, [instA])).toBe(1);
    expect(await num(`SELECT count(*) c FROM platform_audit_log WHERE institution_id = $1 AND action = 'frontoffice.call.create'`, [instA])).toBe(1);
    expect(await num(`SELECT count(*) c FROM platform_audit_log WHERE institution_id = $1 AND action = 'frontoffice.complaint.update'`, [instA])).toBe(1);
    expect(await num(`SELECT count(*) c FROM platform_audit_log WHERE institution_id = $1 AND action LIKE 'visitor%'`, [instA])).toBe(0);
  });
});
