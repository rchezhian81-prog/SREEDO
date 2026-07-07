// Super Admin Q — Help / SOP / Documentation / Module Status Center.
//
// Shared, read-only content types. All Help-Center content is CURATED IN CODE
// (typed data under ./content) — it is documentation, not domain data, so it
// ships with the build and is served read-only through RBAC-gated endpoints.
// Nothing here may contain a real secret / token / key / private path (a
// build-time test scans every bundled string — see help.service.scanForSecrets).

export type ModuleStatus =
  | "complete"
  | "production_stable"
  | "in_progress"
  | "planned"
  | "deprecated";

export type DocReviewStatus = "draft" | "reviewed" | "needs_review" | "deprecated";

export type Severity = "low" | "medium" | "high" | "critical";

export type LimitationStatus = "accepted" | "planned" | "fixed" | "deferred" | "future";

export type HelpCategory =
  | "getting_started"
  | "tenant_management"
  | "billing_and_invoices"
  | "subscriptions"
  | "security_and_rbac"
  | "audit_and_compliance"
  | "support_access"
  | "backup_and_restore"
  | "data_exports"
  | "observability_and_jobs"
  | "communication"
  | "troubleshooting"
  | "release_notes"
  | "sops_and_playbooks";

/** The kinds of content the global search / type-filter spans. */
export type DocType =
  | "help"
  | "sop"
  | "checklist"
  | "playbook"
  | "release"
  | "limitation";

export interface Link {
  label: string;
  href: string;
}

/** Curated documentation metadata (Section J). Curated-in-code, so most docs
 *  share a curation date; edit/publish/archive are not implemented (see PR). */
export interface DocMeta {
  version: string;
  lastUpdatedBy: string;
  lastUpdated: string; // ISO date
  reviewedBy?: string | null;
  reviewStatus: DocReviewStatus;
  nextReviewDate?: string | null;
  moduleOwner?: string | null;
}

/** Section B — a curated module-status register entry. Refs (PR/commit/deploy)
 *  are OPTIONAL and only ever the REAL confirmed value — null when not known
 *  (never fabricated). knownLimitationsCount is derived at read time. */
export interface ModuleStatusEntry {
  key: string;
  name: string;
  letter: string | null;
  status: ModuleStatus;
  prNumber: number | null;
  prCommit: string | null;
  deployNumber: number | null;
  lastSmokeResult: string | null;
  lastUpdated: string; // ISO date (curation date)
  ownerRole: string;
  route: string | null;
  docLink: string | null;
  relatedLinks: Link[];
}

/** Section C — a help article. Body is trusted curated markdown-ish text. */
export interface HelpArticle {
  id: string;
  title: string;
  category: HelpCategory;
  module: string | null;
  appliesToRole: string;
  summary: string;
  body: string;
  relatedLinks: Link[];
  meta: DocMeta;
}

/** Section D — a standard operating procedure. */
export interface Sop {
  id: string;
  title: string;
  purpose: string;
  whenToUse: string;
  requiredRole: string;
  steps: string[];
  safetyWarnings: string[];
  approvalRequired: string | null;
  auditExpectation: string;
  smokeTestCheck: string;
  relatedLinks: Link[];
  meta: DocMeta;
}

export interface ChecklistItem {
  text: string;
  expectedResult: string;
  productionRisk: boolean;
  doNotTestOnRealData: boolean;
}

/** Section E — a smoke-test checklist. */
export interface Checklist {
  id: string;
  title: string;
  module: string;
  route: string | null;
  warning: string | null;
  items: ChecklistItem[];
  meta: DocMeta;
}

/** Section F — a known-limitation register entry. */
export interface Limitation {
  id: string;
  module: string;
  title: string;
  severity: Severity;
  status: LimitationStatus;
  impact: string;
  workaround: string;
  ownerRole: string;
  targetPhase: string | null;
  lastUpdated: string;
  link: string | null;
}

/** Section G — a release note. Refs are only ever the REAL value or null. */
export interface ReleaseNote {
  id: string;
  title: string;
  module: string;
  prNumber: number | null;
  commit: string | null;
  deployNumber: number | null;
  date: string; // ISO date
  summary: string;
  changes: string[];
  migrationSummary: string | null;
  safetyNotes: string | null;
  smokeResult: string | null;
  knownLimitations: string | null;
  rollbackNote: string | null;
}

/** Section I — an emergency playbook. */
export interface Playbook {
  id: string;
  title: string;
  severity: Severity;
  symptoms: string[];
  firstChecks: string[];
  whatNotToDo: string[];
  safeSteps: string[];
  escalationPath: string;
  relatedModules: string[];
  auditSecurityNotes: string;
  recoveryChecklist: string[];
  meta: DocMeta;
}

/** Section H — an admin onboarding guide section. */
export interface OnboardingSection {
  id: string;
  order: number;
  title: string;
  body: string;
  steps: string[];
}
