"use client";

import { Card, EmptyState, ErrorNote, Spinner } from "@/components/ui";
import { Icon } from "@/components/icons";
import type { OverviewTrendSeries, OverviewTrends } from "@/types";
import { formatNumber } from "../_utils";
import { Sparkline } from "./primitives";
import { TREND_META, type TrendMeta } from "./taxonomy";

function TrendCard({ meta, series }: { meta: TrendMeta; series: OverviewTrendSeries }) {
  const points = series.series;

  return (
    <Card>
      <div className="flex items-center gap-2">
        <Icon name={meta.icon} className="h-4 w-4 text-muted" />
        <p className="text-sm font-medium text-ink">{meta.label}</p>
      </div>

      {points.length === 0 ? (
        // Empty series → the API's honest note. NEVER a fabricated flat line.
        <p className="mt-4 rounded-lg border border-dashed border-line bg-surface/60 px-3 py-4 text-center text-xs text-faint">
          {series.note ?? "Trend begins from collected data."}
        </p>
      ) : (
        <>
          <div className="mt-3 space-y-3">
            {columnsOf(points).map((col) => {
              const values = points.map((p) => Number(p[col]) || 0);
              const total = values.reduce((a, b) => a + b, 0);
              const tone = meta.tones?.[col] ?? meta.tone;
              return (
                <div key={col}>
                  {shouldLabelColumns(points) && (
                    <div className="mb-0.5 flex items-center justify-between text-xs">
                      <span className="capitalize text-muted">{col}</span>
                      <span className="text-faint">{formatNumber(total)}</span>
                    </div>
                  )}
                  <Sparkline values={values} tone={tone} />
                </div>
              );
            })}
          </div>
          <p className="mt-2 text-xs text-faint">
            {points.length} day{points.length === 1 ? "" : "s"} of data
          </p>
        </>
      )}
    </Card>
  );
}

/** Numeric metric columns of a series (every key except the `day` axis). */
function columnsOf(points: OverviewTrends["trends"][string]["series"]): string[] {
  if (points.length === 0) return [];
  return Object.keys(points[0]).filter((k) => k !== "day");
}

function shouldLabelColumns(points: OverviewTrends["trends"][string]["series"]): boolean {
  return columnsOf(points).length > 1;
}

export function TrendsPanel({
  trends,
  loading,
  error,
}: {
  trends: OverviewTrends | null;
  loading: boolean;
  error: string | null;
}) {
  if (error) return <ErrorNote message={error} />;
  if (!trends) return loading ? <Spinner /> : <EmptyState message="No trend data available." />;

  // Render in the registry order; only keys the API returned (RBAC-filtered).
  const present = TREND_META.filter((t) => trends.trends[t.key]);
  if (present.length === 0) {
    return <EmptyState message="No trend metrics available for your access level." />;
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {present.map(({ key, meta }) => (
        <TrendCard key={key} meta={meta} series={trends.trends[key]} />
      ))}
    </div>
  );
}
