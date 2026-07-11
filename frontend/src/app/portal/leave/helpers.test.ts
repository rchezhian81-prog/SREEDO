import { describe, it, expect } from "vitest";
import { canCancel, dateRangeValid, statusTone, typeLabel } from "./helpers";

describe("canCancel", () => {
  it("allows cancelling my own pending request", () => {
    expect(canCancel({ status: "pending", appliedBy: "u1" }, "u1")).toBe(true);
  });

  it("blocks non-pending requests even when mine", () => {
    expect(canCancel({ status: "approved", appliedBy: "u1" }, "u1")).toBe(false);
    expect(canCancel({ status: "rejected", appliedBy: "u1" }, "u1")).toBe(false);
    expect(canCancel({ status: "cancelled", appliedBy: "u1" }, "u1")).toBe(false);
  });

  it("blocks requests filed by someone else (e.g. staff on behalf)", () => {
    expect(canCancel({ status: "pending", appliedBy: "staff-1" }, "u1")).toBe(false);
    expect(canCancel({ status: "pending", appliedBy: null }, "u1")).toBe(false);
  });

  it("is false without a signed-in user id", () => {
    expect(canCancel({ status: "pending", appliedBy: "u1" }, null)).toBe(false);
    expect(canCancel({ status: "pending", appliedBy: "u1" }, undefined)).toBe(false);
  });
});

describe("statusTone", () => {
  it("maps every status to its badge tone", () => {
    expect(statusTone("pending")).toBe("amber");
    expect(statusTone("approved")).toBe("green");
    expect(statusTone("rejected")).toBe("red");
    expect(statusTone("cancelled")).toBe("slate");
  });
});

describe("dateRangeValid", () => {
  it("accepts a same-day range and an ordered range", () => {
    expect(dateRangeValid("2026-08-01", "2026-08-01")).toBe(true);
    expect(dateRangeValid("2026-08-01", "2026-08-03")).toBe(true);
  });

  it("rejects a reversed range and missing dates", () => {
    expect(dateRangeValid("2026-08-03", "2026-08-01")).toBe(false);
    expect(dateRangeValid("", "2026-08-01")).toBe(false);
    expect(dateRangeValid("2026-08-01", "")).toBe(false);
  });
});

describe("typeLabel", () => {
  it("labels known types and falls back to Other for null", () => {
    expect(typeLabel("sick")).toBe("Sick");
    expect(typeLabel("emergency")).toBe("Emergency");
    expect(typeLabel(null)).toBe("Other");
  });
});
