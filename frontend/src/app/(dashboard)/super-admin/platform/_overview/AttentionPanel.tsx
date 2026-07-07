"use client";

import Link from "next/link";
import { Badge, Card, EmptyState, ErrorNote, Spinner } from "@/components/ui";
import { Icon } from "@/components/icons";
import type { OverviewAttention } from "@/types";
import { formatRelative, severityTone, sourceMeta, titleCase } from "./taxonomy";

export function AttentionPanel({
  attention,
  loading,
  error,
}: {
  attention: OverviewAttention | null;
  loading: boolean;
  error: string | null;
}) {
  if (error) return <ErrorNote message={error} />;
  if (!attention) return loading ? <Spinner /> : <EmptyState message="No attention data available." />;
  if (attention.items.length === 0) return <EmptyState message="Nothing needs attention 🎉" />;

  return (
    <Card className="p-0">
      <ul className="divide-y divide-line">
        {attention.items.map((item, i) => {
          const src = sourceMeta(item.sourceModule);
          return (
            <li
              key={`${item.sourceModule}-${i}`}
              className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 px-5 py-3 text-sm"
            >
              <div className="flex min-w-0 flex-1 items-center gap-2">
                <Badge tone={severityTone(item.severity)}>{titleCase(item.severity)}</Badge>
                <span className="min-w-0 truncate text-ink" title={item.summary}>
                  {item.summary}
                </span>
              </div>
              <div className="flex items-center gap-3">
                <span className="inline-flex items-center gap-1 text-xs text-muted">
                  <Icon name={src.icon} className="h-3.5 w-3.5 text-faint" />
                  {src.label}
                </span>
                <span className="hidden text-xs text-faint sm:inline">
                  {formatRelative(item.createdAt)}
                </span>
                <Link
                  href={item.actionLink}
                  className="inline-flex items-center gap-1 text-xs font-medium text-brand-600 hover:underline"
                >
                  Action
                  <Icon name="arrowRight" className="h-3.5 w-3.5" />
                </Link>
              </div>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
