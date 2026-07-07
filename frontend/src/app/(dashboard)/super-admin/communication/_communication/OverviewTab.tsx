"use client";

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
import type {
  CommDashboard,
  CommWindow,
  EmailTemplate,
  ProviderStatus,
  TemplateListResult,
  TestSendResult,
} from "@/types";
import type { CommunicationTab } from "../page";
import { formatNumber } from "../../platform/_utils";
import {
  COMM_WINDOWS,
  TRIGGER_SOURCES,
  deliveryStatusTone,
  formatDateTime,
  isTestAddress,
  providerStatusLabel,
  providerStatusTone,
  sourceLabel,
  titleCase,
  windowLabel,
} from "./taxonomy";

const MIN_REASON = 5;

const HEALTH_BANNER: Record<"ok" | "warn", { border: string; icon: IconName; label: string }> = {
  ok: {
    border: "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
    icon: "shieldCheck",
    label: "Communication pipeline healthy",
  },
  warn: {
    border: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300",
    icon: "shieldAlert",
    label: "Communication needs attention",
  },
};

export function OverviewTab({
  reloadKey,
  onJump,
}: {
  reloadKey: number;
  onJump: (tab: CommunicationTab) => void;
}) {
  const [window, setWindow] = useState<CommWindow>("today");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [data, setData] = useState<CommDashboard | null>(null);
  const [provider, setProvider] = useState<ProviderStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [testOpen, setTestOpen] = useState(false);
  const [localReload, setLocalReload] = useState(0);

  const query = useMemo(() => {
    const p = new URLSearchParams();
    p.set("window", window);
    if (window === "custom") {
      if (dateFrom) p.set("dateFrom", dateFrom);
      if (dateTo) p.set("dateTo", dateTo);
    }
    return p.toString();
  }, [window, dateFrom, dateTo]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [summary, prov] = await Promise.all([
        api.get<CommDashboard>(`/comm-admin/summary?${query}`),
        api.get<ProviderStatus>("/comm-admin/provider").catch(() => null),
      ]);
      setData(summary);
      setProvider(prov);
    } catch (err) {
      setData(null);
      setError(err instanceof ApiError ? err.message : "Failed to load the communication dashboard");
    } finally {
      setLoading(false);
    }
  }, [query]);

  useEffect(() => {
    load();
  }, [load, reloadKey, localReload]);

  const refresh = () => setLocalReload((k) => k + 1);

  return (
    <section className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <WindowSelector
          value={window}
          onValue={setWindow}
          dateFrom={dateFrom}
          dateTo={dateTo}
          onDateFrom={setDateFrom}
          onDateTo={setDateTo}
        />
        <Button variant="secondary" onClick={() => setTestOpen(true)}>
          <Icon name="mail" className="h-4 w-4" />
          Send test email
        </Button>
      </div>

      <ErrorNote message={error} />

      {loading ? (
        <Spinner />
      ) : data ? (
        <>
          <HealthBanner health={data.health} />

          {/* Provider status panel */}
          <ProviderPanel provider={provider} onSendTest={() => setTestOpen(true)} />

          {/* Templates */}
          <div>
            <SectionHeading>Templates</SectionHeading>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
              <StatCard
                label="Total"
                value={formatNumber(data.templates.total)}
                sub={
                  <button
                    onClick={() => onJump("templates")}
                    className="text-xs font-medium text-brand-600 hover:underline"
                  >
                    Manage templates →
                  </button>
                }
              />
              <StatCard label="Active" value={formatNumber(data.templates.active)} tone="green" />
              <StatCard label="Draft" value={formatNumber(data.templates.draft)} tone={data.templates.draft > 0 ? "amber" : undefined} />
              <StatCard label="Disabled" value={formatNumber(data.templates.disabled)} />
              <StatCard label="Built-in" value={formatNumber(data.templates.builtin)} />
              <StatCard label="Custom" value={formatNumber(data.templates.custom)} />
            </div>
          </div>

          {/* Emails */}
          <div>
            <SectionHeading>Emails · {windowLabel((data.window as CommWindow) ?? window)}</SectionHeading>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
              <StatCard label="Sent" value={formatNumber(data.emails.sent)} tone="green" />
              <StatCard
                label="Failed"
                value={formatNumber(data.emails.failed)}
                tone={data.emails.failed > 0 ? "red" : undefined}
                sub={
                  <button
                    onClick={() => onJump("deliveries")}
                    className="text-xs font-medium text-brand-600 hover:underline"
                  >
                    View deliveries →
                  </button>
                }
              />
              <StatCard label="Pending" value={formatNumber(data.emails.pending)} tone={data.emails.pending > 0 ? "amber" : undefined} />
              <StatCard label="Delivered" value={formatNumber(data.emails.delivered)} />
              <StatCard label="Skipped" value={formatNumber(data.emails.skipped)} />
              <StatCard
                label="Failure rate"
                value={`${data.failureRatePct}%`}
                tone={data.failureRatePct >= 25 ? "red" : data.failureRatePct > 0 ? "amber" : undefined}
              />
            </div>
          </div>

          {/* Broadcasts + last test */}
          <div>
            <SectionHeading>Broadcasts &amp; last test</SectionHeading>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
              <StatCard
                label="Broadcasts sent"
                value={formatNumber(data.broadcasts.sent)}
                tone="green"
                sub={
                  <button
                    onClick={() => onJump("broadcasts")}
                    className="text-xs font-medium text-brand-600 hover:underline"
                  >
                    View broadcasts →
                  </button>
                }
              />
              <StatCard label="Drafts" value={formatNumber(data.broadcasts.draft)} tone={data.broadcasts.draft > 0 ? "amber" : undefined} />
              <StatCard label="Scheduled" value={formatNumber(data.broadcasts.scheduled)} tone={data.broadcasts.scheduled > 0 ? "amber" : undefined} />
              <StatCard label="Sending" value={formatNumber(data.broadcasts.sending)} tone={data.broadcasts.sending > 0 ? "blue" : undefined} />
              <StatCard label="Cancelled" value={formatNumber(data.broadcasts.cancelled)} />
              <StatCard
                label="Last test"
                value={data.lastTest ? titleCase(data.lastTest.status) : "—"}
                tone={data.lastTest ? (data.lastTest.status === "failed" ? "red" : data.lastTest.status === "sent" ? "green" : undefined) : undefined}
                sub={data.lastTest ? <span className="text-xs text-faint">{formatDateTime(data.lastTest.at)}</span> : undefined}
              />
            </div>
          </div>

          {/* Per-source counts */}
          <div>
            <SectionHeading>By trigger source · {windowLabel((data.window as CommWindow) ?? window)}</SectionHeading>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
              {TRIGGER_SOURCES.map((s) => (
                <StatCard key={s} label={sourceLabel(s)} value={formatNumber(data.bySource?.[s] ?? 0)} />
              ))}
            </div>
          </div>

          {/* Recent delivery failures */}
          <Card className="p-0">
            <div className="flex items-center justify-between border-b border-line px-5 py-3">
              <p className="text-sm font-semibold text-ink">Recent delivery failures</p>
              <button
                onClick={() => onJump("deliveries")}
                className="text-xs font-medium text-brand-600 hover:underline"
              >
                View all →
              </button>
            </div>
            {data.recentFailures.length === 0 ? (
              <p className="px-5 py-6 text-sm text-muted">No delivery failures recorded.</p>
            ) : (
              <ul className="divide-y divide-line">
                {data.recentFailures.map((f) => (
                  <li key={f.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-sm">
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <Badge tone={deliveryStatusTone("failed")}>Failed</Badge>
                      <span className="truncate font-medium text-ink">{f.recipient}</span>
                      {f.template && <span className="text-xs text-muted">· {f.template}</span>}
                      {f.failureReason && (
                        <span className="truncate text-xs text-faint" title={f.failureReason}>
                          — {f.failureReason}
                        </span>
                      )}
                    </div>
                    <span className="text-xs text-faint">{formatDateTime(f.createdAt)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </>
      ) : (
        !error && <EmptyState message="No communication dashboard data available." />
      )}

      <TestSendModal open={testOpen} onClose={() => setTestOpen(false)} onSent={refresh} />
    </section>
  );
}

// ---- provider status panel -------------------------------------------------

function ProviderPanel({
  provider,
  onSendTest,
}: {
  provider: ProviderStatus | null;
  onSendTest: () => void;
}) {
  if (!provider) {
    return (
      <Card>
        <div className="flex items-center gap-2">
          <Badge tone="slate">Unavailable</Badge>
          <span className="text-sm text-faint">Provider status could not be read.</span>
        </div>
      </Card>
    );
  }
  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Icon name="mail" className="h-4 w-4 text-muted" />
            <p className="text-sm font-semibold text-ink">SMTP provider</p>
            <Badge tone={providerStatusTone(provider.status)}>{providerStatusLabel(provider.status)}</Badge>
            {provider.verified && <Badge tone="green">Verified</Badge>}
          </div>
          <p className="mt-2 text-sm text-muted">{provider.note}</p>
          <dl className="mt-3 grid gap-x-8 gap-y-1.5 text-sm sm:grid-cols-2">
            <DataRow label="From name" value={provider.fromName} />
            <DataRow label="From email" value={provider.fromEmail} />
            <DataRow label="Reply-to" value={provider.replyTo} />
            <DataRow
              label="Failures (30d)"
              value={formatNumber(provider.failureCount)}
              tone={provider.failureCount > 0 ? "amber" : undefined}
            />
            <DataRow
              label="Last test"
              value={provider.lastTestStatus ? `${titleCase(provider.lastTestStatus)} · ${formatDateTime(provider.lastTestAt)}` : "—"}
            />
            <DataRow label="Last success" value={formatDateTime(provider.lastSuccessAt)} />
          </dl>
        </div>
        <Button variant="secondary" onClick={onSendTest}>
          <Icon name="mail" className="h-4 w-4" />
          Send test email
        </Button>
      </div>
    </Card>
  );
}

// ---- test-send modal -------------------------------------------------------

function TestSendModal({
  open,
  onClose,
  onSent,
}: {
  open: boolean;
  onClose: () => void;
  onSent: () => void;
}) {
  const [to, setTo] = useState("");
  const [templateKey, setTemplateKey] = useState("");
  const [reason, setReason] = useState("");
  const [templates, setTemplates] = useState<EmailTemplate[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<TestSendResult | null>(null);

  useEffect(() => {
    if (!open) return;
    setTo("");
    setTemplateKey("");
    setReason("");
    setBusy(false);
    setError(null);
    setResult(null);
    api
      .get<TemplateListResult>("/comm-admin/templates?pageSize=200")
      .then((r) => setTemplates(r.rows))
      .catch(() => setTemplates([]));
  }, [open]);

  const needsReason = to.trim().length > 0 && !isTestAddress(to);
  const reasonOk = !needsReason || reason.trim().length >= MIN_REASON;
  const canSend = /.+@.+\..+/.test(to.trim()) && reasonOk && !busy;

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const body: Record<string, unknown> = { to: to.trim() };
      if (templateKey) body.templateKey = templateKey;
      if (reason.trim()) body.reason = reason.trim();
      const res = await api.post<TestSendResult>("/comm-admin/provider/test", body);
      setResult(res);
      toast.success(`Test email ${res.status === "sent" ? "sent" : res.status} to ${to.trim()}.`);
      onSent();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to send test email");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} title="Send test email" onClose={onClose}>
      <div className="space-y-4 text-sm">
        <p className="text-muted">
          Sends a test through the configured SMTP provider (a template is rendered with sample data). No
          secret is ever sent or shown. External (non-test) recipients require a reason and are audited.
        </p>
        <Field label="Recipient email">
          <Input
            type="email"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            placeholder="you@example.com"
          />
        </Field>
        <Field label="Template (optional)" hint="Leave blank for a plain SMTP check.">
          <Select value={templateKey} onChange={(e) => setTemplateKey(e.target.value)}>
            <option value="">No template — plain test</option>
            {templates.map((t) => (
              <option key={t.key} value={t.key}>
                {t.name} ({t.key})
              </option>
            ))}
          </Select>
        </Field>
        {needsReason && (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
            This recipient is not a test address. A reason of at least 5 characters is required and audited.
          </div>
        )}
        <Field
          label={needsReason ? "Reason (min 5 characters)" : "Reason (optional)"}
          error={needsReason && reason.length > 0 && reason.trim().length < MIN_REASON ? "At least 5 characters required." : undefined}
        >
          <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why is this test being sent?" />
        </Field>
        {result && (
          <div className="rounded-lg border border-line bg-surface-2 px-3 py-2 text-xs text-muted">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-ink">Result:</span>
              <Badge tone={result.status === "failed" ? "red" : result.status === "sent" ? "green" : "slate"}>
                {titleCase(result.status)}
              </Badge>
            </div>
            <p className="mt-1">
              <span className="font-medium text-ink">Rendered subject:</span> {result.preview.subject || "—"}
            </p>
            {result.preview.unknownVars.length > 0 && (
              <p className="mt-1 text-amber-600 dark:text-amber-400">
                Unknown variables: {result.preview.unknownVars.join(", ")}
              </p>
            )}
          </div>
        )}
        <ErrorNote message={error} />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            {result ? "Close" : "Cancel"}
          </Button>
          <Button onClick={submit} disabled={!canSend}>
            {busy ? "Sending…" : "Send test"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ---- shared presentational helpers (reused by other tabs) ------------------

export function WindowSelector({
  value,
  onValue,
  dateFrom,
  dateTo,
  onDateFrom,
  onDateTo,
}: {
  value: CommWindow;
  onValue: (w: CommWindow) => void;
  dateFrom: string;
  dateTo: string;
  onDateFrom: (v: string) => void;
  onDateTo: (v: string) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="inline-flex overflow-hidden rounded-lg border border-line">
        {COMM_WINDOWS.map((w) => (
          <button
            key={w}
            onClick={() => onValue(w)}
            className={`px-3 py-1.5 text-xs font-semibold transition ${
              value === w ? "bg-brand-600 text-white" : "bg-surface text-muted hover:bg-hover"
            }`}
          >
            {windowLabel(w)}
          </button>
        ))}
      </div>
      {value === "custom" && (
        <div className="flex flex-wrap items-center gap-2">
          <Input
            type="date"
            value={dateFrom}
            onChange={(e) => onDateFrom(e.target.value)}
            aria-label="From date"
            className="!py-1.5"
          />
          <span className="text-xs text-faint">to</span>
          <Input
            type="date"
            value={dateTo}
            onChange={(e) => onDateTo(e.target.value)}
            aria-label="To date"
            className="!py-1.5"
          />
        </div>
      )}
    </div>
  );
}

export function SectionHeading({ children }: { children: ReactNode }) {
  return <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted">{children}</h2>;
}

export function StatCard({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: "green" | "red" | "amber" | "blue";
}) {
  const valueColor =
    tone === "red"
      ? "text-red-600"
      : tone === "amber"
        ? "text-amber-600"
        : tone === "green"
          ? "text-emerald-600"
          : tone === "blue"
            ? "text-brand-600"
            : "text-ink";
  return (
    <Card>
      <p className="text-sm font-medium text-muted">{label}</p>
      <div className={`mt-1 text-2xl font-semibold ${valueColor}`}>{value}</div>
      {sub && <div className="mt-1.5">{sub}</div>}
    </Card>
  );
}

export function DataRow({
  label,
  value,
  tone,
}: {
  label: string;
  value: ReactNode;
  tone?: "red" | "amber";
}) {
  const color = tone === "red" ? "text-red-600" : tone === "amber" ? "text-amber-600" : "text-ink";
  return (
    <div className="flex items-center justify-between gap-2">
      <dt className="text-muted">{label}</dt>
      <dd className={`min-w-0 break-words text-right font-medium ${color}`}>{value}</dd>
    </div>
  );
}

function HealthBanner({ health }: { health: CommDashboard["health"] }) {
  const b = health.ok ? HEALTH_BANNER.ok : HEALTH_BANNER.warn;
  return (
    <div role="status" className={`rounded-2xl border p-4 ${b.border}`}>
      <div className="flex items-center gap-2 text-sm font-semibold">
        <Icon name={b.icon} className="h-5 w-5" />
        {b.label}
      </div>
      {!health.ok && health.warnings.length > 0 && (
        <ul className="mt-2 list-inside list-disc space-y-0.5 text-sm">
          {health.warnings.map((w, i) => (
            <li key={i}>{w}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
