"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api, ApiError } from "@/lib/api";
import { Badge, Button, Card, EmptyState, ErrorNote, Spinner } from "@/components/ui";
import { Icon } from "@/components/icons";
import type { SupportSecuritySummary, SupportSession } from "@/types";
import { formatNumber } from "../../_utils";
import { formatDateTime, scopeLabel, scopeTone } from "./taxonomy";

export function GovernanceCards({
  reloadKey,
  onOpenSession,
}: {
  reloadKey: number;
  onOpenSession: (id: string) => void;
}) {
  const [data, setData] = useState<SupportSecuritySummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await api.get<SupportSecuritySummary>("/platform/support/security-summary"));
    } catch (err) {
      setData(null);
      setError(err instanceof ApiError ? err.message : "Failed to load security summary");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load, reloadKey]);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">
          Support posture
        </h2>
        <Link href="/super-admin/security">
          <Button variant="secondary">
            <Icon name="lock" className="h-4 w-4" />
            Security Center
          </Button>
        </Link>
      </div>

      <ErrorNote message={error} />

      {loading ? (
        <Spinner />
      ) : data ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <Card>
              <p className="text-sm font-medium text-muted">Active sessions</p>
              <p className={`mt-1 text-2xl font-semibold ${data.activeCount > 0 ? "text-emerald-600" : "text-ink"}`}>
                {formatNumber(data.activeCount)}
              </p>
            </Card>
            <Card>
              <p className="text-sm font-medium text-muted">Long-running (&gt; 60 min)</p>
              <p className={`mt-1 text-2xl font-semibold ${data.longRunningCount > 0 ? "text-amber-600" : "text-ink"}`}>
                {formatNumber(data.longRunningCount)}
              </p>
            </Card>
          </div>

          <SessionList
            title="High-risk active sessions"
            emptyText="No high-risk sessions active."
            sessions={data.highRisk}
            onOpenSession={onOpenSession}
            showScope
          />
          <SessionList
            title="Recently revoked (24h)"
            emptyText="No sessions revoked in the last 24 hours."
            sessions={data.recentlyRevoked}
            onOpenSession={onOpenSession}
          />
        </>
      ) : (
        !error && <EmptyState message="No security summary available." />
      )}
    </div>
  );
}

function SessionList({
  title,
  emptyText,
  sessions,
  onOpenSession,
  showScope,
}: {
  title: string;
  emptyText: string;
  sessions: SupportSession[];
  onOpenSession: (id: string) => void;
  showScope?: boolean;
}) {
  return (
    <Card>
      <p className="mb-3 text-sm font-semibold text-ink">{title}</p>
      {sessions.length === 0 ? (
        <p className="text-xs text-faint">{emptyText}</p>
      ) : (
        <ul className="divide-y divide-line">
          {sessions.map((s) => (
            <li key={s.id}>
              <button
                onClick={() => onOpenSession(s.id)}
                className="flex w-full flex-wrap items-center gap-3 py-2 text-left hover:bg-hover"
              >
                {showScope && <Badge tone={scopeTone(s.scope)}>{scopeLabel(s.scope)}</Badge>}
                <span className="min-w-0 flex-1 truncate text-sm text-ink">{s.targetEmail}</span>
                <span className="hidden shrink-0 text-xs text-faint sm:block">{s.institutionName ?? "—"}</span>
                <span className="shrink-0 text-xs text-faint">
                  {formatDateTime(showScope ? s.startedAt : s.endedAt)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
