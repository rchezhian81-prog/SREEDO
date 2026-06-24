import { z } from "zod";

export const RESERVATION_STATUSES = ["pending", "fulfilled", "cancelled", "expired"] as const;

export const listReservationsQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().optional(),
  status: z.enum(RESERVATION_STATUSES).optional(),
  search: z.string().max(200).optional(),
});

// Admin resolves a pending reservation.
export const updateReservationSchema = z.object({
  status: z.enum(["fulfilled", "cancelled"]),
});

// A student reserves a book (via the portal).
export const createReservationSchema = z.object({
  bookId: z.string().uuid(),
  notes: z.string().max(500).optional(),
});

export const listAvailableBooksQuerySchema = z.object({
  search: z.string().max(200).optional(),
});
