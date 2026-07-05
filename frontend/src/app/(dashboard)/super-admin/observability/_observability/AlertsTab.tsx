"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { api, ApiError } from "@/lib/api";
import {
  Badge,
  Button,
  EmptyState,
  ErrorNote,
  Field,
  Input,
  Modal,
  Select,
  Spinner,
  Textarea,
} from "@/components/ui";
import { Icon } from "@/components/icons";
import { toast } from "@/components/toast";
import type {
  Alert,
  AlertListResult,
  AlertRule,
  AlertRuleType,
  IncidentSeverity,
} from "@/types";
import { formatNumber } from "../../platform/_utils";
import {
  ALERT_RULE_TYPES,
  ALERT_STATUSES,
  INCIDENT_SEVERITIES,
  alertRuleTypeLabel,
  alertStatusTone,
  downloadFile,
  formatDateTime,
  formatExt,
  severityTone,
  titleCase,
} from "./taxonomy";

export function AlertsTab({
  reloadKey,
  onChanged,
}: {
  reloadKey: number;
  onChanged: () => void;
}) {
  return (
    <div className="space-y-8">
      <AlertRulesSection reloadKey={reloadKey} onChanged={onChanged} />
      <AlertFeedSection reloadKey={reloadKey} onChanged={onChanged} />
    </div>
  );
}

// ============================ Alert rules ==================================

