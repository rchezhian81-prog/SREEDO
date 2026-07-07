"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { api, ApiError } from "@/lib/api";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorNote,
  Field,
  Input,
  Modal,
  Select,
  Spinner,
  Textarea,
} from "@/components/ui";
import { Icon, type IconName } from "@/components/icons";
import { toast } from "@/components/toast";
import type { CommIntegrations, CommReports, CommWindow } from "@/types";
import { formatNumber } from "../../platform/_utils";
import { SectionHeading, StatCard, WindowSelector } from "./OverviewTab";
import {
  TRIGGER_SOURCES,
  downloadFile,
  formatExt,
  isUuid,
  sourceLabel,
  superAdminHref,
  titleCase,
} from "./taxonomy";

const MIN_REASON = 5;

interface Filters {
  triggerSource: string;
  category: string;
  tenant: string;
}

const EMPTY: Filters = { triggerSource: "", category: "", tenant: "" };

export function ReportsTab({ reloadKey }: { reloadKey: number }) {
  const [window, setWindow] = useState<CommWindow>("30d");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [filters, setFilters] = useState<Filters>(EMPTY);

  const [reports, setReports] = useState<CommReports | null>(null);
  const [integrations, setIntegrations] = useState<CommIntegrations | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exportOpen, setExportOpen] = useState(false);

  const patch = (p: Partial<Filters>) => setFilters((f) => ({ ...f, ...p }));

  const params = useMemo(() => {
    const p = new URLSearchParams();
    p.set("window", window);
    if (window === "custom") {
      if (dateFrom) p.set("dateFrom", dateFrom);
      if (dateTo) p.set("dateTo", dateTo);
    }
    if (filters.triggerSource) p.set("triggerSource", filters.triggerSource);
    if (filters.category.trim()) p.set("category", filters.category.trim());
    if (isUuid(filters.tenant)) p.set("tenant", filters.tenant.trim());
    return p;
  }, [window, dateFrom, dateTo, filters]);

  const query = params.toString();

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [r, integ] = await Promise.all([
        api.get<CommReports>(`/comm-admin/reports?${query}`),
        api.get<CommIntegrations>("/comm-admin/integrations").catch(() => null),
      ]);
      setReports(r);
      setIntegrations(integ);
    } catch (err) {
      setReports(null);
      setError(err instanceof ApiError ? err.message : "Failed to load reports");
    } finally {
      setLoading(false);
    }
  }, [query]);

  useEffect(() => {
    load();
  }, [load, reloadKey]);

  return (
    <section className="space-y-6">
      <Card className="space-y-3">
        <WindowSelector
          value={window}
          onValue={setWindow}
          dateFrom={dateFrom}
          dateTo={dateTo}
          onDateFrom={setDateFrom}
          onDateTo={setDateTo}
        />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Select value={filters.triggerSource} onChange={(e) => patch({ triggerSource: e.target.value })} aria-label="Trigger source">
            <option value="">All sources</option>
            {TRIGGER_SOURCES.map((s) => (
              <option key={s} value={s}>
                {sourceLabel(s)}
              </option>
            ))}
          </Select>
          <Input value={filters.category} onChange={(e) => patch({ category: e.target.value })} placeholder="Category" aria-label="Category" />
          <Field label="Tenant UUID" error={filters.tenant && !isUuid(filters.tenant) ? "Enter a full UUID" : undefined}>
            <Input
              value={filters.tenant}
              onChange={(e) => patch({ tenant: e.target.value })}
              placeholder="00000000-0000-0000-0000-000000000000"
            />
          </Field>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Button variant="secondary" onClick={() => setFilters(EMPTY)}>
            Reset filters
          </Button>
          <Button variant="secondary" onClick={() => setExportOpen(true)}>
            <Icon name="fileDown" className="h-4 w-4" />
            Export template usage
          </Button>
        </div>
      </Card>

      <ErrorNote message={error} />

      {loading ? (
        <Spinner />
      ) : reports ? (
        <>
          {/* Status summary */}
          <div>
            <SectionHeading>Delivery status</SectionHeading>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
              <StatCard label="Sent" value={formatNumber(reports.status.sent)} tone="green" />
              <StatCard label="Delivered" value={formatNumber(reports.status.delivered)} />
              <StatCard label="Failed" value={formatNumber(reports.status.failed)} tone={reports.status.failed > 0 ? "red" : undefined} />
              <StatCard label="Pending" value={formatNumber(reports.status.pending)} tone={reports.status.pending > 0 ? "amber" : undefined} />
              <StatCard label="Skipped" value={formatNumber(reports.status.skipped)} />
              <StatCard label="Total" value={formatNumber(reports.status.total)} />
            </div>
          </div>

          {/* Broadcasts + test + security */}
          <div>
            <SectionHeading>Broadcasts, test &amp; security</SectionHeading>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
              <StatCard label="Broadcasts" value={formatNumber(reports.broadcasts.total)} />
              <StatCard label="Broadcasts sent" value={formatNumber(reports.broadcasts.sent)} tone="green" />
              <StatCard label="Recipients reached" value={formatNumber(reports.broadcasts.recipientsReached)} />
              <StatCard label="Scheduled" value={formatNumber(reports.broadcasts.scheduled)} tone={reports.broadcasts.scheduled > 0 ? "amber" : undefined} />
              <StatCard label="Test sends" value={formatNumber(reports.testSends)} />
              <StatCard label="Security emails" value={formatNumber(reports.securityEmails)} />
            </div>
          </div>

          {/* Two-column tables */}
          <div className="grid gap-6 lg:grid-cols-2">
            <CountTable
              title="Template usage"
              head="Template"
              rows={reports.byTemplate.map((r) => ({ label: r.template ?? "(none)", value: r.total, extra: r.failed }))}
              extraHead="Failed"
            />
            <CountTable
              title="By category"
              head="Category"
              rows={reports.byCategory.map((r) => ({ label: r.category ?? "(none)", value: r.total }))}
            />
            <CountTable
              title="By trigger source"
              head="Source"
              rows={reports.bySource.map((r) => ({ label: sourceLabel(r.source), value: r.total, extra: r.failed }))}
              extraHead="Failed"
            />
            <CountTable
              title="By tenant"
              head="Tenant"
              rows={reports.byTenant.map((r) => ({ label: r.institutionName ?? "Platform", value: r.total }))}
            />
          </div>

          {/* Integrations */}
          {integrations && <IntegrationsSection data={integrations} />}
        </>
      ) : (
        !error && <EmptyState message="No report data available." />
      )}

      <ExportModal open={exportOpen} onClose={() => setExportOpen(false)} params={params} />
    </section>
  );
}

