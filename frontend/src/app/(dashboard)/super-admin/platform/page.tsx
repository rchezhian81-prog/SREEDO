"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { Button, Field, Input, Modal, PageHeader, Spinner, Textarea } from "@/components/ui";
import { Icon } from "@/components/icons";
import { toast } from "@/components/toast";
import type {
  OverviewAttention,
  OverviewQuickActions,
  OverviewSummary,
  OverviewTrends,
  OverviewWindow,
} from "@/types";
import { usePlatformGuard } from "./_guard";
import { AlertStrip } from "./_overview/AlertStrip";
import { AttentionPanel } from "./_overview/AttentionPanel";
import { KpiCards } from "./_overview/KpiCards";
import { MaintenancePanel } from "./_overview/MaintenancePanel";
import { ModulesPanel } from "./_overview/ModulesPanel";
import { QuickActions } from "./_overview/QuickActions";
import { SectionHeading } from "./_overview/primitives";
import { TrendsPanel } from "./_overview/TrendsPanel";
import {
  OVERVIEW_WINDOWS,
  downloadFile,
  formatDateTime,
  windowLabel,
} from "./_overview/taxonomy";

const AUTO_REFRESH_MS = 60_000;

function errMsg(e: unknown, what: string): string {
  return e instanceof ApiError ? e.message : `Failed to load ${what}`;
}

