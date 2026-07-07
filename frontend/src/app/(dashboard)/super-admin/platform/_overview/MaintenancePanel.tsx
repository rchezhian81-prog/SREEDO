"use client";

import Link from "next/link";
import { Badge, Card, Spinner } from "@/components/ui";
import { Icon } from "@/components/icons";
import type { OverviewSummary } from "@/types";
import { formatDateTime, humanizeToken } from "./taxonomy";

/**
 * Maintenance mode + announcement (display only — free text already masked
 * server-side). Editing lives in Settings / Communication Admin, linked out.
 */
export function MaintenancePanel({
  summary,
  loading,
}: {
  summary: OverviewSummary | null;
  loading: boolean;
}) {
  if (!summary) return loading ? <Spinner /> : null;

  const m = summary.maintenance;

  // Restricted (RBAC-hidden) — subtle placeholder, never zeros.
  if (!m.available) {
    return (
      <Card className="border-dashed bg-surface/60">
        <div className="flex items-center gap-2">
          <Icon name="lock" className="h-4 w-4 text-faint" />
          <p className="text-sm font-medium text-muted">Maintenance &amp; announcements</p>
        </div>
        <p className="mt-2 text-xs text-faint">
          Restricted — you don&rsquo;t have permission to view this.
        </p>
      </Card>
    );
  }

  const maint = Boolean(m.maintenanceMode);
  const ann = Boolean(m.announcementActive);

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-4">
          <div>
            <div className="flex items-center gap-2">
              <Icon name="wrench" className="h-4 w-4 text-muted" />
              <p className="text-sm font-semibold text-ink">Maintenance mode</p>
              <Badge tone={maint ? "amber" : "green"}>{maint ? "On" : "Off"}</Badge>
            </div>
            {maint && (
              <div className="mt-1.5">
                {m.maintenanceMessage && <p className="text-sm text-ink">{m.maintenanceMessage}</p>}
                {(m.maintenanceStartsAt || m.maintenanceEndsAt) && (
                  <p className="mt-1 text-xs text-faint">
                    {m.maintenanceStartsAt ? `From ${formatDateTime(m.maintenanceStartsAt)}` : ""}
                    {m.maintenanceEndsAt ? ` until ${formatDateTime(m.maintenanceEndsAt)}` : ""}
                  </p>
                )}
              </div>
            )}
          </div>

          <div>
            <div className="flex items-center gap-2">
              <Icon name="megaphone" className="h-4 w-4 text-muted" />
              <p className="text-sm font-semibold text-ink">Announcement</p>
              <Badge tone={ann ? "blue" : "slate"}>{ann ? "Active" : "None"}</Badge>
            </div>
            {ann && (
              <div className="mt-1.5">
                {m.announcementText && <p className="text-sm text-ink">{m.announcementText}</p>}
                {m.announcementVisibility && (
                  <p className="mt-1 text-xs text-faint">
                    Visible to {humanizeToken(m.announcementVisibility).toLowerCase()}
                  </p>
                )}
              </div>
            )}
          </div>
        </div>

        <Link
          href={m.drilldown}
          className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-brand-600 hover:underline"
        >
          Manage in Settings
          <Icon name="arrowRight" className="h-3.5 w-3.5" />
        </Link>
      </div>
    </Card>
  );
}
