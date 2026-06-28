"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api, ApiError } from "@/lib/api";
import {
  Badge,
  Button,
  Card,
  ErrorNote,
  Field,
  Input,
  PageHeader,
  Spinner,
} from "@/components/ui";
import type { ImpersonationResult, PlatformUserSearchRow } from "@/types";
import { usePlatformGuard } from "../_guard";

const MIN_REASON = 8;

export default function PlatformSupportPage() {
  const { ready, gate } = usePlatformGuard(
    "Support access",
    "Start an audited, scoped support session for a tenant user"
  );

  const [q, setQ] = useState("");
  const [results, setResults] = useState<PlatformUserSearchRow[]>([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<PlatformUserSearchRow | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [session, setSession] = useState<ImpersonationResult | null>(null);
  const [startedAt, setStartedAt] = useState<Date | null>(null);

  const search = useCallback(async (term: string) => {
    if (!term.trim()) {
      setResults([]);
      return;
    }
    setSearching(true);
    try {
      setResults(
        await api.get<PlatformUserSearchRow[]>(
          `/platform/users?q=${encodeURIComponent(term.trim())}&limit=20`
        )
      );
    } catch {
      setResults([]);
    } finally {
      setSearching(false);
    }
  }, []);

  // Debounced search as the operator types (skip while a session is active).
  useEffect(() => {
    if (session) return;
    const t = setTimeout(() => search(q), 300);
    return () => clearTimeout(t);
  }, [q, search, session]);

  const reasonValid = reason.trim().length >= MIN_REASON;

  const start = async () => {
    setError(null);
    if (!selected) {
      setError("Select a user to support");
      return;
    }
    if (!reasonValid) {
      setError(`Enter a reason of at least ${MIN_REASON} characters`);
      return;
    }
    if (
      !confirm(
        `Start a support session as ${selected.fullName} (${selected.email})? This is recorded in the platform audit log.`
      )
    )
      return;
    setBusy(true);
    try {
      const result = await api.post<ImpersonationResult>("/platform/impersonate", {
        userId: selected.id,
        reason: reason.trim(),
      });
      setSession(result);
      setStartedAt(new Date());
    } catch (err) {
      setSession(null);
      setError(err instanceof ApiError ? err.message : "Failed to start support session");
    } finally {
      setBusy(false);
    }
  };

  const endSession = () => {
    // Exit is local: the platform session is never silently swapped, so the super
    // admin stays signed in. The scoped token is simply discarded.
    setSession(null);
    setStartedAt(null);
    setSelected(null);
    setReason("");
    setQ("");
    setResults([]);
  };

  if (!ready) return gate;

  const expiry = session?.expiresAt ? new Date(session.expiresAt) : null;

  return (
    <>
      <nav className="mb-2 text-xs text-slate-400">
        <Link href="/super-admin/platform" className="hover:text-slate-600">
          Platform
        </Link>{" "}
        / <span className="text-slate-600">Support access</span>
      </nav>

      <PageHeader
        title="Support access"
        subtitle="Start an audited, scoped support session for a tenant user"
        action={
          <Link href="/super-admin/platform">
            <Button variant="secondary">← Back</Button>
          </Link>
        }
      />

      {session && expiry !== null ? (
        <Card>
          {/* Clear, persistent active-session banner + details + exit. */}
          <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Badge tone="amber">Support session active</Badge>
                <span className="text-sm font-semibold text-amber-900">
                  {session.user.fullName}
                </span>
              </div>
              <Button variant="secondary" onClick={endSession}>
                End session
              </Button>
            </div>
            <div className="mt-3 grid gap-2 text-sm text-amber-900 sm:grid-cols-2">
              <div>Email: <span className="font-medium">{session.user.email}</span></div>
              <div>Role: <span className="font-medium">{session.user.role}</span></div>
              {selected && (
                <div>Institution: <span className="font-medium">{selected.institutionName}</span></div>
              )}
              {startedAt && (
                <div>Started: <span className="font-medium">{startedAt.toLocaleString()}</span></div>
              )}
              {expiry && (
                <div>Expires: <span className="font-medium">{expiry.toLocaleString()}</span></div>
              )}
              <div className="sm:col-span-2">Reason: <span className="font-medium">{reason.trim()}</span></div>
            </div>
          </div>
          <p className="text-sm text-slate-600">
            A scoped support token has been issued and recorded in the platform audit log.
            No passwords, secrets, or payment data are ever exposed. End the session when finished;
            it also lapses automatically at the expiry above.
          </p>
        </Card>
      ) : (
        <Card>
          <div className="max-w-2xl space-y-4">
            <Field label="Find a tenant user">
              <Input
                placeholder="Search by name or email…"
                value={q}
                onChange={(e) => {
                  setQ(e.target.value);
                  setSelected(null);
                }}
              />
            </Field>

            {/* Search results */}
            {!selected && q.trim() && (
              <div className="rounded-lg border border-slate-200">
                {searching ? (
                  <div className="p-3">
                    <Spinner />
                  </div>
                ) : results.length === 0 ? (
                  <p className="p-3 text-sm text-slate-400">No matching tenant users.</p>
                ) : (
                  <ul className="max-h-72 divide-y divide-slate-100 overflow-y-auto">
                    {results.map((u) => (
                      <li key={u.id}>
                        <button
                          onClick={() => setSelected(u)}
                          className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-slate-50"
                        >
                          <span>
                            <span className="font-medium text-slate-900">{u.fullName}</span>{" "}
                            <span className="text-slate-500">{u.email}</span>
                          </span>
                          <span className="flex items-center gap-2 text-xs text-slate-400">
                            <Badge tone="slate">{u.role}</Badge>
                            {u.institutionName}
                            {!u.isActive && <Badge tone="red">inactive</Badge>}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            {/* Selected user */}
            {selected && (
              <div className="rounded-lg border border-brand-200 bg-brand-50 px-3 py-2 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <span className="font-semibold text-slate-900">{selected.fullName}</span>{" "}
                    <span className="text-slate-500">{selected.email}</span>
                    <div className="mt-0.5 flex items-center gap-2 text-xs text-slate-500">
                      <Badge tone="slate">{selected.role}</Badge>
                      {selected.institutionName} ({selected.institutionCode})
                      {!selected.isActive && <Badge tone="red">inactive</Badge>}
                    </div>
                  </div>
                  <button
                    onClick={() => setSelected(null)}
                    className="text-xs text-slate-500 hover:text-slate-700"
                  >
                    Change
                  </button>
                </div>
              </div>
            )}

            <Field label="Reason (required)">
              <Input
                placeholder="e.g. Investigating a reported grading issue (ticket #123)"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </Field>
            {reason.length > 0 && !reasonValid && (
              <p className="text-xs text-red-600">
                Please enter at least {MIN_REASON} characters.
              </p>
            )}

            <ErrorNote message={error} />
            <p className="text-xs text-slate-400">
              A super admin cannot impersonate another super admin; only one session can be
              active at a time. The target must be a tenant user. Every attempt is audited.
            </p>
            <Button onClick={start} disabled={busy || !selected || !reasonValid}>
              {busy ? "Starting…" : "Start support session"}
            </Button>
          </div>
        </Card>
      )}
    </>
  );
}
