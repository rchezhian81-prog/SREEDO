// PX3 design-system inventory (UI-UX-DESIGN-SYSTEM.md §5.1). Lists every tenant
// (dashboard) page and flags the non-primitive patterns the sweep removes, then
// ranks by a simple weight so PX3-B/C… pick the next group from evidence, not a
// guess. Read-only: always exits 0. Super Admin is excluded (frozen).
//
// Run:  node scripts/design-inventory.mjs         (full ranked report)
//       node scripts/design-inventory.mjs fees    (filter to a module prefix)

import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, relative, sep } from "node:path";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const DASHBOARD = join(ROOT, "src", "app", "(dashboard)");
const filter = process.argv[2] ?? null;

function walk(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    const abs = join(dir, name);
    if (statSync(abs).isDirectory()) walk(abs, out);
    else if (abs.endsWith("page.tsx")) out.push(abs);
  }
  return out;
}

const CHECKS = [
  { key: "rawTable", weight: 2, re: /<table/g, label: "raw <table>" },
  { key: "confirm", weight: 3, re: /window\.confirm|[^a-zA-Z.]confirm\(/g, label: "window.confirm" },
  { key: "hexClass", weight: 3, re: /(bg|text|border|ring|from|via|to|fill|stroke|divide|shadow|outline)-\[#[0-9a-fA-F]{3,8}\]/g, label: "hex colour class" },
  { key: "palette", weight: 1, re: /(bg|text|border|ring|divide|from|via|to|fill|stroke|placeholder)-(slate|gray|zinc|neutral|stone)-[0-9]/g, label: "raw palette class" },
];

function analyse(abs) {
  const text = readFileSync(abs, "utf8");
  const rel = relative(DASHBOARD, abs).replace(new RegExp(`\\${sep}`, "g"), "/").replace(/\/page\.tsx$/, "") || "/";
  const counts = {};
  let weight = 0;
  for (const c of CHECKS) {
    const n = (text.match(c.re) || []).length;
    counts[c.key] = n;
    weight += n * c.weight;
  }
  // Missing-state signals (each list/detail should render both).
  counts.noEmptyState = /useState|fetch|api\./.test(text) && !/EmptyState/.test(text) ? 1 : 0;
  counts.noErrorNote = /useState|fetch|api\./.test(text) && !/ErrorNote/.test(text) ? 1 : 0;
  weight += (counts.noEmptyState + counts.noErrorNote) * 2;
  return { rel, group: rel.split("/")[1] || rel.replace("/", "") || "root", counts, weight };
}

const pages = walk(DASHBOARD)
  .filter((f) => !f.includes(`(dashboard)${sep}super-admin${sep}`))
  .map(analyse)
  .filter((p) => !filter || p.rel.includes(filter));

// Per-group rollup, ranked by total weight (what to sweep next).
const groups = {};
for (const p of pages) {
  const g = (groups[p.group] ??= { group: p.group, pages: 0, weight: 0, rawTable: 0, confirm: 0, hexClass: 0, palette: 0, noEmptyState: 0, noErrorNote: 0 });
  g.pages += 1;
  g.weight += p.weight;
  for (const k of ["rawTable", "confirm", "hexClass", "palette", "noEmptyState", "noErrorNote"]) g[k] += p.counts[k];
}

console.log(`\nPX3 design inventory — ${pages.length} tenant pages${filter ? ` (filter: "${filter}")` : ""}, Super Admin excluded (frozen)\n`);
console.log("GROUP".padEnd(20), "pages".padStart(6), "weight".padStart(7), "table".padStart(6), "confirm".padStart(8), "hex".padStart(4), "palette".padStart(8), "noEmpty".padStart(8), "noError".padStart(8));
for (const g of Object.values(groups).sort((a, b) => b.weight - a.weight)) {
  console.log(
    g.group.padEnd(20),
    String(g.pages).padStart(6),
    String(g.weight).padStart(7),
    String(g.rawTable).padStart(6),
    String(g.confirm).padStart(8),
    String(g.hexClass).padStart(4),
    String(g.palette).padStart(8),
    String(g.noEmptyState).padStart(8),
    String(g.noErrorNote).padStart(8)
  );
}

const totals = pages.reduce(
  (t, p) => {
    for (const k of ["rawTable", "confirm", "hexClass", "palette", "noEmptyState", "noErrorNote"]) t[k] += p.counts[k];
    return t;
  },
  { rawTable: 0, confirm: 0, hexClass: 0, palette: 0, noEmptyState: 0, noErrorNote: 0 }
);
console.log(`\nTOTALS  raw-table=${totals.rawTable}  confirm=${totals.confirm}  hex-class=${totals.hexClass}  raw-palette=${totals.palette}  missing-EmptyState=${totals.noEmptyState}  missing-ErrorNote=${totals.noErrorNote}`);

if (filter) {
  console.log(`\nPages in "${filter}":`);
  for (const p of pages.sort((a, b) => b.weight - a.weight))
    console.log(`  w=${String(p.weight).padStart(3)}  ${p.rel}  ` + `table=${p.counts.rawTable} confirm=${p.counts.confirm} hex=${p.counts.hexClass} palette=${p.counts.palette} noEmpty=${p.counts.noEmptyState} noError=${p.counts.noErrorNote}`);
}
console.log();
