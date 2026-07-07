// Super Admin Q — Help / SOP / Documentation / Module Status Center.
//
// A READ-ONLY documentation service. All content is CURATED IN CODE (./content)
// — help articles, SOPs, smoke-test checklists, known limitations, release
// notes, emergency playbooks, admin onboarding, and a curated module-status
// register. Nothing is fabricated: module-status refs are the real confirmed
// value or null, and no secret/token/key/private-path is ever emitted (a
// build-time test runs `scanForSecrets` over EVERY bundled string). The only
// write the module performs is the audit row on export.

import { query } from "../../db/postgres";
import { toCsv } from "../../utils/spreadsheet";
import { maskSecrets, maskFreeText } from "../platform/audit.service";
import type { AuthenticatedUser } from "../../types";

import { moduleStatus } from "./content/moduleStatus";
import { releaseNotes } from "./content/releaseNotes";
import { helpArticles } from "./content/helpArticles";
import { sops } from "./content/sops";
import { checklists } from "./content/checklists";
import { limitations } from "./content/limitations";
import { playbooks } from "./content/playbooks";
import { onboarding } from "./content/onboarding";
import type {
  Checklist,
  HelpArticle,
  Limitation,
  ModuleStatusEntry,
  Playbook,
  ReleaseNote,
  Sop,
} from "./help.types";

// ---------------------------------------------------------------------------
// Audit (module-local recorder → platform_audit_log; never emits a secret)
// ---------------------------------------------------------------------------

export interface Actor {
  id: string | null;
  email: string;
  role: string;
  ip: string | null;
}

async function recordAudit(
  actor: Actor,
  input: { action: string; detail?: Record<string, unknown> }
): Promise<void> {
  await query(
    `INSERT INTO platform_audit_log
       (action, target_type, target_id, institution_id, actor_id, actor_email, actor_role, detail, ip)
     VALUES ($1,'help',NULL,NULL,$2,$3,$4,$5::jsonb,$6)`,
    [
      input.action,
      actor.id,
      actor.email,
      actor.role,
      JSON.stringify(input.detail ?? {}),
      actor.ip,
    ]
  );
}

// ---------------------------------------------------------------------------
// Secret scanning — high-precision token-format patterns only (so it never
// false-positives on ordinary doc prose about "passwords" or "tokens"). Used to
// (a) prove no bundled doc ships a real secret [test] and (b) belt-and-suspenders
// mask the export payload alongside maskSecrets.
// ---------------------------------------------------------------------------

const SECRET_PATTERNS: { name: string; re: RegExp }[] = [
  { name: "stripe_secret_key", re: /\bsk_(?:live|test)_[A-Za-z0-9]{10,}/ },
  { name: "webhook_signing_secret", re: /\bwhsec_[A-Za-z0-9]{10,}/ },
  { name: "aws_access_key", re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: "github_token", re: /\bgh[posru]_[A-Za-z0-9]{20,}/ },
  { name: "slack_token", re: /\bxox[baprs]-[A-Za-z0-9-]{10,}/ },
  { name: "private_key_block", re: /-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----/ },
  { name: "jwt", re: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{6,}/ },
  {
    name: "db_url_with_password",
    re: /\b(?:postgres|postgresql|mysql|mongodb(?:\+srv)?):\/\/[^\s/:@]+:[^\s/@]+@/,
  },
  { name: "bearer_jwt", re: /\bBearer\s+eyJ[A-Za-z0-9_-]+/ },
];

/** Returns the names of any secret-shaped patterns found in `text` (empty = clean). */
export function scanForSecrets(text: string): string[] {
  const hits: string[] = [];
  for (const p of SECRET_PATTERNS) if (p.re.test(text)) hits.push(p.name);
  return hits;
}

