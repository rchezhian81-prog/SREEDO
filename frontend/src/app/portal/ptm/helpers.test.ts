import { describe, it, expect } from "vitest";
import {
  slotsLeft,
  isSlotBookable,
  activeBookingsFor,
  hasActiveBooking,
} from "./helpers";
import type { PortalPtmBooking } from "@/types";

const booking = (over: Partial<PortalPtmBooking>): PortalPtmBooking => ({
  id: "b1",
  meetingId: "m1",
  slotId: "s1",
  studentId: "st1",
  studentName: "Asha Rao",
  status: "booked",
  startsAt: "2026-08-01T09:00:00.000Z",
  endsAt: "2026-08-01T09:15:00.000Z",
  ...over,
});

describe("slotsLeft", () => {
  it("subtracts booked (string from Postgres count) from capacity", () => {
    expect(slotsLeft({ capacity: 3, booked: "2" })).toBe(1);
    expect(slotsLeft({ capacity: 1, booked: 0 })).toBe(1);
  });

  it("clamps at zero when full or over-booked", () => {
    expect(slotsLeft({ capacity: 1, booked: "1" })).toBe(0);
    expect(slotsLeft({ capacity: 1, booked: "2" })).toBe(0);
  });
});

describe("isSlotBookable", () => {
  it("is true only for an open slot with free capacity", () => {
    expect(isSlotBookable({ status: "open", capacity: 2, booked: "1" })).toBe(true);
  });

  it("is false when the slot is full", () => {
    expect(isSlotBookable({ status: "open", capacity: 1, booked: "1" })).toBe(false);
  });

  it("is false when the slot is not open, even with capacity", () => {
    expect(isSlotBookable({ status: "closed", capacity: 5, booked: "0" })).toBe(false);
  });
});

describe("activeBookingsFor / hasActiveBooking", () => {
  const bookings: PortalPtmBooking[] = [
    booking({ id: "b1", meetingId: "m1", studentId: "st1", status: "booked" }),
    booking({ id: "b2", meetingId: "m1", studentId: "st2", status: "attended" }),
    booking({ id: "b3", meetingId: "m2", studentId: "st1", status: "booked" }),
    booking({ id: "b4", meetingId: "m1", studentId: "st3", status: "cancelled" }),
  ];

  it("returns only this meeting's non-cancelled bookings", () => {
    expect(activeBookingsFor(bookings, "m1").map((b) => b.id)).toEqual(["b1", "b2"]);
  });

  it("counts attended/no_show as active (server blocks a second booking)", () => {
    expect(hasActiveBooking(bookings, "m1", "st2")).toBe(true);
  });

  it("ignores bookings for other meetings and cancelled ones", () => {
    expect(hasActiveBooking(bookings, "m2", "st2")).toBe(false);
    expect(hasActiveBooking(bookings, "m1", "st3")).toBe(false);
  });

  it("is false for a child with no bookings at all", () => {
    expect(hasActiveBooking(bookings, "m1", "st-none")).toBe(false);
  });
});
