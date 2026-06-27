# Documents & File Uploads Module

> **Status:** Implemented · **Backend:** `backend/src/modules/documents` (+ `backend/src/modules/pdfs`) · **Last updated:** 2026-06-23 · **Owner:** Engineering
>
> Related: [Docs index](../README.md) · [Diagrams](../diagrams/) · [Module workflows](../MODULE_WORKFLOWS.md) · [DB schema](../DATABASE_SCHEMA.md) · [Roles & permissions](../ROLES_AND_PERMISSIONS.md)

## 1. Purpose

A generic, authenticated document store used across the product. It holds file
**metadata** in Postgres (`documents`) and the **bytes** in pluggable storage —
an S3-compatible bucket when configured, otherwise a local-disk fallback. Files
are validated on upload (MIME + extension allowlist + size), and every download
goes through a permission-checked, owner-scoped route so storage keys are never
exposed to clients.

It is the shared file layer for homework/submission attachments, exam report
cards and mark sheets, transfer certificates, payroll payslips, institution
logos, and student/user documents (ID cards, certificates, profile photos). The
`pdfs/` module renders generated PDFs (e.g. via pdfkit) that feature modules
stream or persist.

## 2. User roles involved

| Role | Capability |
|------|-----------|
| `admin` | Read/upload/download/delete any document; upload the institution logo |
| `teacher` | Read/upload/download (per role matrix) |
| `accountant` | Read/download |
| `student` | Read/upload/download their own (student/user) documents |
| `parent` | Read/download their children's documents |
| `super_admin` | Bypasses permission checks |

Owner-scoping (below) further restricts student/parent to their own/linked
records regardless of the permission grant.

## 3. Main screens / pages

- Staff web: `/documents` → `frontend/src/app/(dashboard)/documents/page.tsx`
  (upload by category for students/users/logo; list; delete).
