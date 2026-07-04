"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { useAuthStore } from "@/stores/auth-store";
import { Badge } from "@/components/ui";
import { Icon } from "@/components/icons";
import { toast } from "@/components/toast";
import { useNow } from "@/lib/use-now";
import {
  formatCountdown,
  formatDateTime,
  humanizeRole,
  moduleLabel,
  scopeLabel,
  scopeTone,
} from "@/lib/support";

const CONSOLE_PATH = "/super-admin/platform/support";

/**
 * App-wide support-mode banner. Renders NOTHING unless an operator is engaged in
 * a support session (auth-store `support` is non-null). When engaged it shows the
 * target/tenant/operator, scope + allowed modules, a live countdown, and lets the
 * operator End or Return.
 *
 * End / Return call POST /platform/support/sessions/:id/end with the OPERATOR's
 * own token (the active token is the target's scoped imp token, and the end
 * endpoint is super-admin-only), then exit support mode. The countdown reaching
 * zero exits locally without an /end call (the server already expired it).
 */
export function SupportModeBanner() {
  const support = useAuthStore((s) => s.support);
  const exitSupport = useAuthStore((s) => s.exitSupport);
  const router = useRouter();
  const now = useNow(1000, support !== null);
  const [busy, setBusy] = useState(false);
  const handledExpiry = useRef(false);

  // Defer the console redirect a tick so the layout's own out-of-area redirect
  // (fired the instant the operator identity is restored) can't win the race.
  const exitTo = useCallback(
    (path: string) => {
      setTimeout(() => router.replace(path), 0);
    },
    [router]
  );

  const expiresMs = support ? new Date(support.session.expiresAt).getTime() : 0;

  // Auto-exit when the countdown hits zero: the imp token is already dead
  // server-side, so DON'T call /end — just drop support mode and inform.
  useEffect(() => {
    if (!support) {
      handledExpiry.current = false;
      return;
    }
    if (!handledExpiry.current && now >= expiresMs) {
      handledExpiry.current = true;
      exitSupport();
      toast.info("Support session expired — returned to Super Admin.");
      exitTo(CONSOLE_PATH);
    }
  }, [support, now, expiresMs, exitSupport, exitTo]);

  if (!support) return null;
  const { session, operatorToken } = support;

  const leave = async () => {
    if (busy) return;
    setBusy(true);
    // Best-effort: end the server-side session with the operator's token. Even if
    // this fails (already expired/revoked), still restore the operator locally.
    try {
      await api.post(`/platform/support/sessions/${session.id}/end`, undefined, operatorToken);
    } catch {
      // ignore — the session may have already ended server-side
    }
    exitSupport();
    exitTo(CONSOLE_PATH);
  };

  return (
    <div
      role="alert"
      className="w-full border-b-2 border-amber-500 bg-amber-500 text-amber-950 shadow-[0_2px_10px_rgb(0_0_0_/_0.15)]"
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5 md:px-6">
        <span className="inline-flex items-center gap-2 rounded-md bg-amber-950/90 px-2.5 py-1 text-xs font-extrabold uppercase tracking-wide text-amber-50">
          <Icon name="shield" className="h-4 w-4" />
          Support mode
        </span>

        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-4 gap-y-1 text-sm">
          <span className="min-w-0 truncate font-bold">
            {session.targetName}{" "}
            <span className="font-medium text-amber-900">
              · {session.targetEmail} · {humanizeRole(session.targetRole)}
            </span>
          </span>
          <span className="truncate text-amber-900">
            Tenant: <strong>{session.institutionName ?? "—"}</strong>
            {session.institutionCode ? ` (${session.institutionCode})` : ""}
          </span>
          <Badge tone={scopeTone(session.scope)}>{scopeLabel(session.scope)}</Badge>
          {session.scope === "module_limited" && session.allowedModules.length > 0 && (
            <span className="truncate text-xs text-amber-900">
              Modules: {session.allowedModules.map((m) => moduleLabel(m)).join(", ")}
            </span>
          )}
        </div>

        <span
          className="inline-flex items-center gap-1.5 rounded-md bg-amber-950/90 px-2.5 py-1 font-mono text-sm font-bold text-amber-50"
          title={`Expires ${formatDateTime(session.expiresAt)}`}
        >
          <Icon name="calendar" className="h-3.5 w-3.5" />
          {formatCountdown(expiresMs, now)}
        </span>

        <div className="flex items-center gap-2">
          <button
            onClick={leave}
            disabled={busy}
            className="rounded-lg bg-red-600 px-3 py-1.5 text-sm font-semibold text-white transition hover:bg-red-700 disabled:opacity-60"
          >
            {busy ? "Ending…" : "End session"}
          </button>
          <button
            onClick={leave}
            disabled={busy}
            className="rounded-lg border border-amber-950/40 bg-amber-100 px-3 py-1.5 text-sm font-semibold text-amber-950 transition hover:bg-amber-50 disabled:opacity-60"
          >
            Return to Super Admin
          </button>
        </div>
      </div>

      {/* Secondary line: operator + reason, for full accountability at a glance. */}
      <div className="border-t border-amber-500/70 bg-amber-400/70 px-4 py-1.5 text-xs text-amber-950 md:px-6">
        <span className="font-semibold">Operator:</span> {session.operatorEmail}
        <span className="mx-2 text-amber-800">·</span>
        <span className="font-semibold">Started:</span> {formatDateTime(session.startedAt)}
        <span className="mx-2 text-amber-800">·</span>
        <span className="font-semibold">Reason:</span> {session.reason}
      </div>
    </div>
  );
}
