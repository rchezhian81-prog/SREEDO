"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { Badge, Card } from "@/components/ui";
import { Icon } from "@/components/icons";
import type { OverviewCardStatus } from "@/types";
import { statusTone, titleCase, type SparkTone } from "./taxonomy";

// ---- headings --------------------------------------------------------------

export function SectionHeading({
  children,
  action,
}: {
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="mb-2 flex items-center justify-between gap-3">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">{children}</h2>
      {action}
    </div>
  );
}

// ---- KPI stat card (optionally a drilldown link) ---------------------------

export function StatCard({
  label,
  value,
  sub,
  hint,
  tone,
  href,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  hint?: string;
  tone?: "green" | "red" | "amber";
  href?: string;
}) {
  const valueColor =
    tone === "red"
      ? "text-red-600"
      : tone === "amber"
        ? "text-amber-600"
        : tone === "green"
          ? "text-emerald-600"
          : "text-ink";

  const body = (
    <>
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium text-muted">{label}</p>
        {href && (
          <Icon
            name="arrowRight"
            className="h-4 w-4 shrink-0 text-faint transition group-hover:text-brand-600"
          />
        )}
      </div>
      <div className={`mt-1 text-2xl font-semibold ${valueColor}`}>{value}</div>
      {hint && <p className="mt-1 text-xs text-faint">{hint}</p>}
      {sub && <div className="mt-1.5">{sub}</div>}
    </>
  );

  if (href) {
    return (
      <Link
        href={href}
        className="group block rounded-2xl border border-line bg-surface p-5 shadow-card transition hover:border-brand-500/40 hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50"
      >
        {body}
      </Link>
    );
  }
  return <Card>{body}</Card>;
}

/**
 * Placeholder for a `{ available: false }` KPI section — the caller lacks the
 * permission to view it. NEVER shown as zeros: it is a distinct restricted card.
 */
export function RestrictedCard({ label }: { label: string }) {
  return (
    <Card className="border-dashed bg-surface/60">
      <div className="flex items-center gap-2">
        <Icon name="lock" className="h-4 w-4 text-faint" />
        <p className="text-sm font-medium text-muted">{label}</p>
      </div>
      <p className="mt-2 text-xs text-faint">
        Restricted — you don&rsquo;t have permission to view this.
      </p>
    </Card>
  );
}

// ---- status badge ----------------------------------------------------------

export function StatusBadge({ status }: { status?: OverviewCardStatus | string | null }) {
  const s = status ?? "unknown";
  return <Badge tone={statusTone(s)}>{titleCase(String(s))}</Badge>;
}

// ---- inline SVG sparkline (no chart lib) -----------------------------------

const SPARK_STROKE: Record<SparkTone, string> = {
  brand: "text-brand-500",
  green: "text-emerald-500",
  amber: "text-amber-500",
  red: "text-red-500",
  violet: "text-violet-500",
};

const VB_W = 120;
const VB_H = 32;
const PAD = 2;

/**
 * A lightweight zero-baselined sparkline drawn as an inline SVG polyline (the
 * fill is anchored to a 0 baseline so bar heights are honest counts). Renders
 * nothing for an empty series — the caller shows the "begins from collected
 * data" note instead, so a flat/fake line is never drawn.
 */
export function Sparkline({ values, tone = "brand" }: { values: number[]; tone?: SparkTone }) {
  if (values.length === 0) return null;
  const max = Math.max(...values, 0);
  const min = Math.min(...values, 0);
  const span = max - min || 1;
  const n = values.length;
  const innerW = VB_W - PAD * 2;
  const innerH = VB_H - PAD * 2;
  const x = (i: number) => (n === 1 ? VB_W / 2 : PAD + (i / (n - 1)) * innerW);
  const y = (v: number) => PAD + innerH - ((v - min) / span) * innerH;
  const line = values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const area = `${PAD},${VB_H - PAD} ${line} ${VB_W - PAD},${VB_H - PAD}`;

  return (
    <svg
      viewBox={`0 0 ${VB_W} ${VB_H}`}
      preserveAspectRatio="none"
      className={`h-8 w-full ${SPARK_STROKE[tone]}`}
      role="img"
      aria-hidden="true"
    >
      <polygon points={area} fill="currentColor" opacity={0.12} />
      <polyline
        points={line}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {n === 1 && <circle cx={VB_W / 2} cy={y(values[0])} r={2.4} fill="currentColor" />}
    </svg>
  );
}
