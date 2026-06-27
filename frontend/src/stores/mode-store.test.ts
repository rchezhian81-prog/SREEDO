// @vitest-environment jsdom
import { beforeEach, describe, it, expect } from "vitest";
import { useModeStore } from "@/stores/mode-store";

describe("campus mode store", () => {
  beforeEach(() => {
    useModeStore.getState().reset();
    localStorage.clear();
  });

  it("defaults to school and not yet chosen", () => {
    const s = useModeStore.getState();
    expect(s.mode).toBe("school");
    expect(s.hasChosen).toBe(false);
  });

  it("setMode switches the campus and marks it chosen", () => {
    useModeStore.getState().setMode("college");
    expect(useModeStore.getState().mode).toBe("college");
    expect(useModeStore.getState().hasChosen).toBe(true);
  });

  it("reset returns to the school default", () => {
    useModeStore.getState().setMode("college");
    useModeStore.getState().reset();
    expect(useModeStore.getState().mode).toBe("school");
    expect(useModeStore.getState().hasChosen).toBe(false);
  });
});
