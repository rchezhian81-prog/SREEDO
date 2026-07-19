import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { isModernSkinRequested, MODERN_SKIN_ENV } from "../lib/ui-flag";

// PR-UI1 — proves the dormant `.ui-v2` design-token foundation is (a) byte-identical
// to the pre-PR-UI1 look while the flag is off, (b) genuinely different when on, and
// (c) accessible (WCAG AA). Parses the committed CSS directly — no browser needed.

const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
const tw = readFileSync(new URL("../../tailwind.config.ts", import.meta.url), "utf8");
const layout = readFileSync(new URL("../app/layout.tsx", import.meta.url), "utf8");

/** Concatenated declaration body of every top-level block with an exact selector. */
function blockBody(selector: string): string {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp("^[ \\t]*" + esc + "\\s*\\{([^}]*)\\}", "gm");
  let m: RegExpExecArray | null;
  let body = "";
  while ((m = re.exec(css))) body += m[1] + "\n";
  return body;
}
function tokenOf(selector: string, name: string): string | null {
  const m = blockBody(selector).match(new RegExp("--" + name + "\\s*:\\s*([^;]+);"));
  return m ? m[1].trim() : null;
}
const rgb = (s: string | null) => (s ?? "").split(/\s+/).map(Number);

// WCAG relative-luminance + contrast ratio.
function lum([r, g, b]: number[]): number {
  const f = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
function contrast(a: number[], b: number[]): number {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
const WHITE = [255, 255, 255];

describe("PR-UI1 tokens — dormancy / identity (off-flag is unchanged)", () => {
  it("keeps the base brand ramp at the exact legacy hex (var-backed, same colour)", () => {
    expect(tokenOf(":root", "brand-500")).toBe("59 110 240"); // #3b6ef0
    expect(tokenOf(":root", "brand-600")).toBe("37 99 235"); // #2563eb
    expect(tokenOf(":root", "brand-700")).toBe("29 78 216"); // #1d4ed8
    expect(tokenOf(":root", "c-accent")).toBe("37 99 235"); // = brand-600
  });

  it("keeps the base chart series at the exact legacy DONUT_COLORS hex", () => {
    expect(tokenOf(":root", "chart-1")).toBe("37 99 235"); // #2563eb
    expect(tokenOf(":root", "chart-2")).toBe("22 163 74"); // #16a34a
    expect(tokenOf(":root", "chart-5")).toBe("124 58 237"); // #7c3aed
    expect(tokenOf(":root", "chart-6")).toBe("8 145 178"); // #0891b2
  });

  it("keeps base elevation identical to the pre-PR-UI1 card/pop shadows", () => {
    expect(tokenOf(":root", "elevation-1")).toContain("rgb(20 30 55 / 0.04)");
    expect(tokenOf(":root", "elevation-2")).toBe("0 10px 30px rgb(20 30 55 / 0.12)");
    expect(tokenOf(":root", "shadow-accent")).toBe("0 8px 18px rgb(37 99 235 / 0.32)");
  });

  it("maps Tailwind brand + elevation onto the CSS variables (not static hex)", () => {
    expect(tw).toContain("rgb(var(--brand-600) / <alpha-value>)");
    expect(tw).toContain('card: "var(--elevation-1)"');
    expect(tw).not.toContain('"#2563eb"');
  });
});

describe("PR-UI1 tokens — the skin is genuinely different when on", () => {
  it("retints the brand to violet under the light skin", () => {
    expect(tokenOf(".ui-v2:not(.dark)", "brand-600")).toBe("124 58 237");
    expect(tokenOf(".ui-v2:not(.dark)", "brand-600")).not.toBe("37 99 235");
  });
  it("uses a midnight-navy canvas under the dark skin", () => {
    expect(tokenOf(".ui-v2.dark", "c-app")).toBe("8 10 24");
    expect(tokenOf(".ui-v2.dark", "c-surface")).toBe("17 20 40");
  });
});

describe("PR-UI1 tokens — WCAG AA contrast (both skins)", () => {
  it("passes AA for body text + primary action in the light skin", () => {
    const surface = rgb(tokenOf(".ui-v2:not(.dark)", "c-surface"));
    expect(contrast(rgb(tokenOf(".ui-v2:not(.dark)", "c-ink")), surface)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(rgb(tokenOf(".ui-v2:not(.dark)", "c-muted")), surface)).toBeGreaterThanOrEqual(4.5);
    // white button label on the accent
    expect(contrast(WHITE, rgb(tokenOf(".ui-v2:not(.dark)", "c-accent")))).toBeGreaterThanOrEqual(4.5);
  });
  it("passes AA for body text + primary action in the dark skin", () => {
    const surface = rgb(tokenOf(".ui-v2.dark", "c-surface"));
    expect(contrast(rgb(tokenOf(".ui-v2.dark", "c-ink")), surface)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(rgb(tokenOf(".ui-v2.dark", "c-muted")), surface)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(WHITE, rgb(tokenOf(".ui-v2.dark", "c-accent")))).toBeGreaterThanOrEqual(4.5);
  });
});

describe("PR-UI1 typography — self-hosted, no shell change", () => {
  it("declares self-hosted Manrope + Noto Sans Tamil @font-face with swap", () => {
    expect(css).toMatch(/@font-face[\s\S]*Manrope[\s\S]*url\("\/fonts\//);
    expect(css).toMatch(/@font-face[\s\S]*Noto Sans Tamil[\s\S]*url\("\/fonts\//);
    expect(css).toContain("font-display: swap");
    expect(css).not.toContain("https://fonts."); // no external font host
  });
  it("does not wire fonts through the app shell (layout.tsx untouched for fonts)", () => {
    expect(layout).not.toContain("next/font");
  });
  it("forces receipts/print to a light scheme under the skin", () => {
    expect(css).toMatch(/@media print[\s\S]*:root\.ui-v2[\s\S]*color-scheme: light/);
  });
});

describe("PR-UI1 flag — reserved and OFF by default", () => {
  it("defaults to false (no runtime activation)", () => {
    expect(isModernSkinRequested()).toBe(false);
    expect(MODERN_SKIN_ENV).toBe("NEXT_PUBLIC_UI_V2");
  });
});
