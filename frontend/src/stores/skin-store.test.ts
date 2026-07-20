// @vitest-environment jsdom
import { beforeEach, describe, it, expect, vi } from "vitest";
import { useSkinStore, resolveSkin } from "@/stores/skin-store";
import { UI_V2_CLASS } from "@/lib/ui-flag";
import { THEME_STORAGE_KEY } from "@/stores/theme-store";

// PR-UI2 — the modern-skin runtime engine. These tests pin the DOM side-effect
// (the `.ui-v2` scope class on <html>), the `resolved` render-gate latch, the
// failure-safe orchestration (success / disabled / error / timeout / late
// success), and the eligible-only light default. All of it is inert unless the
// build master switch AND the tenant flag agree — that gate is exercised in
// skin-engine.test.tsx; here we drive the engine directly.

const hasSkin = () => document.documentElement.classList.contains(UI_V2_CLASS);
const isDark = () => document.documentElement.classList.contains("dark");

beforeEach(() => {
  useSkinStore.setState({ resolved: false, active: false });
  document.documentElement.className = "";
  localStorage.clear();
  vi.useRealTimers();
});

describe("skin store — direct apply / legacy", () => {
  it("apply(true) adds the scope class and latches resolved+active", () => {
    useSkinStore.getState().apply(true);
    expect(hasSkin()).toBe(true);
    expect(useSkinStore.getState().active).toBe(true);
    expect(useSkinStore.getState().resolved).toBe(true);
  });

  it("apply(false) leaves the scope class off and latches resolved", () => {
    useSkinStore.getState().apply(false);
    expect(hasSkin()).toBe(false);
    expect(useSkinStore.getState().active).toBe(false);
    expect(useSkinStore.getState().resolved).toBe(true);
  });

  it("resolveLegacy clears the scope class and latches resolved", () => {
    document.documentElement.classList.add(UI_V2_CLASS);
    useSkinStore.getState().resolveLegacy();
    expect(hasSkin()).toBe(false);
    expect(useSkinStore.getState().active).toBe(false);
    expect(useSkinStore.getState().resolved).toBe(true);
  });
});

describe("skin store — eligible-only light default", () => {
  it("opens light (drops .dark) when the session is eligible and no theme is saved", () => {
    document.documentElement.classList.add("dark");
    localStorage.removeItem(THEME_STORAGE_KEY);
    useSkinStore.getState().apply(true);
    expect(isDark()).toBe(false);
    expect(hasSkin()).toBe(true);
  });

  it("respects an explicit saved dark theme even when eligible", () => {
    document.documentElement.classList.add("dark");
    localStorage.setItem(THEME_STORAGE_KEY, "dark");
    useSkinStore.getState().apply(true);
    expect(isDark()).toBe(true);
  });

  it("respects an explicit saved light theme (no-op on .dark)", () => {
    localStorage.setItem(THEME_STORAGE_KEY, "light");
    useSkinStore.getState().apply(true);
    expect(isDark()).toBe(false);
  });

  it("never touches .dark when the session resolves to legacy (not eligible)", () => {
    document.documentElement.classList.add("dark");
    localStorage.removeItem(THEME_STORAGE_KEY);
    useSkinStore.getState().apply(false);
    expect(isDark()).toBe(true); // legacy theme resolution is untouched
  });
});

describe("resolveSkin — failure-safe orchestration", () => {
  it("applies the modern skin when the tenant flag is enabled", async () => {
    await resolveSkin({ fetchTenantEnabled: async () => true });
    expect(hasSkin()).toBe(true);
    expect(useSkinStore.getState().resolved).toBe(true);
  });

  it("resolves to legacy when the tenant flag is disabled", async () => {
    await resolveSkin({ fetchTenantEnabled: async () => false });
    expect(hasSkin()).toBe(false);
    expect(useSkinStore.getState().resolved).toBe(true);
  });

  it("fails safe to legacy when the tenant lookup throws", async () => {
    await resolveSkin({
      fetchTenantEnabled: async () => {
        throw new Error("network");
      },
    });
    expect(hasSkin()).toBe(false);
    expect(useSkinStore.getState().resolved).toBe(true);
  });

  it("falls back to legacy when the tenant lookup times out", () => {
    vi.useFakeTimers();
    void resolveSkin({
      fetchTenantEnabled: () => new Promise<boolean>(() => {}), // never resolves
      timeoutMs: 4000,
    });
    expect(useSkinStore.getState().resolved).toBe(false); // still deciding
    vi.advanceTimersByTime(4000);
    expect(useSkinStore.getState().resolved).toBe(true);
    expect(hasSkin()).toBe(false);
  });

  it("ignores a lookup that succeeds after the timeout already fell back (no re-skin flash)", async () => {
    vi.useFakeTimers();
    let resolveFetch: (v: boolean) => void = () => {};
    const p = resolveSkin({
      fetchTenantEnabled: () =>
        new Promise<boolean>((res) => {
          resolveFetch = res;
        }),
      timeoutMs: 4000,
    });
    vi.advanceTimersByTime(4000); // timeout → legacy
    expect(hasSkin()).toBe(false);
    resolveFetch(true); // the real lookup finally returns "enabled"…
    await p;
    expect(hasSkin()).toBe(false); // …but the session stays legacy — no mid-flight re-skin
  });
});
