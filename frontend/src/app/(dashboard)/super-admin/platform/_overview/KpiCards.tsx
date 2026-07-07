"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { EmptyState, ErrorNote, Spinner } from "@/components/ui";
import { Icon } from "@/components/icons";
import { formatMoney } from "@/lib/format";
import type {
  OverviewCardStatus,
  OverviewSection,
  OverviewSummary,
} from "@/types";
import { formatNumber } from "../_utils";
import { RestrictedCard, SectionHeading, StatCard } from "./primitives";
import { titleCase } from "./taxonomy";

/** Honest metric: a genuinely-absent value shows "—", a real 0 shows "0". */
const num = (v?: number | null): string => (v == null ? "—" : formatNumber(v));
const money = (v: number | null | undefined, cur?: string): string =>
  v == null ? "—" : formatMoney(v, cur);

/** Health/operations status → value tone. */
function statusValueTone(
  status?: OverviewCardStatus | string | null
): "green" | "amber" | "red" | undefined {
  if (status === "healthy") return "green";
  if (status === "warning") return "amber";
  if (status === "critical") return "red";
  return undefined;
}

/** A KPI group: heading + (restricted placeholder | a grid of stat cards). */
function Group<T>({
  title,
  section,
  children,
}: {
  title: string;
  section: OverviewSection<T>;
  /** Rendered only when the section is available; receives the unwrapped data + its drilldown. */
  children: (data: T & { drilldown?: string }) => ReactNode;
}) {
  const drilldown =
    section.available && "drilldown" in section
      ? (section as { drilldown?: string }).drilldown
      : undefined;
  return (
    <div>
      <SectionHeading
        action={
          section.available && drilldown ? (
            <Link
              href={drilldown}
              className="inline-flex items-center gap-1 text-xs font-medium text-brand-600 hover:underline"
            >
              View
              <Icon name="arrowRight" className="h-3.5 w-3.5" />
            </Link>
          ) : undefined
        }
      >
        {title}
      </SectionHeading>
      {section.available ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          {children(section as T & { drilldown?: string })}
        </div>
      ) : (
        <RestrictedCard label={title} />
      )}
    </div>
  );
}

