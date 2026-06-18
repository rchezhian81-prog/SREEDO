import { z } from "zod";

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const time = z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/);
const month = z.string().regex(/^\d{4}-\d{2}$/);

const attendanceStatus = z.enum(["present", "absent", "half_day", "leave", "holiday"]);

const attendanceEntrySchema = z.object({
  teacherId: z.string().uuid(),
  status: attendanceStatus,
  checkIn: time.nullish(),
  checkOut: time.nullish(),
  late: z.boolean().optional(),
  earlyOut: z.boolean().optional(),
  remarks: z.string().max(300).nullish(),
});

// Bulk upsert for one date.
export const markAttendanceSchema = z.object({
  date,
  entries: z.array(attendanceEntrySchema).min(1),
});

export const updateAttendanceSchema = z.object({
  status: attendanceStatus.optional(),
  checkIn: time.nullish(),
  checkOut: time.nullish(),
  late: z.boolean().optional(),
  earlyOut: z.boolean().optional(),
  remarks: z.string().max(300).nullish(),
});

export const listAttendanceQuerySchema = z.object({
  date: date.optional(),
  teacherId: z.string().uuid().optional(),
  month: month.optional(),
});

export const summaryQuerySchema = z.object({
  month,
  teacherId: z.string().uuid().optional(),
});

export const createLeaveTypeSchema = z.object({
  name: z.string().min(1).max(120),
  code: z.string().min(1).max(40),
  isPaid: z.boolean().optional(),
  defaultBalance: z.coerce.number().min(0).max(100000).optional(),
});
export const updateLeaveTypeSchema = createLeaveTypeSchema.partial();

export const setBalanceSchema = z.object({
  teacherId: z.string().uuid(),
  leaveTypeId: z.string().uuid(),
  balance: z.coerce.number().min(0).max(100000),
});

export const createLeaveRequestSchema = z.object({
  // Optional: only honoured for approvers acting on behalf of staff; a regular
  // staff member always requests for themselves.
  teacherId: z.string().uuid().optional(),
  leaveTypeId: z.string().uuid(),
  startDate: date,
  endDate: date,
  reason: z.string().max(500).nullish(),
});

export const decideLeaveSchema = z.object({
  note: z.string().max(300).nullish(),
});
