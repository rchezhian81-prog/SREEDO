"use client";

import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { Button, Card, ConfirmDialog, ErrorNote, Field, Input, Spinner } from "@/components/ui";
import { Icon } from "@/components/icons";
import { toast } from "@/components/toast";
import type { ExportRetention } from "@/types";
import { formatDateTime } from "./taxonomy";

export function RetentionTab({
  reloadKey,
  onChanged,
}: {
  reloadKey: number;
  onChanged: () => void;
}) {
  const [settings, setSettings] = useState<ExportRetention | null>(null);
  const [defaultDays, setDefaultDays] = useState("");
  const [sensitiveDays, setSensitiveDays] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const applySettings = (s: ExportRetention) => {
    setSettings(s);
    setDefaultDays(String(s.defaultRetentionDays));
    setSensitiveDays(String(s.sensitiveRetentionDays));
  };

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      applySettings(await api.get<ExportRetention>("/exports/retention"));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load retention settings");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load, reloadKey]);

  if (loading) return <Spinner />;
  if (error && !settings) return <ErrorNote message={error} />;
  if (!settings) return null;

  const defNum = defaultDays.trim() === "" ? null : Number(defaultDays);
  const sensNum = sensitiveDays.trim() === "" ? null : Number(sensitiveDays);
  const defValid = defNum != null && Number.isInteger(defNum) && defNum >= 1 && defNum <= 365;
  const sensValid = sensNum != null && Number.isInteger(sensNum) && sensNum >= 1 && sensNum <= 90;
  const changed =
    defNum !== settings.defaultRetentionDays || sensNum !== settings.sensitiveRetentionDays;
  const formValid = defValid && sensValid && changed;
  const sensitiveLonger = defValid && sensValid && sensNum! > defNum!;

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const updated = await api.patch<ExportRetention>("/exports/retention", {
        defaultRetentionDays: defNum,
        sensitiveRetentionDays: sensNum,
      });
      applySettings(updated);
      setConfirmOpen(false);
      toast.success("Retention settings saved.");
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to save retention settings");
      setConfirmOpen(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Export retention</h2>
        <Button onClick={() => setConfirmOpen(true)} disabled={!formValid || saving}>
          {saving ? "Saving…" : "Save changes"}
        </Button>
      </div>

      <ErrorNote message={error} />

      <Card>
        <p className="mb-4 text-sm font-semibold text-ink">Retention windows</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Standard retention (days)"
            hint="How long a standard completed export is kept before it expires. 1–365."
            error={!defValid && defaultDays !== "" ? "Whole number 1–365." : undefined}
          >
            <Input
              type="number"
              min={1}
              max={365}
              step={1}
              value={defaultDays}
              onChange={(e) => setDefaultDays(e.target.value)}
            />
          </Field>
          <Field
            label="Sensitive retention (days)"
            hint="Sensitive exports expire sooner. 1–90."
            error={!sensValid && sensitiveDays !== "" ? "Whole number 1–90." : undefined}
          >
            <Input
              type="number"
              min={1}
              max={90}
              step={1}
              value={sensitiveDays}
              onChange={(e) => setSensitiveDays(e.target.value)}
            />
          </Field>
        </div>

        <div className="mt-4 rounded-lg border border-line bg-surface-2 px-3 py-2 text-xs text-muted">
          When an export passes its retention window it is swept to <strong>expired</strong> and its
          artifact is removed — the metadata row is always retained. Sensitive exports should expire at
          least as soon as standard ones.
        </div>

        {sensitiveLonger && (
          <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
            <Icon name="shieldAlert" className="mt-0.5 h-4 w-4 shrink-0" />
            Sensitive retention is longer than standard retention — sensitive data would be kept
            around longer than ordinary exports. Consider lowering it.
          </div>
        )}

        <p className="mt-4 text-xs text-faint">
          Last updated: {formatDateTime(settings.updatedAt)}
          {settings.updatedBy ? ` · by ${settings.updatedBy.slice(0, 8)}` : ""}
        </p>
      </Card>

      <ConfirmDialog
        open={confirmOpen}
        title="Save retention settings?"
        tone="primary"
        confirmLabel="Save settings"
        busy={saving}
        onConfirm={save}
        onClose={() => setConfirmOpen(false)}
        message={
          <div className="space-y-2">
            <p>
              Apply a {defNum}-day standard window and a {sensNum}-day sensitive window? This takes
              effect on the next expiry sweep and applies to future exports.
            </p>
            {sensitiveLonger && (
              <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
                Sensitive retention is longer than standard — sensitive data will be kept longer.
              </p>
            )}
          </div>
        }
      />
    </div>
  );
}
