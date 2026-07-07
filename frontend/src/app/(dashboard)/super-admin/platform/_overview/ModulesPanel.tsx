"use client";

import Link from "next/link";
import { Badge, Card, EmptyState, ErrorNote, Spinner } from "@/components/ui";
import { Icon } from "@/components/icons";
import type { OverviewModuleCard, OverviewSummary } from "@/types";
import { formatNumber } from "../_utils";
import { StatusBadge } from "./primitives";
import { MODULE_ORDER, formatRelative, moduleMeta } from "./taxonomy";

function metricText(metric: OverviewModuleCard["metric"]): string {
  if (metric == null) return "—";
  return typeof metric === "number" ? formatNumber(metric) : String(metric);
}

function ModuleCardView({ moduleKey, card }: { moduleKey: string; card: OverviewModuleCard }) {
  const meta = moduleMeta(moduleKey);

  // Restricted (RBAC-hidden) — subtle placeholder, never zeros.
  if (!card.available) {
    return (
      <div className="rounded-2xl border border-dashed border-line bg-surface/60 p-4">
        <div className="flex items-center gap-2 text-muted">
          <Icon name={meta.icon} className="h-4 w-4 text-faint" />
          <span className="text-sm font-medium">{meta.label}</span>
          <Icon name="lock" className="ml-auto h-3.5 w-3.5 text-faint" />
        </div>
        <p className="mt-2 text-xs text-faint">Restricted.</p>
      </div>
    );
  }

  const content = (
    <>
      <div className="flex items-center gap-2">
        <Icon name={meta.icon} className="h-4 w-4 text-muted" />
        <span className="text-sm font-medium text-ink">{meta.label}</span>
        <span className="ml-auto">
          <StatusBadge status={card.status} />
        </span>
      </div>
      <div className="mt-3 flex items-end justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xl font-semibold text-ink">{metricText(card.metric)}</p>
          {card.metricLabel && <p className="truncate text-xs text-muted">{card.metricLabel}</p>}
        </div>
        {card.attention ? (
          <Badge tone="amber">{formatNumber(card.attention)} to review</Badge>
        ) : null}
      </div>
      {card.lastActivityAt && (
        <p className="mt-2 text-xs text-faint">Last activity {formatRelative(card.lastActivityAt)}</p>
      )}
      {card.drilldown && (
        <span className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-brand-600 group-hover:underline">
          Open
          <Icon name="arrowRight" className="h-3.5 w-3.5" />
        </span>
      )}
    </>
  );

  if (card.drilldown) {
    return (
      <Link
        href={card.drilldown}
        className="group block rounded-2xl border border-line bg-surface p-4 shadow-card transition hover:border-brand-500/40 hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50"
      >
        {content}
      </Link>
    );
  }
  return <Card className="p-4">{content}</Card>;
}

export function ModulesPanel({
  summary,
  loading,
  error,
}: {
  summary: OverviewSummary | null;
  loading: boolean;
  error: string | null;
}) {
  if (error) return <ErrorNote message={error} />;
  if (!summary) return loading ? <Spinner /> : <EmptyState message="No module data available." />;

  const ms = summary.moduleStatus ?? {};
  // Registry order first, then any unlisted keys the API may add later.
  const keys = [
    ...MODULE_ORDER.filter((k) => k in ms),
    ...Object.keys(ms).filter((k) => !MODULE_ORDER.includes(k)),
  ];
  if (keys.length === 0) return <EmptyState message="No modules available." />;

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {keys.map((k) => (
        <ModuleCardView key={k} moduleKey={k} card={ms[k]} />
      ))}
    </div>
  );
}
