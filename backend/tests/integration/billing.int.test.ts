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

const SUPER = { email: "super@test.dev", password: "Passw0rd!" };
const ADMIN = { email: "admin@test.dev", password: "Passw0rd!" };
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

async function makeSub(
  institutionId: string,
  packageId: string,
  opts: { status: string; endsExpr?: string; trialExpr?: string }
): Promise<string> {
  const ends = opts.endsExpr ?? "NULL";
  const trial = opts.trialExpr ?? "NULL";
  const { rows } = await query<{ id: string }>(
    `INSERT INTO institution_subscriptions
       (institution_id, package_id, status, starts_at, ends_at, trial_ends_at)
     VALUES ($1, $2, $3, CURRENT_DATE - 90, ${ends}, ${trial})
     RETURNING id`,
    [institutionId, packageId, opts.status]
  );
  return rows[0].id;
}

describe("billing: subscription lifecycle sweep", () => {
  let superToken: string;
  let adminToken: string;
  let pkgId: string;

  beforeEach(async () => {
    await resetDb();
    await createUser({ ...SUPER, role: "super_admin" });
    await createUser({ ...ADMIN, role: "admin" });
    superToken = await tokenFor(SUPER.email, SUPER.password);
    adminToken = await tokenFor(ADMIN.email, ADMIN.password);
    const pkg = await query<{ id: string }>(
      `INSERT INTO subscription_packages (name, max_students, price, billing_cycle)
       VALUES ('Test Plan', 100, 1000, 'annual') RETURNING id`
    );
    pkgId = pkg.rows[0].id;
  });

  it("blocks non-super-admins from running the sweep", async () => {
    const res = await request(app)
      .post("/api/v1/platform/subscriptions/run-lifecycle")
      .set(auth(adminToken));
    expect(res.status).toBe(403);
  });

  it("expires, opens grace, reminds, and is idempotent", async () => {
    const expiredInst = await createInstitution("EXP");
    const graceInst = await createInstitution("GRC");
    const remindInst = await createInstitution("REM");
    const trialInst = await createInstitution("TRL");
    const foreverInst = await createInstitution("FVR");

    // Term ended 30d ago (> 14d grace) -> expired.
    await makeSub(expiredInst, pkgId, { status: "active", endsExpr: "CURRENT_DATE - 30" });
    // Term ended 3d ago (within grace) -> grace_started, stays active.
    await makeSub(graceInst, pkgId, { status: "active", endsExpr: "CURRENT_DATE - 3" });
    // Ends in 7d -> reminder_sent (7 is in default 14,7,1).
    await makeSub(remindInst, pkgId, { status: "active", endsExpr: "CURRENT_DATE + 7" });
    // Trial ended yesterday -> trial_expired.
    await makeSub(trialInst, pkgId, { status: "trialing", trialExpr: "CURRENT_DATE - 1" });
    // Perpetual (no end) -> untouched.
    await makeSub(foreverInst, pkgId, { status: "active" });

    const run = await request(app)
      .post("/api/v1/platform/subscriptions/run-lifecycle")
      .set(auth(superToken));
    expect(run.status).toBe(200);
    expect(run.body.expired).toBe(1);
    expect(run.body.trialExpired).toBe(1);
    expect(run.body.graceStarted).toBe(1);
    expect(run.body.remindersSent).toBe(1);
    // Auto-suspend is OFF by default -> non-disruptive.
    expect(run.body.autoSuspended).toBe(0);

    const expStatus = await request(app)
      .get(`/api/v1/platform/institutions/${expiredInst}/subscription/status`)
      .set(auth(superToken));
    expect(expStatus.body.status).toBe("expired");
    expect(expStatus.body.isActiveNow).toBe(false);

    const grcStatus = await request(app)
      .get(`/api/v1/platform/institutions/${graceInst}/subscription/status`)
      .set(auth(superToken));
    expect(grcStatus.body.status).toBe("active");
    expect(grcStatus.body.graceUntil).not.toBeNull();
    expect(grcStatus.body.isActiveNow).toBe(true);

    const trlStatus = await request(app)
      .get(`/api/v1/platform/institutions/${trialInst}/subscription/status`)
      .set(auth(superToken));
    expect(trlStatus.body.status).toBe("expired");

    const fvrStatus = await request(app)
      .get(`/api/v1/platform/institutions/${foreverInst}/subscription/status`)
      .set(auth(superToken));
    expect(fvrStatus.body.status).toBe("active");
    expect(fvrStatus.body.isActiveNow).toBe(true);

    // Expired institution is NOT suspended (auto-suspend off).
    const inst = await query<{ is_active: boolean }>(
      "SELECT is_active FROM institutions WHERE id = $1",
      [expiredInst]
    );
    expect(inst.rows[0].is_active).toBe(true);

    // Events recorded.
    const events = await request(app)
      .get(`/api/v1/platform/institutions/${remindInst}/subscription/events`)
      .set(auth(superToken));
    expect(events.status).toBe(200);
    expect(events.body.some((e: { event: string }) => e.event === "reminder_sent")).toBe(true);

    // Idempotent: a second run changes nothing.
    const again = await request(app)
      .post("/api/v1/platform/subscriptions/run-lifecycle")
      .set(auth(superToken));
    expect(again.body.expired).toBe(0);
    expect(again.body.trialExpired).toBe(0);
    expect(again.body.graceStarted).toBe(0);
    expect(again.body.remindersSent).toBe(0);
  });
});
