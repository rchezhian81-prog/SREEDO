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
const PDF = Buffer.from("%PDF-1.4\nfake report\n%%EOF");

async function insertId(sql: string, params: unknown[]): Promise<string> {
  const { rows } = await query<{ id: string }>(sql, params);
  return rows[0].id;
}

function binaryParser(
  res: NodeJS.ReadableStream,
  cb: (err: Error | null, body: Buffer) => void
): void {
  const chunks: Buffer[] = [];
  res.on("data", (c: Buffer) => chunks.push(c));
  res.on("end", () => cb(null, Buffer.concat(chunks)));
}

describe("document management", () => {
  let instA: string;
  let st1: string;
  let st2: string;
  const tok: Record<string, string> = {};

  const uploadAs = (
    token: string,
    fields: Record<string, string>,
    file: { buffer: Buffer; filename: string; contentType: string }
  ) => {
    let r = request(app)
      .post("/api/v1/documents")
      .set("Authorization", `Bearer ${token}`);
    for (const [k, v] of Object.entries(fields)) r = r.field(k, v);
    return r.attach("file", file.buffer, {
      filename: file.filename,
      contentType: file.contentType,
    });
  };
  const get = (path: string, token: string) =>
    request(app).get(path).set("Authorization", `Bearer ${token}`);

  beforeEach(async () => {
    await resetDb();
    instA = await createInstitution("DA");
    for (const role of ["admin", "teacher", "accountant"] as const) {
      await createUser({ email: `${role}@d.dev`, password: PW, role, institutionId: instA });
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
      `INSERT INTO students (institution_id, admission_no, first_name, last_name, section_id) VALUES ($1, 'D1', 'Ava', 'One', $2) RETURNING id`,
      [instA, sectionA]
    );
    st2 = await insertId(
      `INSERT INTO students (institution_id, admission_no, first_name, last_name, section_id) VALUES ($1, 'D2', 'Ben', 'Two', $2) RETURNING id`,
      [instA, sectionA]
    );

    const su1 = await createUser({ email: "su1@d.dev", password: PW, role: "student", institutionId: instA });
    await query(`UPDATE students SET user_id = $1 WHERE id = $2`, [su1.id, st1]);
    const pu1 = await createUser({ email: "pu1@d.dev", password: PW, role: "parent", institutionId: instA });
    await query(
      `INSERT INTO guardians (institution_id, user_id, student_id, relationship) VALUES ($1, $2, $3, 'mother')`,
      [instA, pu1.id, st1] // linked to st1 only
    );

    const instB = await createInstitution("DB");
    await createUser({ email: "badmin@d.dev", password: PW, role: "admin", institutionId: instB });

    for (const e of ["admin", "teacher", "accountant"]) tok[e] = await tokenFor(`${e}@d.dev`, PW);
    tok.su1 = await tokenFor("su1@d.dev", PW);
    tok.pu1 = await tokenFor("pu1@d.dev", PW);
    tok.badmin = await tokenFor("badmin@d.dev", PW);
  });

  it("uploads a document via the local-disk fallback and hides storage internals", async () => {
    const res = await uploadAs(
      tok.admin,
      { ownerType: "student", ownerId: st1, category: "certificate" },
      { buffer: PDF, filename: "cert.pdf", contentType: "application/pdf" }
    );
    expect(res.status).toBe(201);
    expect(res.body.id).toBeTruthy();
    expect(res.body.originalName).toBe("cert.pdf");
    expect(res.body.storageMode).toBe("local"); // object storage not configured → fallback
    // No private storage path / safe name is ever exposed.
    expect(res.body.storageKey).toBeUndefined();
    expect(res.body.safeName).toBeUndefined();
  });

  it("validates file type and extension", async () => {
    const exe = await uploadAs(
      tok.admin,
      { ownerType: "student", ownerId: st1 },
      { buffer: Buffer.from("MZ"), filename: "virus.exe", contentType: "application/octet-stream" }
    );
    expect(exe.status).toBe(400);

    const html = await uploadAs(
      tok.admin,
      { ownerType: "student", ownerId: st1 },
      { buffer: Buffer.from("<script>"), filename: "x.html", contentType: "text/html" }
    );
    expect(html.status).toBe(400);
  });

  it("validates file size", async () => {
    const big = Buffer.alloc(11 * 1024 * 1024, 1); // 11MB > 10MB limit
    const res = await uploadAs(
      tok.admin,
      { ownerType: "student", ownerId: st1 },
      { buffer: big, filename: "big.pdf", contentType: "application/pdf" }
    );
    expect(res.status).toBe(400);
  });

  it("serves a protected download with matching bytes", async () => {
    const up = await uploadAs(
      tok.admin,
      { ownerType: "student", ownerId: st1, category: "tc" },
      { buffer: PDF, filename: "tc.pdf", contentType: "application/pdf" }
    );
    const dl = await get(`/api/v1/documents/${up.body.id}/download`, tok.admin)
      .buffer(true)
      .parse(binaryParser);
    expect(dl.status).toBe(200);
    expect(dl.headers["content-type"]).toMatch(/application\/pdf/);
    expect(Buffer.compare(dl.body, PDF)).toBe(0);
  });

  it("deletes a document and its file", async () => {
    const up = await uploadAs(
      tok.admin,
      { ownerType: "student", ownerId: st1 },
      { buffer: PDF, filename: "d.pdf", contentType: "application/pdf" }
    );
    expect((await request(app).delete(`/api/v1/documents/${up.body.id}`).set("Authorization", `Bearer ${tok.admin}`)).status).toBe(204);
    expect((await get(`/api/v1/documents/${up.body.id}/download`, tok.admin)).status).toBe(404);
  });

  it("scopes a student to their own documents", async () => {
    // Student uploads their own document.
    const own = await uploadAs(
      tok.su1,
      { ownerType: "student", ownerId: st1, category: "certificate" },
      { buffer: PDF, filename: "mine.pdf", contentType: "application/pdf" }
    );
    expect(own.status).toBe(201);
    // Student cannot upload for another student.
    const other = await uploadAs(
      tok.su1,
      { ownerType: "student", ownerId: st2 },
      { buffer: PDF, filename: "no.pdf", contentType: "application/pdf" }
    );
    expect(other.status).toBe(403);

    // An admin-uploaded doc for st2 is not downloadable by su1.
    const st2doc = await uploadAs(
      tok.admin,
      { ownerType: "student", ownerId: st2 },
      { buffer: PDF, filename: "ben.pdf", contentType: "application/pdf" }
    );
    expect((await get(`/api/v1/documents/${st2doc.body.id}/download`, tok.su1)).status).toBe(403);

    // Student's list shows only their own.
    const list = await get("/api/v1/documents", tok.su1);
    expect(list.status).toBe(200);
    expect(list.body.every((d: { ownerId: string }) => d.ownerId === st1)).toBe(true);
  });

  it("scopes a parent to their linked child's documents", async () => {
    const doc1 = await uploadAs(
      tok.admin,
      { ownerType: "student", ownerId: st1 },
      { buffer: PDF, filename: "c1.pdf", contentType: "application/pdf" }
    );
    const doc2 = await uploadAs(
      tok.admin,
      { ownerType: "student", ownerId: st2 },
      { buffer: PDF, filename: "c2.pdf", contentType: "application/pdf" }
    );
    // Parent linked to st1 only.
    expect((await get(`/api/v1/documents/${doc1.body.id}/download`, tok.pu1)).status).toBe(200);
    expect((await get(`/api/v1/documents/${doc2.body.id}/download`, tok.pu1)).status).toBe(403);
  });

  it("enforces permission guards", async () => {
    const up = await uploadAs(
      tok.admin,
      { ownerType: "student", ownerId: st1 },
      { buffer: PDF, filename: "p.pdf", contentType: "application/pdf" }
    );
    // accountant lacks documents:upload
    expect(
      (await uploadAs(tok.accountant, { ownerType: "student", ownerId: st1 }, { buffer: PDF, filename: "a.pdf", contentType: "application/pdf" })).status
    ).toBe(403);
    // student lacks documents:delete
    expect((await request(app).delete(`/api/v1/documents/${up.body.id}`).set("Authorization", `Bearer ${tok.su1}`)).status).toBe(403);
  });

  it("denies cross-institution access", async () => {
    const bDoc = await uploadAs(
      tok.badmin,
      { ownerType: "user" }, // defaults to the uploader (institution B)
      { buffer: PDF, filename: "b.pdf", contentType: "application/pdf" }
    );
    expect(bDoc.status).toBe(201);
    // Institution A admin cannot reach B's document.
    expect((await get(`/api/v1/documents/${bDoc.body.id}/download`, tok.admin)).status).toBe(404);
  });

  it("uploads an institution logo (admin only)", async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const ok = await request(app)
      .post("/api/v1/documents/logo")
      .set("Authorization", `Bearer ${tok.admin}`)
      .attach("file", png, { filename: "logo.png", contentType: "image/png" });
    expect(ok.status).toBe(201);
    expect(ok.body.category).toBe("logo");
    expect(ok.body.ownerType).toBe("institution");
    expect(ok.body.storageMode).toBe("local");
    expect(ok.body.storageKey).toBeUndefined();

    // teacher lacks institution:logo:update
    const denied = await request(app)
      .post("/api/v1/documents/logo")
      .set("Authorization", `Bearer ${tok.teacher}`)
      .attach("file", png, { filename: "logo.png", contentType: "image/png" });
    expect(denied.status).toBe(403);
  });
});
