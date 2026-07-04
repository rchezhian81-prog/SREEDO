"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api, ApiError } from "@/lib/api";
import {
  Badge,
  Button,
  EmptyState,
  ErrorNote,
  PageHeader,
  Select,
  Spinner,
} from "@/components/ui";
import { usePlatformGuard } from "../../platform/_guard";
import {
  AUDIT_ACTIONS,
  auditActionLabel,
  auditActionTone,
  formatDateTime,
  type Paged,
  type RbacAuditDetail,
  type RbacAuditRow,
} from "../_rbac";

/** The role/user a row is about — prefer the friendliest field available. */
function targetLabel(row: RbacAuditRow): string {
  const d = row.detail ?? {};
  return (
    d.role || d.key || d.email || row.targetId || row.targetType || "—"
  );
}

function ChangeSummary({ detail }: { detail: RbacAuditDetail | null }) {
  if (!detail) return <span className="text-faint">—</span>;
  const chips: React.ReactNode[] = [];
  for (const k of detail.added ?? []) {
    chips.push(
      <span
        key={`a-${k}`}
        className="rounded bg-emerald-500/12 px-1.5 py-0.5 font-mono text-[11px] text-emerald-600 dark:text-emerald-400"
      >
        +{k}
      </span>
    );
  }
  for (const k of detail.removed ?? []) {
    chips.push(
      <span
        key={`r-${k}`}
        className="rounded bg-red-500/12 px-1.5 py-0.5 font-mono text-[11px] text-red-600 dark:text-red-400"
      >
        −{k}
      </span>
    );
  }
  if (detail.from !== undefined || detail.to !== undefined) {
    chips.push(
      <span key="ft" className="font-mono text-[11px] text-muted">
        {detail.from ?? "—"} → {detail.to ?? "—"}
      </span>
    );
  }
  if (detail.copyFrom) {
    chips.push(
      <span key="cf" className="font-mono text-[11px] text-muted">
        copy from {detail.copyFrom}
      </span>
    );
  }
  if (chips.length === 0) return <span className="text-faint">—</span>;
  return <div className="flex max-w-md flex-wrap gap-1">{chips}</div>;
}

export default function RbacAuditPage() {
  const { ready, gate } = usePlatformGuard(
    "RBAC history",
    "Every role & permission change, audited"
  );

  const [data, setData] = useState<Paged<RbacAuditRow>>({
    rows: [],
    total: 0,
    page: 1,
    pageSize: 25,
  });
  const [action, setAction] = useState("");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);

  useEffect(() => {
    setPage(1);
  }, [action]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setForbidden(false);
    try {
      const p = new URLSearchParams();
      if (action) p.set("action", action);
      p.set("page", String(page));
      p.set("pageSize", "25");
      setData(
        await api.get<Paged<RbacAuditRow>>(
          `/platform/rbac/audit?${p.toString()}`
        )
      );
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) setForbidden(true);
      else setError(err instanceof ApiError ? err.message : "Failed to load audit");
    } finally {
      setLoading(false);
    }
  }, [action, page]);

  useEffect(() => {
    if (ready) load();
  }, [ready, load]);

  const totalPages = Math.max(1, Math.ceil(data.total / (data.pageSize || 25)));

  if (!ready) return gate;

  if (forbidden) {
    return (
      <>
        <PageHeader title="RBAC history" subtitle="Every role & permission change, audited" />
        <EmptyState message="You don't have permission to view this." />
      </>
    );
  }

  return (
    <>
      <nav className="mb-2 text-xs text-faint">
        <Link href="/super-admin/rbac" className="hover:text-muted">
          Roles &amp; permissions
        </Link>{" "}
        / <span className="text-muted">History</span>
      </nav>
      <PageHeader
        title="RBAC history"
        subtitle="Every role & permission change, audited"
        action={
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href="/super-admin/platform/audit?category=Authorization%2FRBAC"
              className="text-sm font-medium text-brand-600 hover:text-brand-700"
            >
              Open in Audit Console →
            </Link>
            <div className="w-56">
              <Select value={action} onChange={(e) => setAction(e.target.value)}>
                {AUDIT_ACTIONS.map((a) => (
                  <option key={a.value} value={a.value}>
                    {a.label}
                  </option>
                ))}
              </Select>
            </div>
          </div>
        }
      />

      <ErrorNote message={error} />

      {loading ? (
        <Spinner />
      ) : data.rows.length === 0 ? (
        <EmptyState message="No RBAC activity recorded yet." />
      ) : (
        <>
          <div className="overflow-x-auto rounded-xl border border-line bg-surface">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-line bg-surface-2 text-xs uppercase text-muted">
                <tr>
                  <th className="px-4 py-3">Time</th>
                  <th className="px-4 py-3">Action</th>
                  <th className="px-4 py-3">Actor</th>
                  <th className="px-4 py-3">Target</th>
                  <th className="px-4 py-3">Before / after</th>
                  <th className="px-4 py-3">Reason</th>
                  <th className="px-4 py-3">IP</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {data.rows.map((row) => (
                  <tr key={row.id} className="align-top hover:bg-surface-2">
                    <td className="whitespace-nowrap px-4 py-3 text-muted">
                      {formatDateTime(row.createdAt)}
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone={auditActionTone(row.action)}>
                        {auditActionLabel(row.action)}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-muted">
                      {row.actorEmail ?? "—"}
                    </td>
                    <td className="px-4 py-3">
                      <span className="font-mono text-xs text-ink">
                        {targetLabel(row)}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <ChangeSummary detail={row.detail} />
                    </td>
                    <td className="max-w-xs px-4 py-3 text-muted">
                      {row.detail?.reason ? (
                        <span className="block break-words">
                          {row.detail.reason}
                        </span>
                      ) : (
                        <span className="text-faint">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-faint">{row.ip ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-4 flex items-center justify-between text-sm text-muted">
            <span>
              {data.total} event{data.total === 1 ? "" : "s"}
            </span>
            <div className="flex items-center gap-2">
              <Button
                variant="secondary"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
              >
                ← Prev
              </Button>
              <span>
                Page {data.page} of {totalPages}
              </span>
              <Button
                variant="secondary"
                onClick={() => setPage((p) => p + 1)}
                disabled={page >= totalPages}
              >
                Next →
              </Button>
            </div>
          </div>
        </>
      )}
    </>
  );
}
