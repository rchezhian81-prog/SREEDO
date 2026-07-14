"use client";

import Link from "next/link";
import { Button } from "@/components/ui";
import { Icon } from "@/components/icons";

/**
 * PR-SEC2 — shown when the backend blocks a request with INSTITUTION_SUSPENDED
 * (the api client clears the session and routes here). Standalone screen: no
 * dashboard chrome, since the tenant no longer has access.
 */
export default function SuspendedPage() {
  return (
    <main className="grid min-h-screen place-items-center bg-app p-6">
      <div className="w-full max-w-md rounded-2xl border border-line bg-surface p-8 text-center shadow-card">
        <div className="mx-auto mb-5 grid h-14 w-14 place-items-center rounded-2xl bg-amber-500/12 text-amber-600 dark:text-amber-400">
          <Icon name="lock" className="h-7 w-7" />
        </div>
        <h1 className="text-xl font-extrabold tracking-tight text-ink">
          Institution suspended
        </h1>
        <p className="mt-3 text-sm text-muted">
          Access to this institution is currently suspended. This usually means the
          account has been paused by an administrator or is pending a billing
          matter.
        </p>
        <p className="mt-3 text-sm text-muted">
          Please contact your institution administrator or our support team to
          restore access. If you believe this is a mistake, your administrator can
          reactivate the account.
        </p>
        <div className="mt-6">
          <Link href="/login">
            <Button variant="secondary" className="w-full">
              Back to sign in
            </Button>
          </Link>
        </div>
      </div>
    </main>
  );
}
