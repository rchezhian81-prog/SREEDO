"use client";

import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { Badge, Card, EmptyState, ErrorNote, Spinner } from "@/components/ui";
import { Icon } from "@/components/icons";
import type { OpsStorage, OpsTenantStorage } from "@/types";
import { formatBytes, formatNumber } from "../../platform/_utils";
import { StatCard } from "./OverviewTab";
import { formatPct } from "./taxonomy";

export function StorageTab({ reloadKey }: { reloadKey: number }) {
  const [data, setData] = useState<OpsStorage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await api.get<OpsStorage>("/observability/storage"));
    } catch (err) {
      setData(null);
      setError(err instanceof ApiError ? err.message : "Failed to load storage");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load, reloadKey]);

  return (
    <div className="space-y-5">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Storage</h2>
      <ErrorNote message={error} />

      {loading ? (
        <Spinner />
      ) : data ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="Total storage" value={formatBytes(data.totalBytes)} />
            <StatCard label="Backups" value={formatBytes(data.byCategory.backups)} />
            <StatCard label="Exports" value={formatBytes(data.byCategory.exports)} />
            <StatCard
              label="Documents"
              value={formatBytes(data.byCategory.documents)}
              sub={
                <span className="text-xs text-faint">
                  {formatNumber(data.documentCount)} files · {data.storageMode}
                </span>
              }
            />
          </div>

          {data.documentCategories.length > 0 && (
            <Card>
              <p className="mb-3 text-sm font-semibold text-ink">Documents by category</p>
              <div className="flex flex-wrap gap-2">
                {data.documentCategories.map((c) => (
                  <div key={c.category} className="rounded-lg border border-line bg-surface-2 px-3 py-2">
                    <p className="text-xs font-medium capitalize text-muted">{c.category}</p>
                    <p className="mt-0.5 text-sm font-semibold text-ink">{formatBytes(c.bytes)}</p>
                    <p className="text-xs text-faint">{formatNumber(c.count)} files</p>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {data.nearOrOverLimit.length > 0 && (
            <div
              role="status"
              className="rounded-2xl border border-amber-500/40 bg-amber-500/10 p-4 text-amber-700 dark:text-amber-300"
            >
              <div className="flex items-center gap-2 text-sm font-semibold">
                <Icon name="shieldAlert" className="h-4 w-4" />
                {formatNumber(data.nearOrOverLimit.length)} tenant
                {data.nearOrOverLimit.length === 1 ? "" : "s"} near or over the storage limit
              </div>
              <ul className="mt-2 list-disc space-y-1 pl-6 text-sm">
                {data.nearOrOverLimit.map((t) => (
                  <li key={t.institutionId}>
                    {t.institutionName} ({t.institutionCode}) — {formatPct(t.usagePct)} of{" "}
                    {t.limitMb == null ? "∞" : `${formatNumber(t.limitMb)} MB`}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <Card className="p-0">
            <div className="border-b border-line px-5 py-3">
              <p className="text-sm font-semibold text-ink">Tenant storage</p>
            </div>
            {data.byTenant.length === 0 ? (
              <p className="px-5 py-4 text-sm text-muted">No tenant storage recorded.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="border-b border-line bg-surface-2 text-xs uppercase text-muted">
                    <tr>
                      <th className="px-4 py-3">Tenant</th>
                      <th className="px-4 py-3">Code</th>
                      <th className="px-4 py-3 text-right">Used</th>
                      <th className="px-4 py-3 text-right">Limit</th>
                      <th className="px-4 py-3 text-right">Usage</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {data.byTenant.map((t) => (
                      <tr key={t.institutionId} className="hover:bg-hover">
                        <td className="px-4 py-3 font-medium text-ink">{t.institutionName}</td>
                        <td className="px-4 py-3 text-muted">{t.institutionCode}</td>
                        <td className="whitespace-nowrap px-4 py-3 text-right text-muted">
                          {formatBytes(t.usedBytes)}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-right text-muted">
                          {t.limitMb == null ? "∞" : `${formatNumber(t.limitMb)} MB`}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-right">
                          <UsageBadge tenant={t} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      ) : (
        !error && <EmptyState message="No storage data available." />
      )}
    </div>
  );
}

function UsageBadge({ tenant }: { tenant: OpsTenantStorage }) {
  if (tenant.usagePct == null) return <span className="text-faint">—</span>;
  const tone = tenant.overLimit ? "red" : tenant.nearLimit ? "amber" : "slate";
  return <Badge tone={tone}>{formatPct(tenant.usagePct)}</Badge>;
}
