// PR-SEC1 — Teacher own-class row scoping.
//
// A "scoped" staff member (the coarse `teacher` role, or any job-role without
// the broad-view `academics:all_sections` permission) may only read/write rows
// for students and sections they personally own. Ownership is the union of:
//   • sections they are the homeroom/class teacher of (sections.homeroom_teacher_id),
//   • subjects they are assigned to teach in a section (class_subjects.teacher_id),
//   • sections they are timetabled to teach (timetable_entries.teacher_id).
//
// The whole feature sits behind the ENFORCE_TEACHER_SCOPE kill-switch (OFF by
// default) and applies to SCHOOL institutions only — college row scoping (via
// staff_allocations → department/program/subject) is a documented fast-follow
// before multi-teacher college exposure. Admins, principals, coordinators and
// exam controllers hold `academics:all_sections` and are never scoped;
// super_admin (platform) always bypasses.

import type { Request } from "express";
import { query } from "../db/postgres";
import { ApiError } from "./api-error";
import { env } from "../config/env";
import { getInstitutionType } from "../middleware/institution-type";
import { userHasPermission } from "../middleware/permissions";
import { recordAudit } from "../modules/observability/audit";

/** The broad-view bypass permission — a holder is exempt from row scoping. */
export const ALL_SECTIONS_PERMISSION = "academics:all_sections";

export interface TeacherScope {
  /**
   * When true, no row scoping applies (kill-switch off, super_admin, no tenant
   * context, a non-school institution, or the caller holds the broad-view
   * permission). When false, `sectionIds` is the exhaustive set of sections the
   * caller owns — possibly empty, meaning they own nothing.
   */
  unrestricted: boolean;
  sectionIds: string[];
}

const UNRESTRICTED: TeacherScope = { unrestricted: true, sectionIds: [] };

/**
 * Resolve the caller's own-class teaching scope for school-mode row scoping.
 * Cheap and safe to call on every guarded request: it short-circuits to
 * `unrestricted` before touching teacher tables for the common broad-view case.
 */
export async function resolveTeacherScope(req: Request): Promise<TeacherScope> {
  if (!env.enforceTeacherScope) return UNRESTRICTED; // kill-switch OFF → no-op
  if (!req.user) throw ApiError.unauthorized();
  if (req.user.role === "super_admin") return UNRESTRICTED; // platform bypass
  // Only the coarse teaching role is ever row-scoped. admin/accountant are broad
  // staff, and student/parent are governed by their own record-level scoping
  // (accessibleStudentIds) — none of them are "own-nothing teachers" here.
  if (req.user.role !== "teacher") return UNRESTRICTED;
  const institutionId = req.user.institutionId;
  if (!institutionId) return UNRESTRICTED; // no tenant context to scope within
  // College row scoping is a deliberate fast-follow; only school is enforced.
  if ((await getInstitutionType(institutionId)) !== "school") return UNRESTRICTED;
  // A promoted teacher (principal/coordinator/exam-controller job-role) carrying
  // the broad-view permission bypasses; a plain subject/class teacher does not.
  if (await userHasPermission(req.user, ALL_SECTIONS_PERMISSION)) return UNRESTRICTED;

  // A scoped staff member: resolve the teacher record linked to this login and
  // the sections they own. No linked teacher row ⇒ they own nothing.
  const { rows: teacherRows } = await query<{ id: string }>(
    "SELECT id FROM teachers WHERE user_id = $1 AND institution_id = $2",
    [req.user.id, institutionId]
  );
  const teacherId = teacherRows[0]?.id;
  if (!teacherId) return { unrestricted: false, sectionIds: [] };

  const { rows } = await query<{ section_id: string }>(
    `SELECT DISTINCT section_id FROM (
       SELECT id AS section_id FROM sections
         WHERE institution_id = $1 AND homeroom_teacher_id = $2
       UNION
       SELECT section_id FROM class_subjects
         WHERE institution_id = $1 AND teacher_id = $2
       UNION
       SELECT section_id FROM timetable_entries
         WHERE institution_id = $1 AND teacher_id = $2
     ) owned
     WHERE section_id IS NOT NULL`,
    [institutionId, teacherId]
  );
  return { unrestricted: false, sectionIds: rows.map((r) => r.section_id) };
}

/** The owned-section filter for read queries, or `null` when unrestricted. */
export function scopedSectionIds(scope: TeacherScope): string[] | null {
  return scope.unrestricted ? null : scope.sectionIds;
}

const actorOf = (req: Request) => ({
  id: req.user?.id ?? null,
  email: req.user?.email ?? "unknown",
  role: req.user?.role ?? "unknown",
  ip: req.ip ?? null,
});

/** Best-effort durable audit row for a cross-scope denial (never throws). */
async function auditDenial(req: Request, detail: Record<string, unknown>): Promise<void> {
  try {
    await recordAudit(actorOf(req), {
      action: "teacher_scope.denied",
      targetType: "teacher_scope",
      targetId: null,
      institutionId: req.user?.institutionId ?? null,
      detail,
    });
  } catch (err) {
    console.error("teacher-scope audit failed:", err);
  }
}

/**
 * Assert the caller may act on every one of `studentIds` — each must belong to
 * a section the caller owns. Throws 403 (and audits) otherwise. No-op when the
 * scope is unrestricted. Used by the bulk write paths (attendance, period
 * attendance, exam marks).
 */
export async function assertStudentsInTeacherScope(
  req: Request,
  scope: TeacherScope,
  studentIds: string[],
  action: string,
  institutionId: string
): Promise<void> {
  if (scope.unrestricted) return;
  const ids = [...new Set(studentIds)];
  if (ids.length === 0) return;
  // Count how many of the requested students sit in an owned section. An empty
  // owned set makes the ANY($3) match nothing, so any student trips the guard.
  const { rows } = await query<{ id: string }>(
    `SELECT id FROM students
     WHERE institution_id = $1 AND id = ANY($2::uuid[])
       AND section_id = ANY($3::uuid[])`,
    [institutionId, ids, scope.sectionIds]
  );
  if (rows.length !== ids.length) {
    await auditDenial(req, {
      action,
      attemptedStudents: ids.length,
      inScope: rows.length,
      ownedSections: scope.sectionIds.length,
    });
    throw ApiError.forbidden("You can only manage students in your own classes");
  }
}

/**
 * Assert the caller owns `sectionId`. Throws 403 (and audits) otherwise. No-op
 * when unrestricted or `sectionId` is null/undefined (nothing to check).
 */
export async function assertSectionInTeacherScope(
  req: Request,
  scope: TeacherScope,
  sectionId: string | null | undefined,
  action: string
): Promise<void> {
  if (scope.unrestricted || !sectionId) return;
  if (!scope.sectionIds.includes(sectionId)) {
    await auditDenial(req, { action, attemptedSection: sectionId });
    throw ApiError.forbidden("You can only access your own classes");
  }
}