export default function PlatformOverviewPage() {
  const { ready, gate } = usePlatformGuard(
    "Platform Overview",
    "Executive & operations command center"
  );

  // Window / range controls.
  const [win, setWin] = useState<OverviewWindow>("30d");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  // Per-endpoint data + error (each section renders its own state).
  const [summary, setSummary] = useState<OverviewSummary | null>(null);
  const [summaryErr, setSummaryErr] = useState<string | null>(null);
  const [attention, setAttention] = useState<OverviewAttention | null>(null);
  const [attentionErr, setAttentionErr] = useState<string | null>(null);
  const [trends, setTrends] = useState<OverviewTrends | null>(null);
  const [trendsErr, setTrendsErr] = useState<string | null>(null);
  const [actions, setActions] = useState<OverviewQuickActions | null>(null);
  const [actionsErr, setActionsErr] = useState<string | null>(null);

  const [loading, setLoading] = useState(true);
  const [refreshedAt, setRefreshedAt] = useState<Date | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(false);

  // Export modal.
  const [exportOpen, setExportOpen] = useState(false);
  const [exportReason, setExportReason] = useState("");
  const [exportBusy, setExportBusy] = useState(false);

  const query = useMemo(() => {
    const p = new URLSearchParams();
    p.set("window", win);
    if (win === "custom") {
      if (dateFrom) p.set("dateFrom", dateFrom);
      if (dateTo) p.set("dateTo", dateTo);
    }
    return p.toString();
  }, [win, dateFrom, dateTo]);

  const load = useCallback(async () => {
    setLoading(true);
    // attention + quick-actions ignore the window (backend contract); summary +
    // trends take it. Each call fails independently so one 403 can't blank the page.
    const [s, a, t, qa] = await Promise.all([
      api
        .get<OverviewSummary>(`/overview/summary?${query}`)
        .then((d) => {
          setSummaryErr(null);
          return d;
        })
        .catch((e) => {
          setSummaryErr(errMsg(e, "overview summary"));
          return null;
        }),
      api
        .get<OverviewAttention>(`/overview/attention`)
        .then((d) => {
          setAttentionErr(null);
          return d;
        })
        .catch((e) => {
          setAttentionErr(errMsg(e, "attention list"));
          return null;
        }),
      api
        .get<OverviewTrends>(`/overview/trends?${query}`)
        .then((d) => {
          setTrendsErr(null);
          return d;
        })
        .catch((e) => {
          setTrendsErr(errMsg(e, "trends"));
          return null;
        }),
      api
        .get<OverviewQuickActions>(`/overview/quick-actions`)
        .then((d) => {
          setActionsErr(null);
          return d;
        })
        .catch((e) => {
          setActionsErr(errMsg(e, "quick actions"));
          return null;
        }),
    ]);
    setSummary(s);
    setAttention(a);
    setTrends(t);
    setActions(qa);
    setRefreshedAt(new Date());
    setLoading(false);
  }, [query]);

  useEffect(() => {
    if (ready) load();
  }, [ready, load]);

  // Optional auto-refresh (off by default; always cleared safely).
  useEffect(() => {
    if (!ready || !autoRefresh) return;
    const id = setInterval(() => {
      load();
    }, AUTO_REFRESH_MS);
    return () => clearInterval(id);
  }, [ready, autoRefresh, load]);

  const doExport = async (format: "csv" | "json") => {
    setExportBusy(true);
    try {
      const p = new URLSearchParams(query);
      p.set("format", format);
      const reason = exportReason.trim();
      if (reason) p.set("reason", reason);
      await downloadFile(`/overview/export?${p.toString()}`, `platform-overview-snapshot.${format}`);
      toast.success(`Overview exported as ${format.toUpperCase()}.`);
      setExportOpen(false);
      setExportReason("");
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Export failed");
    } finally {
      setExportBusy(false);
    }
  };

  if (!ready) return gate;

  const initial = loading && !summary && !attention && !trends && !actions;

  return (
    <>
      <PageHeader
        title="Platform Overview"
        subtitle="Executive & operations command center"
        action={
          <div className="flex flex-wrap items-center gap-2">
            {refreshedAt && (
              <span className="text-xs text-faint">
                Last refreshed {refreshedAt.toLocaleTimeString()}
              </span>
            )}
            <Button
              variant="secondary"
              onClick={() => setAutoRefresh((v) => !v)}
              aria-pressed={autoRefresh}
              title="Auto-refresh every 60s"
            >
              <Icon name="clock" className="h-4 w-4" />
              Auto {autoRefresh ? "on" : "off"}
            </Button>
            <Button variant="secondary" onClick={load} disabled={loading}>
              <Icon name="history" className="h-4 w-4" />
              {loading ? "Refreshing…" : "Refresh"}
            </Button>
            <Button variant="secondary" onClick={() => setExportOpen(true)}>
              <Icon name="download" className="h-4 w-4" />
              Export
            </Button>
          </div>
        }
      />

      {/* Window / range control */}
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <div className="inline-flex flex-wrap overflow-hidden rounded-lg border border-line">
          {OVERVIEW_WINDOWS.map((w) => (
            <button
              key={w.value}
              onClick={() => setWin(w.value)}
              className={`px-3 py-1.5 text-xs font-semibold transition ${
                win === w.value ? "bg-brand-600 text-white" : "bg-surface text-muted hover:bg-hover"
              }`}
            >
              {w.label}
            </button>
          ))}
        </div>
        {win === "custom" && (
          <div className="flex flex-wrap items-center gap-2">
            <Input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              aria-label="From date"
              className="!py-1.5"
            />
            <span className="text-xs text-faint">to</span>
            <Input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              aria-label="To date"
              className="!py-1.5"
            />
          </div>
        )}
      </div>

      {/* Data-start / generated note (only when the API returns one) */}
      {summary && (
        <p className="mb-1 text-xs text-faint">
          Showing {windowLabel(summary.range.window)} · generated {formatDateTime(summary.generatedAt)}
        </p>
      )}
      {summary?.note && <p className="mb-6 text-xs text-faint">{summary.note}</p>}

      {initial ? (
        <Spinner />
      ) : (
        <div className="space-y-8">
          <AlertStrip summary={summary} attention={attention} />

          <section>
            <SectionHeading>Executive KPIs</SectionHeading>
            <KpiCards summary={summary} loading={loading} error={summaryErr} />
          </section>

          <section>
            <SectionHeading>Trends</SectionHeading>
            <TrendsPanel trends={trends} loading={loading} error={trendsErr} />
          </section>

          <section>
            <SectionHeading>Needs attention</SectionHeading>
            <AttentionPanel attention={attention} loading={loading} error={attentionErr} />
          </section>

          <section>
            <SectionHeading>Modules</SectionHeading>
            <ModulesPanel summary={summary} loading={loading} error={summaryErr} />
          </section>

          <section>
            <SectionHeading>Quick actions</SectionHeading>
            <QuickActions data={actions} loading={loading} error={actionsErr} />
          </section>

          <section>
            <SectionHeading>Maintenance &amp; announcements</SectionHeading>
            <MaintenancePanel summary={summary} loading={loading} />
          </section>
        </div>
      )}

      <Modal title="Export platform overview" open={exportOpen} onClose={() => setExportOpen(false)}>
        <div className="space-y-4">
          <p className="text-sm text-muted">
            Download a masked snapshot of the current KPIs and attention list for the selected
            window ({windowLabel(win)}). Secrets and paths are never included; the export is
            audited.
          </p>
          <Field label="Reason (optional)" hint="Recorded on the audit log.">
            <Textarea
              value={exportReason}
              onChange={(e) => setExportReason(e.target.value)}
              rows={2}
              maxLength={500}
              placeholder="e.g. monthly board report"
            />
          </Field>
          <div className="flex justify-end gap-2">
            <Button onClick={() => doExport("csv")} disabled={exportBusy}>
              <Icon name="fileDown" className="h-4 w-4" />
              {exportBusy ? "Exporting…" : "CSV"}
            </Button>
            <Button variant="secondary" onClick={() => doExport("json")} disabled={exportBusy}>
              <Icon name="download" className="h-4 w-4" />
              JSON
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
