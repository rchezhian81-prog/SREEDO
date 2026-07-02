"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api, ApiError } from "@/lib/api";
import {
  Button,
  Card,
  ConfirmDialog,
  ErrorNote,
  Field,
  Input,
  PageHeader,
  Spinner,
} from "@/components/ui";
import { toast } from "@/components/toast";
import { usePlatformGuard } from "../../platform/_guard";
import { formatNumber } from "../../platform/_utils";
import {
  type LifecycleConfig,
  type LifecyclePreview,
  type RunResult,
} from "../_subs";

/** Parse "7, 3, 1" → [7,3,1]; ignores blanks/non-numbers. */
function parseDays(s: string): number[] {
  return s
    .split(/[\s,]+/)
    .map((x) => Number(x.trim()))
    .filter((n) => Number.isFinite(n) && n >= 0);
}

export default function SubscriptionConfigPage() {
  const { ready, gate } = usePlatformGuard(
    "Subscription config",
    "Lifecycle configuration & manual sweep"
  );

  const [cfg, setCfg] = useState<LifecycleConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState({
    trialDays: "0",
    graceDays: "0",
    renewalReminderDays: "",
    expiryReminderDays: "",
    autoExpireEnabled: false,
    autoSuspendEnabled: false,
    billingOverdueSuspendEnabled: false,
  });

  const [preview, setPreview] = useState<LifecyclePreview | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [confirmRun, setConfirmRun] = useState(false);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<RunResult | null>(null);

  const applyConfig = (c: LifecycleConfig) => {
    setCfg(c);
    setForm({
      trialDays: String(c.trialDays ?? 0),
      graceDays: String(c.graceDays ?? 0),
      renewalReminderDays: (c.renewalReminderDays ?? []).join(", "),
      expiryReminderDays: (c.expiryReminderDays ?? []).join(", "),
      autoExpireEnabled: !!c.autoExpireEnabled,
      autoSuspendEnabled: !!c.autoSuspendEnabled,
      billingOverdueSuspendEnabled: !!c.billingOverdueSuspendEnabled,
    });
  };

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      applyConfig(
        await api.get<LifecycleConfig>("/platform/subscriptions/config")
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load config");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (ready) load();
  }, [ready, load]);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const updated = await api.put<LifecycleConfig>(
        "/platform/subscriptions/config",
        {
          trialDays: Number(form.trialDays) || 0,
          graceDays: Number(form.graceDays) || 0,
          renewalReminderDays: parseDays(form.renewalReminderDays),
          expiryReminderDays: parseDays(form.expiryReminderDays),
          autoExpireEnabled: form.autoExpireEnabled,
          autoSuspendEnabled: form.autoSuspendEnabled,
          billingOverdueSuspendEnabled: form.billingOverdueSuspendEnabled,
        }
      );
      applyConfig(updated);
      toast.success("Config saved");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to save config");
    } finally {
      setSaving(false);
    }
  };

  const runPreview = async () => {
    setPreviewing(true);
    setResult(null);
    try {
      setPreview(
        await api.get<LifecyclePreview>(
          "/platform/subscriptions/lifecycle-preview"
        )
      );
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Preview failed");
    } finally {
      setPreviewing(false);
    }
  };

  const run = async () => {
    setRunning(true);
    try {
      const r = await api.post<RunResult>(
        "/platform/subscriptions/run-lifecycle"
      );
      setResult(r);
      setConfirmRun(false);
      toast.success("Lifecycle run complete");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Run failed");
    } finally {
      setRunning(false);
    }
  };

  if (!ready) return gate;

  const set = (k: keyof typeof form, v: string | boolean) =>
    setForm((s) => ({ ...s, [k]: v }));

  const a = preview?.actions;

  return (
    <>
      <nav className="mb-2 text-xs text-faint">
        <Link href="/super-admin/subscriptions" className="hover:text-muted">
          Subscriptions
        </Link>{" "}
        / <span className="text-muted">Config</span>
      </nav>
      <PageHeader
        title="Subscription config"
        subtitle="Lifecycle configuration & manual sweep (super-admin)"
      />

      {loading ? (
        <Spinner />
      ) : error && !cfg ? (
        <ErrorNote message={error} />
      ) : (
        <div className="space-y-6">
          {error && <ErrorNote message={error} />}

          <Card>
            <div className="mb-4 flex items-center justify-between">
              <p className="text-sm font-medium text-ink">Lifecycle settings</p>
              {cfg?.updatedAt && (
                <p className="text-xs text-faint">
                  Updated {new Date(cfg.updatedAt).toLocaleString()}
                  {cfg.updatedByEmail ? ` · by ${cfg.updatedByEmail}` : ""}
                </p>
              )}
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Trial days" hint="Default trial length for new subscriptions">
                <Input
                  type="number"
                  min={0}
                  value={form.trialDays}
                  onChange={(e) => set("trialDays", e.target.value)}
                />
              </Field>
              <Field label="Grace days" hint="Days after expiry before it lapses">
                <Input
                  type="number"
                  min={0}
                  value={form.graceDays}
                  onChange={(e) => set("graceDays", e.target.value)}
                />
              </Field>
              <Field
                label="Renewal reminder days"
                hint="Days-before-expiry to remind, e.g. 30, 7, 1"
              >
                <Input
                  value={form.renewalReminderDays}
                  onChange={(e) => set("renewalReminderDays", e.target.value)}
                  placeholder="30, 7, 1"
                />
              </Field>
              <Field
                label="Expiry reminder days"
                hint="Days-after-expiry to remind, e.g. 1, 7"
              >
                <Input
                  value={form.expiryReminderDays}
                  onChange={(e) => set("expiryReminderDays", e.target.value)}
                  placeholder="1, 7"
                />
              </Field>
            </div>
            <div className="mt-4 space-y-2">
              <label className="flex items-center gap-2 text-sm text-muted">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-line"
                  checked={form.autoExpireEnabled}
                  onChange={(e) => set("autoExpireEnabled", e.target.checked)}
                />
                Auto-expire lapsed subscriptions on the lifecycle sweep
              </label>
              <label className="flex items-center gap-2 text-sm text-muted">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-line"
                  checked={form.autoSuspendEnabled}
                  onChange={(e) => set("autoSuspendEnabled", e.target.checked)}
                />
                Auto-suspend expired tenants (deactivates the institution)
              </label>
              <label className="flex items-center gap-2 text-sm text-muted">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-line"
                  checked={form.billingOverdueSuspendEnabled}
                  onChange={(e) =>
                    set("billingOverdueSuspendEnabled", e.target.checked)
                  }
                />
                Suspend on overdue billing
              </label>
            </div>
            <div className="mt-4">
              <Button onClick={save} disabled={saving}>
                {saving ? "Saving…" : "Save config"}
              </Button>
            </div>
          </Card>

          <Card>
            <div className="mb-3 flex items-center justify-between">
              <p className="text-sm font-medium text-ink">Lifecycle sweep</p>
              <Button
                variant="secondary"
                onClick={runPreview}
                disabled={previewing}
              >
                {previewing ? "Previewing…" : "Run lifecycle preview"}
              </Button>
            </div>
            <p className="mb-3 text-xs text-faint">
              Preview is a dry-run (no writes). Running the sweep applies grace,
              expiry, trial-expiry, optional auto-suspend, and queues reminders.
            </p>

            {a && (
              <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
                <PreviewTile label="Grace starting" value={a.graceStarting} />
                <PreviewTile label="Trials expiring" value={a.trialExpiring} />
                <PreviewTile label="Terms expiring" value={a.termExpiring} />
                <PreviewTile label="Will expire" value={a.willExpire} />
                <PreviewTile
                  label="Will auto-suspend"
                  value={a.willAutoSuspend}
                />
                <PreviewTile
                  label="Reminders to send"
                  value={a.remindersToSend}
                />
                <PreviewTile
                  label="Overdue-billing risk"
                  value={a.overdueBillingRisk}
                />
              </div>
            )}
            {preview?.note && (
              <p className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
                {preview.note}
              </p>
            )}

            {result && (
              <div className="mt-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-700 dark:text-emerald-300">
                <p className="font-semibold">Lifecycle run complete</p>
                <p className="mt-1">
                  grace started {result.graceStarted} · expired {result.expired}{" "}
                  · trials expired {result.trialExpired} · auto-suspended{" "}
                  {result.autoSuspended} · reminders sent {result.remindersSent}
                </p>
              </div>
            )}

            {preview && !result && (
              <div className="mt-4">
                <Button variant="danger" onClick={() => setConfirmRun(true)}>
                  Run lifecycle now
                </Button>
              </div>
            )}
          </Card>
        </div>
      )}

      <ConfirmDialog
        open={confirmRun}
        title="Run lifecycle sweep"
        message="This applies subscription transitions and queues reminders across all tenants. Continue?"
        confirmLabel="Run now"
        busy={running}
        onConfirm={run}
        onClose={() => setConfirmRun(false)}
      />
    </>
  );
}

function PreviewTile({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center justify-between rounded-lg border border-line px-3 py-2">
      <span className="text-muted">{label}</span>
      <span className="font-semibold text-ink">{formatNumber(value)}</span>
    </div>
  );
}
