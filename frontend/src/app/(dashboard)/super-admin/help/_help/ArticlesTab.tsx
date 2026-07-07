"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { Badge, Card, EmptyState, ErrorNote, Input, Modal, Select, Spinner } from "@/components/ui";
import { Icon } from "@/components/icons";
import type { HelpArticle, HelpArticlesResponse } from "@/types";
import { KeyVal, LinkList, RichText } from "./primitives";
import { formatDate, humanizeToken, reviewStatusTone, titleCase } from "./taxonomy";

const CATEGORIES = [
  "getting_started",
  "tenant_management",
  "billing_and_invoices",
  "subscriptions",
  "security_and_rbac",
  "audit_and_compliance",
  "support_access",
  "backup_and_restore",
  "data_exports",
  "observability_and_jobs",
  "communication",
  "troubleshooting",
  "release_notes",
  "sops_and_playbooks",
];

export function ArticlesTab({ reloadKey }: { reloadKey: number }) {
  const [q, setQ] = useState("");
  const [module, setModule] = useState("");
  const [category, setCategory] = useState("");
  const [data, setData] = useState<HelpArticle[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [knownModules, setKnownModules] = useState<string[]>([]);
  const [active, setActive] = useState<HelpArticle | null>(null);

  const query = useMemo(() => {
    const p = new URLSearchParams();
    if (q.trim()) p.set("q", q.trim());
    if (module) p.set("module", module);
    if (category) p.set("category", category);
    return p.toString();
  }, [q, module, category]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get<HelpArticlesResponse>(`/help/articles?${query}`);
      setData(res.articles);
      // Grow (never shrink) the module filter options as content is seen.
      setKnownModules((prev) => {
        const set = new Set(prev);
        res.articles.forEach((a) => a.module && set.add(a.module));
        return [...set].sort();
      });
    } catch (err) {
      setData(null);
      setError(err instanceof ApiError ? err.message : "Failed to load help articles");
    } finally {
      setLoading(false);
    }
  }, [query]);

  useEffect(() => {
    load();
  }, [load, reloadKey]);

  return (
    <section className="space-y-4">
      <Card className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search articles by title or content…"
          aria-label="Search articles"
        />
        <Select value={module} onChange={(e) => setModule(e.target.value)} aria-label="Filter by module">
          <option value="">All modules</option>
          {knownModules.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </Select>
        <Select value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Filter by category">
          <option value="">All categories</option>
          {CATEGORIES.map((cItem) => (
            <option key={cItem} value={cItem}>
              {humanizeToken(cItem)}
            </option>
          ))}
        </Select>
      </Card>

      <ErrorNote message={error} />

      {loading ? (
        <Spinner />
      ) : !data ? (
        !error && <EmptyState message="No help articles available." />
      ) : data.length === 0 ? (
        <EmptyState message="No articles match these filters." />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {data.map((a) => (
            <button
              key={a.id}
              onClick={() => setActive(a)}
              className="group flex flex-col rounded-2xl border border-line bg-surface p-5 text-left shadow-card transition hover:border-brand-500/40 hover:bg-hover"
            >
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <Badge tone="blue">{humanizeToken(a.category)}</Badge>
                {a.module && <Badge tone="slate">{a.module}</Badge>}
                <Badge tone={reviewStatusTone(a.meta.reviewStatus)}>
                  {humanizeToken(a.meta.reviewStatus)}
                </Badge>
              </div>
              <p className="font-semibold text-ink group-hover:text-brand-600">{a.title}</p>
              <p className="mt-1 line-clamp-2 text-sm text-muted">{a.summary}</p>
              <p className="mt-3 text-xs text-faint">
                Applies to {a.appliesToRole} · v{a.meta.version} · {formatDate(a.meta.lastUpdated)}
              </p>
            </button>
          ))}
        </div>
      )}

      <ArticleModal article={active} onClose={() => setActive(null)} />
    </section>
  );
}

export function ArticleModal({
  article,
  onClose,
}: {
  article: HelpArticle | null;
  onClose: () => void;
}) {
  if (!article) return null;
  return (
    <Modal title={article.title} open={article !== null} onClose={onClose}>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="blue">{humanizeToken(article.category)}</Badge>
          {article.module && <Badge tone="slate">{article.module}</Badge>}
          <Badge tone={reviewStatusTone(article.meta.reviewStatus)}>
            {humanizeToken(article.meta.reviewStatus)}
          </Badge>
        </div>

        <p className="text-sm italic text-muted">{article.summary}</p>

        <div className="rounded-xl border border-line bg-surface-2 p-4">
          <RichText text={article.body} />
        </div>

        {article.relatedLinks.length > 0 && (
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Related</p>
            <LinkList links={article.relatedLinks} />
          </div>
        )}

        <div className="rounded-xl border border-line">
          <div className="px-4">
            <KeyVal label="Applies to">{article.appliesToRole}</KeyVal>
            <KeyVal label="Version">v{article.meta.version}</KeyVal>
            <KeyVal label="Last updated">
              {formatDate(article.meta.lastUpdated)} · {article.meta.lastUpdatedBy}
            </KeyVal>
            <KeyVal label="Review status">
              <Badge tone={reviewStatusTone(article.meta.reviewStatus)}>
                {titleCase(article.meta.reviewStatus.replace(/_/g, " "))}
              </Badge>
            </KeyVal>
            {article.meta.reviewedBy && <KeyVal label="Reviewed by">{article.meta.reviewedBy}</KeyVal>}
            {article.meta.nextReviewDate && (
              <KeyVal label="Next review">{formatDate(article.meta.nextReviewDate)}</KeyVal>
            )}
            {article.meta.moduleOwner && <KeyVal label="Module owner">{article.meta.moduleOwner}</KeyVal>}
          </div>
        </div>
      </div>
    </Modal>
  );
}
