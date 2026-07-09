import { z } from "zod";

// PR-T8 — PTM / Parent Meetings. audience_type mirrors communication.resolveAudience
// so invites reuse that surface verbatim (school: section/class; college: semester/batch).

export const PTM_AUDIENCE_TYPES = ["all_parents", "section", "class", "semester", "batch"] as const;
export const PTM_MODES = ["in_person", "online"] as const;
export const PTM_STATUSES = ["draft", "scheduled", "completed", "cancelled"] as const;
export const PTM_BOOKING_STATUSES = ["booked", "attended", "no_show", "cancelled"] as const;

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD");
// datetime-local value ("YYYY-MM-DDTHH:MM"), optionally with seconds / zone.
const dateTimeStr = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/, "Expected an ISO date-time");

export const createMeetingSchema = z
  .object({
    title: z.string().min(1).max(200),
    description: z.string().max(4000).optional(),
    meetingDate: dateStr,
    venue: z.string().max(200).optional(),
    mode: z.enum(PTM_MODES).optional(),
    joinLink: z.string().max(500).optional(),
    audienceType: z.enum(PTM_AUDIENCE_TYPES).optional(),
    audienceRef: z.string().uuid().optional(),
  })
  .refine((v) => v.audienceType === undefined || v.audienceType === "all_parents" || !!v.audienceRef, {
    message: "audienceRef is required for a section/class/semester/batch audience",
    path: ["audienceRef"],
  });

export const updateMeetingSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(4000).optional(),
  meetingDate: dateStr.optional(),
  venue: z.string().max(200).optional(),
  mode: z.enum(PTM_MODES).optional(),
  joinLink: z.string().max(500).optional(),
  status: z.enum(PTM_STATUSES).optional(),
});

export const listMeetingsQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().optional(),
  status: z.enum(PTM_STATUSES).optional(),
});

// Generate one or more slots for a teacher across a window. slotMinutes < window
// splits it into consecutive slots; omit (or >= window) for a single slot.
export const generateSlotsSchema = z.object({
  teacherId: z.string().uuid(),
  startsAt: dateTimeStr,
  endsAt: dateTimeStr,
  slotMinutes: z.coerce.number().int().positive().max(600).optional(),
  capacity: z.coerce.number().int().positive().max(100).optional(),
});

export const bookingSchema = z.object({
  slotId: z.string().uuid(),
  studentId: z.string().uuid(),
});

export const updateBookingSchema = z.object({
  status: z.enum(PTM_BOOKING_STATUSES).optional(),
  notes: z.string().max(4000).optional(),
});

export const inviteSchema = z.object({
  subject: z.string().max(200).optional(),
  message: z.string().max(4000).optional(),
});
