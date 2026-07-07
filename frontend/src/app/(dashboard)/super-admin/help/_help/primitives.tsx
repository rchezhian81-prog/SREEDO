"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { ApiError } from "@/lib/api";
import { Badge, Button, Card } from "@/components/ui";
import { Icon } from "@/components/icons";
import { toast } from "@/components/toast";
import type { HelpLink } from "@/types";
import { downloadFile, moduleStatusLabel, moduleStatusTone } from "./taxonomy";

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

// ---- KPI stat card ---------------------------------------------------------

export function StatCard({
  label,
  value,
  sub,
  hint,
  tone,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  hint?: string;
  tone?: "green" | "red" | "amber";
}) {
  const valueColor =
    tone === "red"
      ? "text-red-600"
      : tone === "amber"
        ? "text-amber-600"
        : tone === "green"
          ? "text-emerald-600"
          : "text-ink";
  return (
    <Card>
      <p className="text-sm font-medium text-muted">{label}</p>
      <div className={`mt-1 text-2xl font-semibold ${valueColor}`}>{value}</div>
      {hint && <p className="mt-1 text-xs text-faint">{hint}</p>}
      {sub && <div className="mt-1.5">{sub}</div>}
    </Card>
  );
}

// ---- module status badge ---------------------------------------------------

export function StatusBadge({ status }: { status?: string | null }) {
  return <Badge tone={moduleStatusTone(status)}>{moduleStatusLabel(status)}</Badge>;
}

// ---- lightweight markdown-ish body renderer --------------------------------
// Trusted curated text: a `\n`-to-`<p>`/`•`/heading render. NOT a markdown lib —
// bullets (- * •), headings (#..####), and blank-line-separated paragraphs only.

export function RichText({ text }: { text: string }) {
  const lines = text.split("\n");
  const blocks: ReactNode[] = [];
  let bullets: string[] = [];

  const flush = (key: string) => {
    if (bullets.length) {
      const items = bullets;
      bullets = [];
      blocks.push(
        <ul key={key} className="ml-4 list-disc space-y-1 text-sm leading-relaxed text-muted">
          {items.map((it, i) => (
            <li key={i}>{it}</li>
          ))}
        </ul>
      );
    }
  };

  lines.forEach((raw, i) => {
    const trimmed = raw.trim();
    if (!trimmed) {
      flush(`ul-${i}`);
      return;
    }
    if (/^[-*•]\s+/.test(trimmed)) {
      bullets.push(trimmed.replace(/^[-*•]\s+/, ""));
      return;
    }
    flush(`ul-${i}`);
    if (/^#{1,4}\s+/.test(trimmed)) {
      blocks.push(
        <p key={i} className="mt-3 text-sm font-semibold text-ink">
          {trimmed.replace(/^#{1,4}\s+/, "")}
        </p>
      );
      return;
    }
    blocks.push(
      <p key={i} className="text-sm leading-relaxed text-muted">
        {trimmed}
      </p>
    );
  });
  flush("ul-end");

  return <div className="space-y-2">{blocks}</div>;
}

// ---- detail helpers (reused by the detail modals) --------------------------

/** A labelled key/value row for detail panels. */
export function KeyVal({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line py-2 last:border-0">
      <span className="text-xs font-semibold uppercase tracking-wide text-faint">{label}</span>
      <span className="text-right text-sm text-ink">{children}</span>
    </div>
  );
}

/** A titled block wrapper used throughout the detail modals. */
export function DetailBlock({
  title,
  icon,
  children,
  tone = "default",
}: {
  title: string;
  icon?: Parameters<typeof Icon>[0]["name"];
  children: ReactNode;
  tone?: "default" | "amber" | "red";
}) {
  const ring =
    tone === "amber"
      ? "border-amber-500/30 bg-amber-500/5"
      : tone === "red"
        ? "border-red-500/30 bg-red-500/5"
        : "border-line bg-surface-2";
  const titleColor =
    tone === "amber"
      ? "text-amber-700 dark:text-amber-400"
      : tone === "red"
        ? "text-red-700 dark:text-red-400"
        : "text-ink";
  return (
    <div className={`rounded-xl border p-3.5 ${ring}`}>
      <p className={`mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide ${titleColor}`}>
        {icon && <Icon name={icon} className="h-3.5 w-3.5" />}
        {title}
      </p>
      <div className="text-sm text-muted">{children}</div>
    </div>
  );
}

/** An ordered step list. */
export function StepList({ steps }: { steps: string[] }) {
  if (steps.length === 0) return <p className="text-sm text-faint">None.</p>;
  return (
    <ol className="ml-4 list-decimal space-y-1.5 text-sm leading-relaxed text-muted">
      {steps.map((s, i) => (
        <li key={i}>{s}</li>
      ))}
    </ol>
  );
}

/** A plain bullet list. */
export function BulletList({ items }: { items: string[] }) {
  if (items.length === 0) return <p className="text-sm text-faint">None.</p>;
  return (
    <ul className="ml-4 list-disc space-y-1 text-sm leading-relaxed text-muted">
      {items.map((s, i) => (
        <li key={i}>{s}</li>
      ))}
    </ul>
  );
}

/**
 * CSV / JSON export buttons for a masked help snapshot (`kind` = modules |
 * checklists | limitations). Streams via the reason-gated downloadFile and
 * surfaces success / failure through a toast.
 */
export function ExportButtons({
  kind,
  filenameBase,
}: {
  kind: "modules" | "checklists" | "limitations";
  filenameBase: string;
}) {
  const [busy, setBusy] = useState<"csv" | "json" | null>(null);

  const run = async (format: "csv" | "json") => {
    setBusy(format);
    try {
      const reason = encodeURIComponent(`Help center ${kind} snapshot`);
      await downloadFile(
        `/help/export?kind=${kind}&format=${format}&reason=${reason}`,
        `${filenameBase}.${format}`
      );
      toast.success(`${kind} ${format.toUpperCase()} export downloaded.`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Export failed");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-wrap gap-2">
      <Button variant="secondary" onClick={() => run("csv")} disabled={busy !== null}>
        <Icon name="fileDown" className="h-4 w-4" />
        {busy === "csv" ? "Preparing…" : "Export CSV"}
      </Button>
      <Button variant="secondary" onClick={() => run("json")} disabled={busy !== null}>
        <Icon name="download" className="h-4 w-4" />
        {busy === "json" ? "Preparing…" : "Export JSON"}
      </Button>
    </div>
  );
}

/** Related-link chips. Internal (/…) links use next/link; external stay as <a>. */
export function LinkList({ links }: { links: HelpLink[] }) {
  if (!links || links.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {links.map((l, i) => {
        const internal = l.href.startsWith("/");
        const cls =
          "inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface-2 px-2.5 py-1 text-xs font-medium text-brand-600 transition hover:bg-hover";
        return internal ? (
          <Link key={i} href={l.href} className={cls}>
            <Icon name="link" className="h-3.5 w-3.5" />
            {l.label}
          </Link>
        ) : (
          <a key={i} href={l.href} target="_blank" rel="noopener noreferrer" className={cls}>
            <Icon name="link" className="h-3.5 w-3.5" />
            {l.label}
          </a>
        );
      })}
    </div>
  );
}
