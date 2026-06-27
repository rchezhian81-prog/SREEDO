import { z } from "zod";

const time = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM (24h)");

export const createPeriodSchema = z.object({
  name: z.string().min(1).max(60),
  startTime: time,
  endTime: time,
  sortOrder: z.coerce.number().int().min(0).max(100).optional(),
  isBreak: z.boolean().optional(),
});

export const updatePeriodSchema = createPeriodSchema.partial();

export const createRoomSchema = z.object({
  name: z.string().min(1).max(80),
  code: z.string().min(1).max(40),
  capacity: z.coerce.number().int().min(0).max(10000).optional(),
  building: z.string().max(80).optional(),
});

export const updateRoomSchema = createRoomSchema.partial();

export const createEntrySchema = z.object({
  sectionId: z.string().uuid(),
  dayOfWeek: z.coerce.number().int().min(1).max(7),
  periodId: z.string().uuid(),
  subjectId: z.string().uuid(),
  teacherId: z.string().uuid().nullish(),
  roomId: z.string().uuid().nullish(),
});

export const updateEntrySchema = createEntrySchema.partial();

export const listEntriesQuerySchema = z.object({
  sectionId: z.string().uuid().optional(),
  teacherId: z.string().uuid().optional(),
  roomId: z.string().uuid().optional(),
  dayOfWeek: z.coerce.number().int().min(1).max(7).optional(),
});

export const exportQuerySchema = z.object({
  sectionId: z.string().uuid().optional(),
  teacherId: z.string().uuid().optional(),
});
