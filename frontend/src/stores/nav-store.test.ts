import { describe, it, expect } from "vitest";
import { MAX_PINS, MAX_RECENTS, pushRecentList, togglePinList } from "./nav-store";

describe("togglePinList", () => {
  it("adds and removes an href", () => {
    expect(togglePinList([], "/fees")).toEqual(["/fees"]);
    expect(togglePinList(["/fees"], "/fees")).toEqual([]);
  });

  it("caps pins at MAX_PINS — adding beyond is a no-op", () => {
    const full = Array.from({ length: MAX_PINS }, (_, i) => `/p${i}`);
    expect(togglePinList(full, "/extra")).toEqual(full);
    // …but unpinning from a full list still works.
    expect(togglePinList(full, "/p0")).toHaveLength(MAX_PINS - 1);
  });
});

describe("pushRecentList", () => {
  it("prepends, dedupes, and caps at MAX_RECENTS", () => {
    let r: string[] = [];
    for (const h of ["/a", "/b", "/c", "/b", "/d", "/e", "/f"]) r = pushRecentList(r, h);
    expect(r).toHaveLength(MAX_RECENTS);
    expect(r[0]).toBe("/f");
    expect(new Set(r).size).toBe(r.length);
    expect(r).not.toContain("/a"); // oldest evicted
  });
});
