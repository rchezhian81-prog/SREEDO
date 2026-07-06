"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { api, ApiError } from "@/lib/api";
import { Badge, Button, Card, EmptyState, ErrorNote, Spinner } from "@/components/ui";
import { Icon, type IconName } from "@/components/icons";
import type { OpsIntegrations } from "@/types";
import { formatBytes, formatNumber } from "../../platform/_utils";
import { formatDateTime, superAdminHref } from "./taxonomy";

export function IntegrationsTab({ reloadKey }: { reloadKey: number }) {
  const [data, setData] = useState<OpsIntegrations | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await api.get<OpsIntegrations>("/observability/integrations"));
    } catch (err) {
      setData(null);
      setError(err instanceof ApiError ? err.message : "Failed to load integrations");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load, reloadKey]);

  return (
    <div className="space-y-5">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Integrations</h2>
      <ErrorNote message={error} />

      {loading ? (
        <Spinner />
      ) : data ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <IntegrationCard
            icon="database"
            title="Backups"
            href={superAdminHref(data.links.backups)}
          >
            {"unavailable" in data.backups ? (
              <Unavailable />
            ) : (
              <>
                <DataRow label="Last success" value={formatDateTime(data.backups.lastSuccessAt)} />
                <DataRow label="Available" value={formatNumber(data.backups.available)} />
                <DataRow
                  label="Failed"
                  value={formatNumber(data.backups.failed)}
                  tone={data.backups.failed > 0 ? "red" : undefined}
                />
                <DataRow label="Storage" value={formatBytes(data.backups.storageUsedBytes)} />
                <DataRow
                  label="Warnings"
                  value={formatNumber(data.backups.warnings)}
                  tone={data.backups.warnings > 0 ? "amber" : undefined}
                />
              </>
            )}
          </IntegrationCard>

          <IntegrationCard icon="fileDown" title="Exports" href={superAdminHref(data.links.exports)}>
            {"unavailable" in data.exports ? (
              <Unavailable />
            ) : (
              <>
                <DataRow label="Total" value={formatNumber(data.exports.total)} />
                <DataRow
                  label="Pending approval"
                  value={formatNumber(data.exports.pendingApproval)}
                  tone={data.exports.pendingApproval > 0 ? "amber" : undefined}
                />
                <DataRow label="Sensitive" value={formatNumber(data.exports.sensitive)} />
                <DataRow label="Storage" value={formatBytes(data.exports.storageUsedBytes)} />
              </>
            )}
          </IntegrationCard>

          <IntegrationCard
            icon="shieldCheck"
            title="Security"
            href={superAdminHref(data.links.security)}
          >
            <DataRow label="Open alerts" value={formatNumber(data.security.alerts)} />
            <DataRow
              label="Critical"
              value={formatNumber(data.security.critical)}
              tone={data.security.critical > 0 ? "red" : undefined}
            />
          </IntegrationCard>

          <IntegrationCard icon="clipboard" title="Audit" href={superAdminHref(data.links.audit)}>
            <DataRow label="Events (24h)" value={formatNumber(data.audit.last24h)} />
            <DataRow
              label="High-risk (24h)"
              value={formatNumber(data.audit.highRisk24h)}
              tone={data.audit.highRisk24h > 0 ? "amber" : undefined}
            />
          </IntegrationCard>
        </div>
      ) : (
        !error && <EmptyState message="No integration data available." />
      )}
    </div>
  );
}

function IntegrationCard({
  icon,
  title,
  href,
  children,
}: {
  icon: IconName;
  title: string;
  href: string;
  children: ReactNode;
}) {
  return (
    <Card>
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Icon name={icon} className="h-4 w-4 text-muted" />
          <p className="text-sm font-semibold text-ink">{title}</p>
        </div>
        <Link href={href}>
          <Button variant="secondary" className="!px-3 !py-1.5">
            View
            <Icon name="arrowRight" className="h-4 w-4" />
          </Button>
        </Link>
      </div>
      <dl className="space-y-2 text-sm">{children}</dl>
    </Card>
  );
}

function DataRow({
  label,
  value,
  tone,
}: {
  label: string;
  value: ReactNode;
  tone?: "red" | "amber";
}) {
  const color = tone === "red" ? "text-red-600" : tone === "amber" ? "text-amber-600" : "text-ink";
  return (
    <div className="flex items-center justify-between gap-2">
      <dt className="text-muted">{label}</dt>
      <dd className={`font-medium ${color}`}>{value}</dd>
    </div>
  );
}

function Unavailable() {
  return (
    <div className="flex items-center gap-2">
      <Badge tone="slate">Unavailable</Badge>
      <span className="text-xs text-faint">This integration could not be read.</span>
    </div>
  );
}
