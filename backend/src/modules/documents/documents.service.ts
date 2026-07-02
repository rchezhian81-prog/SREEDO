import { randomUUID } from "node:crypto";
import type { Request } from "express";
import { query } from "../../db/postgres";
import { env } from "../../config/env";
import { ApiError } from "../../utils/api-error";
import { storage } from "../../utils/storage";
import { assertStorageWithinLimit } from "../../utils/plan-limits";
import { accessibleStudentIds, isStaff } from "../../utils/scope";
import type { z } from "zod";
import type { listQuerySchema, uploadFieldsSchema } from "./documents.schema";

// MIME allowlist → permitted extensions (defense in depth: both are checked).
const ALLOWED: Record<string, string[]> = {
  "image/jpeg": ["jpg", "jpeg"],
  "image/png": ["png"],
  "image/webp": ["webp"],
  "image/gif": ["gif"],
  "application/pdf": ["pdf"],
};
const DANGEROUS = new Set([
  "exe", "sh", "bat", "cmd", "com", "js", "mjs", "cjs", "php", "phtml",
  "html", "htm", "svg", "jar", "msi", "dll", "app", "py", "rb", "pl",
]);

function extensionOf(name: string): string {
  const m = name.toLowerCase().match(/\.([a-z0-9]+)$/);
  return m ? m[1] : "";
}

/** Validates type, extension and size; returns the safe extension. Throws 400 otherwise. */
export function assertValidFile(
  originalName: string,
  mimeType: string,
  sizeBytes: number
): string {
  const ext = extensionOf(originalName);
  if (!ext) throw ApiError.badRequest("File must have an extension");
  if (DANGEROUS.has(ext)) throw ApiError.badRequest("File type is not allowed");
  const allowedExts = ALLOWED[mimeType];
  if (!allowedExts) throw ApiError.badRequest("Unsupported file type");
  if (!allowedExts.includes(ext)) {
    throw ApiError.badRequest("File extension does not match its content type");
  }
  if (sizeBytes > env.storageMaxMb * 1024 * 1024) {
    throw ApiError.badRequest(`File exceeds the ${env.storageMaxMb}MB limit`);
  }
  return ext;
}

const SELECT = `
  id, owner_type AS "ownerType", owner_id AS "ownerId", category,
  original_name AS "originalName", mime_type AS "mimeType",
  size_bytes AS "sizeBytes", storage_mode AS "storageMode",
  uploaded_by AS "uploadedBy", created_at AS "createdAt"`;

async function refExists(
  table: "students" | "users" | "messages" | "institutions",
  id: string,
  institutionId: string
): Promise<boolean> {
  const col = table === "institutions" ? "id" : "institution_id";
  const idClause = table === "institutions" ? "id = $1" : `id = $1 AND ${col} = $2`;
  const params = table === "institutions" ? [id] : [id, institutionId];
  const { rows } = await query(`SELECT 1 FROM ${table} WHERE ${idClause}`, params);
  return rows.length > 0;
}

/** Resolves + authorizes the upload target, returning the effective owner id. */
async function resolveUploadOwner(
  req: Request,
  ownerType: string,
  ownerId: string | undefined,
  institutionId: string
): Promise<string> {
  const staff = isStaff(req.user!.role);
  if (ownerType === "user") {
    const target = ownerId ?? req.user!.id;
    if (!staff && target !== req.user!.id) {
      throw ApiError.forbidden("Cannot upload for another user");
    }
    if (!(await refExists("users", target, institutionId))) {
      throw ApiError.badRequest("Invalid user");
    }
    return target;
  }
  if (ownerType === "student") {
    if (!ownerId) throw ApiError.badRequest("ownerId is required for a student document");
    if (!(await refExists("students", ownerId, institutionId))) {
      throw ApiError.badRequest("Invalid student");
    }
    if (!staff) {
      const allowed = (await accessibleStudentIds(req)) ?? [];
      if (!allowed.includes(ownerId)) {
        throw ApiError.forbidden("Cannot upload for this student");
      }
    }
    return ownerId;
  }
  if (ownerType === "message") {
    if (!ownerId) throw ApiError.badRequest("ownerId is required for an attachment");
    if (!(await refExists("messages", ownerId, institutionId))) {
      throw ApiError.badRequest("Invalid message");
    }
    return ownerId;
  }
  if (ownerType === "institution") {
    return institutionId; // logo path handles its own permission
  }
  throw ApiError.badRequest("Invalid owner type");
}

