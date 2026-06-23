# Transfer Certificates Module

> **Status:** Implemented · **Backend:** `backend/src/modules/tc` · **Last updated:** 2026-06-23 · **Owner:** Engineering
>
> Related: [Docs index](../README.md) · [Diagrams](../diagrams/) · [Module workflows](../MODULE_WORKFLOWS.md) · [DB schema](../DATABASE_SCHEMA.md) · [Roles & permissions](../ROLES_AND_PERMISSIONS.md)

## 1. Purpose

Issues and tracks Transfer Certificates (TCs) — the leaving document a student
receives when they exit an institution. The module maintains a tenant-scoped TC
register with a draft → issued → cancelled lifecycle, snapshots the student's
identity at creation time (so the certificate stays accurate even if the student
record changes later), enforces a **pending-dues gate** before issue (fees,
library, transport, hostel) with a permission-controlled override, generates the
TC PDF, and exposes an owner-scoped download to students/parents once the
certificate is issued.

The PDF rendering lives in the shared `backend/src/modules/pdfs/` module
(`tcPdf` + `institutionLogo`); the `tc/` module owns the data and workflow.

## 2. User roles involved

- **admin** — full TC control, including `transfer_certificates:override_dues`.
- **accountant** — create / read / update / issue / cancel / download, but **not**
  the dues override (attempting to override returns 403).
- **teacher** — no TC permissions by default (403 on every TC route).
- **student / parent** — `read` + `download` only, owner-scoped: a student sees
  their own TCs; a parent sees their linked children's. They may download **only
  issued** certificates (drafts/cancelled are blocked for non-staff).
- **super_admin** — bypasses permission checks, but TC routes are tenant-scoped
  (`requireTenant`), so a null-tenant super admin is not the intended caller.

## 3. Main screens / pages

- `/transfer-certificates` — TC register (list, filter by status, search, create
  draft). Frontend: `frontend/src/app/(dashboard)/transfer-certificates/page.tsx`.
- `/transfer-certificates/[id]` — TC detail: edit draft, run the pre-issue dues
  check, issue, cancel, download.
  `frontend/src/app/(dashboard)/transfer-certificates/[id]/page.tsx`.
- **Portal:** `frontend/src/app/portal/certificates/page.tsx` consumes the same
  `/transfer-certificates` endpoints (owner-scoped) so a student/parent can view
  and download their issued certificate.

## 4. Main backend APIs

All under `/api/v1` and guarded by `authenticate` + `requireTenant`.

| Method | Path | Purpose | Permission |
| --- | --- | --- | --- |
| GET | `/transfer-certificates` | TC register (owner-scoped for student/parent) | `transfer_certificates:read` |
| POST | `/transfer-certificates` | Create a TC draft (snapshots student, assigns TC number) | `transfer_certificates:create` |
| GET | `/transfer-certificates/student/{studentId}/dues` | Pending dues across fees/library/transport/hostel | `transfer_certificates:read` |
| GET | `/transfer-certificates/{id}` | TC detail (owner-scoped) | `transfer_certificates:read` |
| PATCH | `/transfer-certificates/{id}` | Edit a TC draft (draft-only) | `transfer_certificates:update` |
| POST | `/transfer-certificates/{id}/issue` | Issue a TC (blocked by dues unless overridden) | `transfer_certificates:issue` (+ `:override_dues` to override) |
| POST | `/transfer-certificates/{id}/cancel` | Cancel a TC (stays in the register, invalid) | `transfer_certificates:cancel` |
| GET | `/transfer-certificates/{id}/download` | Download the TC PDF (student/parent: issued only) | `transfer_certificates:download` |

## 5. Database tables / entities

- **`transfer_certificates`** (PK `id` UUID, tenant `institution_id`). Key columns:
  `tc_no` (globally unique, `TC-<YYYY>-<5-digit seq>` from the
  `transfer_certificate_seq` sequence), `student_id`, the snapshot columns
  (`admission_no`, `class_name`, `section_name`, `program_name`, `semester_name`,
  `academic_year`), `date_of_issue`, `last_attendance_date`, `leaving_reason`,
  `conduct`, the four dues-status strings
  (`fee_dues_status` / `library_dues_status` / `transport_dues_status` /
  `hostel_dues_status` — frozen at issue time), `dues_override` +
  `dues_override_reason`, `status` (`draft` / `issued` / `cancelled`), and
  `issued_at`/`issued_by`, `cancelled_at`/`cancelled_by`/`cancel_reason`,
  `created_by`. Migration `0034_transfer_certificates.sql`.

