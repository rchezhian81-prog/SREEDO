"use client";

import Link from "next/link";
import { EmptyState, ErrorNote, Spinner } from "@/components/ui";
import { Icon, type IconName } from "@/components/icons";
import type { OverviewQuickActions } from "@/types";

/** Best-effort icon per quick-action key (falls back to sparkles). */
const ACTION_ICON: Record<string, IconName> = {
  create_tenant: "building",
  invoices: "receipt",
  create_invoice: "receipt",
  subscriptions: "card",
  packages: "package",
  security: "shield",
  audit: "history",
  support: "lifeBuoy",
  create_backup: "database",
  exports: "download",
  jobs: "layers",
  observability: "health",
  communication: "mail",
  settings: "gear",
  platform_admins: "users",
  rbac: "key",
};

export function QuickActions({
  data,
  loading,
  error,
}: {
  data: OverviewQuickActions | null;
  loading: boolean;
  error: string | null;
}) {
  if (error) return <ErrorNote message={error} />;
  if (!data) return loading ? <Spinner /> : <EmptyState message="No quick actions available." />;
  if (data.actions.length === 0) return <EmptyState message="No quick actions available." />;

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {data.actions.map((a) => {
        const icon = ACTION_ICON[a.key] ?? "sparkles";

        // Disallowed (backend RBAC is the source of truth) — disabled + tooltip,
        // never a live link, so the user can never bypass a missing permission.
        if (!a.allowed) {
          return (
            <div
              key={a.key}
              aria-disabled="true"
              title="You don't have permission to perform this action"
              className="flex cursor-not-allowed items-center gap-3 rounded-2xl border border-dashed border-line bg-surface/60 p-4 opacity-60"
            >
              <Icon name={icon} className="h-5 w-5 text-faint" />
              <span className="text-sm font-medium text-muted">{a.label}</span>
              <Icon name="lock" className="ml-auto h-4 w-4 text-faint" />
            </div>
          );
        }

        return (
          <Link
            key={a.key}
            href={a.route}
            className="group flex items-center gap-3 rounded-2xl border border-line bg-surface p-4 shadow-card transition hover:border-brand-500/40 hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50"
          >
            <Icon name={icon} className="h-5 w-5 text-brand-600" />
            <span className="text-sm font-medium text-ink">{a.label}</span>
            <Icon
              name="arrowRight"
              className="ml-auto h-4 w-4 text-faint transition group-hover:text-brand-600"
            />
          </Link>
        );
      })}
    </div>
  );
}
