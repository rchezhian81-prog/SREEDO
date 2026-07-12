// PX3 design guard — a committed, zero-dependency enforcement of the design
// system's colour + icon rules. Two enforcement tiers:
//
//  HARD (fail everywhere, today): the two rules already clean across every
//    tenant page — Lucide only via the Icon facade, and no arbitrary hex colour
//    classes. These can never regress.
//
//  SWEPT-GROUP LOCK (fail, per finished group): once a module group has been
//    brought to the T4+ bar it is added to SWEPT and must stay perfect — zero
//    raw-palette classes, zero emoji, zero hex. PX3-A finishes Fees & Accounts.
//
//  WARNINGS (reported, informational): emoji + raw-palette on not-yet-swept
//    pages. This is the worklist for PX3-B/C… — printed, never failed, so the
//    sweep stays reviewable one group at a time.
//
// Why not ESLint: the repo has no ESLint baseline; bootstrapping one would
// surface hundreds of unrelated findings and bloat every sweep PR. This scanner
// enforces exactly the design-system rules and rides the existing `npm test`
// CI gate (see src/design-guard.test.ts).
//
// Run directly:  node scripts/design-guard.mjs   (exit 1 on hard/lock violation)

import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, relative, sep } from "node:path";

const ROOT = fileURLToPath(new URL("..", import.meta.url)); // frontend/
const SRC = join(ROOT, "src");
const ICONS_FILE = join(SRC, "components", "icons.tsx");
const DASHBOARD = join(SRC, "app", "(dashboard)");

// Module path-prefixes (relative to (dashboard)) that have been swept to the
// design-system bar and are now locked clean. Add the next group here when its
// PX3 PR lands. PX3-A: Fees & Accounts. PX3-B: Payroll.
export const SWEPT = ["fees", "accounting", "online-payments", "payroll"];

const superAdminDir = `(dashboard)${sep}super-admin${sep}`;

function walk(dir, test, out = []) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    const abs = join(dir, name);
    if (statSync(abs).isDirectory()) walk(abs, test, out);
    else if (test(abs)) out.push(abs);
  }
  return out;
}

// Pictographs only — deliberately excludes arrows (↑↓↵) and the ⌘ glyph (Misc
// Technical block) so legitimate keyboard hints are never flagged.
const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{FE0F}]/u;
const HEX_CLASS =
  /(bg|text|border|ring|from|via|to|fill|stroke|divide|shadow|outline|ring-offset)-\[#[0-9a-fA-F]{3,8}\]/;
const RAW_PALETTE =
  /(bg|text|border|ring|divide|from|via|to|fill|stroke|placeholder)-(slate|gray|zinc|neutral|stone)-[0-9]/;

const dashRel = (abs) => relative(DASHBOARD, abs).replace(new RegExp(`\\${sep}`, "g"), "/");
const isSwept = (abs) => {
  const r = dashRel(abs);
  return SWEPT.some((p) => r === `${p}/page.tsx` || r.startsWith(`${p}/`));
};

/**
 * Scan the codebase. Returns { hard, lock, warnings } — arrays of
 * { rule, file, line, snippet }. `hard` + `lock` must be empty; `warnings` is
 * the remaining sweep worklist. Exported so the vitest gate asserts without
 * shelling out.
 */
export function scan() {
  const hard = [];
  const lock = [];
  const warnings = [];

  // HARD rule 1 — Lucide only inside the Icon facade (whole src tree).
  for (const abs of walk(SRC, (f) => f.endsWith(".ts") || f.endsWith(".tsx"))) {
    if (abs === ICONS_FILE) continue;
    readFileSync(abs, "utf8")
      .split("\n")
      .forEach((ln, i) => {
        if (/from ['"]lucide-react['"]/.test(ln))
          hard.push({ rule: "icon-facade", file: relative(ROOT, abs), line: i + 1, snippet: ln.trim() });
      });
  }

  // Tenant (dashboard) pages, Super Admin excluded (frozen).
  const pages = walk(
    DASHBOARD,
    (f) => f.endsWith("page.tsx") && !f.includes(superAdminDir)
  );
  for (const abs of pages) {
    const rel = relative(ROOT, abs);
    const swept = isSwept(abs);
    readFileSync(abs, "utf8")
      .split("\n")
      .forEach((ln, i) => {
        const at = { file: rel, line: i + 1, snippet: ln.trim() };
        // HARD rule 2 — no arbitrary hex colour classes, anywhere.
        if (HEX_CLASS.test(ln)) hard.push({ rule: "no-hex-class", ...at });
        // Emoji + raw-palette: locked on swept groups, warned elsewhere.
        if (EMOJI.test(ln)) (swept ? lock : warnings).push({ rule: "no-emoji", ...at });
        if (RAW_PALETTE.test(ln)) (swept ? lock : warnings).push({ rule: "raw-palette", ...at });
      });
  }
  return { hard, lock, warnings };
}

// CLI entry — only when invoked directly, not when imported by the test.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { hard, lock, warnings } = scan();

  if (warnings.length) {
    const grouped = warnings.reduce((m, w) => ((m[w.file] = (m[w.file] || 0) + 1), m), {});
    console.log(`\n⚠  sweep worklist — ${warnings.length} emoji/palette warnings on not-yet-swept pages:`);
    for (const [file, n] of Object.entries(grouped).sort((a, b) => b[1] - a[1]).slice(0, 20))
      console.log(`   ${String(n).padStart(3)}  ${file.replace("src/app/(dashboard)/", "")}`);
    const more = Object.keys(grouped).length - 20;
    if (more > 0) console.log(`   … and ${more} more pages`);
  }

  const fail = [...hard, ...lock];
  if (fail.length === 0) {
    console.log(`\n✅ design-guard: 0 hard violations; swept groups [${SWEPT.join(", ")}] locked clean.`);
    process.exit(0);
  }
  console.error(`\n❌ design-guard: ${hard.length} hard + ${lock.length} swept-group-lock violation(s):`);
  for (const v of fail) console.error(`   [${v.rule}] ${v.file.replace("src/app/(dashboard)/", "")}:${v.line}  ${v.snippet}`);
  process.exit(1);
}
