"use client";

import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { Badge, Card, ErrorNote, Spinner } from "@/components/ui";
import { Icon } from "@/components/icons";
import type { AuditIntegrity } from "@/types";

/**
 * Integrity status card. Reports the HONEST state — row-level hash-chaining is
 * not enabled — and never fakes tamper-evidence. Presented as a future
 * enhancement so operators aren't misled about guarantees the store can't make.
 */
export function IntegrityCard() {
  const [data, setData] = useState<AuditIntegrity | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<AuditIntegrity>("/platform/audit/integrity")
      .then(setData)
      .catch((err) =>
        setError(err instanceof ApiError ? err.message : "Failed to load integrity status")
      )
      .finally(() => setLoading(false));
  }, []);

  return (
    <Card>
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Icon name="fingerprint" className="h-5 w-5 text-slate-400" />
          <h3 className="text-base font-semibold text-slate-800">Tamper-evidence</h3>
        </div>
        {data && (
          <Badge tone={data.enabled ? "green" : "slate"}>
            {data.enabled ? "Enabled" : "Not enabled"}
          </Badge>
        )}
      </div>

      {loading ? (
        <Spinner />
      ) : error ? (
        <ErrorNote message={error} />
      ) : data ? (
        <div className="space-y-3">
          <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
            <span className="font-medium text-slate-600">Hash-chaining</span>
            <Badge tone="amber">Future enhancement</Badge>
          </div>
          <p className="text-sm text-slate-500">{data.note}</p>
        </div>
      ) : null}
    </Card>
  );
}