export async function createDocument(
  req: Request,
  fields: z.infer<typeof uploadFieldsSchema>,
  file: { originalname: string; mimetype: string; size: number; buffer: Buffer },
  institutionId: string
) {
  const ext = assertValidFile(file.originalname, file.mimetype, file.size);
  // Enforce the tenant's effective storage quota before we persist the bytes.
  await assertStorageWithinLimit(institutionId, file.size);
  const ownerId = await resolveUploadOwner(
    req,
    fields.ownerType,
    fields.ownerId,
    institutionId
  );
  const safeName = `${randomUUID()}.${ext}`;
  const storageKey = `${institutionId}/${fields.ownerType}/${safeName}`;

  try {
    await storage.put(storageKey, file.buffer, file.mimetype);
  } catch (err) {
    console.error("storage.put failed:", err);
    throw ApiError.serviceUnavailable("File storage is unavailable");
  }

  const { rows } = await query(
    `INSERT INTO documents
       (institution_id, owner_type, owner_id, category, original_name, safe_name,
        mime_type, size_bytes, storage_key, storage_mode, uploaded_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     RETURNING ${SELECT}`,
    [
      institutionId,
      fields.ownerType,
      ownerId,
      fields.category ?? "document",
      file.originalname,
      safeName,
      file.mimetype,
      file.size,
      storageKey,
      storage.mode,
      req.user!.id,
    ]
  );
  return rows[0];
}

export async function setInstitutionLogo(
  req: Request,
  file: { originalname: string; mimetype: string; size: number; buffer: Buffer },
  institutionId: string
) {
  if (!file.mimetype.startsWith("image/")) {
    throw ApiError.badRequest("Logo must be an image");
  }
  return createDocument(
    req,
    { ownerType: "institution", category: "logo" },
    file,
    institutionId
  );
}

export async function listDocuments(
  req: Request,
  filters: z.infer<typeof listQuerySchema>,
  institutionId: string
) {
  const params: unknown[] = [institutionId];
  const conditions = ["d.institution_id = $1"];
  const allowed = await accessibleStudentIds(req); // null for staff

  if (allowed === null) {
    // Staff: free filtering.
    if (filters.ownerType) {
      params.push(filters.ownerType);
      conditions.push(`d.owner_type = $${params.length}`);
    }
    if (filters.ownerId) {
      params.push(filters.ownerId);
      conditions.push(`d.owner_id = $${params.length}`);
    }
  } else {
    // Student/parent: only their own/linked documents (+ a student's own user docs).
    params.push(allowed);
    const idsParam = params.length;
    params.push(req.user!.id);
    const selfParam = params.length;
    conditions.push(
      `((d.owner_type = 'student' AND d.owner_id = ANY($${idsParam}::uuid[]))` +
        ` OR (d.owner_type = 'user' AND d.owner_id = $${selfParam})` +
        ` OR d.category = 'logo')`
    );
  }
  if (filters.category) {
    params.push(filters.category);
    conditions.push(`d.category = $${params.length}`);
  }

  const { rows } = await query(
    `SELECT ${SELECT} FROM documents d WHERE ${conditions.join(" AND ")}
     ORDER BY d.created_at DESC`,
    params
  );
  return rows;
}

interface DownloadRow {
  storage_key: string;
  mime_type: string;
  original_name: string;
  owner_type: string;
  owner_id: string | null;
  category: string;
}

/** Fetches a document and enforces owner-scoping; returns the bytes to stream. */
export async function downloadDocument(
  req: Request,
  id: string,
  institutionId: string
): Promise<{ buffer: Buffer; mimeType: string; originalName: string }> {
  const { rows } = await query<DownloadRow>(
    `SELECT storage_key, mime_type, original_name, owner_type, owner_id, category
     FROM documents WHERE id = $1 AND institution_id = $2`,
    [id, institutionId]
  );
  const doc = rows[0];
  if (!doc) throw ApiError.notFound("Document not found");

  await assertCanAccess(req, doc);

  try {
    const buffer = await storage.get(doc.storage_key);
    return { buffer, mimeType: doc.mime_type, originalName: doc.original_name };
  } catch (err) {
    console.error("storage.get failed:", err);
    throw ApiError.serviceUnavailable("File storage is unavailable");
  }
}

async function assertCanAccess(req: Request, doc: DownloadRow): Promise<void> {
  if (doc.category === "logo") return; // branding is readable within the tenant
  const allowed = await accessibleStudentIds(req);
  if (allowed === null) return; // staff
  if (
    doc.owner_type === "student" &&
    doc.owner_id &&
    allowed.includes(doc.owner_id)
  ) {
    return;
  }
  if (doc.owner_type === "user" && doc.owner_id === req.user!.id) return;
  throw ApiError.forbidden("You cannot access this document");
}

export async function deleteDocument(
  id: string,
  institutionId: string
): Promise<void> {
  const { rows } = await query<{ storage_key: string }>(
    "SELECT storage_key FROM documents WHERE id = $1 AND institution_id = $2",
    [id, institutionId]
  );
  if (!rows[0]) throw ApiError.notFound("Document not found");
  await storage.remove(rows[0].storage_key);
  await query("DELETE FROM documents WHERE id = $1 AND institution_id = $2", [
    id,
    institutionId,
  ]);
}
