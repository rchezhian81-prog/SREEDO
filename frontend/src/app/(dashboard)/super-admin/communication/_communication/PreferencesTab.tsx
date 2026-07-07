"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { Button, Card, ConfirmDialog, EmptyState, ErrorNote, Spinner } from "@/components/ui";
import { Icon } from "@/components/icons";
import { toast } from "@/components/toast";
import type { CommPreferences, CommPreferencesUpdate } from "@/types";
import { PREFERENCE_CATEGORIES, formatDateTime, preferenceLabel } from "./taxonomy";

export function PreferencesTab({ reloadKey, onChanged }: { reloadKey: number; onChanged: () => void }) {
  const [prefs, setPrefs] = useState<CommPreferences | null>(null);
  const [draft, setDraft] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmSecurity, setConfirmSecurity] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const p = await api.get<CommPreferences>("/comm-admin/preferences");
      setPrefs(p);
      setDraft({ ...p.categories });
    } catch (err) {
      setPrefs(null);
      setError(err instanceof ApiError ? err.message : "Failed to load preferences");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load, reloadKey]);

  const enabledOf = (key: string) => draft[key] ?? true;
  const toggle = (key: string) => setDraft((d) => ({ ...d, [key]: !(d[key] ?? true) }));

  const dirty = useMemo(() => {
    if (!prefs) return false;
    return PREFERENCE_CATEGORIES.some((k) => (draft[k] ?? true) !== (prefs.categories[k] ?? true));
  }, [prefs, draft]);

  // Security is being turned off (was on, now off) — requires a confirm.
  const disablingSecurity = !!prefs && (prefs.categories.security ?? true) && draft.security === false;

  const persist = async () => {
    setBusy(true);
    setError(null);
    try {
      const categories: Record<string, boolean> = {};
      for (const k of PREFERENCE_CATEGORIES) categories[k] = draft[k] ?? true;
      const res = await api.patch<CommPreferencesUpdate>("/comm-admin/preferences", { categories });
      setPrefs({ categories: res.categories, updatedBy: prefs?.updatedBy ?? null, updatedAt: new Date().toISOString() });
      setDraft({ ...res.categories });
      onChanged();
      if (res.warning) {
        toast.error(res.warning);
      } else {
        toast.success("Notification preferences saved.");
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to save preferences");
    } finally {
      setBusy(false);
      setConfirmSecurity(false);
    }
  };

  const onSave = () => {
    if (disablingSecurity) setConfirmSecurity(true);
    else persist();
  };

  const securityDisabled = prefs ? (prefs.categories.security ?? true) === false : false;

  return (
    <section className="space-y-5">
      <ErrorNote message={error} />

      {loading ? (
        <Spinner />
      ) : prefs ? (
        <>
          {securityDisabled && (
            <div role="alert" className="rounded-2xl border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-600 dark:text-red-400">
              <div className="flex items-center gap-2 font-semibold">
                <Icon name="shieldAlert" className="h-5 w-5" />
                Security notifications are DISABLED
              </div>
              <p className="mt-1 text-sm">
                Critical security emails will not be sent until this category is re-enabled. This state is audited.
              </p>
            </div>
          )}

          <Card>
            <p className="text-sm font-semibold text-ink">Global notification categories</p>
            <p className="mt-1 text-sm text-muted">
              Platform-wide defaults for each transactional notification category. Changes are audited; disabling the
              security category also raises a security event.
            </p>

            <div className="mt-4 divide-y divide-line">
              {PREFERENCE_CATEGORIES.map((key) => {
                const on = enabledOf(key);
                const isSecurity = key === "security";
                return (
                  <div key={key} className="flex items-center justify-between gap-4 py-3">
                    <div className="min-w-0">
                      <p className="flex items-center gap-2 text-sm font-medium text-ink">
                        {preferenceLabel(key)}
                        {isSecurity && <Icon name="shield" className="h-3.5 w-3.5 text-muted" />}
                      </p>
                      <p className="text-xs text-faint">
                        {on ? "Enabled — these emails are sent." : "Disabled — these emails are skipped."}
                      </p>
                    </div>
                    <Toggle
                      on={on}
                      danger={isSecurity}
                      onClick={() => toggle(key)}
                      label={`Toggle ${preferenceLabel(key)}`}
                    />
                  </div>
                );
              })}
            </div>

            <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs text-faint">
                {prefs.updatedAt ? `Last updated ${formatDateTime(prefs.updatedAt)}` : "Using platform defaults."}
              </p>
              <div className="flex gap-2">
                <Button variant="secondary" onClick={() => prefs && setDraft({ ...prefs.categories })} disabled={busy || !dirty}>
                  Reset
                </Button>
                <Button onClick={onSave} disabled={busy || !dirty}>
                  {busy ? "Saving…" : "Save preferences"}
                </Button>
              </div>
            </div>
          </Card>
        </>
      ) : (
        !error && <EmptyState message="No preferences available." />
      )}

      <ConfirmDialog
        open={confirmSecurity}
        title="Disable security notifications?"
        tone="danger"
        confirmLabel="Disable security emails"
        busy={busy}
        onClose={() => setConfirmSecurity(false)}
        onConfirm={persist}
        message={
          <div className="space-y-2">
            <p className="font-semibold text-red-600 dark:text-red-400">
              This turns off critical security notifications platform-wide.
            </p>
            <p>
              Security emails (suspicious activity, admin changes, etc.) will not be sent until re-enabled. This action is
              audited and raises a security event. Are you sure?
            </p>
          </div>
        }
      />
    </section>
  );
}

function Toggle({
  on,
  danger,
  onClick,
  label,
}: {
  on: boolean;
  danger?: boolean;
  onClick: () => void;
  label: string;
}) {
  const activeColor = danger ? "bg-red-600" : "bg-brand-600";
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={onClick}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition ${on ? activeColor : "bg-line"}`}
    >
      <span
        className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition ${on ? "translate-x-5" : "translate-x-0.5"}`}
      />
    </button>
  );
}
