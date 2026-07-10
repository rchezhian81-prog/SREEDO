import { z } from "zod";

// PR-T9 — Student Leave Management. Application-only (no balances). On approval
// the service marks the student 'excused' in daily attendance for the range.

export const STUDENT_LEAVE_TYPES = ["sick", "casual", "emergency", "other"] as const;
export const STUDENT_LEAVE_STATUSES = ["pending", "approved", "rejected", "cancelled"] as const;

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD");

export const createLeaveSchema = z
  .object({
    studentId: z.string().uuid(),
    type: z.enum(STUDENT_LEAVE_TYPES).optional(),
    fromDate: dateStr,
    toDate: dateStr,
    reason: z.string().max(2000).optional(),
  })
  .refine((v) => v.fromDate <= v.toDate, {
    message: "fromDate must be on or before toDate",
    path: ["toDate"],
  });

export const reviewLeaveSchema = z.object({
  reviewNote: z.string().max(2000).optional(),
});

export const listLeaveQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().optional(),
  status: z.enum(STUDENT_LEAVE_STATUSES).optional(),
  studentId: z.string().uuid().optional(),
});
