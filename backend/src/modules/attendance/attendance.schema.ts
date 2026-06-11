import { z } from "zod";

const attendanceStatus = z.enum(["present", "absent", "late", "excused"]);

export const bulkMarkAttendanceSchema = z.object({
  date: z.string().date(),
  records: z
    .array(
      z.object({
        studentId: z.string().uuid(),
        status: attendanceStatus,
        remarks: z.string().max(500).optional(),
      })
    )
    .min(1)
    .max(500),
});

export const attendanceQuerySchema = z.object({
  sectionId: z.string().uuid().optional(),
  date: z.string().date().optional(),
});

export const studentAttendanceQuerySchema = z.object({
  from: z.string().date().optional(),
  to: z.string().date().optional(),
});
