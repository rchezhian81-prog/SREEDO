# API Reference — SRE EDU OS

Deliverable **#3 API list**. The **live, authoritative** contract is the
generated Swagger at `/api/docs` (JSON at `/api/docs.json`). This document lists
the **current endpoints** (exact, from the route files) and the **planned
endpoints** per upcoming module.

- **Base path:** `/api/v1`
- **Auth:** `Authorization: Bearer <accessToken>` (15-min JWT). Refresh via
  `POST /auth/refresh`.
- **Validation:** every body/query is zod-validated; failures return a 400 with a
  consistent error envelope from the central error handler.
- **Rate limiting:** global limiter on all `/api/v1`; stricter limiter on login.
- **Errors:** `{ error: { message, ... } }` via `ApiError` + error middleware.
- **Owner-scoping:** staff roles see all records; `student` is limited to their
  own student/attendance/exam/fee records; section rosters, exam-wide results,
  the fee summary and dashboard stats are staff-only.
- **Health (outside /api/v1):** `GET /health` → `{ status, postgres, mongo, uptime }`.

Auth column legend: **public** · **auth** (any logged-in) · or explicit role(s).

---

## Part 1 — Current endpoints

### Auth — `/api/v1/auth`
| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| POST | `/login` | public (rate-limited) | Email+password → access + refresh tokens |
| POST | `/refresh` | public | Rotate refresh token → new tokens |
| POST | `/logout` | public | Revoke a refresh token |
| GET | `/me` | auth | Current user profile |
| POST | `/change-password` | auth | Change password (revokes all sessions) |

### Users — `/api/v1/users` *(admin only, whole router)*
| Method | Path | Purpose |
|--------|------|---------|
| GET | `/` | List user accounts |
| POST | `/` | Create account |
| GET | `/:id` | Get account |
| PATCH | `/:id` | Update account |
| DELETE | `/:id` | Delete account |

### Students — `/api/v1/students`
| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/` | auth | List (search + pagination) |
| POST | `/` | admin | Create (auto admission no.) |
| GET | `/:id` | auth | Get student |
| PATCH | `/:id` | admin | Update |
| DELETE | `/:id` | admin | Archive (soft delete); `?hard=true` to permanently delete |

### Teachers — `/api/v1/teachers`
| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/` | auth | List |
| POST | `/` | admin | Create (auto employee no.) |
| GET | `/:id` | auth | Get |
| PATCH | `/:id` | admin | Update |
| DELETE | `/:id` | admin | Delete |

### Academics — `/api/v1` *(read: auth; write: admin)*
| Method | Path | Purpose |
|--------|------|---------|
| GET / POST | `/academic-years` | List / create academic years |
| GET / POST | `/classes` | List / create classes |
| DELETE | `/classes/:id` | Delete class |
| POST | `/sections` | Create section |
| DELETE | `/sections/:id` | Delete section |
| GET / POST | `/subjects` | List / create subjects |
| DELETE | `/subjects/:id` | Delete subject |

### Attendance — `/api/v1/attendance`
| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/` | auth | View by section + date |
| POST | `/` | admin, teacher | Bulk upsert for a section/date |
| GET | `/students/:studentId` | auth | Per-student history |

### Exams — `/api/v1/exams`
| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/` | auth | List exams |
| POST | `/` | admin | Create exam |
| GET | `/:id/results` | auth | Results for an exam |
| POST | `/:id/results` | admin, teacher | Bulk upsert results |
| GET | `/students/:studentId/report` | auth | Per-student report |

### Fees — `/api/v1/fees` *(write: admin, accountant)*
| Method | Path | Purpose |
|--------|------|---------|
| GET / POST | `/structures` | List / create fee structures |
| GET / POST | `/invoices` | List / create invoices |
| GET | `/invoices/:id` | Invoice detail |
| POST | `/invoices/:id/payments` | Record payment (overpay-guarded) |
| GET | `/summary` | Fee summary (collected/pending) |

### Announcements — `/api/v1/announcements` *(write: admin, teacher)*
| Method | Path | Purpose |
|--------|------|---------|
| GET | `/` | List (audience-filtered) |
| POST | `/` | Create |
| GET | `/:id` | Get |
| PATCH | `/:id` | Update |
| DELETE | `/:id` | Delete |

