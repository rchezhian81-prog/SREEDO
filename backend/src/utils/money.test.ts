import { describe, expect, it } from "vitest";
import { allocate, percentOf, prorate, sumPaise, toPaise, toRupees } from "./money";

describe("toPaise", () => {
  it("parses NUMERIC strings from pg", () => {
    expect(toPaise("12.50")).toBe(1250);
    expect(toPaise("100.00")).toBe(10000);
    expect(toPaise("0.01")).toBe(1);
  });

  it("parses JS numbers from the API", () => {
    expect(toPaise(12.5)).toBe(1250);
    expect(toPaise(0)).toBe(0);
  });

  it("eliminates classic float drift", () => {
    // 0.1 + 0.2 === 0.30000000000000004 as floats, but exact in paise.
    expect(toPaise(0.1) + toPaise(0.2)).toBe(toPaise(0.3));
    expect(toPaise(0.1) + toPaise(0.2)).toBe(30);
  });

  it("collapses tiny float errors from prior arithmetic to the nearest paisa", () => {
    expect(toPaise(0.1 * 3)).toBe(30); // 0.1*3 === 0.30000000000000004
    expect(toPaise(19.99 + 0.01)).toBe(2000); // === 20.000000000000004
    expect(toPaise(35.6)).toBe(3560); // 35.6*100 is not exactly 3560 as a float
  });

  it("throws on non-finite input rather than yielding NaN", () => {
    expect(() => toPaise("abc")).toThrow(/Invalid money/);
    expect(() => toPaise(Number.NaN)).toThrow(/Invalid money/);
    expect(() => toPaise(Infinity)).toThrow(/Invalid money/);
  });
});

describe("toRupees", () => {
  it("round-trips with toPaise", () => {
    for (const v of ["0.00", "0.01", "999999.99", "12.34"]) {
      expect(toRupees(toPaise(v))).toBe(Number(v));
    }
  });

  it("returns a value safe for NUMERIC(12,2) storage", () => {
    expect(toRupees(1250)).toBe(12.5);
    expect(toRupees(1)).toBe(0.01);
  });
});

describe("sumPaise", () => {
  it("sums mixed strings and numbers exactly", () => {
    expect(sumPaise(["10.10", "20.20", 0.7])).toBe(3100);
  });

  it("is exact where float addition would drift", () => {
    expect(sumPaise([0.1, 0.2, 0.3, 0.4])).toBe(100);
  });
});

describe("percentOf", () => {
  it("computes a clean percentage", () => {
    expect(percentOf(toPaise(10000), 5)).toBe(toPaise(500));
  });

  it("rounds the fractional paisa", () => {
    // 33% of 10.10 = 3.333 -> 3.33
    expect(percentOf(toPaise(10.1), 33)).toBe(333);
  });
});

describe("prorate", () => {
  it("prorates per-day amounts", () => {
    // 22000 over 23 days, 1 day = 956.5217... -> 956.52
    expect(prorate(toPaise(22000), 1, 23)).toBe(95652);
  });

  it("returns 0 for a non-positive whole", () => {
    expect(prorate(toPaise(22000), 1, 0)).toBe(0);
    expect(prorate(toPaise(22000), 1, -5)).toBe(0);
  });
});

describe("allocate", () => {
  it("splits evenly and conserves every paisa", () => {
    const parts = allocate(10000, [1, 1, 1]);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(10000);
    expect(parts).toEqual([3334, 3333, 3333]);
  });

  it("respects weights", () => {
    expect(allocate(10000, [3, 1])).toEqual([7500, 2500]);
  });

  it("distributes the remainder by largest fraction and always sums to total", () => {
    const parts = allocate(1001, [1, 1]);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(1001);
    expect(parts).toEqual([501, 500]);
  });

  it("never creates or loses a paisa across awkward splits", () => {
    for (const total of [1, 7, 100, 333, 99999]) {
      const parts = allocate(total, [2, 3, 5, 7]);
      expect(parts.reduce((a, b) => a + b, 0)).toBe(total);
    }
  });

  it("returns zeros when weights sum to zero", () => {
    expect(allocate(5000, [0, 0])).toEqual([0, 0]);
  });
});