// ---- generic count table ---------------------------------------------------

function CountTable({
  title,
  head,
  rows,
  extraHead,
}: {
  title: string;
  head: string;
  rows: { label: string; value: number; extra?: number }[];
  extraHead?: string;
}) {
  return (
    <Card className="p-0">
      <div className="border-b border-line px-4 py-3">
        <p className="text-sm font-semibold text-ink">{title}</p>
      </div>
      {rows.length === 0 ? (
        <p className="px-4 py-5 text-sm text-muted">No data.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-line bg-surface-2 text-xs uppercase text-muted">
              <tr>
                <th className="px-4 py-2.5">{head}</th>
                {extraHead && <th className="px-4 py-2.5 text-right">{extraHead}</th>}
                <th className="px-4 py-2.5 text-right">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((r, i) => (
                <tr key={`${r.label}-${i}`} className="hover:bg-hover">
                  <td className="px-4 py-2.5 text-ink">{r.label}</td>
                  {extraHead && (
                    <td className="px-4 py-2.5 text-right">
                      <span className={r.extra && r.extra > 0 ? "text-red-600" : "text-muted"}>{formatNumber(r.extra ?? 0)}</span>
                    </td>
                  )}
                  <td className="px-4 py-2.5 text-right font-medium text-ink">{formatNumber(r.value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

// ---- integrations ----------------------------------------------------------

function IntegrationsSection({ data }: { data: CommIntegrations }) {
  return (
    <div>
      <SectionHeading>Integrations</SectionHeading>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <IntegrationCard icon="health" title="Observability" href={superAdminHref(data.links.observability)}>
          {"unavailable" in data.smtp ? (
            <Unavailable />
          ) : (
            <>
              <DataRow label="SMTP status" value={titleCase(data.smtp.status)} />
              <DataRow label="Verified" value={data.smtp.verified ? "Yes" : "No"} />
              <DataRow
                label="Sent / failed"
                value={`${formatNumber(data.smtp.delivery.sent)} / ${formatNumber(data.smtp.delivery.failed)}`}
              />
              <DataRow
                label="Failure rate"
                value={`${data.smtp.delivery.failureRatePct}%`}
                tone={data.smtp.delivery.failureRatePct >= 25 ? "red" : undefined}
              />
            </>
          )}
        </IntegrationCard>

        <IntegrationCard icon="gear" title="Jobs" href={superAdminHref(data.links.jobs)}>
          {data.jobs.byType.length === 0 ? (
            <p className="text-xs text-faint">No email/broadcast jobs.</p>
          ) : (
            data.jobs.byType.map((j) => (
              <DataRow
                key={j.type}
                label={j.type}
                value={`${formatNumber(j.total)}${j.failed > 0 ? ` · ${formatNumber(j.failed)} failed` : ""}`}
                tone={j.failed > 0 ? "amber" : undefined}
              />
            ))
          )}
        </IntegrationCard>

        <IntegrationCard icon="shieldCheck" title="Security" href={superAdminHref(data.links.security)}>
          <DataRow
            label="Comm events (30d)"
            value={formatNumber(data.security.events)}
            tone={data.security.events > 0 ? "amber" : undefined}
          />
        </IntegrationCard>

        <IntegrationCard icon="clipboard" title="Audit" href={superAdminHref(data.links.audit)}>
          <DataRow label="Comm actions (30d)" value={formatNumber(data.audit.actions)} />
        </IntegrationCard>
      </div>
    </div>
  );
}

function IntegrationCard({
  icon,
  title,
  href,
  children,
}: {
  icon: IconName;
  title: string;
  href: string;
  children: ReactNode;
}) {
  return (
    <Card>
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Icon name={icon} className="h-4 w-4 text-muted" />
          <p className="text-sm font-semibold text-ink">{title}</p>
        </div>
        <Link href={href}>
          <Button variant="secondary" className="!px-3 !py-1.5">
            View
            <Icon name="arrowRight" className="h-4 w-4" />
          </Button>
        </Link>
      </div>
      <dl className="space-y-2 text-sm">{children}</dl>
    </Card>
  );
}

function DataRow({ label, value, tone }: { label: string; value: ReactNode; tone?: "red" | "amber" }) {
  const color = tone === "red" ? "text-red-600" : tone === "amber" ? "text-amber-600" : "text-ink";
  return (
    <div className="flex items-center justify-between gap-2">
      <dt className="min-w-0 truncate text-muted">{label}</dt>
      <dd className={`font-medium ${color}`}>{value}</dd>
    </div>
  );
}

function Unavailable() {
  return (
    <div className="flex items-center gap-2">
      <Badge tone="slate">Unavailable</Badge>
      <span className="text-xs text-faint">This integration could not be read.</span>
    </div>
  );
}

// ---- export modal ----------------------------------------------------------

function ExportModal({ open, onClose, params }: { open: boolean; onClose: () => void; params: URLSearchParams }) {
  const [format, setFormat] = useState<"csv" | "xlsx">("csv");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setFormat("csv");
      setReason("");
      setBusy(false);
      setError(null);
    }
  }, [open]);

  const reasonLen = reason.trim().length;

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const p = new URLSearchParams(params);
      p.set("format", format);
      p.set("reason", reason.trim());
      await downloadFile(`/comm-admin/reports/export?${p.toString()}`, `communication-reports.${formatExt(format)}`);
      toast.success("Report export downloaded.");
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Export failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} title="Export template-usage report" onClose={onClose}>
      <div className="space-y-4 text-sm">
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
          A reason of at least 5 characters is required and recorded in the platform audit log. The current window and
          filters are applied.
        </div>
        <Field label="Format">
          <Select value={format} onChange={(e) => setFormat(e.target.value as "csv" | "xlsx")}>
            <option value="csv">CSV</option>
            <option value="xlsx">XLSX</option>
          </Select>
        </Field>
        <Field
          label="Reason (min 5 characters)"
          error={reason.length > 0 && reasonLen < MIN_REASON ? "At least 5 characters required." : undefined}
        >
          <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why is this export needed?" />
        </Field>
        <ErrorNote message={error} />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={busy || reasonLen < MIN_REASON}>
            {busy ? "Preparing…" : "Download export"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