/** Every bundled content collection, flattened to strings — for the no-secret test. */
export function allBundledStrings(): string[] {
  const out: string[] = [];
  const walk = (v: unknown): void => {
    if (typeof v === "string") out.push(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") Object.values(v).forEach(walk);
  };
  walk({ moduleStatus, releaseNotes, helpArticles, sops, checklists, limitations, playbooks, onboarding });
  return out;
}

// ---------------------------------------------------------------------------
// Derivations
// ---------------------------------------------------------------------------

function limitationsCountFor(moduleKey: string): number {
  return limitations.filter((l) => l.module === moduleKey).length;
}

/** Module-status register (Section B) with the derived known-limitations count. */
export function listModules(): (ModuleStatusEntry & { knownLimitationsCount: number })[] {
  return moduleStatus.map((m) => ({ ...m, knownLimitationsCount: limitationsCountFor(m.key) }));
}

const CONTENT_TYPES = ["help", "sop", "checklist", "playbook", "release", "limitation"] as const;
type ContentType = (typeof CONTENT_TYPES)[number];

interface RecentDoc {
  type: ContentType | "module";
  id: string;
  title: string;
  module: string | null;
  lastUpdated: string;
}

function recentDocs(): RecentDoc[] {
  const rows: RecentDoc[] = [
    ...helpArticles.map((a) => ({ type: "help" as const, id: a.id, title: a.title, module: a.module, lastUpdated: a.meta.lastUpdated })),
    ...sops.map((s) => ({ type: "sop" as const, id: s.id, title: s.title, module: null, lastUpdated: s.meta.lastUpdated })),
    ...checklists.map((c) => ({ type: "checklist" as const, id: c.id, title: c.title, module: c.module, lastUpdated: c.meta.lastUpdated })),
    ...playbooks.map((p) => ({ type: "playbook" as const, id: p.id, title: p.title, module: null, lastUpdated: p.meta.lastUpdated })),
    ...releaseNotes.map((r) => ({ type: "release" as const, id: r.id, title: r.title, module: r.module, lastUpdated: r.date })),
    ...limitations.map((l) => ({ type: "limitation" as const, id: l.id, title: l.title, module: l.module, lastUpdated: l.lastUpdated })),
  ];
  return rows.sort((a, b) => (a.lastUpdated < b.lastUpdated ? 1 : a.lastUpdated > b.lastUpdated ? -1 : 0));
}

/** Docs that carry review metadata and are flagged needs_review (Section J). */
function docsNeedingReview(): { type: string; id: string; title: string }[] {
  const out: { type: string; id: string; title: string }[] = [];
  for (const a of helpArticles) if (a.meta.reviewStatus === "needs_review") out.push({ type: "help", id: a.id, title: a.title });
  for (const s of sops) if (s.meta.reviewStatus === "needs_review") out.push({ type: "sop", id: s.id, title: s.title });
  for (const c of checklists) if (c.meta.reviewStatus === "needs_review") out.push({ type: "checklist", id: c.id, title: c.title });
  for (const p of playbooks) if (p.meta.reviewStatus === "needs_review") out.push({ type: "playbook", id: p.id, title: p.title });
  return out;
}

function lastDocumentationUpdate(): string | null {
  const all = recentDocs();
  return all.length ? all[0].lastUpdated : null;
}

// ---------------------------------------------------------------------------
// A) Help / SOP dashboard summary
// ---------------------------------------------------------------------------

export function helpDashboard(_user: AuthenticatedUser) {
  const total = moduleStatus.length;
  const stable = moduleStatus.filter((m) => m.status === "production_stable").length;
  const complete = moduleStatus.filter((m) => m.status === "complete" || m.status === "production_stable").length;
  const inProgress = moduleStatus.filter((m) => m.status === "in_progress").length;

  const criticalRunbooks = playbooks.filter((p) => p.severity === "critical");

  return {
    generatedAt: new Date().toISOString(),
    completion: {
      total,
      complete,
      productionStable: stable,
      inProgress,
      percentComplete: total ? Math.round((complete / total) * 100) : 0,
    },
    counts: {
      moduleDocs: moduleStatus.length,
      helpArticles: helpArticles.length,
      sops: sops.length,
      checklists: checklists.length,
      limitations: limitations.length,
      releaseNotes: releaseNotes.length,
      playbooks: playbooks.length,
      onboardingSections: onboarding.length,
    },
    recentlyUpdated: recentDocs().slice(0, 6),
    docsNeedingReview: docsNeedingReview(),
    criticalRunbooks: criticalRunbooks.map((p) => ({ id: p.id, title: p.title })),
    onboardingStatus: {
      sections: onboarding.length,
      available: onboarding.length > 0,
    },
    lastDocumentationUpdate: lastDocumentationUpdate(),
    // Curated-in-code notice: this help surface is documentation, not editable
    // domain data — surfaced so the UI can show the limitation honestly.
    curatedInCode: true,
  };
}

// ---------------------------------------------------------------------------
// C) Help articles — list / search / filter / detail
// ---------------------------------------------------------------------------

function matches(hay: string, needle: string): boolean {
  return hay.toLowerCase().includes(needle.toLowerCase());
}

export interface HelpListQuery {
  q?: string;
  module?: string;
  category?: string;
}

export function listArticles(qy: HelpListQuery): HelpArticle[] {
  return helpArticles.filter((a) => {
    if (qy.module && a.module !== qy.module) return false;
    if (qy.category && a.category !== qy.category) return false;
    if (qy.q && !(matches(a.title, qy.q) || matches(a.summary, qy.q) || matches(a.body, qy.q))) return false;
    return true;
  });
}

export function getArticle(id: string): HelpArticle | null {
  return helpArticles.find((a) => a.id === id) ?? null;
}

// ---------------------------------------------------------------------------
// D) SOPs — list / detail
// ---------------------------------------------------------------------------

export function listSops(qy: { q?: string; module?: string }): Sop[] {
  return sops.filter((s) => {
    if (qy.module && !s.relatedLinks.some((l) => l.href.includes(qy.module!))) return false;
    if (qy.q && !(matches(s.title, qy.q) || matches(s.purpose, qy.q) || matches(s.whenToUse, qy.q))) return false;
    return true;
  });
}

export function getSop(id: string): Sop | null {
  return sops.find((s) => s.id === id) ?? null;
}

// ---------------------------------------------------------------------------
// E) Smoke-test checklists — list / detail
// ---------------------------------------------------------------------------

export function listChecklists(qy: { q?: string; module?: string }): Checklist[] {
  return checklists.filter((c) => {
    if (qy.module && c.module !== qy.module) return false;
    if (qy.q && !matches(c.title, qy.q)) return false;
    return true;
  });
}

export function getChecklist(id: string): Checklist | null {
  return checklists.find((c) => c.id === id) ?? null;
}

// ---------------------------------------------------------------------------
// F) Known limitations register — list / filter
// ---------------------------------------------------------------------------

export function listLimitations(qy: { module?: string; severity?: string; status?: string }): Limitation[] {
  return limitations.filter((l) => {
    if (qy.module && l.module !== qy.module) return false;
    if (qy.severity && l.severity !== qy.severity) return false;
    if (qy.status && l.status !== qy.status) return false;
    return true;
  });
}

// ---------------------------------------------------------------------------
// G) Release notes — list / detail
// ---------------------------------------------------------------------------

export function listReleaseNotes(qy: { module?: string }): ReleaseNote[] {
  return releaseNotes.filter((r) => !qy.module || r.module === qy.module);
}

export function getReleaseNote(id: string): ReleaseNote | null {
  return releaseNotes.find((r) => r.id === id) ?? null;
}

// ---------------------------------------------------------------------------
// H) Admin onboarding guide
// ---------------------------------------------------------------------------

export function getOnboarding() {
  return [...onboarding].sort((a, b) => a.order - b.order);
}

// ---------------------------------------------------------------------------
// I) Emergency playbooks — list / detail
// ---------------------------------------------------------------------------

export function listPlaybooks(qy: { q?: string; module?: string }): Playbook[] {
  return playbooks.filter((p) => {
    if (qy.module && !p.relatedModules.includes(qy.module)) return false;
    if (qy.q && !(matches(p.title, qy.q) || p.symptoms.some((s) => matches(s, qy.q!)))) return false;
    return true;
  });
}

export function getPlaybook(id: string): Playbook | null {
  return playbooks.find((p) => p.id === id) ?? null;
}

// ---------------------------------------------------------------------------
// K) Global search across every content type
// ---------------------------------------------------------------------------

export interface SearchResult {
  type: ContentType;
  id: string;
  title: string;
  module: string | null;
  snippet: string;
}

export function search(qy: { q?: string; type?: string; module?: string }): SearchResult[] {
  const q = (qy.q ?? "").trim();
  const wantType = qy.type && (CONTENT_TYPES as readonly string[]).includes(qy.type) ? (qy.type as ContentType) : null;
  const results: SearchResult[] = [];

  const push = (type: ContentType, id: string, title: string, module: string | null, snippet: string) => {
    if (wantType && type !== wantType) return;
    if (qy.module && module !== qy.module) return;
    if (q && !(matches(title, q) || matches(snippet, q))) return;
    results.push({ type, id, title, module, snippet: snippet.slice(0, 200) });
  };

  helpArticles.forEach((a) => push("help", a.id, a.title, a.module, a.summary));
  sops.forEach((s) => push("sop", s.id, s.title, null, s.purpose));
  checklists.forEach((c) => push("checklist", c.id, c.title, c.module, `${c.items.length} checks`));
  playbooks.forEach((p) => push("playbook", p.id, p.title, null, p.symptoms[0] ?? ""));
  releaseNotes.forEach((r) => push("release", r.id, r.title, r.module, r.summary));
  limitations.forEach((l) => push("limitation", l.id, l.title, l.module, l.impact));

  return results;
}

// ---------------------------------------------------------------------------
// Export (Section E.4 / M.10) — masked + audited snapshot download
// ---------------------------------------------------------------------------

export type ExportKind = "modules" | "checklists" | "limitations";

interface ExportOpts {
  kind: ExportKind;
  format: "csv" | "json";
  reason?: string;
}

export async function exportSnapshot(
  user: AuthenticatedUser,
  opts: ExportOpts,
  actor: Actor
): Promise<{ buffer: Buffer; filename: string; contentType: string }> {
  let headers: string[] = [];
  let rows: (string | number)[][] = [];
  let jsonPayload: unknown;

  if (opts.kind === "modules") {
    headers = ["Module", "Letter", "Status", "PR", "Commit", "Deploy", "Owner", "Route", "Known limitations", "Last smoke", "Last updated"];
    const data = listModules();
    rows = data.map((m) => [
      m.name, m.letter ?? "", m.status, m.prNumber ?? "", m.prCommit ?? "", m.deployNumber ?? "",
      m.ownerRole, m.route ?? "", m.knownLimitationsCount, m.lastSmokeResult ?? "", m.lastUpdated,
    ]);
    jsonPayload = data;
  } else if (opts.kind === "checklists") {
    headers = ["Checklist", "Module", "Item", "Expected result", "Production risk", "Do not test on real data"];
    for (const c of checklists) {
      for (const it of c.items) {
        rows.push([c.title, c.module, it.text, it.expectedResult, it.productionRisk ? "yes" : "no", it.doNotTestOnRealData ? "yes" : "no"]);
      }
    }
    jsonPayload = checklists;
  } else {
    headers = ["Module", "Title", "Severity", "Status", "Impact", "Workaround", "Owner", "Target phase", "Last updated"];
    rows = limitations.map((l) => [l.module, l.title, l.severity, l.status, l.impact, l.workaround, l.ownerRole, l.targetPhase ?? "", l.lastUpdated]);
    jsonPayload = limitations;
  }

  await recordAudit(actor, {
    action: "help.exported",
    detail: {
      kind: opts.kind,
      format: opts.format,
      rows: rows.length,
      reason: (maskFreeText(opts.reason ?? "") as string) || null,
    },
  });

  if (opts.format === "json") {
    const payload = maskSecrets({
      generatedAt: new Date().toISOString(),
      generatedBy: { email: user.email, role: user.role },
      kind: opts.kind,
      data: jsonPayload,
    });
    return {
      buffer: Buffer.from(JSON.stringify(payload, null, 2), "utf8"),
      filename: `help-${opts.kind}-snapshot.json`,
      contentType: "application/json; charset=utf-8",
    };
  }

  // CSV — mask each cell's free text belt-and-suspenders.
  const maskedRows = rows.map((r) => r.map((c) => (typeof c === "string" ? (maskFreeText(c) as string) : c)));
  const csv = toCsv(headers, maskedRows);
  return {
    buffer: Buffer.from(csv, "utf8"),
    filename: `help-${opts.kind}-snapshot.csv`,
    contentType: "text/csv; charset=utf-8",
  };
}
