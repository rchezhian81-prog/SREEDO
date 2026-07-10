import type { PortalPtmBooking, PortalPtmSlot } from "@/types";

/** Seats still free on a slot (Postgres count() arrives as a string). */
export function slotsLeft(slot: Pick<PortalPtmSlot, "capacity" | "booked">): number {
  return Math.max(0, slot.capacity - Number(slot.booked));
}

/** A slot can be booked only while it is open and has free capacity. */
export function isSlotBookable(
  slot: Pick<PortalPtmSlot, "status" | "capacity" | "booked">
): boolean {
  return slot.status === "open" && slotsLeft(slot) > 0;
}

/**
 * The caller's active bookings for one meeting. GET /ptm/my already excludes
 * cancelled bookings, but filter defensively so a stale row can't block the UI.
 */
export function activeBookingsFor(
  bookings: PortalPtmBooking[],
  meetingId: string
): PortalPtmBooking[] {
  return bookings.filter(
    (b) => b.meetingId === meetingId && b.status !== "cancelled"
  );
}

/**
 * Whether a child already holds an active booking for a meeting — the server
 * enforces one active booking per student per meeting, so booking again would
 * be rejected; the UI uses this to explain that upfront.
 */
export function hasActiveBooking(
  bookings: PortalPtmBooking[],
  meetingId: string,
  studentId: string
): boolean {
  return activeBookingsFor(bookings, meetingId).some(
    (b) => b.studentId === studentId
  );
}
