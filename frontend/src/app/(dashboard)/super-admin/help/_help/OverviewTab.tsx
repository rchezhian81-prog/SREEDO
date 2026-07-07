"use client";

import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { Badge, Card, EmptyState, ErrorNote, Spinner } from "@/components/ui";
import { Icon } from "@/components/icons";
import type { HelpSummary } from "@/types";
import type { HelpTab } from "../page";
import { ExportButtons, SectionHeading, StatCard } from "./primitives";
import { contentTypeMeta, formatDate, formatDateTime } from "./taxonomy";

export function OverviewTab({
  reloadKey,
  onJump,
}: {
  reloadKey: number;
  onJump: (tab: HelpTab) => void;
}) {
  const [data, setData] = useState<HelpSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await api.get<HelpSummary>("/help/summary"));
    } catch (err) {
      setData(null);
      setError(err instanceof ApiError ? err.message : "Failed to load the help dashboard");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load, reloadKey]);

  if (loading) return <Spinner />;
  if (error) return <ErrorNote message={error} />;
  if (!data) return <EmptyState message="No help dashboard data available." />;

  const c = data.counts;

  return (
    <section className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {data.curatedInCode ? (
          <p className="inline-flex items-center gap-2 rounded-lg border border-brand-500/30 bg-brand-500/5 px-3 py-1.5 text-xs text-brand-700 dark:text-brand-300">
            <Icon name="bookOpen" className="h-3.5 w-3.5" />
            Docs are curated in code — this center is read-only documentation, not editable data.
          </p>
        ) : (
          <span />
        )}
        <ExportButtons kind="modules" filenameBase="help-module-status-snapshot" />
      </div>

      {/* Completion + counts */}
      <div>
        <SectionHeading>Documentation coverage</SectionHeading>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          <StatCard
            label="Platform completion"
            value={`${data.completion.percentComplete}%`}
            tone={data.completion.percentComplete >= 80 ? "green" : "amber"}
            sub={
              <button
                onClick={() => onJump("modules")}
                className="text-xs font-medium text-brand-600 hover:underline"
              >
                {data.completion.complete}/{data.completion.total} modules complete ·{" "}
                {data.completion.inProgress} in progress →
              </button>
            }
          />
          <StatCard
            label="Module docs"
            value={c.moduleDocs}
            sub={
              <button
                onClick={() => onJump("modules")}
                className="text-xs font-medium text-brand-600 hover:underline"
              >
                View module status →
              </button>
            }
          />
          <StatCard
            label="Help articles"
            value={c.helpArticles}
            sub={
              <button
                onClick={() => onJump("articles")}
                className="text-xs font-medium text-brand-600 hover:underline"
              >
                Browse articles →
              </button>
            }
          />
          <StatCard
            label="SOPs"
            value={c.sops}
            sub={
              <button
                onClick={() => onJump("sops")}
                className="text-xs font-medium text-brand-600 hover:underline"
              >
                View SOPs →
              </button>
            }
          />
          <StatCard
            label="Checklists"
            value={c.checklists}
            sub={
              <button
                onClick={() => onJump("checklists")}
                className="text-xs font-medium text-brand-600 hover:underline"
              >
                View checklists →
              </button>
            }
          />
          <StatCard
            label="Known limitations"
            value={c.limitations}
            tone={c.limitations > 0 ? "amber" : undefined}
            sub={
              <button
                onClick={() => onJump("limitations")}
                className="text-xs font-medium text-brand-600 hover:underline"
              >
                Review limitations →
              </button>
            }
          />
          <StatCard
            label="Release notes"
            value={c.releaseNotes}
            sub={
              <button
                onClick={() => onJump("releases")}
                className="text-xs font-medium text-brand-600 hover:underline"
              >
                View release notes →
              </button>
            }
          />
          <StatCard
            label="Playbooks"
            value={c.playbooks}
            sub={
              <button
                onClick={() => onJump("playbooks")}
                className="text-xs font-medium text-brand-600 hover:underline"
              >
                Emergency playbooks →
              </button>
            }
          />
        </div>
      </div>

      {/* Health of the docs themselves */}
      <div>
        <SectionHeading>Documentation health</SectionHeading>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            label="Onboarding"
            value={data.onboardingStatus.available ? "Available" : "Unavailable"}
            tone={data.onboardingStatus.available ? "green" : "amber"}
            sub={
              <button
                onClick={() => onJump("onboarding")}
                className="text-xs font-medium text-brand-600 hover:underline"
              >
                {data.onboardingStatus.sections} sections →
              </button>
            }
          />
          <StatCard
            label="Docs needing review"
            value={data.docsNeedingReview.length}
            tone={data.docsNeedingReview.length > 0 ? "amber" : "green"}
            hint={data.docsNeedingReview.length === 0 ? "All reviewed" : "Flagged needs_review"}
          />
          <StatCard
            label="Critical runbooks"
            value={data.criticalRunbooks.length}
            tone={data.criticalRunbooks.length > 0 ? "red" : undefined}
            sub={
              <button
                onClick={() => onJump("playbooks")}
                className="text-xs font-medium text-brand-600 hover:underline"
              >
                View playbooks →
              </button>
            }
          />
          <StatCard
            label="Last documentation update"
            value={<span className="text-base">{formatDate(data.lastDocumentationUpdate)}</span>}
            hint={`Snapshot ${formatDateTime(data.generatedAt)}`}
          />
        </div>
      </div>

      {/* Recently updated + docs needing review */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-0">
          <div className="border-b border-line px-5 py-3">
            <p className="text-sm font-semibold text-ink">Recently updated</p>
          </div>
          {data.recentlyUpdated.length === 0 ? (
            <p className="px-5 py-6 text-sm text-muted">No documentation recorded yet.</p>
          ) : (
            <ul className="divide-y divide-line">
              {data.recentlyUpdated.map((r) => {
                const meta = contentTypeMeta(r.type);
                return (
                  <li
                    key={`${r.type}-${r.id}`}
                    className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-sm"
                  >
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <Icon name={meta.icon} className="h-4 w-4 shrink-0 text-faint" />
                      <span className="truncate font-medium text-ink">{r.title}</span>
                      <Badge tone="slate">{meta.label}</Badge>
                      {r.module && <span className="text-xs text-faint">· {r.module}</span>}
                    </div>
                    <span className="whitespace-nowrap text-xs text-faint">
                      {formatDate(r.lastUpdated)}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <Card className="p-0">
          <div className="flex items-center justify-between border-b border-line px-5 py-3">
            <p className="text-sm font-semibold text-ink">Docs needing review</p>
            <Badge tone={data.docsNeedingReview.length > 0 ? "amber" : "green"}>
              {data.docsNeedingReview.length}
            </Badge>
          </div>
          {data.docsNeedingReview.length === 0 ? (
            <p className="px-5 py-6 text-sm text-muted">Every reviewed doc is up to date.</p>
          ) : (
            <ul className="divide-y divide-line">
              {data.docsNeedingReview.map((d) => {
                const meta = contentTypeMeta(d.type);
                return (
                  <li
                    key={`${d.type}-${d.id}`}
                    className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-sm"
                  >
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <Icon name={meta.icon} className="h-4 w-4 shrink-0 text-faint" />
                      <span className="truncate font-medium text-ink">{d.title}</span>
                    </div>
                    <Badge tone="slate">{meta.label}</Badge>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>

      {data.criticalRunbooks.length > 0 && (
        <Card className="border-red-500/30 bg-red-500/5 p-0">
          <div className="flex items-center gap-2 border-b border-red-500/20 px-5 py-3">
            <Icon name="shieldAlert" className="h-4 w-4 text-red-600" />
            <p className="text-sm font-semibold text-ink">Critical runbooks</p>
          </div>
          <ul className="divide-y divide-line">
            {data.criticalRunbooks.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-2 px-5 py-3 text-sm">
                <span className="min-w-0 truncate font-medium text-ink">{r.title}</span>
                <button
                  onClick={() => onJump("playbooks")}
                  className="whitespace-nowrap text-xs font-medium text-brand-600 hover:underline"
                >
                  Open playbook →
                </button>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </section>
  );
}
