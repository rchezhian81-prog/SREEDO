import { describe, expect, it } from "vitest";
import { paginatedResponse, parsePagination } from "./pagination";

describe("parsePagination", () => {
  it("defaults to page 1, limit 20", () => {
    expect(parsePagination({})).toEqual({ page: 1, limit: 20, offset: 0 });
  });

  it("computes the offset", () => {
    expect(parsePagination({ page: 3, limit: 10 })).toEqual({
      page: 3,
      limit: 10,
      offset: 20,
    });
  });

  it("caps the limit at 100 and floors invalid pages", () => {
    const result = parsePagination({ page: -5, limit: 9999 });
    expect(result.page).toBe(1);
    expect(result.limit).toBe(100);
  });
});

describe("paginatedResponse", () => {
  it("includes totals and page count", () => {
    const result = paginatedResponse([1, 2], 42, {
      page: 2,
      limit: 2,
      offset: 2,
    });
    expect(result.meta).toEqual({ page: 2, limit: 2, total: 42, totalPages: 21 });
    expect(result.data).toEqual([1, 2]);
  });
});
