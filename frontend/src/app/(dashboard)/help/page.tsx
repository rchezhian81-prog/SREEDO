"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { api, ApiError } from "@/lib/api";
import { usePermissions } from "@/lib/use-permissions";
import { useTerms } from "@/lib/terms";
import { Icon, type IconName } from "@/components/icons";
import {
  Badge, Button, Card, EmptyState, ErrorNote, Input, Modal, PageHeader, Spinner,
} from "@/components/ui";

// PR-T10 — Tenant Help & SOP center (read-only curated docs, tenant_help:read).
// Content arrives already filtered to this institution's type (school/college).
// Fully separate from the super-admin help console — no shared imports.

interface DocMeta { version: string; lastUpdated: string; reviewStatus: string }
interface HelpLink { label: string; href: string }
interface Article {
  id: string; title: string; category: string; appliesTo: string;
  summary: string; body: string; links: HelpLink[]; meta: DocMeta;
}
interface Sop {
  id: string; title: string; category: string; appliesTo: string;
  purpose: string; steps: string[]; safetyWarnings: string[];
  auditExpectation: string; links: HelpLink[]; meta: DocMeta;
}
interface GsStep { title: string; description: string; href: string }
interface GsSection { id: string; title: string; appliesTo: string; steps: GsStep[] }
interface SearchHit { type: string; id: string; title: string; category: string; snippet: string }

type Tab = "getting-started" | "articles" | "sops";
const TABS: { key: Tab; label: string; icon: IconName }[] = [
  { key: "getting-started", label: "Getting started", icon: "rocket" },
  { key: "articles", label: "Articles", icon: "bookOpen" },
  { key: "sops", label: "SOPs", icon: "clipboard" },
];
const HIT_TONE: Record<string, "blue" | "green" | "amber"> = {
  article: "blue", sop: "green", "getting-started": "amber",
};

