"use client";

import { useCallback, useEffect, useState } from "react";
import { ApiError } from "@/lib/api";
import { ErrorNote, Spinner } from "@/components/ui";
import type { NotificationPreferences } from "@/types";

/** Minimal API surface this card needs — satisfied by both api and portalApi. */
interface PrefsClient {
  get: <T>(path: string) => Promise<T>;
  patch: <T>(path: string, body?: unknown) => Promise<T>;
}

const CHANNELS: Array<{
  key: keyof NotificationPreferences;
  label: string;
  hint: string;
}> = [
  { key: "emailEnabled", label: "Email", hint: "Reminders and alerts by email" },
  { key: "smsEnabled", label: "SMS", hint: "Text messages to your phone" },
  { key: "pushEnabled", label: "Push", hint: "Notifications on your devices" },
];

/**
 * Per-channel notification opt in/out, backed by /communication/preferences.
 * Works in both the staff dashboard (api) and the portal (portalApi) by taking
 * the client as a prop.
 */
export function NotificationPreferencesCard({ client }: { client: PrefsClient }) {
  const [prefs, setPrefs] = useState<NotificationPreferences | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setPrefs(
        await client.get<NotificationPreferences>("/communication/preferences")
      );
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Could not load preferences"
      );
    } finally {
      setLoading(false);
    }
  }, [client]);

  useEffect(() => {
    load();
  }, [load]);

  const toggle = async (key: keyof NotificationPreferences, value: boolean) => {
    setSaving(key);
    setError(null);
    // Optimistic update; revert on failure.
    setPrefs((prev) => (prev ? { ...prev, [key]: value } : prev));
    try {
      const updated = await client.patch<NotificationPreferences>(
        "/communication/preferences",
        { [key]: value }
      );
      setPrefs(updated);
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Could not save preference"
      );
      setPrefs((prev) => (prev ? { ...prev, [key]: !value } : prev));
    } finally {
      setSaving(null);
    }
  };

  return (
    <div className="rounded-xl border border-line bg-surface p-5">
      <div className="mb-3">
        <h2 className="font-semibold text-ink">Notifications</h2>
        <p className="text-sm text-muted">
          Choose how you&apos;d like to be notified.
        </p>
      </div>
      <ErrorNote message={error} />
      {loading || !prefs ? (
        <Spinner />
      ) : (
        <ul className="divide-y divide-line">
          {CHANNELS.map(({ key, label, hint }) => (
            <li
              key={key}
              className="flex items-center justify-between gap-3 py-3"
            >
              <div>
                <p className="font-medium text-ink">{label}</p>
                <p className="text-xs text-faint">{hint}</p>
              </div>
              <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-muted">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-line"
                  checked={prefs[key]}
                  disabled={saving === key}
                  onChange={(e) => toggle(key, e.target.checked)}
                />
                {prefs[key] ? "On" : "Off"}
              </label>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
