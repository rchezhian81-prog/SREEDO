"use client";

import { useState } from "react";
import { api, ApiError } from "@/lib/api";
import {
  Badge,
  Button,
  Card,
  ErrorNote,
  Field,
  Input,
  PageHeader,
} from "@/components/ui";
import type { ImpersonationResult } from "@/types";
import { usePlatformGuard } from "../_guard";

export default function PlatformImpersonatePage() {
  const { ready, gate } = usePlatformGuard(
    "Support impersonation",
    "Start an audited, scoped support session for a tenant user"
  );

  const [userId, setUserId] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [session, setSession] = useState<ImpersonationResult | null>(null);

  const start = async () => {
    setError(null);
    if (!userId.trim()) {
      setError("Enter the target user's ID");
      return;
    }
    if (
      !confirm(
        "Start a support impersonation session for this user? This action is recorded in the platform audit log."
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      const result = await api.post<ImpersonationResult>("/platform/impersonate", {
        userId: userId.trim(),
        reason: reason.trim() || undefined,
      });
      setSession(result);
    } catch (err) {
      setSession(null);
      setError(
        err instanceof ApiError ? err.message : "Failed to start impersonation"
      );
    } finally {
      setBusy(false);
    }
  };

  const endSession = () => {
    // Exit is local: the platform session is never silently swapped, so the
    // super admin stays signed in. The scoped token is simply discarded.
    setSession(null);
    setUserId("");
    setReason("");
  };

  if (!ready) return gate;

  return (
    <>
      <PageHeader
        title="Support impersonation"
        subtitle="Start an audited, scoped support session for a tenant user"
      />

      {session ? (
        <Card>
          {/* Clear, persistent impersonation banner + exit. */}
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3">
            <div className="flex flex-wrap items-center gap-2 text-sm text-amber-900">
              <Badge tone="amber">Impersonation active</Badge>
              <span>
                Acting as{" "}
                <span className="font-semibold">{session.user.fullName}</span> (
                {session.user.email}) ·{" "}
                <span className="font-medium">{session.user.role}</span>
              </span>
            </div>
            <Button variant="secondary" onClick={endSession}>
              End impersonation
            </Button>
          </div>
          <p className="text-sm text-slate-600">
            A scoped support session has been issued for this user and recorded in
            the platform audit log. No passwords, secrets, or payment data are ever
            exposed. End the session when you are finished.
          </p>
        </Card>
      ) : (
        <Card>
          <div className="max-w-lg space-y-4">
            <Field label="Target user ID">
              <Input
                placeholder="UUID of the tenant user"
                value={userId}
                onChange={(event) => setUserId(event.target.value)}
              />
            </Field>
            <Field label="Reason (optional)">
              <Input
                placeholder="e.g. Investigating a reported issue"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
              />
            </Field>
            <ErrorNote message={error} />
            <p className="text-xs text-slate-400">
              A super admin cannot impersonate another super admin. The target must
              be a tenant user. Every attempt is audited.
            </p>
            <Button onClick={start} disabled={busy}>
              {busy ? "Starting…" : "Start impersonation"}
            </Button>
          </div>
        </Card>
      )}
    </>
  );
}
