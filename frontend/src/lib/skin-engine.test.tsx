import { afterEach, beforeEach, describe, it, expect } from "vitest";
import {
  MODERN_SKIN_ENV,
  UI_V2_CLASS,
  isModernSkinRequested,
  shouldApplyUiV2,
} from "@/lib/ui-flag";

// PR-UI2 — the two-gate activation contract. The modern skin is effective ONLY
// when the build-time master switch (NEXT_PUBLIC_UI_V2 === "true") AND the
// authenticated tenant's server-derived flag both agree. Either gate false =>
// legacy UI. These tests pin that truth table and the stable token names.

const ENV = MODERN_SKIN_ENV; // "NEXT_PUBLIC_UI_V2"
const original = process.env[ENV];

beforeEach(() => {
  delete process.env[ENV];
});
afterEach(() => {
  if (original === undefined) delete process.env[ENV];
  else process.env[ENV] = original;
});

describe("stable token contract", () => {
  it("reserves the documented env var + scope class names", () => {
    expect(MODERN_SKIN_ENV).toBe("NEXT_PUBLIC_UI_V2");
    expect(UI_V2_CLASS).toBe("ui-v2");
  });
});

describe("isModernSkinRequested — build-time master switch", () => {
  it("is false when the env var is unset (the default)", () => {
    expect(isModernSkinRequested()).toBe(false);
  });
  it('is false for any value other than exactly "true"', () => {
    process.env[ENV] = "1";
    expect(isModernSkinRequested()).toBe(false);
    process.env[ENV] = "TRUE";
    expect(isModernSkinRequested()).toBe(false);
    process.env[ENV] = "false";
    expect(isModernSkinRequested()).toBe(false);
  });
  it('is true only for exactly "true"', () => {
    process.env[ENV] = "true";
    expect(isModernSkinRequested()).toBe(true);
  });
});

describe("shouldApplyUiV2 — BOTH gates required", () => {
  it("false when the master switch is off, regardless of the tenant flag", () => {
    delete process.env[ENV];
    expect(shouldApplyUiV2(true)).toBe(false);
    expect(shouldApplyUiV2(false)).toBe(false);
  });
  it("false when the master switch is on but the tenant flag is off", () => {
    process.env[ENV] = "true";
    expect(shouldApplyUiV2(false)).toBe(false);
  });
  it("true only when the master switch is on AND the tenant flag is on", () => {
    process.env[ENV] = "true";
    expect(shouldApplyUiV2(true)).toBe(true);
  });
});