function AlertRulesSection({
  reloadKey,
  onChanged,
}: {
  reloadKey: number;
  onChanged: () => void;
}) {
  const [rules, setRules] = useState<AlertRule[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [localReload, setLocalReload] = useState(0);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [editing, setEditing] = useState<AlertRule | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setRules(await api.get<AlertRule[]>("/observability/alert-rules"));
    } catch (err) {
      setRules(null);
      setError(err instanceof ApiError ? err.message : "Failed to load alert rules");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load, reloadKey, localReload]);

  const refreshAll = () => {
    setLocalReload((k) => k + 1);
    onChanged();
  };

  const toggle = async (rule: AlertRule) => {
    setBusyId(rule.id);
    try {
      await api.patch<AlertRule>(`/observability/alert-rules/${rule.id}`, { enabled: !rule.enabled });
      toast.success(rule.enabled ? "Rule disabled." : "Rule enabled.");
      refreshAll();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to update rule");
    } finally {
      setBusyId(null);
    }
  };

  const test = async (rule: AlertRule) => {
    setBusyId(rule.id);
    try {
      await api.post(`/observability/alert-rules/${rule.id}/test`);
      toast.success("Synthetic test alert fired (suppressed — no notification).");
      onChanged();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to test rule");
    } finally {
      setBusyId(null);
    }
  };

  const list = rules ?? [];

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Alert rules</h2>
        <Button onClick={() => setCreateOpen(true)}>
          <Icon name="plus" className="h-4 w-4" />
          New rule
        </Button>
      </div>

      <ErrorNote message={error} />

      {loading ? (
        <Spinner />
      ) : list.length === 0 ? (
        <EmptyState message="No alert rules configured yet." />
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-line bg-surface">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-line bg-surface-2 text-xs uppercase text-muted">
              <tr>
                <th className="px-4 py-3">Rule</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Severity</th>
                <th className="px-4 py-3 text-right">Threshold</th>
                <th className="px-4 py-3">Enabled</th>
                <th className="px-4 py-3">Last fired</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {list.map((r) => (
                <tr key={r.id} className="hover:bg-hover">
                  <td className="px-4 py-3 font-medium text-ink">{r.name}</td>
                  <td className="px-4 py-3 text-muted">{alertRuleTypeLabel(r.type)}</td>
                  <td className="px-4 py-3">
                    <Badge tone={severityTone(r.severity)}>{titleCase(r.severity)}</Badge>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right text-muted">
                    {r.threshold == null ? "—" : formatNumber(r.threshold)}
                  </td>
                  <td className="px-4 py-3">
                    <Badge tone={r.enabled ? "green" : "slate"}>{r.enabled ? "On" : "Off"}</Badge>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-faint">
                    {formatDateTime(r.lastTriggeredAt)}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap justify-end gap-1.5">
                      <Button
                        variant="secondary"
                        className="!px-2.5 !py-1.5"
                        onClick={() => setEditing(r)}
                        disabled={busyId === r.id}
                      >
                        Edit
                      </Button>
                      <Button
                        variant="secondary"
                        className="!px-2.5 !py-1.5"
                        onClick={() => toggle(r)}
                        disabled={busyId === r.id}
                      >
                        {r.enabled ? "Disable" : "Enable"}
                      </Button>
                      <Button
                        variant="secondary"
                        className="!px-2.5 !py-1.5"
                        onClick={() => test(r)}
                        disabled={busyId === r.id}
                      >
                        Test
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <AlertRuleModal
        open={createOpen || editing !== null}
        rule={editing}
        onClose={() => {
          setCreateOpen(false);
          setEditing(null);
        }}
        onSaved={() => {
          setCreateOpen(false);
          setEditing(null);
          refreshAll();
        }}
      />
    </section>
  );
}

interface RuleForm {
  name: string;
  type: AlertRuleType;
  threshold: string;
  windowMinutes: string;
  severity: IncidentSeverity;
  enabled: boolean;
  notifyTarget: string;
  cooldownMinutes: string;
}

function AlertRuleModal({
  open,
  rule,
  onClose,
  onSaved,
}: {
  open: boolean;
  rule: AlertRule | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<RuleForm>({
    name: "",
    type: "error_rate_high",
    threshold: "",
    windowMinutes: "5",
    severity: "major",
    enabled: true,
    notifyTarget: "",
    cooldownMinutes: "30",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    if (rule) {
      setForm({
        name: rule.name,
        type: rule.type,
        threshold: rule.threshold == null ? "" : String(rule.threshold),
        windowMinutes: String(rule.windowMinutes),
        severity: rule.severity,
        enabled: rule.enabled,
        notifyTarget: rule.notifyTarget ?? "",
        cooldownMinutes: String(rule.cooldownMinutes),
      });
    } else {
      setForm({
        name: "",
        type: "error_rate_high",
        threshold: "",
        windowMinutes: "5",
        severity: "major",
        enabled: true,
        notifyTarget: "",
        cooldownMinutes: "30",
      });
    }
    setBusy(false);
    setError(null);
  }, [open, rule]);

  const patch = (p: Partial<RuleForm>) => setForm((f) => ({ ...f, ...p }));

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const body = {
        name: form.name.trim(),
        type: form.type,
        threshold: form.threshold.trim() === "" ? null : Number(form.threshold),
        windowMinutes: Number(form.windowMinutes) || 5,
        severity: form.severity,
        enabled: form.enabled,
        notifyTarget: form.notifyTarget.trim() === "" ? null : form.notifyTarget.trim(),
        cooldownMinutes: Number(form.cooldownMinutes) || 0,
      };
      if (rule) {
        await api.patch<AlertRule>(`/observability/alert-rules/${rule.id}`, body);
        toast.success("Alert rule updated.");
      } else {
        await api.post<AlertRule>("/observability/alert-rules", body);
        toast.success("Alert rule created.");
      }
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to save alert rule");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={rule ? "Edit alert rule" : "New alert rule"} open={open} onClose={onClose}>
      <div className="space-y-4 text-sm">
        <Field label="Name (min 3 characters)">
          <Input
            value={form.name}
            onChange={(e) => patch({ name: e.target.value })}
            placeholder="e.g. API error rate > 5%"
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Type">
            <Select value={form.type} onChange={(e) => patch({ type: e.target.value as AlertRuleType })}>
              {ALERT_RULE_TYPES.map((t) => (
                <option key={t} value={t}>
                  {alertRuleTypeLabel(t)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Severity">
            <Select
              value={form.severity}
              onChange={(e) => patch({ severity: e.target.value as IncidentSeverity })}
            >
              {INCIDENT_SEVERITIES.map((s) => (
                <option key={s} value={s}>
                  {titleCase(s)}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Threshold" hint="Blank = rule default">
            <Input
              type="number"
              value={form.threshold}
              onChange={(e) => patch({ threshold: e.target.value })}
              placeholder="default"
            />
          </Field>
          <Field label="Window (min)">
            <Input
              type="number"
              min={1}
              max={1440}
              value={form.windowMinutes}
              onChange={(e) => patch({ windowMinutes: e.target.value })}
            />
          </Field>
          <Field label="Cooldown (min)">
            <Input
              type="number"
              min={0}
              max={10080}
              value={form.cooldownMinutes}
              onChange={(e) => patch({ cooldownMinutes: e.target.value })}
            />
          </Field>
        </div>
        <Field label="Notify target (optional)" hint="e.g. an email or webhook label">
          <Input
            value={form.notifyTarget}
            onChange={(e) => patch({ notifyTarget: e.target.value })}
            placeholder="ops@example.com"
          />
        </Field>
        <label className="flex items-center gap-2 text-sm text-muted">
          <input
            type="checkbox"
            checked={form.enabled}
            onChange={(e) => patch({ enabled: e.target.checked })}
            className="h-4 w-4 rounded border-line"
          />
          Enabled
        </label>
        <ErrorNote message={error} />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={busy || form.name.trim().length < 3}>
            {busy ? "Saving…" : rule ? "Save changes" : "Create rule"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ============================ Alert feed ===================================

function AlertFeedSection({
  reloadKey,
  onChanged,
}: {
  reloadKey: number;
  onChanged: () => void;
}) {
  const [status, setStatus] = useState("");
  const [severity, setSeverity] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize] = useState(50);
  const [data, setData] = useState<AlertListResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [localReload, setLocalReload] = useState(0);

  const [action, setAction] = useState<Alert | null>(null);
  const [exportOpen, setExportOpen] = useState(false);

  useEffect(() => {
    setPage(1);
  }, [status, severity]);

  const query = useMemo(() => {
    const p = new URLSearchParams();
    if (status) p.set("status", status);
    if (severity) p.set("severity", severity);
    p.set("page", String(page));
    p.set("pageSize", String(pageSize));
    return p.toString();
  }, [status, severity, page, pageSize]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await api.get<AlertListResult>(`/observability/alerts?${query}`));
    } catch (err) {
      setData(null);
      setError(err instanceof ApiError ? err.message : "Failed to load alerts");
    } finally {
      setLoading(false);
    }
  }, [query]);

  useEffect(() => {
    load();
  }, [load, reloadKey, localReload]);

  const refreshAll = () => {
    setLocalReload((k) => k + 1);
    onChanged();
  };

  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Alert feed</h2>
        <Button variant="secondary" onClick={() => setExportOpen(true)}>
          <Icon name="download" className="h-4 w-4" />
          Export
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
          <option value="">All statuses</option>
          {ALERT_STATUSES.map((s) => (
            <option key={s} value={s}>
              {titleCase(s)}
            </option>
          ))}
        </Select>
        <Select value={severity} onChange={(e) => setSeverity(e.target.value)} aria-label="Severity">
          <option value="">All severities</option>
          {INCIDENT_SEVERITIES.map((s) => (
            <option key={s} value={s}>
              {titleCase(s)}
            </option>
          ))}
        </Select>
      </div>

      <ErrorNote message={error} />

      {loading ? (
        <Spinner />
      ) : rows.length === 0 ? (
        <EmptyState message="No alerts match these filters." />
      ) : (
        <>
          <div className="overflow-x-auto rounded-2xl border border-line bg-surface">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-line bg-surface-2 text-xs uppercase text-muted">
                <tr>
                  <th className="px-4 py-3">Rule</th>
                  <th className="px-4 py-3">Severity</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Service</th>
                  <th className="px-4 py-3 text-right">Value / threshold</th>
                  <th className="px-4 py-3">Triggered</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((a) => (
                  <tr key={a.id} className="hover:bg-hover">
                    <td className="px-4 py-3">
                      <span className="block font-medium text-ink">{a.ruleName}</span>
                      <span className="block text-xs text-faint">{alertRuleTypeLabel(a.type)}</span>
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone={severityTone(a.severity)}>{titleCase(a.severity)}</Badge>
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone={alertStatusTone(a.status)}>{titleCase(a.status)}</Badge>
                      {a.incidentId && <span className="mt-1 block text-xs text-faint">linked</span>}
                    </td>
                    <td className="px-4 py-3 text-muted">{a.service ?? "—"}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-right text-muted">
                      {a.metricValue == null ? "—" : formatNumber(a.metricValue)}
                      {a.threshold != null && (
                        <span className="text-faint"> / {formatNumber(a.threshold)}</span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-faint">
                      {formatDateTime(a.triggeredAt)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end">
                        <Button
                          variant="secondary"
                          className="!px-3 !py-1.5"
                          onClick={() => setAction(a)}
                        >
                          Manage
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-3 text-sm text-muted">
            <span>
              Page {page} of {totalPages} · {formatNumber(total)} total
            </span>
            <Button variant="secondary" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}>
              ← Prev
            </Button>
            <Button
              variant="secondary"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
            >
              Next →
            </Button>
          </div>
        </>
      )}

      <AlertActionModal alert={action} onClose={() => setAction(null)} onChanged={refreshAll} />
      <AlertExportModal
        open={exportOpen}
        status={status}
        severity={severity}
        onClose={() => setExportOpen(false)}
      />
    </section>
  );
}

type AlertView = "menu" | "ack" | "resolve" | "link" | "note";

function AlertActionModal({
  alert,
  onClose,
  onChanged,
}: {
  alert: Alert | null;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [view, setView] = useState<AlertView>("menu");
  const [note, setNote] = useState("");
  const [incidentId, setIncidentId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (alert) {
      setView("menu");
      setNote("");
      setIncidentId("");
      setBusy(false);
      setError(null);
    }
  }, [alert]);

  if (!alert) return null;
  const a = alert;

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      toast.success(ok);
      onChanged();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Action failed");
    } finally {
      setBusy(false);
    }
  };

  const ack = () =>
    run(
      () => api.post(`/observability/alerts/${a.id}/ack`, note.trim() ? { note: note.trim() } : {}),
      "Alert acknowledged."
    );
  const resolve = () =>
    run(
      () => api.post(`/observability/alerts/${a.id}/resolve`, note.trim() ? { note: note.trim() } : {}),
      "Alert resolved."
    );
  const link = () =>
    run(
      () => api.post(`/observability/alerts/${a.id}/link-incident`, { incidentId: incidentId.trim() }),
      "Alert linked to incident."
    );
  const addNote = () =>
    run(() => api.post(`/observability/alerts/${a.id}/note`, { note: note.trim() }), "Note added.");

  const canAck = a.status === "triggered" || a.status === "suppressed";
  const canResolve = a.status !== "resolved";

  const title =
    view === "menu"
      ? a.ruleName
      : view === "ack"
        ? "Acknowledge alert"
        : view === "resolve"
          ? "Resolve alert"
          : view === "link"
            ? "Link to incident"
            : "Add note";

  return (
    <Modal title={title} open={alert !== null} onClose={onClose}>
      {view === "menu" ? (
        <div className="space-y-5 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={severityTone(a.severity)}>{titleCase(a.severity)}</Badge>
            <Badge tone={alertStatusTone(a.status)}>{titleCase(a.status)}</Badge>
            <span className="text-muted">{alertRuleTypeLabel(a.type)}</span>
            {a.service && <span className="text-faint">· {a.service}</span>}
          </div>
          <dl className="space-y-2">
            <RowLine label="Metric" value={a.metricValue == null ? "—" : formatNumber(a.metricValue)} />
            <RowLine label="Threshold" value={a.threshold == null ? "—" : formatNumber(a.threshold)} />
            <RowLine label="Triggered" value={formatDateTime(a.triggeredAt)} />
            <RowLine label="Acknowledged" value={formatDateTime(a.acknowledgedAt)} />
            <RowLine label="Resolved" value={formatDateTime(a.resolvedAt)} />
            {a.incidentId && <RowLine label="Incident" value={<span className="font-mono text-xs">{a.incidentId.slice(0, 8)}</span>} />}
            {a.note && <RowLine label="Note" value={a.note} />}
          </dl>
          <ErrorNote message={error} />
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="secondary" onClick={() => setView("note")} disabled={busy}>
              Add note
            </Button>
            <Button variant="secondary" onClick={() => setView("link")} disabled={busy}>
              Link incident
            </Button>
            {canAck && (
              <Button variant="secondary" onClick={() => setView("ack")} disabled={busy}>
                Acknowledge
              </Button>
            )}
            {canResolve && (
              <Button onClick={() => setView("resolve")} disabled={busy}>
                Resolve
              </Button>
            )}
          </div>
        </div>
      ) : view === "link" ? (
        <div className="space-y-4 text-sm">
          <Field label="Incident ID (UUID)">
            <Input
              value={incidentId}
              onChange={(e) => setIncidentId(e.target.value)}
              placeholder="00000000-0000-0000-0000-000000000000"
            />
          </Field>
          <ErrorNote message={error} />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setView("menu")} disabled={busy}>
              Back
            </Button>
            <Button onClick={link} disabled={busy || incidentId.trim().length < 10}>
              {busy ? "Linking…" : "Link incident"}
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-4 text-sm">
          <Field label={view === "note" ? "Note (required)" : "Note (optional)"}>
            <Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
          <ErrorNote message={error} />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setView("menu")} disabled={busy}>
              Back
            </Button>
            <Button
              onClick={view === "ack" ? ack : view === "resolve" ? resolve : addNote}
              disabled={busy || (view === "note" && note.trim().length < 1)}
            >
              {busy
                ? "Working…"
                : view === "ack"
                  ? "Acknowledge"
                  : view === "resolve"
                    ? "Resolve"
                    : "Add note"}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

const MIN_REASON = 5;

function AlertExportModal({
  open,
  status,
  severity,
  onClose,
}: {
  open: boolean;
  status: string;
  severity: string;
  onClose: () => void;
}) {
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
      const p = new URLSearchParams();
      p.set("format", format);
      p.set("reason", reason.trim());
      if (status) p.set("status", status);
      if (severity) p.set("severity", severity);
      await downloadFile(`/observability/alerts/export?${p.toString()}`, `alerts.${formatExt(format)}`);
      toast.success("Alert export downloaded.");
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Export failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Export alerts" open={open} onClose={onClose}>
      <div className="space-y-4 text-sm">
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
          Exporting the alert feed is audited. A reason is required and recorded in the platform audit
          log. The current status / severity filters are applied.
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
          <Textarea
            rows={2}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Why is this export needed?"
          />
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

function RowLine({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex gap-2">
      <dt className="w-28 shrink-0 font-medium text-muted">{label}</dt>
      <dd className="min-w-0 break-words text-ink">{value}</dd>
    </div>
  );
}
