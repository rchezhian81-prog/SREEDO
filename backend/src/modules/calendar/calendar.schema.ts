import { z } from "zod";

export const EVENT_TYPES = ["holiday", "event", "exam", "meeting", "other"] as const;

export const createEventSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  eventDate: z.string().date(),
  endDate: z.string().date().optional(),
  type: z.enum(EVENT_TYPES).optional(),
  allDay: z.coerce.boolean().optional(),
});

export const updateEventSchema = createEventSchema.partial();

export const listEventsQuerySchema = z.object({
  type: z.enum(EVENT_TYPES).optional(),
  dateFrom: z.string().date().optional(),
  dateTo: z.string().date().optional(),
});