// Lightweight markdown-ish renderer for trusted curated text — bullets (- * •),
// #-headings and blank-line paragraphs only (same convention as the corpus).
function RichText({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  let bullets: string[] = [];
  const flush = (key: string) => {
    if (!bullets.length) return;
    const items = bullets;
    bullets = [];
    blocks.push(
      <ul key={key} className="ml-4 list-disc space-y-1 text-sm leading-relaxed text-muted">
        {items.map((it, i) => <li key={i}>{it}</li>)}
      </ul>
    );
  };
  text.split("\n").forEach((raw, i) => {
    const line = raw.trim();
    if (!line) { flush(`u${i}`); return; }
    if (/^[-*•]\s+/.test(line)) { bullets.push(line.replace(/^[-*•]\s+/, "")); return; }
    flush(`u${i}`);
    if (/^#{1,4}\s+/.test(line)) {
      blocks.push(<p key={i} className="mt-3 text-sm font-semibold text-ink">{line.replace(/^#{1,4}\s+/, "")}</p>);
      return;
    }
    blocks.push(<p key={i} className="text-sm leading-relaxed text-muted">{line}</p>);
  });
  flush("uend");
  return <div className="space-y-2">{blocks}</div>;
}

function DocLinks({ links }: { links: HelpLink[] }) {
  if (!links.length) return null;
  return (
    <div className="flex flex-wrap gap-2 border-t border-line pt-3">
      {links.map((l) => (
        <Link key={l.href} href={l.href}
          className="inline-flex items-center gap-1 rounded-full border border-line bg-surface-2 px-3 py-1 text-xs font-medium text-ink hover:border-brand-500">
          {l.label} <Icon name="arrowRight" className="h-3 w-3" />
        </Link>
      ))}
    </div>
  );
}

export default function TenantHelpPage() {
  const { can, loading: permLoading } = usePermissions();
  const canRead = can("tenant_help:read");
  const term = useTerms();
  const [tab, setTab] = useState<Tab>("getting-started");
  const [gs, setGs] = useState<GsSection[] | null>(null);
  const [articles, setArticles] = useState<Article[] | null>(null);
  const [sops, setSops] = useState<Sop[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [openArticle, setOpenArticle] = useState<Article | null>(null);
  const [openSop, setOpenSop] = useState<Sop | null>(null);

  const load = useCallback(async (which: Tab) => {
    setError(null);
    try {
      if (which === "getting-started" && !gs) setGs(await api.get<GsSection[]>("/tenant-help/getting-started"));
      if (which === "articles" && !articles) setArticles(await api.get<Article[]>("/tenant-help/articles"));
      if (which === "sops" && !sops) setSops(await api.get<Sop[]>("/tenant-help/sops"));
    } catch (e) { setError(e instanceof ApiError ? e.message : "Failed to load help content"); }
  }, [gs, articles, sops]);
  // Depend on the stable canRead boolean, never the `can` function identity.
  useEffect(() => { if (canRead) load(tab); }, [tab, canRead, load]);

  const search = async (evt: React.FormEvent) => {
    evt.preventDefault();
    if (!q.trim()) { setHits(null); return; }
    setSearching(true); setError(null);
    try { setHits(await api.get<SearchHit[]>(`/tenant-help/search?q=${encodeURIComponent(q.trim())}`)); }
    catch (e) { setError(e instanceof ApiError ? e.message : "Search failed"); }
    finally { setSearching(false); }
  };

  const openHit = async (hit: SearchHit) => {
    setError(null);
    try {
      if (hit.type === "article") setOpenArticle(await api.get<Article>(`/tenant-help/articles/${hit.id}`));
      else if (hit.type === "sop") setOpenSop(await api.get<Sop>(`/tenant-help/sops/${hit.id}`));
      else { setHits(null); setQ(""); setTab("getting-started"); }
    } catch (e) { setError(e instanceof ApiError ? e.message : "Failed to open document"); }
  };

  if (permLoading) return <Spinner />;
  if (!canRead) {
    return (
      <>
        <PageHeader title="Help & SOP" subtitle="Guides and procedures for running your institution" />
        <EmptyState message="You don't have access to the help center." />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Help & SOP"
        subtitle={`Guides, how-tos and standard procedures for your ${term.klassPlural.toLowerCase()}, ${term.students.toLowerCase()}, fees and daily operations`}
      />

      <form onSubmit={search} className="mb-4 flex max-w-xl gap-2">
        <Input placeholder="Search articles, SOPs and setup guides…" value={q} onChange={(e) => setQ(e.target.value)} />
        <Button type="submit" disabled={searching}>{searching ? "…" : "Search"}</Button>
        {hits !== null && (
          <Button type="button" variant="secondary" onClick={() => { setHits(null); setQ(""); }}>Clear</Button>
        )}
      </form>
      <ErrorNote message={error} />

      {hits !== null ? (
        hits.length === 0 ? <EmptyState message="No documents match your search." /> : (
          <div className="space-y-2">
            {hits.map((h) => (
              <button key={`${h.type}-${h.id}`} onClick={() => openHit(h)}
                className="block w-full rounded-xl border border-line bg-surface p-4 text-left hover:border-brand-500">
                <div className="flex items-center gap-2">
                  <Badge tone={HIT_TONE[h.type] ?? "slate"}>{h.type === "getting-started" ? "guide" : h.type}</Badge>
                  <span className="text-sm font-medium text-ink">{h.title}</span>
                </div>
                <p className="mt-1 text-xs text-muted">{h.snippet}</p>
              </button>
            ))}
          </div>
        )
      ) : (
        <>
          <div className="mb-4 flex flex-wrap gap-2">
            {TABS.map((t) => (
              <button key={t.key} onClick={() => setTab(t.key)}
                className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition ${
                  tab === t.key ? "bg-brand-600 text-white" : "border border-line bg-surface text-muted hover:text-ink"
                }`}>
                <Icon name={t.icon} className="h-4 w-4" /> {t.label}
              </button>
            ))}
          </div>

          {tab === "getting-started" && (
            gs === null ? <Spinner /> : gs.length === 0 ? <EmptyState message="No setup guides yet." /> : (
              <div className="space-y-5">
                {gs.map((section) => (
                  <Card key={section.id}>
                    <h2 className="mb-3 text-base font-semibold text-ink">{section.title}</h2>
                    <ol className="space-y-3">
                      {section.steps.map((s, i) => (
                        <li key={s.href + i} className="flex gap-3">
                          <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-500/12 text-xs font-semibold text-brand-600 dark:text-brand-300">{i + 1}</span>
                          <div>
                            <Link href={s.href} className="text-sm font-medium text-ink hover:text-brand-600">
                              {s.title} <Icon name="arrowRight" className="inline h-3 w-3" />
                            </Link>
                            <p className="mt-0.5 text-sm leading-relaxed text-muted">{s.description}</p>
                          </div>
                        </li>
                      ))}
                    </ol>
                  </Card>
                ))}
              </div>
            )
          )}

          {tab === "articles" && (
            articles === null ? <Spinner /> : articles.length === 0 ? <EmptyState message="No articles yet." /> : (
              <div className="grid gap-4 sm:grid-cols-2">
                {articles.map((a) => (
                  <button key={a.id} onClick={() => setOpenArticle(a)}
                    className="rounded-2xl border border-line bg-surface p-5 text-left shadow-card transition hover:border-brand-500">
                    <div className="mb-2 flex items-center gap-2">
                      <Badge tone="blue">{a.category}</Badge>
                      {a.appliesTo !== "both" && <Badge tone="slate">{a.appliesTo}</Badge>}
                    </div>
                    <div className="text-sm font-semibold text-ink">{a.title}</div>
                    <p className="mt-1 text-sm leading-relaxed text-muted">{a.summary}</p>
                  </button>
                ))}
              </div>
            )
          )}

          {tab === "sops" && (
            sops === null ? <Spinner /> : sops.length === 0 ? <EmptyState message="No SOPs yet." /> : (
              <div className="grid gap-4 sm:grid-cols-2">
                {sops.map((s) => (
                  <button key={s.id} onClick={() => setOpenSop(s)}
                    className="rounded-2xl border border-line bg-surface p-5 text-left shadow-card transition hover:border-brand-500">
                    <div className="mb-2 flex items-center gap-2">
                      <Badge tone="green">{s.category}</Badge>
                      {s.appliesTo !== "both" && <Badge tone="slate">{s.appliesTo}</Badge>}
                      <span className="text-xs text-faint">{s.steps.length} steps</span>
                    </div>
                    <div className="text-sm font-semibold text-ink">{s.title}</div>
                    <p className="mt-1 text-sm leading-relaxed text-muted">{s.purpose}</p>
                  </button>
                ))}
              </div>
            )
          )}
        </>
      )}

      {openArticle && (
        <Modal title={openArticle.title} open onClose={() => setOpenArticle(null)}>
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <Badge tone="blue">{openArticle.category}</Badge>
              <span className="text-xs text-faint">Updated {openArticle.meta.lastUpdated}</span>
            </div>
            <RichText text={openArticle.body} />
            <DocLinks links={openArticle.links} />
          </div>
        </Modal>
      )}

      {openSop && (
        <Modal title={openSop.title} open onClose={() => setOpenSop(null)}>
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <Badge tone="green">{openSop.category}</Badge>
              <span className="text-xs text-faint">Updated {openSop.meta.lastUpdated}</span>
            </div>
            <p className="text-sm leading-relaxed text-muted">{openSop.purpose}</p>
            <ol className="ml-4 list-decimal space-y-1.5 text-sm leading-relaxed text-ink">
              {openSop.steps.map((st, i) => <li key={i} className="text-muted"><span className="text-ink">{st}</span></li>)}
            </ol>
            {openSop.safetyWarnings.length > 0 && (
              <div className="rounded-lg border border-amber-300/50 bg-amber-500/10 p-3">
                <div className="mb-1 text-xs font-semibold uppercase text-amber-700 dark:text-amber-300">Before you start</div>
                <ul className="ml-4 list-disc space-y-1 text-sm text-muted">
                  {openSop.safetyWarnings.map((w, i) => <li key={i}>{w}</li>)}
                </ul>
              </div>
            )}
            <div className="rounded-lg border border-line bg-surface-2 p-3 text-sm text-muted">
              <span className="font-medium text-ink">Audit trail: </span>{openSop.auditExpectation}
            </div>
            <DocLinks links={openSop.links} />
          </div>
        </Modal>
      )}
    </>
  );
}
