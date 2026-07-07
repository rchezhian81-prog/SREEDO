"use client";

import Link from "next/link";
import { Icon, type IconName } from "@/components/icons";
import type { OverviewAttention, OverviewCardStatus, OverviewSummary } from "@/types";
import { SectionHeading } from "./primitives";

interface StripAlert {
  tone: "red" | "amber";
  text: string;
  href: string;
  icon: IconName;
}

/**
 * Compact top-of-page alert strip. Composed from the summary's health/operations
 * status (platform degraded / outage) plus the CRITICAL attention items (real
 * severities + real action links, already masked). Link-only — management lives
 * in the source module. Hidden entirely when nothing is wrong.
 */
export function AlertStrip({
  summary,
  attention,
}: {
  summary: OverviewSummary | null;
  attention: OverviewAttention | null;
}) {
  const alerts: StripAlert[] = [];
  const seen = new Set<string>();
  const add = (a: StripAlert) => {
    if (seen.has(a.text)) return;
    seen.add(a.text);
    alerts.push(a);
  };

  // Platform status (worst of health + operations).
  if (summary) {
    const statuses: OverviewCardStatus[] = [];
    if (summary.health.available) statuses.push(summary.health.status);
    if (summary.operations.available && summary.operations.status) {
      statuses.push(summary.operations.status);
    }
    const opsHref =
      (summary.operations.available && summary.operations.drilldown) ||
      (summary.health.available && summary.health.drilldown) ||
      "/super-admin/observability";
    if (statuses.includes("critical")) {
      add({ tone: "red", text: "Platform outage — services critical", href: opsHref, icon: "alert" });
    } else if (statuses.includes("warning")) {
      add({ tone: "amber", text: "Platform degraded — check services", href: opsHref, icon: "shieldAlert" });
    }
  }

  // Critical attention items (blockers) link to their source module.
  if (attention) {
    for (const item of attention.items) {
      if (item.severity !== "critical") continue;
      add({ tone: "red", text: item.summary, href: item.actionLink, icon: "alert" });
    }
  }

  if (alerts.length === 0) return null;

  return (
    <div>
      <SectionHeading>Platform alerts</SectionHeading>
      <div className="grid gap-2 sm:grid-cols-2">
        {alerts.map((a, i) => (
          <Link
            key={i}
            href={a.href}
            className={`flex items-center justify-between gap-2 rounded-xl border px-3.5 py-2.5 text-sm font-medium transition ${
              a.tone === "red"
                ? "border-red-500/30 bg-red-500/10 text-red-700 hover:bg-red-500/15 dark:text-red-300"
                : "border-amber-500/30 bg-amber-500/10 text-amber-700 hover:bg-amber-500/15 dark:text-amber-300"
            }`}
          >
            <span className="flex min-w-0 items-center gap-2">
              <Icon name={a.icon} className="h-4 w-4 shrink-0" />
              <span className="truncate">{a.text}</span>
            </span>
            <Icon name="arrowRight" className="h-4 w-4 shrink-0 opacity-70" />
          </Link>
        ))}
      </div>
    </div>
  );
}
