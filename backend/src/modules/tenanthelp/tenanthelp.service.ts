import { ApiError } from "../../utils/api-error";
import {
  getInstitutionType,
  type InstitutionType,
} from "../../middleware/institution-type";
import type {
  GettingStartedSection,
  TenantHelpArticle,
  TenantHelpSearchHit,
  TenantHelpSummary,
  TenantSop,
} from "./tenanthelp.types";
import { gettingStartedSections } from "./content/getting-started";
import { tenantHelpArticles } from "./content/articles";
import { tenantSops } from "./content/sops";

// Read-only service over the in-code registries. Every list is filtered by the
// caller's institution type server-side (school never sees college-only docs
// and vice-versa), so responses are mode-appropriate without client logic.

const applies = (docApplies: string, type: InstitutionType): boolean =>
  docApplies === "both" || docApplies === type;

const matches = (q: string | undefined, ...fields: (string | string[])[]): boolean => {
  if (!q) return true;
  const needle = q.toLowerCase();
  return fields.some((f) =>
    Array.isArray(f)
      ? f.some((s) => s.toLowerCase().includes(needle))
      : f.toLowerCase().includes(needle)
  );
};

const snippet = (text: string, max = 180): string => {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`;
};

export async function summary(institutionId: string): Promise<TenantHelpSummary> {
  const type = await getInstitutionType(institutionId);
  const articles = tenantHelpArticles.filter((a) => applies(a.appliesTo, type));
  const sops = tenantSops.filter((s) => applies(s.appliesTo, type));
  const sections = gettingStartedSections.filter((g) => applies(g.appliesTo, type));
  const lastUpdated = [...articles, ...sops, ...sections]
    .map((d) => d.meta.lastUpdated)
    .sort()
    .at(-1) ?? "";
  return {
    articles: articles.length,
    sops: sops.length,
    gettingStartedSections: sections.length,
    curatedInCode: true,
    lastUpdated,
  };
}

export async function gettingStarted(institutionId: string): Promise<GettingStartedSection[]> {
  const type = await getInstitutionType(institutionId);
  return gettingStartedSections.filter((g) => applies(g.appliesTo, type));
}

export async function listArticles(
  institutionId: string,
  filters: { q?: string; category?: string }
): Promise<TenantHelpArticle[]> {
  const type = await getInstitutionType(institutionId);
  return tenantHelpArticles.filter(
    (a) =>
      applies(a.appliesTo, type) &&
      (!filters.category || a.category === filters.category) &&
      matches(filters.q, a.title, a.summary, a.body)
  );
}

export async function getArticle(
  institutionId: string,
  id: string
): Promise<TenantHelpArticle> {
  const type = await getInstitutionType(institutionId);
  const article = tenantHelpArticles.find((a) => a.id === id);
  // Out-of-mode docs are absent, not forbidden — same as the list view.
  if (!article || !applies(article.appliesTo, type)) {
    throw ApiError.notFound("Help article not found");
  }
  return article;
}

export async function listSops(
  institutionId: string,
  filters: { q?: string; category?: string }
): Promise<TenantSop[]> {
  const type = await getInstitutionType(institutionId);
  return tenantSops.filter(
    (s) =>
      applies(s.appliesTo, type) &&
      (!filters.category || s.category === filters.category) &&
      matches(filters.q, s.title, s.purpose, s.steps, s.safetyWarnings)
  );
}

export async function getSop(institutionId: string, id: string): Promise<TenantSop> {
  const type = await getInstitutionType(institutionId);
  const sop = tenantSops.find((s) => s.id === id);
  if (!sop || !applies(sop.appliesTo, type)) {
    throw ApiError.notFound("SOP not found");
  }
  return sop;
}

export async function search(
  institutionId: string,
  q: string | undefined,
  typeFilter?: "article" | "sop" | "getting-started"
): Promise<TenantHelpSearchHit[]> {
  const type = await getInstitutionType(institutionId);
  const hits: TenantHelpSearchHit[] = [];
  if (!typeFilter || typeFilter === "article") {
    for (const a of tenantHelpArticles) {
      if (applies(a.appliesTo, type) && matches(q, a.title, a.summary, a.body)) {
        hits.push({ type: "article", id: a.id, title: a.title, category: a.category, snippet: snippet(a.summary) });
      }
    }
  }
  if (!typeFilter || typeFilter === "sop") {
    for (const s of tenantSops) {
      if (applies(s.appliesTo, type) && matches(q, s.title, s.purpose, s.steps)) {
        hits.push({ type: "sop", id: s.id, title: s.title, category: s.category, snippet: snippet(s.purpose) });
      }
    }
  }
  if (!typeFilter || typeFilter === "getting-started") {
    for (const g of gettingStartedSections) {
      const stepText = g.steps.map((st) => `${st.title} ${st.description}`);
      if (applies(g.appliesTo, type) && matches(q, g.title, stepText)) {
        hits.push({
          type: "getting-started",
          id: g.id,
          title: g.title,
          category: "getting-started",
          snippet: snippet(g.steps.map((st) => st.title).join(" · ")),
        });
      }
    }
  }
  return hits;
}

// ---- content hygiene (used by the build-time integration test) --------------
// The corpus ships inside the image, so a leaked credential would ship too.
// High-precision patterns only (same idea as the platform help center's scan,
// implemented independently — no super-admin import).

const SECRET_PATTERNS: RegExp[] = [
  /sk-[A-Za-z0-9]{20,}/, // OpenAI-style keys
  /AKIA[0-9A-Z]{16}/, // AWS access key ids
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/, // JWTs
  /\b(password|passwd|secret|token|api[_-]?key)\s*[:=]\s*['"][^'"]{8,}['"]/i,
];

/** Every string bundled in the tenant help corpus (for the no-secrets test). */
export function allBundledStrings(): string[] {
  const out: string[] = [];
  const push = (v: unknown): void => {
    if (typeof v === "string") out.push(v);
    else if (Array.isArray(v)) v.forEach(push);
    else if (v && typeof v === "object") Object.values(v).forEach(push);
  };
  push(gettingStartedSections);
  push(tenantHelpArticles);
  push(tenantSops);
  return out;
}

/** Strings that look like credentials (should always be empty). */
export function scanForSecrets(): string[] {
  return allBundledStrings().filter((s) => SECRET_PATTERNS.some((p) => p.test(s)));
}
