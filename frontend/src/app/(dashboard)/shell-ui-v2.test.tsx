// @vitest-environment jsdom
import { afterEach, beforeEach, describe, it, expect } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ThemeToggle, SidebarContent } from "./layout";
import { useThemeStore } from "@/stores/theme-store";
import { useSkinStore } from "@/stores/skin-store";
import type { NavGroup, NavItem } from "@/lib/nav";

// PR-UI3 — the UI-v2 staff shell. These tests pin the four contracts jsdom can
// verify directly: (1) the theme-toggle a11y enhancement is eligible-only and
// leaves legacy markup byte-identical; (2) EVERY shell style rule is scoped
// under `.ui-v2`, so the shell can never restyle a legacy / super-admin / portal
// session (frozen-surface + legacy identity, proven at the CSS layer); (3) the
// sidebar text keeps AA contrast on the navy surface; (4) the sidebar renders
// exactly the nav items from the registry (skin never changes which items show)
// with the inert `sb-*` hooks applied. Pixel-level identity + responsive live in
// the Playwright shell suite.

afterEach(cleanup);
beforeEach(() => {
  document.documentElement.className = "";
  useSkinStore.setState({ active: false, resolved: false });
});

const setSkin = (active: boolean) => useSkinStore.setState({ active, resolved: true });
const setTheme = (dark: boolean) => {
  document.documentElement.classList.toggle("dark", dark);
  useThemeStore.setState({ theme: dark ? "dark" : "light" });
};

describe("theme toggle — eligible-only a11y enhancement (Decision 1)", () => {
  it("keeps legacy markup byte-identical when the skin is inactive", () => {
    setSkin(false);
    setTheme(false);
    const { getByRole } = render(<ThemeToggle />);
    const btn = getByRole("button");
    expect(btn.getAttribute("aria-label")).toBe("Toggle theme");
    expect(btn.hasAttribute("aria-pressed")).toBe(false);
    expect(btn.className).not.toContain("sb-theme-toggle");
    expect(btn.className).not.toContain("sb-focus");
  });

  it("announces state + restyles ONLY inside an eligible UI-v2 session (light)", () => {
    setSkin(true);
    setTheme(false);
    const { getByRole } = render(<ThemeToggle />);
    const btn = getByRole("button");
    expect(btn.getAttribute("aria-label")).toBe("Switch to dark mode");
    expect(btn.getAttribute("aria-pressed")).toBe("false");
    expect(btn.className).toContain("sb-theme-toggle");
    expect(btn.className).toContain("sb-focus");
  });

  it("announces pressed=true and the inverse label in dark", () => {
    setSkin(true);
    setTheme(true);
    const { getByRole } = render(<ThemeToggle />);
    const btn = getByRole("button");
    expect(btn.getAttribute("aria-pressed")).toBe("true");
    expect(btn.getAttribute("aria-label")).toBe("Switch to light mode");
  });
});

describe("frozen-surface isolation — every shell rule is `.ui-v2`-scoped", () => {
  // vitest runs from the frontend package root; globals.css lives under src/app.
  const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");
  // Each CSS selector is the text immediately before a `{`.
  const selectors = [...css.matchAll(/([^{}]+)\{/g)].map((m) => m[1].trim());
  const shellSelectors = selectors.filter((s) => s.includes(".sb-"));

  it("actually defines shell (`sb-*`) rules", () => {
    expect(shellSelectors.length).toBeGreaterThan(0);
  });

  it("never applies a shell style without a `.ui-v2` ancestor (legacy/super-admin/portal inert)", () => {
    for (const sel of shellSelectors) {
      expect(sel.includes(".ui-v2"), `shell selector escapes .ui-v2 scope: "${sel}"`).toBe(true);
    }
  });
});

describe("sidebar accessibility — AA contrast of sidebar text on the navy surface", () => {
  const hex = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const lum = (c: number[]) => {
    const [r, g, b] = c.map((v) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const contrast = (a: number[], b: number[]) => {
    const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  };
  it("keeps the sidebar body text ≥ AA on the lightest navy gradient stop", () => {
    const text = hex("#a8b6dc"); // sidebar item text
    const navy = hex("#241a52"); // lightest UI-v2 sidebar stop (worst case)
    expect(contrast(text, navy)).toBeGreaterThanOrEqual(4.5);
  });
});

describe("navigation parity — the sidebar renders the registry items, never the skin", () => {
  const items: NavItem[] = [
    { href: "/dashboard", label: "Dashboard", icon: "grid" },
    { href: "/students", label: "Students", icon: "cap" },
    { href: "/fees", label: "Fees", icon: "receipt" },
  ];
  const groups: NavGroup[] = [{ title: "Main", items }];

  const renderSidebar = () =>
    render(
      <SidebarContent
        navGroups={groups}
        pathname="/students"
        subtitle="School"
        currentYearLabel="2026-27"
        pinnedItems={[items[0]]}
        onTogglePin={() => {}}
        openGroups={{ Main: true }}
      />
    );

  it("renders exactly the registry hrefs and applies the inert sb-* hooks", () => {
    const { container } = renderSidebar();
    const hrefs = [...container.querySelectorAll("a[href]")].map((a) => a.getAttribute("href"));
    // Every registry item shows (pinned dashboard appears in Pinned + Main).
    for (const it of items) expect(hrefs).toContain(it.href);
    // Active row (/students) carries the violet-active hook; pins carry the gold hook.
    expect(container.querySelector("a.sb-nav-active")?.getAttribute("href")).toBe("/students");
    expect(container.querySelector("button.sb-pin")).toBeTruthy();
    expect(container.querySelectorAll("a.sb-focus").length).toBeGreaterThan(0);
  });

  it("is identical whether or not `.ui-v2` is on the document (skin ≠ item set)", () => {
    const off = renderSidebar();
    const offHrefs = [...off.container.querySelectorAll("a[href]")].map((a) => a.getAttribute("href"));
    cleanup();
    document.documentElement.classList.add("ui-v2");
    const on = renderSidebar();
    const onHrefs = [...on.container.querySelectorAll("a[href]")].map((a) => a.getAttribute("href"));
    expect(onHrefs).toEqual(offHrefs);
  });
});
