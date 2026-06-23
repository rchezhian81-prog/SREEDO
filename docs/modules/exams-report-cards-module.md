# Exams & Report Cards Module

> **Status:** Implemented · **Backend:** `backend/src/modules/exams` + `backend/src/modules/reports` (+ `backend/src/modules/pdfs`) · **Last updated:** 2026-06-23 · **Owner:** Engineering
>
> Related: [Docs index](../README.md) · [Diagrams](../diagrams/) · [Module workflows](../MODULE_WORKFLOWS.md) · [DB schema](../DATABASE_SCHEMA.md) · [Roles & permissions](../ROLES_AND_PERMISSIONS.md)

## 1. Purpose
Two cooperating modules:
- **exams** (`/api/v1/exams`) — define exams, enter subject-wise results in bulk,
  and read a per-student mark report.
- **reports** (`/api/v1/reports`) — maintain the institution **grade scale**
  (grade bands) and render **report-card** and **mark-sheet** PDFs from existing
  exam results.

See *MODULE_WORKFLOWS.md §G — Exams & results* and *§R — Reports*.

## 2. User roles involved
- **admin** — create exams; full grade-scale + reporting access.
- **teacher** — enter/upsert results; full reporting access (grade scale,
  report cards, mark sheets).
- **accountant** — view the reports area (`reports:read`, `reports:export`).
- **student** — download **their own** report card (`report_cards:read`).
- **parent** — download **their linked child's** report card (`report_cards:read`).

Exam-wide and section-wide views are staff-only (`requireStaff`);
per-student endpoints are owner-scoped (`assertStudentAccess`).

## 3. Main screens / pages
- `/exams` — `frontend/src/app/(dashboard)/exams/page.tsx`: create exams, enter
  results per section, view a student's report, and download report-card /
  mark-sheet PDFs. The grade scale (grade bands) is managed from the reports
  area surfaced here.

## 4. Main backend APIs
Base path `/api/v1`. Both routers require `authenticate` + `requireTenant`.

### Exams (`/exams`) — legacy role gates
| Method | Path | Purpose | Permission |
| --- | --- | --- | --- |
| GET | `/exams` | List exams (latest first) | Authenticated |
| POST | `/exams` | Create an exam | `authorize("admin")` |
| GET | `/exams/{id}/results` | Results for an exam (optional `sectionId`) | `requireStaff` |
| POST | `/exams/{id}/results` | Bulk upsert results | `authorize("admin", "teacher")` |
| GET | `/exams/students/{studentId}/report` | All-exam mark report for one student | Authenticated + `assertStudentAccess()` |

### Reports / report cards (`/reports`) — granular permission keys
| Method | Path | Purpose | Permission |
| --- | --- | --- | --- |
| GET | `/reports/grade-bands` | List the grade scale | `reports:read` |
| POST | `/reports/grade-bands` | Add a grade band | `report_cards:generate` |
| PATCH | `/reports/grade-bands/{id}` | Update a grade band | `report_cards:generate` |
| DELETE | `/reports/grade-bands/{id}` | Delete a grade band | `report_cards:generate` |
| GET | `/reports/report-card` | Student report-card PDF (`examId`, `studentId`) | `report_cards:read` + `assertStudentAccess()` |
| GET | `/reports/mark-sheet` | Class/section mark-sheet PDF (`examId`, `sectionId`) | `mark_sheets:export` + `requireStaff` |

Validation: exam requires `name`; results array 1–500 items each with
`studentId`, `subjectId`, `marksObtained` (≥0), optional `maxMarks` (default
100), `grade`, `remarks`; grade band requires `grade`, `minPercent`,
`maxPercent` (0–100, max ≥ min). PDFs are produced with pdfkit (`reports.pdf.ts`).

## 5. Database tables / entities
- **exams** (`0005_exams.sql`): `name`, `academic_year_id`, `start_date`,
  `end_date`; `institution_id` added in `0013/0014`.
- **exam_results**: `exam_id`, `student_id`, `subject_id`, `marks_obtained`,
  `max_marks` (default 100), `grade`, `remarks`;
  **UNIQUE (exam_id, student_id, subject_id)** → idempotent upsert.
- **grade_bands** (`0017_grade_bands.sql`): per-tenant `grade`, `min_percent`,
  `max_percent`, `remark`, `sort_order`; `UNIQUE (institution_id, grade)`.

## 6. Permissions / RBAC involved
- **exams** routes use **legacy role gates** (`authorize("admin")`,
  `authorize("admin","teacher")`, `requireStaff`). The catalogue also defines
  `exams:read` / `exams:manage` keys (seeded for roles) for future migration.
- **reports** routes use **granular keys**: `reports:read`, `reports:export`,
  `report_cards:read`, `report_cards:generate`, `mark_sheets:export`
  (seeded in `0017`; admin + teacher get all, accountant gets read/export,
  student + parent get `report_cards:read`).

## 7. Tenant isolation notes
Exams, results and grade bands are all filtered/stamped by `institution_id`.
PDF generation re-resolves the exam/student/section within the caller's tenant.
A student/parent requesting a student outside their tenant gets 404; an
inaccessible-but-in-tenant student gets 403 (`assertStudentAccess`).

## 8. Key workflows
1. **Create an exam.** Admin POSTs `/exams` (name + optional year/dates).
2. **Enter results.** Teacher/admin POSTs `/exams/{id}/results` with the
   subject-wise marks array; rows upsert on (exam, student, subject), so
   re-submitting corrects marks without duplicating.
3. **Set the grade scale.** A `report_cards:generate` holder defines grade bands
   (percentage → letter grade + remark) once per institution.
4. **Generate a report card.** `GET /reports/report-card?examId=…&studentId=…`
   maps each result's percentage through the grade bands and returns a PDF.
   Staff get any student; students/parents only their own/child.
5. **Generate a class mark sheet.** Staff `GET /reports/mark-sheet?examId=…&
   sectionId=…` returns a section-wide PDF.
6. **Per-student report.** `GET /exams/students/{id}/report` returns mark rows
   across all exams (owner-scoped).

## 9. Test coverage summary
`reports.int.test.ts` extensively covers the report-card and mark-sheet PDFs
(pdfkit smoke, permission enforcement, student/parent owner-scoping,
cross-tenant 404, and missing-data handling) — seeding `exams`/`exam_results`
directly. The **exams** endpoints themselves have **no dedicated integration
test** (their data is exercised via the reports suite). Grade-band CRUD is
covered through the reports flows.

## 10. Common troubleshooting
| Symptom | Likely cause | Resolution |
| --- | --- | --- |
| 403 on grade-band write | Caller lacks `report_cards:generate` | Grant the permission (admin/teacher have it) |
| 404 on report-card PDF | Missing exam/student/results in tenant | Verify ids; ensure results were entered |
| Report card shows no grade letter | No grade bands configured | Add grade bands first |
| Results upsert "duplicated" expectation | Unique on (exam, student, subject) | By design — re-submit overwrites |
| Student can't download a classmate's card | Owner scope (`report_cards:read`) | Expected; only staff download any student |

## 11. Future enhancement notes
- Migrate exams routes from legacy role gates to `exams:read`/`exams:manage`.
- Add `PATCH`/`DELETE` for exams and weighting/aggregation (overall %, rank).
- Auto-fill `grade` on result upsert from the grade scale.
- Bulk/batch report-card generation per section (PDF zip).