The dues check is computed on demand by joining `invoices`, `transport_invoices`,
`hostel_invoices`, `book_issues` + `library_members`; nothing extra is persisted
until issue, when the human-readable dues status strings are written onto the TC.

## 6. Permissions / RBAC involved

Seeded in `0034_transfer_certificates.sql`:

- `transfer_certificates:read`, `:create`, `:update`, `:issue`, `:cancel`,
  `:download`, `:override_dues`.

Default grants: **admin** receives all seven keys; **accountant** receives all
except `:override_dues`; **student** and **parent** receive `:read` + `:download`
only. The override is decided at the route by checking
`transfer_certificates:override_dues` and passing a `canOverride` flag into the
service — `super_admin` always passes.

## 7. Tenant isolation notes

Every query filters on `institution_id` (from `tenantId(req)`), and the
register/detail/download routes additionally owner-scope via
`accessibleStudentIds(req)` + `assertStudentAccess`. The dues route confirms the
student belongs to the tenant before computing dues, to avoid cross-tenant
probing. Cross-institution access returns empty lists or 404 (verified in tests:
a second institution's admin sees zero TCs and 404 on detail/issue/download).

## 8. Key workflows

1. **Create draft** — `POST /` snapshots the student (admission no, class/section
   or program/semester via enrollment) and assigns a collision-free `tc_no` from
   a dedicated sequence. Status = `draft`.
2. **Pre-issue dues check** — `GET /student/{id}/dues` returns
   `{ fee, library, transport, hostel, hasDues }`. `hasDues` is true when fees are
   outstanding or library books/fines are pending.
3. **Issue** — `POST /{id}/issue` runs in one transaction with `FOR UPDATE`:
   recomputes dues, and if `hasDues` requires both `overrideDues:true` in the body
   **and** the caller to hold `:override_dues` (plus an `overrideReason`),
   otherwise it throws 400/403. On success it freezes the dues-status strings,
   sets `date_of_issue`, and (unless `markTransferred:false`) sets the student's
   status to `transferred` — data is retained, never deleted.
4. **Cancel** — `POST /{id}/cancel` sets status `cancelled` (with reason); the row
   stays in the register and remains downloadable by staff (PDF is watermarked).
5. **Download** — `GET /{id}/download` returns the rendered PDF. Non-staff callers
   may download only when status is `issued`.

See [Module workflows](../MODULE_WORKFLOWS.md) for the cross-module dues lineage.

## 9. Test coverage summary

`backend/tests/integration/tc.int.test.ts` covers: unique sequence-based TC
numbers + student snapshot; dues reporting; dues-free issue → PDF generation
(`%PDF-` header) → student marked transferred → re-issue rejected; dues block +
permission-gated override (accountant 403, admin 200); cancel + watermarked PDF
still downloadable by staff; owner-scoped portal download (issued-only,
own/linked-child); permission enforcement (teacher 403, student read-only); TC
entries surfaced in the Reports Center; and full tenant isolation (cross-institution
404s).

## 10. Common troubleshooting

| Symptom | Likely cause | Resolution |
| --- | --- | --- |
| Issue returns 400 "pending dues" | Student has outstanding fees/library items | Clear the dues, or re-issue with `overrideDues:true` + `overrideReason` |
| Override attempt returns 403 | Caller lacks `transfer_certificates:override_dues` (e.g. accountant) | Have an admin issue, or grant the override permission via the RBAC console |
| Edit returns 400 "Only draft TCs can be edited" | TC already issued/cancelled | TCs are immutable after issue; cancel and create a new draft if needed |
| Student/parent download returns 403 | Certificate not yet issued, or not their record | Issue the TC first; non-staff cannot download drafts/cancelled or others' TCs |
| Cross-institution 404 on a known TC id | Tenant isolation (different `institution_id`) | Expected; access TCs only within the owning tenant |

## 11. Future enhancement notes

- Email/notify the student/parent automatically when a TC is issued.
- Configurable conduct/leaving-reason vocabularies per institution.
- Bulk TC issue for graduating cohorts.
- Optional digital signature / QR verification on the PDF.
- Items marked "(to confirm)": none — the documented behaviour all maps to code
  in `tc.routes.ts` / `tc.service.ts` and the integration test.