### Dashboard — `/api/v1/dashboard`
| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/stats` | auth | KPI counts for dashboard cards |

### AI — `/api/v1/ai` *(admin, teacher, accountant; 503 without OpenAI key)*
| Method | Path | Purpose |
|--------|------|---------|
| POST | `/assistant` | Ask the GPT-4o assistant (grounded in live stats) |
| GET | `/conversations` | List conversation history |
| GET | `/conversations/:id` | Get a conversation |

### AI Insights — `/api/v1/ai-insights` *(tenant-scoped; `ai:*` permissions; metrics always returned, narrative only when OpenAI configured)*
| Method | Path | Permission | Purpose |
|--------|------|------------|---------|
| GET | `/dashboard` | `ai:read` | Headline KPIs + workflow suggestions |
| GET | `/summary/:report` | `ai:summarize` | KPI summary for a report (attendance, fees, exams, homework, payroll, library, transport, hostel, inventory) |
| GET | `/risk/attendance` | `ai:risk_alerts` | Low-attendance students over a window (`threshold`, `windowDays`) |
| GET | `/risk/fees` | `ai:risk_alerts` | Overdue + outstanding invoices (manual reminder only) |
| GET | `/search` | `ai:document_search` | Semantic document search (keyword fallback); `q` required |
| GET | `/suggestions` | `ai:workflow_suggestions` | Deterministic workflow suggestions |

---

## Part 2 — Planned endpoints (by phase)

Naming follows the existing conventions (plural nouns, nested resources, bulk
upsert where natural). Each ships with `@openapi` JSDoc so Swagger stays current.

### Phase A — Super Admin & permissions
- `/institutions` CRUD · `/institutions/:id/branches` CRUD
- `/packages` CRUD · `/institutions/:id/subscription`
- `/permissions` (list) · `/roles/:role/permissions` (grant/revoke)
- `/admin/audit-logs` (read) · `/admin/backups` (trigger/list/restore)
- `/settings` (institution settings get/patch)

### Phase B — College mode & timetables
- `/departments`, `/courses`, `/semesters` CRUD
- `/rooms`, `/periods` CRUD
- `/timetables` (per section) · `/timetables/teacher/:id` · conflict check on write
- `/grade-bands` CRUD (for report cards)

### Phase C — Portals, homework, communication, uploads
- `/homework` CRUD · `/homework/:id/submissions` (submit/grade)
- `/me/children` (parent) · `/me/attendance`, `/me/results`, `/me/fees` (scoped)
- `/messages` (internal messaging) · `/notifications` (list/read)
- `/devices` (register FCM token) · `/notify` (admin push/SMS/email send)
- `/uploads` (pres?/signed object-storage URLs) · `/documents` CRUD
- Receipt + report-card PDF: `/fees/invoices/:id/receipt.pdf`,
  `/exams/:id/students/:sid/report-card.pdf`

### Phase D — Operations modules
- **Library:** `/library/books`, `/library/loans` (issue/return), `/library/fines`
- **Transport:** `/transport/vehicles`, `/drivers`, `/transport/routes`,
  `/transport/allocations`
- **Hostel:** `/hostels`, `/hostels/:id/rooms`, `/hostel/allocations`
- **Inventory:** `/inventory/items`, `/vendors`, `/inventory/purchases`,
  `/inventory/issues`
- **Payroll:** `/payroll/salary-structures`, `/payroll/runs`,
  `/payroll/payslips`, `/staff/attendance`, `/staff/leaves`

### Cross-cutting (Reports — deliverable spans modules)
- `/reports/<area>` with `format=csv|pdf` query for export/print
- `/reports/custom` (saved custom report definitions) — Phase D

> Status of each endpoint maps to the module status in [`PRD.md`](./PRD.md) §4 and
> the phasing in [`DEV_ROADMAP.md`](./DEV_ROADMAP.md). Role gates per endpoint
> follow the matrix in [`ROLES_AND_PERMISSIONS.md`](./ROLES_AND_PERMISSIONS.md).
