# UI Page List — SRE EDU OS

Deliverable **#7 UI page list**. Pages across the web admin, super-admin console,
parent/student portals, and mobile app. ✅ exists today · 🟡 partial · ⬜ planned.

## Design language (applies to all surfaces)

Clean, premium, **soft-3D** UI in Tailwind CSS: rounded cards with soft shadows,
gentle gradients, generous spacing, attractive dashboard KPI cards. Responsive
(desktop/tablet/mobile). Every list page has **search, filters, export, print**.
Avoid dense/complex screens; clear menus + icons. Reuse `src/components/ui.tsx`
primitives; the **students page is the reference** for table+form screens.

## 1. Web admin (Next.js) — `frontend/src/app`

### Auth & shell
| Page | Route | Status |
|------|-------|--------|
| Login | `/login` | ✅ |
| Dashboard shell / layout (auth guard, nav) | `(dashboard)/layout` | ✅ |

### Implemented dashboard pages ✅
| Page | Route | Notes |
|------|-------|-------|
| Dashboard (KPI cards) | `/dashboard` | counts, fee + attendance snapshots |
| Students | `/students` | list, search, pagination, create/edit modal (reference pattern) |
| Teachers | `/teachers` | list + create/edit |
| Classes & academics | `/classes` | classes/sections/subjects setup |
| Attendance | `/attendance` | section+date roster, bulk mark |
| Fees | `/fees` | structures, invoices, payments, summary |
| Announcements | `/announcements` | notice board CRUD |
| AI Assistant | `/assistant` | chat with GPT-4o assistant |
| Exams & Results | `/exams` | exam CRUD + per-section/subject mark entry grid |
| Users / Account management | `/users` | admin-only: list, create, edit role/status, deactivate |

### Planned admin pages ⬜ (APIs partly exist)
| Page | Phase | Notes |
|------|-------|-------|
| Report cards / printable mark sheets | B/C | PDF generation on top of the exams data |
| Academic years & terms/semesters | A/B | year + term/semester setup |
| Departments / Courses (college) | B | college-mode setup |
| Timetable builder | B | drag-grid, conflict warnings |
| Homework | C | assign + track submissions |
| Communication center | C | circulars, email/SMS/push campaigns, messaging |
| Library | D | catalogue, issue/return, fines |
| Transport | D | vehicles, routes, allocations |
| Hostel | D | hostels, rooms, allocations |
| Inventory | D | items, purchases, issues, vendors |
| Payroll | D | salary structures, runs, payslips |
| Reports center | C/D | cross-module reports, export/print, custom builder |
| Settings | A | institution settings, branding |

## 2. Super Admin console ⬜ (Phase A)
| Page | Notes |
|------|-------|
| Institutions | create/manage institutions |
| Branches / campuses | per-institution branches |
| Subscription packages | package + limits management |
| Global users & roles | cross-tenant user/role admin |
| System settings | global configuration |
| Backup & restore | trigger/list/restore backups |
| Global audit logs | searchable audit trail |

## 3. Parent portal ⬜ (Phase C)
Child attendance · homework · exam marks · fee status & payment · notices ·
teacher communication · transport tracking (if available). Web + mobile.

## 4. Student portal ⬜ (Phase C)
Profile · timetable · attendance · homework/assignments · exam results · fee
details · notices · study materials. Web + mobile.

## 5. Mobile app (Flutter) — `mobile/lib/screens`
| Screen | Status |
|--------|--------|
| Login | ✅ |
| Home shell (nav) | ✅ |
| Dashboard | ✅ |
| Announcements / notices | ✅ |
| Profile | ✅ |
| Attendance / results / fees (student & parent) | ⬜ (Phase C) |
| Homework | ⬜ (Phase C) |
| Push notifications (FCM) | 🟡 token obtained; backend registration pending |

> Mobile is read-only v0.1 and unverified (no SDK at build time) — expect minor
> fixes on first `flutter analyze`/run (handover §2).

## 6. Shared UI primitives (`frontend/src/components/ui.tsx`) ✅
Button, Modal, Field/Input, Select, Table, Card, Badge, Toast, etc. Extend here
(don't reinvent) so the soft-3D look stays consistent. New pages should copy the
**students page** structure: page header + filters/search + table + create/edit
modal with React Hook Form + zod.
