"use client";

import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { Button, ErrorNote, Field, Input, PageHeader, Spinner } from "@/components/ui";
import { NotificationPreferencesCard } from "@/components/NotificationPreferencesCard";
import type { SessionInfo } from "@/types";

/** Best-effort friendly device label from a raw User-Agent string. */
function deviceLabel(userAgent: string | null): string {
  if (!userAgent) return "Unknown device";
  const browser =
    /Edg/.test(userAgent) ? "Edge"
    : /OPR|Opera/.test(userAgent) ? "Opera"
    : /Chrome/.test(userAgent) ? "Chrome"
    : /Firefox/.test(userAgent) ? "Firefox"
    : /Safari/.test(userAgent) ? "Safari"
    : null;
  const os =
    /Windows/.test(userAgent) ? "Windows"
    : /Android/.test(userAgent) ? "Android"
    : /iPhone|iPad|iOS/.test(userAgent) ? "iOS"
    : /Mac OS X|Macintosh/.test(userAgent) ? "macOS"
    : /Linux/.test(userAgent) ? "Linux"
    : null;
  if (browser && os) return `${browser} on ${os}`;
  return browser ?? os ?? userAgent.slice(0, 40);
}

export default function SecurityPage() {
  const [loading, setLoading] = useState(true);
  const [enabled, setEnabled] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [setup, setSetup] = useState<{ secret: string; otpauthUrl: string } | null>(
    null
  );
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [pwBusy, setPwBusy] = useState(false);
  const [pwError, setPwError] = useState<string | null>(null);
  const [pwNotice, setPwNotice] = useState<string | null>(null);

  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [sessionsError, setSessionsError] = useState<string | null>(null);

  const loadStatus = useCallback(async () => {
    setLoading(true);
    try {
      const s = await api.get<{ enabled: boolean }>("/auth/2fa/status");
      setEnabled(s.enabled);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadSessions = useCallback(async () => {
    setSessionsError(null);
    try {
      setSessions(await api.get<SessionInfo[]>("/auth/sessions"));
    } catch (err) {
      setSessionsError(
        err instanceof ApiError ? err.message : "Could not load sessions"
      );
    }
  }, []);

  useEffect(() => {
    loadStatus().catch(() => setLoading(false));
    loadSessions();
  }, [loadStatus, loadSessions]);

  const signOutSession = async (session: SessionInfo) => {
    if (!confirm("Sign out this device?")) return;
    try {
      await api.delete(`/auth/sessions/${session.id}`);
      await loadSessions();
    } catch (err) {
      setSessionsError(
        err instanceof ApiError ? err.message : "Could not sign out the device"
      );
    }
  };

  const beginSetup = async () => {
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      const s = await api.post<{ secret: string; otpauthUrl: string }>(
        "/auth/2fa/setup"
      );
      setSetup(s);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not start setup");
    } finally {
      setBusy(false);
    }
  };

  const confirmEnable = async () => {
    setError(null);
    setBusy(true);
    try {
      await api.post("/auth/2fa/enable", { code });
      setSetup(null);
      setCode("");
      setNotice("Two-factor authentication is now enabled.");
      await loadStatus();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not enable two-factor");
    } finally {
      setBusy(false);
    }
  };

  const disable = async () => {
    setError(null);
    setBusy(true);
    try {
      await api.post("/auth/2fa/disable", { password });
      setPassword("");
      setNotice("Two-factor authentication has been disabled.");
      await loadStatus();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not disable two-factor");
    } finally {
      setBusy(false);
    }
  };

  const changePasswordHandler = async () => {
    setPwError(null);
    setPwNotice(null);
    if (
      newPassword.length < 8 ||
      !/[A-Za-z]/.test(newPassword) ||
      !/[0-9]/.test(newPassword)
    ) {
      setPwError(
        "New password must be at least 8 characters and include a letter and a number."
      );
      return;
    }
    if (newPassword !== confirmPassword) {
      setPwError("New password and confirmation do not match.");
      return;
    }
    setPwBusy(true);
    try {
      await api.post("/auth/change-password", { currentPassword, newPassword });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setPwNotice(
        "Password updated. You'll need to sign in again on your other devices."
      );
    } catch (err) {
      setPwError(
        err instanceof ApiError ? err.message : "Could not change password"
      );
    } finally {
      setPwBusy(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Security"
        subtitle="Manage your password, two-factor authentication, and active sessions"
      />
      {loading ? (
        <Spinner />
      ) : (
        <div className="max-w-lg space-y-6">
          <div className="rounded-xl border border-line bg-surface p-5">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <h2 className="font-semibold text-ink">
                  Two-factor authentication
                </h2>
                <p className="text-sm text-muted">
                  Require a 6-digit authenticator code at sign-in.
                </p>
              </div>
              <span
                className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${
                  enabled
                    ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300"
                    : "bg-surface-2 text-muted"
                }`}
              >
                {enabled ? "Enabled" : "Disabled"}
              </span>
            </div>

            {notice && (
              <p className="mb-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300">
                {notice}
              </p>
            )}
            <ErrorNote message={error} />

            {!enabled && !setup && (
              <Button type="button" disabled={busy} onClick={beginSetup}>
                {busy ? "Starting…" : "Enable two-factor"}
              </Button>
            )}

            {!enabled && setup && (
              <div className="space-y-4">
                <div className="rounded-lg border border-line bg-surface-2 p-3 text-sm">
                  <p className="mb-2 text-muted">
                    1. In your authenticator app (Google Authenticator, Authy, …)
                    add an account using this key:
                  </p>
                  <code className="block break-all rounded bg-surface px-2 py-1 font-mono text-xs text-ink">
                    {setup.secret}
                  </code>
                  <p className="mt-2 text-muted">
                    Or open this link on the device with the app installed:
                  </p>
                  <code className="block break-all rounded bg-surface px-2 py-1 font-mono text-[11px] text-ink">
                    {setup.otpauthUrl}
                  </code>
                </div>
                <Field label="2. Enter the 6-digit code to confirm">
                  <Input
                    inputMode="numeric"
                    maxLength={6}
                    placeholder="123456"
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                  />
                </Field>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => {
                      setSetup(null);
                      setCode("");
                    }}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="button"
                    disabled={busy || code.length < 6}
                    onClick={confirmEnable}
                  >
                    {busy ? "Verifying…" : "Verify & enable"}
                  </Button>
                </div>
              </div>
            )}

            {enabled && (
              <div className="space-y-3">
                <Field label="Enter your password to turn off two-factor">
                  <Input
                    type="password"
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </Field>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={busy || !password}
                  onClick={disable}
                >
                  {busy ? "Disabling…" : "Disable two-factor"}
                </Button>
              </div>
            )}
          </div>
          <p className="text-xs text-faint">
            Lost your device? An administrator can reset your two-factor from the
            Users page.
          </p>

          <div className="rounded-xl border border-line bg-surface p-5">
            <div className="mb-3">
              <h2 className="font-semibold text-ink">Change password</h2>
              <p className="text-sm text-muted">
                Use a strong, unique password — at least 8 characters with a
                letter and a number.
              </p>
            </div>
            {pwNotice && (
              <p className="mb-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300">
                {pwNotice}
              </p>
            )}
            <ErrorNote message={pwError} />
            <div className="space-y-3">
              <Field label="Current password">
                <Input
                  type="password"
                  autoComplete="current-password"
                  placeholder="••••••••"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                />
              </Field>
              <Field label="New password">
                <Input
                  type="password"
                  autoComplete="new-password"
                  placeholder="At least 8 characters"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                />
              </Field>
              <Field label="Confirm new password">
                <Input
                  type="password"
                  autoComplete="new-password"
                  placeholder="Re-enter new password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                />
              </Field>
              <Button
                type="button"
                disabled={pwBusy || !currentPassword || !newPassword || !confirmPassword}
                onClick={changePasswordHandler}
              >
                {pwBusy ? "Updating…" : "Update password"}
              </Button>
              <p className="text-xs text-faint">
                Changing your password signs you out on all other devices.
              </p>
            </div>
          </div>

          <div className="rounded-xl border border-line bg-surface p-5">
            <div className="mb-3">
              <h2 className="font-semibold text-ink">Active sessions</h2>
              <p className="text-sm text-muted">
                Devices currently signed in to your account. Sign out any you
                don&apos;t recognise.
              </p>
            </div>
            <ErrorNote message={sessionsError} />
            {sessions.length === 0 ? (
              <p className="text-sm text-faint">No active sessions.</p>
            ) : (
              <ul className="divide-y divide-line">
                {sessions.map((session) => (
                  <li
                    key={session.id}
                    className="flex items-center justify-between gap-3 py-3"
                  >
                    <div className="min-w-0">
                      <p className="font-medium text-ink">
                        {deviceLabel(session.userAgent)}
                        {session.current && (
                          <span className="ml-2 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300">
                            This device
                          </span>
                        )}
                      </p>
                      <p className="text-xs text-faint">
                        Last active {new Date(session.lastUsedAt).toLocaleString()}
                      </p>
                    </div>
                    {!session.current && (
                      <button
                        onClick={() => signOutSession(session)}
                        className="shrink-0 text-xs font-medium text-red-600 hover:text-red-700"
                      >
                        Sign out
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <NotificationPreferencesCard client={api} />
        </div>
      )}
    </>
  );
}
