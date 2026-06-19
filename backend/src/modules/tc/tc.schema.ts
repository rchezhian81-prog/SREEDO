import { z } from "zod";

export const createTcSchema = z.object({
  studentId: z.string().uuid(),
  leavingReason: z.string().max(500).nullable().optional(),
  conduct: z.string().max(300).nullable().optional(),
  academicYear: z.string().max(40).nullable().optional(),
  lastAttendanceDate: z.string().date().nullable().optional(),
  remarks: z.string().max(1000).nullable().optional(),
});

export const updateTcSchema = z.object({
  leavingReason: z.string().max(500).nullable().optional(),
  conduct: z.string().max(300).nullable().optional(),
  academicYear: z.string().max(40).nullable().optional(),
  lastAttendanceDate: z.string().date().nullable().optional(),
  dateOfIssue: z.string().date().nullable().optional(),
  remarks: z.string().max(1000).nullable().optional(),
});

export const issueTcSchema = z.object({
  dateOfIssue: z.string().date().optional(),
  lastAttendanceDate: z.string().date().nullable().optional(),
  overrideDues: z.boolean().optional(),
  overrideReason: z.string().max(500).optional(),
  markTransferred: z.boolean().optional(),
});

export const cancelTcSchema = z.object({
  reason: z.string().max(500).optional(),
});

export const listTcQuerySchema = z.object({
  status: z.enum(["draft", "issued", "cancelled"]).optional(),
  studentId: z.string().uuid().optional(),
  search: z.string().max(100).optional(),
});
