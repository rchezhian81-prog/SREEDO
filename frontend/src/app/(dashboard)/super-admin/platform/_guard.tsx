"use client";

import { useEffect, useState } from "react";
import { useAuthStore } from "@/stores/auth-store";
import { EmptyState, PageHeader, Spinner } from "@/components/ui";

/**
 * Super-admin gate for the platform console.
 *
 * The (dashboard) layout already redirects non-super_admins away from
 * `/super-admin/*`, but every platform page also gates explicitly here so a
 * tenant user can never see platform data even for a frame: we use the SAME
 * mechanism the layout uses — the persisted auth-store `user.role`.
 *
 * Returns:
 *  - `ready: false` + a `gate` node while hydrating or when access is denied
 *    (render the gate and return early — AFTER all hooks have run).
 *  - `ready: true` once the current user is confirmed to be a super_admin.
 */
export function usePlatformGuard(title: string, subtitle?: string): {
  ready: boolean;
  gate: React.ReactNode;
} {
  const role = useAuthStore((s) => s.user?.role);
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);

  if (!hydrated) {
    return {
      ready: false,
      gate: (
        <>
          <PageHeader title={title} subtitle={subtitle} />
          <Spinner />
        </>
      ),
    };
  }

  if (role !== "super_admin") {
    return {
      ready: false,
      gate: (
        <>
          <PageHeader title={title} subtitle={subtitle} />
          <EmptyState message="This area is restricted to the platform super administrator." />
        </>
      ),
    };
  }

  return { ready: true, gate: null };
}
