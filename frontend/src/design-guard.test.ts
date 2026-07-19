import { describe, it, expect } from "vitest";
import { scan, SWEPT } from "../scripts/design-guard.mjs";

// PX3 — runs the committed design guard inside the existing `npm test` CI gate,
// so the icon/colour rules and the swept-group lock can never silently
// regress. Raw-palette/emoji on not-yet-swept pages are the sweep worklist
// (guard `warnings`) and are intentionally NOT asserted here.
type Finding = { rule: string; file: string; line: number };

describe("design guard (icon + colour rules)", () => {
  const { hard, lock, warnings, glass, dormancy } = scan();

  it("has zero hard violations (icon-facade, no-hex-class) across tenant pages", () => {
    if (hard.length) {
      throw new Error(
        "design-guard hard violations:\n" +
          hard.map((v: Finding) => `[${v.rule}] ${v.file}:${v.line}`).join("\n")
      );
    }
    expect(hard.length).toBe(0);
  });

  it(`keeps swept groups [${SWEPT.join(", ")}] locked clean (no emoji/palette/hex)`, () => {
    if (lock.length) {
      throw new Error(
        "swept-group-lock violations:\n" +
          lock.map((v: Finding) => `[${v.rule}] ${v.file}:${v.line}`).join("\n")
      );
    }
    expect(lock.length).toBe(0);
  });

  it("exposes a sweep worklist for the next groups (informational)", () => {
    expect(Array.isArray(warnings)).toBe(true);
  });

  it("keeps the PR-UI1 `.ui-v2` token scope fully dormant (never applied in the DOM)", () => {
    if (dormancy.length) {
      throw new Error(
        "ui-v2 must stay dormant (theme engine is a later PR):\n" +
          dormancy.map((v: Finding) => `[${v.rule}] ${v.file}:${v.line}`).join("\n")
      );
    }
    expect(dormancy.length).toBe(0);
  });

  it("keeps the glass utility allow-listed (never on forms/tables)", () => {
    if (glass.length) {
      throw new Error(
        "glass-panel used outside the nav/dashboard/AI/analytics allow-list:\n" +
          glass.map((v: Finding) => `[${v.rule}] ${v.file}:${v.line}`).join("\n")
      );
    }
    expect(glass.length).toBe(0);
  });
});