export function KpiCards({
  summary,
  loading,
  error,
}: {
  summary: OverviewSummary | null;
  loading: boolean;
  error: string | null;
}) {
  if (error) return <ErrorNote message={error} />;
  if (!summary) return loading ? <Spinner /> : <EmptyState message="No overview data available." />;

  return (
    <div className="space-y-6">
      {/* Tenant */}
      <Group title="Tenants" section={summary.tenant}>
        {(t) => (
          <>
            <StatCard label="Total" value={num(t.total)} href={t.drilldown} />
            <StatCard label="Active" value={num(t.active)} href={t.drilldown} />
            <StatCard label="Trial" value={num(t.trial)} href={t.drilldown} />
            <StatCard
              label="Suspended"
              value={num(t.suspended)}
              tone={t.suspended ? "amber" : undefined}
              href={t.drilldown}
            />
            <StatCard label="Archived" value={num(t.archived)} href={t.drilldown} />
            <StatCard label="New this period" value={num(t.newInRange)} href={t.drilldown} />
          </>
        )}
      </Group>

      {/* Subscription */}
      <Group title="Subscriptions" section={summary.subscription}>
        {(s) => (
          <>
            <StatCard label="Active" value={num(s.active)} href={s.drilldown} />
            <StatCard
              label="Expiring soon"
              value={num(s.expiringSoon)}
              tone={s.expiringSoon ? "amber" : undefined}
              href={s.drilldown}
            />
            <StatCard
              label="In grace"
              value={num(s.grace)}
              tone={s.grace ? "amber" : undefined}
              href={s.drilldown}
            />
            <StatCard
              label="Expired"
              value={num(s.expired)}
              tone={s.expired ? "red" : undefined}
              href={s.drilldown}
            />
            <StatCard label="Cancelled" value={num(s.cancelled)} href={s.drilldown} />
            <StatCard
              label="Renewal due"
              value={num(s.renewalDue)}
              tone={s.renewalDue ? "amber" : undefined}
              href={s.drilldown}
            />
          </>
        )}
      </Group>

      {/* Billing */}
      <Group title="Billing & revenue" section={summary.billing}>
        {(b) => (
          <>
            <StatCard label="MRR" value={money(b.mrr, b.currency)} href={b.drilldown} />
            <StatCard label="ARR" value={money(b.arr, b.currency)} href={b.drilldown} />
            <StatCard
              label="Outstanding"
              value={money(b.outstanding, b.currency)}
              tone={b.outstanding ? "amber" : undefined}
              href={b.drilldown}
            />
            <StatCard
              label="Overdue"
              value={money(b.overdue, b.currency)}
              tone={b.overdue ? "red" : undefined}
              href={b.drilldown}
            />
            <StatCard
              label="Paid"
              value={money(b.paidAmount, b.currency)}
              hint={b.paidCount != null ? `${formatNumber(b.paidCount)} invoice(s)` : undefined}
              href={b.drilldown}
            />
            <StatCard
              label="Unpaid"
              value={num(b.unpaidCount)}
              tone={b.unpaidCount ? "amber" : undefined}
              hint={b.overdueCount != null ? `${formatNumber(b.overdueCount)} overdue` : undefined}
              href={b.drilldown}
            />
            {b.mixedCurrency && (
              <p className="col-span-full text-xs text-amber-600">
                Multiple currencies present — headline shown in {b.currency}.
              </p>
            )}
          </>
        )}
      </Group>

      {/* Security */}
      <Group title="Security" section={summary.security}>
        {(s) => (
          <>
            <StatCard
              label="High-risk events"
              value={num(s.highRisk)}
              tone={s.highRisk ? "red" : undefined}
              href={s.drilldown}
            />
            <StatCard
              label="Failed logins (today)"
              value={num(s.failedLoginsToday)}
              tone={s.failedLoginsToday ? "amber" : undefined}
              hint={s.failedLoginsWeek != null ? `${formatNumber(s.failedLoginsWeek)} this week` : undefined}
              href={s.drilldown}
            />
            <StatCard label="Active sessions" value={num(s.activeSessions)} href={s.drilldown} />
            <StatCard
              label="Owners without 2FA"
              value={num(s.ownersWithout2fa)}
              tone={s.ownersWithout2fa ? "red" : undefined}
              hint={s.adminsWithout2fa != null ? `${formatNumber(s.adminsWithout2fa)} admin(s) too` : undefined}
              href={s.drilldown}
            />
            <StatCard label="Support sessions" value={num(s.supportSessions)} href={s.drilldown} />
            <StatCard
              label="RBAC changes"
              value={num(s.rbacChanges)}
              tone={s.rbacChanges ? "amber" : undefined}
              href={s.drilldown}
            />
          </>
        )}
      </Group>

      {/* Operations */}
      <Group title="Operations" section={summary.operations}>
        {(o) => (
          <>
            <StatCard
              label="Health"
              value={titleCase(o.status)}
              tone={statusValueTone(o.status)}
              href={o.drilldown}
            />
            <StatCard
              label="Active incidents"
              value={num(o.incidents)}
              tone={o.incidents ? "amber" : undefined}
              hint={o.criticalIncidents ? `${formatNumber(o.criticalIncidents)} critical` : undefined}
              href={o.drilldown}
            />
            <StatCard
              label="Open alerts"
              value={num(o.openAlerts)}
              tone={o.openAlerts ? "amber" : undefined}
              href={o.drilldown}
            />
            <StatCard
              label="Failed jobs (today)"
              value={num(o.failedJobsToday)}
              tone={o.failedJobsToday ? "amber" : undefined}
              hint={o.stuckJobs ? `${formatNumber(o.stuckJobs)} stuck` : undefined}
              href={o.drilldown}
            />
            <StatCard label="Queue depth" value={num(o.queueDepth)} href={o.drilldown} />
            <StatCard
              label="Failed exports"
              value={num(o.failedExports)}
              tone={o.failedExports ? "amber" : undefined}
              href={o.drilldown}
            />
            <StatCard
              label="Failed comms"
              value={num(o.failedComms)}
              tone={o.failedComms ? "amber" : undefined}
              href={o.drilldown}
            />
            <StatCard
              label="Failed backups"
              value={num(o.failedBackups)}
              tone={o.failedBackups ? "red" : undefined}
              href={o.drilldown}
            />
          </>
        )}
      </Group>
    </div>
  );
}
