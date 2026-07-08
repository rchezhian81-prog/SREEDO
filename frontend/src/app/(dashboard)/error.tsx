"use client";

import { useEffect } from "react";
import { Icon } from "@/components/icons";

/**
 * Route-level error boundary for the whole tenant dashboard (PR-T4). Any render
 * or data error inside a dashboard page surfaces here instead of a blank white
 * screen — with an honest message, a retry, and an escape hatch to the overview.
 */
export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Log for diagnostics; never render raw stack traces to the user.
    console.error("Dashboard route error:", error);
  }, [error]);

  return (
    <div className="grid min-h-[60vh] place-items-center p-6">
      <div className="w-full max-w-md rounded-2xl border border-line bg-surface p-8 text-center shadow-card">
        <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-red-500/12 text-red-600 dark:text-red-400">
          <Icon name="alert" className="h-7 w-7" />
        </div>
        <h1 className="text-lg font-bold text-ink">Something went wrong</h1>
        <p className="mx-auto mt-2 max-w-sm text-sm text-muted">
          This page ran into an unexpected error. You can retry, or head back to
          your dashboard.
        </p>
        {error.digest && (
          <p className="mt-2 text-xs text-faint">Reference: {error.digest}</p>
        )}
        <div className="mt-5 flex flex-wrap justify-center gap-2.5">
          <button
            onClick={reset}
            className="inline-flex items-center gap-2 rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-700"
          >
            <Icon name="history" className="h-4 w-4" />
            Try again
          </button>
          <a
            href="/dashboard"
            className="inline-flex items-center gap-2 rounded-xl border border-line bg-surface px-4 py-2.5 text-sm font-semibold text-ink transition hover:bg-hover"
          >
            Go to dashboard
          </a>
        </div>
      </div>
    </div>
  );
}
