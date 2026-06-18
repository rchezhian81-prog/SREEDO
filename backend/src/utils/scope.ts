import type { Request } from "express";
import { ApiError } from "./api-error";
import type { UserRole } from "../types";
import {
  childStudentIdsForUser,
  studentIdForUser,
} from "../modules/students/students.service";

// Staff roles see all records; student/parent are scoped to their own data.
// This is the foundation for issuing student/parent logins (see
// docs/DEVELOPER_HANDOVER.md §8 and docs/ROLES_AND_PERMISSIONS.md).
const STAFF_ROLES: ReadonlyArray<UserRole> = ["admin", "teacher", "accountant"];

export function isStaff(role: UserRole): boolean {
  return STAFF_ROLES.includes(role);
}

/** Throws 403 unless the requester holds a staff role. */
export function requireStaff(req: Request): void {
  if (!req.user) throw ApiError.unauthorized();
  if (!isStaff(req.user.role)) throw ApiError.forbidden();
}

/**
 * The set of student ids the requester may read, or `null` when unrestricted
 * (staff). Used to scope list/detail queries.
 *
 * - staff   → `null` (no scoping)
 * - student → their own linked student id, or `[]` when no record is linked
 * - parent  → the ids of their linked children (guardians table)
 */
export async function accessibleStudentIds(
  req: Request
): Promise<string[] | null> {
  if (!req.user) throw ApiError.unauthorized();
  if (isStaff(req.user.role)) return null;
  if (req.user.role === "student") {
    const id = await studentIdForUser(req.user.id);
    return id ? [id] : [];
  }
  if (req.user.role === "parent") {
    if (!req.user.institutionId) return [];
    return childStudentIdsForUser(req.user.id, req.user.institutionId);
  }
  return [];
}

/** Allows access when unrestricted (`null`) or the id is in the allowed set. */
export function assertStudentAccess(
  allowed: string[] | null,
  studentId: string
): void {
  if (allowed === null) return;
  if (!allowed.includes(studentId)) throw ApiError.forbidden();
}
