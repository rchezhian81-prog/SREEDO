import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import request from "supertest";
import {
  app,
  createInstitution,
  createUser,
  resetDb,
  tokenFor,
} from "./helpers";
import {
  dispatchEvent,
  signBody,
} from "../../src/modules/integrations/webhooks.delivery";
import { processDueJobs } from "../../src/modules/jobs/jobs.worker";

const PW = "Passw0rd!";

interface Captured {
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

describe("integrations — webhook delivery (/integrations/webhooks)", () => {
  let inst: string;
  let adminTok: string;
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  // A local receiver each test can control (status code + captured requests).
  let server: Server;
  let baseUrl: string;
  let received: Captured[] = [];
  let respondStatus = 200;

  beforeAll(async () => {
    server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (c) => chunks.push(c as Buffer));
      req.on("end", () => {
        received.push({ headers: req.headers, body: Buffer.concat(chunks).toString("utf8") });
        res.statusCode = respondStatus;
        res.end("ok");
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const addr = server.address();
    baseUrl = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  beforeEach(async () => {
    await resetDb();
    received = [];
    respondStatus = 200;
    inst = await createInstitution("WH");
    await createUser({ email: "admin@wh.dev", password: PW, role: "admin", institutionId: inst });
    adminTok = await tokenFor("admin@wh.dev", PW);
  });

  async function createWebhook(events = "*", path = "/hook") {
    const res = await request(app)
      .post("/api/v1/integrations/webhooks")
      .set(auth(adminTok))
      .send({ url: `${baseUrl}${path}`, eventTypes: events });
    expect(res.status).toBe(201);
    return res.body as { id: string; secret: string };
  }

  it("requires auth on the webhook routes", async () => {
    expect((await request(app).get("/api/v1/integrations/webhooks")).status).toBe(401);
  });

  it("returns the signing secret once at creation and never lists it again", async () => {
    const created = await createWebhook();
    expect(created.secret).toMatch(/^whsec_[0-9a-f]{48}$/);

    const list = await request(app).get("/api/v1/integrations/webhooks").set(auth(adminTok));
    expect(list.status).toBe(200);
    expect(list.body[0].secret).toBeUndefined();
    expect(JSON.stringify(list.body)).not.toContain(created.secret);
  });

  it("test delivery sends a valid HMAC-signed ping and logs success", async () => {
    const wh = await createWebhook();
    const res = await request(app)
      .post(`/api/v1/integrations/webhooks/${wh.id}/test`)
      .set(auth(adminTok));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true, statusCode: 200 });

    expect(received).toHaveLength(1);
    const got = received[0];
    expect(got.headers["x-sreedo-event"]).toBe("ping");
    // The signature verifies against the RAW body using the returned secret.
    expect(got.headers["x-sreedo-signature"]).toBe(signBody(wh.secret, got.body));
    expect(JSON.parse(got.body).event).toBe("ping");

    const del = await request(app)
      .get(`/api/v1/integrations/webhooks/${wh.id}/deliveries`)
      .set(auth(adminTok));
    expect(del.status).toBe(200);
    expect(del.body[0]).toMatchObject({ eventType: "ping", success: true, statusCode: 200 });
  });

  it("records a failed delivery when the endpoint returns non-2xx", async () => {
    respondStatus = 500;
    const wh = await createWebhook();
    const res = await request(app)
      .post(`/api/v1/integrations/webhooks/${wh.id}/test`)
      .set(auth(adminTok));
    expect(res.body).toMatchObject({ success: false, statusCode: 500 });

    const del = await request(app)
      .get(`/api/v1/integrations/webhooks/${wh.id}/deliveries`)
      .set(auth(adminTok));
    expect(del.body[0]).toMatchObject({ success: false, statusCode: 500 });
  });

  it("dispatchEvent enqueues jobs the worker delivers to matching endpoints only", async () => {
    const matching = await createWebhook("student.created,fee.paid", "/match");
    const other = await createWebhook("other.event", "/other");

    await dispatchEvent(inst, "student.created", { id: "abc", admissionNo: "A1" });
    expect(received).toHaveLength(0); // nothing until the worker drains the queue

    const stats = await processDueJobs({ limit: 10 });
    expect(stats.success).toBeGreaterThanOrEqual(1);

    expect(received).toHaveLength(1);
    expect(JSON.parse(received[0].body).data.admissionNo).toBe("A1");

    const matchDel = await request(app)
      .get(`/api/v1/integrations/webhooks/${matching.id}/deliveries`)
      .set(auth(adminTok));
    expect(matchDel.body).toHaveLength(1);
    const otherDel = await request(app)
      .get(`/api/v1/integrations/webhooks/${other.id}/deliveries`)
      .set(auth(adminTok));
    expect(otherDel.body).toHaveLength(0);
  });

  it("isolates tenants — testing another institution's webhook 404s", async () => {
    const wh = await createWebhook();
    const inst2 = await createInstitution("WH2");
    await createUser({ email: "admin@wh2.dev", password: PW, role: "admin", institutionId: inst2 });
    const tok2 = await tokenFor("admin@wh2.dev", PW);
    const res = await request(app)
      .post(`/api/v1/integrations/webhooks/${wh.id}/test`)
      .set(auth(tok2));
    expect(res.status).toBe(404);
  });
});
