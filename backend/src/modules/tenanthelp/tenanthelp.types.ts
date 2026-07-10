// PR-T10 — Tenant Help/SOP Center (Module 30).
//
// All content is CURATED IN CODE (typed data under ./content) — it is
// documentation, not domain data, so it ships with the build and is served
// read-only through RBAC-gated endpoints (tenant_help:read). Same pattern as
// the platform Help Center (Q), but a fully separate tenant surface: distinct
// module, mount (/tenant-help) and permission namespace. IDs are STABLE slugs —
// the AI Copilot (PR-T11) will cite them, so never repurpose an id.

/** Which institution type a doc applies to. */
export type HelpApplies = "school" | "college" | "both";

export type HelpCategory =
  | "getting-started"
  | "students"
  | "academics"
  | "attendance"
  | "fees"
  | "exams"
  | "communication"
  | "operations"
  | "administration";

export interface HelpDocMeta {
  version: string;
  /** YYYY-MM-DD */
  lastUpdated: string;
  reviewStatus: "reviewed" | "needs_review";
}

export interface HelpLink {
  label: string;
  /** In-app dashboard path, e.g. "/students". */
  href: string;
}

export interface TenantHelpArticle {
  id: string;
  title: string;
  category: HelpCategory;
  appliesTo: HelpApplies;
  /** One-paragraph teaser shown on cards and in search results. */
  summary: string;
  /** Markdown-ish trusted prose: #-headings, - bullets, blank-line paragraphs. */
  body: string;
  links: HelpLink[];
  meta: HelpDocMeta;
}

export interface TenantSop {
  id: string;
  title: string;
  category: HelpCategory;
  appliesTo: HelpApplies;
  purpose: string;
  steps: string[];
  safetyWarnings: string[];
  /** What the audit log should show after the SOP is followed. */
  auditExpectation: string;
  links: HelpLink[];
  meta: HelpDocMeta;
}

export interface GettingStartedStep {
  title: string;
  description: string;
  href: string;
}

export interface GettingStartedSection {
  id: string;
  title: string;
  appliesTo: HelpApplies;
  steps: GettingStartedStep[];
  meta: HelpDocMeta;
}

export interface TenantHelpSummary {
  articles: number;
  sops: number;
  gettingStartedSections: number;
  /** Honest limitation flag: content is curated in code, updated via deploys. */
  curatedInCode: true;
  lastUpdated: string;
}

export type TenantHelpSearchHit = {
  type: "article" | "sop" | "getting-started";
  id: string;
  title: string;
  category: HelpCategory;
  snippet: string;
};
