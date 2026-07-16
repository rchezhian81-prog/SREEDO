import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import request from "supertest";
import {
  app,
  createInstitution,
  createUser,
  query,
  resetDb,
  tokenFor,
} from "./helpers";
import { storage } from "../../src/utils/storage";
import { __setDocumentCryptoForTests } from "../../src/utils/document-crypto";

const PW = "Passw0rd!";
const PDF = Buffer.from("%PDF-1.4\nfake report\n%%EOF");
const KEY1 = randomBytes(32).toString("base64");
const KEY2 = randomBytes(32).toString("base64");

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

  // Reset document encryption to the env-derived keyring (disabled in tests) after each
  // case, so plaintext cases run unencrypted and encryption cases opt in explicitly.
  afterEach(() => __setDocumentCryptoForTests(null));

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

  // --- PR-OPS3: per-file storage_mode routing (S3 flip is backward-compatible) ---

  it("keeps a local-recorded document downloadable (legacy files survive an S3 flip)", async () => {
    const up = await uploadAs(
      tok.admin,
      { ownerType: "student", ownerId: st1, category: "certificate" },
      { buffer: PDF, filename: "legacy.pdf", contentType: "application/pdf" }
    );
    expect(up.body.storageMode).toBe("local");
    const dl = await get(`/api/v1/documents/${up.body.id}/download`, tok.admin)
      .buffer(true)
      .parse(binaryParser);
    expect(dl.status).toBe(200);
    expect(Buffer.compare(dl.body, PDF)).toBe(0); // still read from local disk
  });

  it("routes an S3-recorded document to S3 and never silently falls back to a lingering local copy", async () => {
    // Uploaded while S3 is unconfigured → written to local disk, mode 'local'.
    const up = await uploadAs(
      tok.admin,
      { ownerType: "student", ownerId: st1, category: "tc" },
      { buffer: PDF, filename: "s3doc.pdf", contentType: "application/pdf" }
    );
    expect(up.body.storageMode).toBe("local");
    // Simulate the row having been written during the S3 window.
    await query(`UPDATE documents SET storage_mode = 's3' WHERE id = $1`, [up.body.id]);
    // A local copy still exists on disk, but an 's3' record must resolve to S3. S3 is not
    // configured here → the router throws → surfaced as 503, NOT a 200 from the local file
    // (which would mask a real S3 outage/misconfiguration).
    const dl = await get(`/api/v1/documents/${up.body.id}/download`, tok.admin);
    expect(dl.status).toBe(503);
  });

  it("surfaces a storage failure when deleting an S3-recorded document and keeps the metadata row", async () => {
    const up = await uploadAs(
      tok.admin,
      { ownerType: "student", ownerId: st1 },
      { buffer: PDF, filename: "del-s3.pdf", contentType: "application/pdf" }
    );
    await query(`UPDATE documents SET storage_mode = 's3' WHERE id = $1`, [up.body.id]);
    const del = await request(app)
      .delete(`/api/v1/documents/${up.body.id}`)
      .set("Authorization", `Bearer ${tok.admin}`);
    expect(del.status).toBe(503); // S3 unavailable → surfaced, not a silent success
    const still = await query(`SELECT 1 FROM documents WHERE id = $1`, [up.body.id]);
    expect(still.rows.length).toBe(1); // row retained → stored object is never orphaned
  });

  it("still denies cross-institution download for an S3-recorded document", async () => {
    const bDoc = await uploadAs(
      tok.badmin,
      { ownerType: "user" },
      { buffer: PDF, filename: "b-s3.pdf", contentType: "application/pdf" }
    );
    await query(`UPDATE documents SET storage_mode = 's3' WHERE id = $1`, [bDoc.body.id]);
    // Tenant isolation is enforced before storage is touched → 404 (not 503).
    expect((await get(`/api/v1/documents/${bDoc.body.id}/download`, tok.admin)).status).toBe(404);
  });

  // --- Phase 1: application-layer document encryption at rest ---

  it("encrypts uploaded documents at rest and round-trips an authorised download", async () => {
    __setDocumentCryptoForTests([{ id: "k1", keyB64: KEY1, active: true }]);
    const up = await uploadAs(
      tok.admin,
      { ownerType: "student", ownerId: st1, category: "id_card" },
      { buffer: PDF, filename: "id.pdf", contentType: "application/pdf" }
    );
    expect(up.status).toBe(201);
    const { rows } = await query<{ storage_key: string; enc_key_id: string | null }>(
      `SELECT storage_key, enc_key_id FROM documents WHERE id = $1`,
      [up.body.id]
    );
    expect(rows[0].enc_key_id).toBe("k1"); // recorded as encrypted with the active key
    // The bytes actually on disk are ciphertext — not the original file.
    const stored = await storage.get(rows[0].storage_key);
    expect(stored.equals(PDF)).toBe(false);
    expect(stored.subarray(0, 4).toString()).not.toBe("%PDF");
    // ...but an authorised download returns the exact original bytes.
    const dl = await get(`/api/v1/documents/${up.body.id}/download`, tok.admin)
      .buffer(true)
      .parse(binaryParser);
    expect(dl.status).toBe(200);
    expect(Buffer.compare(dl.body, PDF)).toBe(0);
  });

  it("still downloads a legacy plaintext document while encryption is enabled", async () => {
    __setDocumentCryptoForTests([{ id: "k1", keyB64: KEY1, active: true }]);
    // Simulate a pre-encryption file: plaintext bytes on disk + a row with enc_key_id NULL.
    const key = `${instA}/student/legacy-plain.pdf`;
    await storage.put(key, PDF, "application/pdf");
    const id = await insertId(
      `INSERT INTO documents
         (institution_id, owner_type, owner_id, category, original_name, safe_name,
          mime_type, size_bytes, storage_key, storage_mode, enc_key_id, uploaded_by)
       VALUES ($1,'student',$2,'certificate','legacy.pdf','legacy-plain.pdf','application/pdf',$3,$4,'local',NULL,NULL)
       RETURNING id`,
      [instA, st1, PDF.length, key]
    );
    const dl = await get(`/api/v1/documents/${id}/download`, tok.admin)
      .buffer(true)
      .parse(binaryParser);
    expect(dl.status).toBe(200);
    expect(Buffer.compare(dl.body, PDF)).toBe(0); // passthrough — not an attempted decrypt
  });

  it("fails safe (503) when the key that encrypted a document is unavailable", async () => {
    __setDocumentCryptoForTests([{ id: "k1", keyB64: KEY1, active: true }]);
    const up = await uploadAs(
      tok.admin,
      { ownerType: "student", ownerId: st1 },
      { buffer: PDF, filename: "sealed.pdf", contentType: "application/pdf" }
    );
    expect(up.status).toBe(201);
    // Key rotated away / removed: the keyring no longer holds k1.
    __setDocumentCryptoForTests([{ id: "k2", keyB64: KEY2, active: true }]);
    const dl = await get(`/api/v1/documents/${up.body.id}/download`, tok.admin);
    expect(dl.status).toBe(503); // cannot decrypt → surfaced, never returns ciphertext
  });

  it("uploads, downloads and deletes an encrypted document end-to-end", async () => {
    __setDocumentCryptoForTests([{ id: "k1", keyB64: KEY1, active: true }]);
    const up = await uploadAs(
      tok.admin,
      { ownerType: "student", ownerId: st1, category: "tc" },
      { buffer: PDF, filename: "enc-lifecycle.pdf", contentType: "application/pdf" }
    );
    expect(up.status).toBe(201);
    // download decrypts to the original bytes
    const dl = await get(`/api/v1/documents/${up.body.id}/download`, tok.admin)
      .buffer(true)
      .parse(binaryParser);
    expect(dl.status).toBe(200);
    expect(Buffer.compare(dl.body, PDF)).toBe(0);
    // delete removes the stored (encrypted) object and the row
    const { rows } = await query<{ storage_key: string }>(
      `SELECT storage_key FROM documents WHERE id = $1`,
      [up.body.id]
    );
    const del = await request(app)
      .delete(`/api/v1/documents/${up.body.id}`)
      .set("Authorization", `Bearer ${tok.admin}`);
    expect(del.status).toBe(204);
    expect((await get(`/api/v1/documents/${up.body.id}/download`, tok.admin)).status).toBe(404);
    await expect(storage.get(rows[0].storage_key)).rejects.toThrow(); // ciphertext file gone
  });
});