- Portal web: `/portal/documents` → `frontend/src/app/portal/documents/page.tsx`
  (upload/download a student's own documents by category).
- Mobile: `mobile/lib/screens/portal/documents_screen.dart` (list + download via
  the platform viewer).
- Other modules embed downloads (report cards, TC, payslips) rather than the
  generic page.

## 4. Main backend APIs

Router — `backend/src/modules/documents/documents.routes.ts` (mounted under
`authenticate, requireTenant`). Uploads use multer in-memory with
`limits.fileSize = STORAGE_MAX_MB`.

| Method | Path | Purpose | Permission |
|--------|------|---------|------------|
| GET | `/documents` | List document metadata (owner-scoped); filters `ownerType`, `ownerId`, `category` | `documents:read` |
| POST | `/documents` | Upload a document (multipart `file` + `ownerType`/`ownerId`/`category`) | `documents:upload` |
| POST | `/documents/logo` | Upload/replace the institution logo (image only) | `institution:logo:update` |
| GET | `/documents/{id}/download` | Download bytes through a protected, owner-scoped route | `documents:download` |
| DELETE | `/documents/{id}` | Delete the document and its stored file | `documents:delete` |

`ownerType` enum: `student | user | institution | message`.
`category` enum: `profile_photo | id_card | certificate | tc | document | logo | attachment`.
(The homework module additionally writes `owner_type` `homework`/`submission`
rows and serves them via its own download route.)

## 5. Database tables / entities

- **`documents`** (migration `0019_documents.sql`): `id`, `institution_id`
  (NOT NULL, CASCADE), `owner_type` (TEXT), `owner_id` (UUID, nullable),
  `category` (TEXT), `original_name`, `safe_name` (uuid-based), `mime_type`,
  `size_bytes`, `storage_key`, `storage_mode` (`s3`/`local`), `uploaded_by` →
  users (SET NULL), `created_at`. Indexed on `(institution_id, owner_type,
  owner_id)` and `(institution_id, category)`.
- Bytes live in object storage / local disk, **not** in Postgres. The
  `storage_key` is `{institution_id}/{owner_type}/{uuid}.{ext}` and is never
  returned to clients.

## 6. Permissions / RBAC involved

Keys (seeded `0019_documents.sql`): `documents:read`, `documents:upload`,
`documents:download`, `documents:delete`, and `institution:logo:update`.
Seeded grants: admin = all (+ logo); teacher = read/upload/download; accountant =
read/download; student = read/upload/download; parent = read/download.
`super_admin` bypasses checks.

## 7. Tenant isolation notes

- Every query filters by `institution_id`; the storage key is namespaced by
  `institution_id`.
- **Upload authorization** (`resolveUploadOwner`): a non-staff user may upload a
  `user` document only for themselves and a `student` document only for an
  owner-accessible student (`accessibleStudentIds`); staff may target any
  in-tenant owner. The owner reference (user/student/message/institution) is
  validated to exist in the tenant.
- **List** is owner-scoped: staff filter freely; student/parent see only
  `student` docs for their accessible ids, their own `user` docs, plus `logo`
  (branding is tenant-readable).
- **Download** (`assertCanAccess`): logo is allowed within the tenant; staff
  unrestricted; otherwise a `student` doc must be in the caller's accessible set
  or a `user` doc must be the caller's own — else 403. Only the bytes are
  streamed; the storage key stays server-side.
- Validation (`assertValidFile`): MIME allowlist (jpeg/png/webp/gif/pdf) with
  matching extension; a dangerous-extension blocklist (exe/sh/js/html/svg/…);
  size ≤ `STORAGE_MAX_MB`.

## 8. Key workflows

1. **Configure storage:** if all of `STORAGE_ENDPOINT`, `STORAGE_BUCKET`,
   `STORAGE_ACCESS_KEY`, `STORAGE_SECRET_KEY` are set, the S3 adapter is used
   (`STORAGE_REGION` default `us-east-1`); otherwise the local-disk adapter
   writes under `STORAGE_LOCAL_DIR` (default `uploads`). Selected once at startup
   in `backend/src/utils/storage.ts`.
2. **Upload:** multer holds the file in memory; `assertValidFile` validates;
   `storage.put` writes the bytes; a `documents` row is inserted with metadata +
   `storage_mode`. A `storage.put` failure returns 503.
3. **Download:** look up the row (tenant-scoped), enforce owner scope, then
   `storage.get` the bytes and stream them with a sanitized `Content-Disposition`.
4. **Delete:** remove the stored file (best-effort), then delete the row.
5. **Reuse by other modules:** homework/submission attachments, report cards,
   TCs, payslips, and logos all flow through this store or the `pdfs` renderer.

## 9. Test coverage summary

- Integration: `backend/tests/integration/documents.int.test.ts` — upload with
  the local-disk fallback; MIME/extension rejection (.exe/.html); size-limit
  enforcement; byte-for-byte protected download; delete; student/parent
  owner-scoping on upload and download; role guards (accountant lacks upload,
  student lacks delete); institution logo upload (admin-only); cross-institution
  denial.
- Run via `npm run test:integration` (local-disk storage; S3 not configured in
  tests).

## 10. Common troubleshooting

| Symptom | Likely cause | Resolution |
|---------|--------------|------------|
| Upload 413 / "File exceeds the size limit" | File larger than `STORAGE_MAX_MB` **or** nginx `client_max_body_size` | Raise both together — `STORAGE_MAX_MB` (default 10) **must** match nginx `client_max_body_size` (`10m` in `infra/nginx/*.conf`) |
| Upload 400 "Unsupported file type" / extension mismatch | MIME not in allowlist or extension ≠ content type | Use jpeg/png/webp/gif/pdf with a matching extension |
| Upload/download 503 | `storage.put`/`storage.get` failed | Check `STORAGE_*` (S3) or local-dir write permissions |
| Files vanish after redeploy | Local-disk fallback in use; container storage not persisted | Configure S3 (`STORAGE_*`) or mount a persistent volume for `STORAGE_LOCAL_DIR` |
| Portal user 403 on download | Document not owned/linked to the caller | Only the owning student/user (or staff) may download |

## 11. Future enhancement notes

- The `documents` `owner_type` enum is deliberately narrow; thread/message
  attachments were deferred to avoid widening it (see DATABASE_SCHEMA notes).
- Antivirus scanning, signed time-limited URLs, and image thumbnailing are
  natural additions; today every download proxies through the API.
