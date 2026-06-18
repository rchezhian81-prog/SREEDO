"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api, ApiError } from "@/lib/api";
import { usePermissions } from "@/lib/use-permissions";
import {
  Button,
  Card,
  cx,
  EmptyState,
  ErrorNote,
  PageHeader,
  Select,
  Spinner,
} from "@/components/ui";
import type { LibraryMember, ReportData } from "@/types";

const REPORTS: { key: string; title: string; needsMember?: boolean }[] = [
  { key: "library_stock", title: "Stock" },
  { key: "library_issued", title: "Currently issued" },
  { key: "library_overdue", title: "Overdue" },
  { key: "library_lost_damaged", title: "Lost & damaged" },
  { key: "library_fines", title: "Fines" },
  { key: "library_member_history", title: "Member history", needsMember: true },
];

function renderCell(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export default function LibraryReportsPage() {
  const { can, loading: permsLoading } = usePermissions();

  const [selectedKey, setSelectedKey] = useState<string>(REPORTS[0].key);
  const [members, setMembers] = useState<LibraryMember[]>([]);
  const [memberId, setMemberId] = useState("");

  const [data, setData] = useState<ReportData | null>(null);
  const [dataLoading, setDataLoading] = useState(false);
  const [dataError, setDataError] = useState<string | null>(null);

  const selected = REPORTS.find((report) => report.key === selectedKey)!;

  useEffect(() => {
    api
      .get<LibraryMember[]>("/library/members")
      .then(setMembers)
      .catch(() => undefined);
  }, []);

  const runReport = useCallback(
    async (key: string, member: string) => {
      const report = REPORTS.find((item) => item.key === key);
      if (report?.needsMember && !member) {
        setData(null);
        setDataError(null);
        return;
      }
      setDataLoading(true);
      setDataError(null);
      try {
        const qs = report?.needsMember
          ? `?memberId=${encodeURIComponent(member)}`
          : "";
        setData(await api.get<ReportData>(`/report-center/${key}${qs}`));
      } catch (err) {
        setData(null);
        setDataError(
          err instanceof ApiError ? err.message : "Failed to load report"
        );
      } finally {
        setDataLoading(false);
      }
    },
    []
  );

  useEffect(() => {
    if (permsLoading || !can("library:reports")) return;
    runReport(selectedKey, memberId);
  }, [permsLoading, can, selectedKey, memberId, runReport]);

  if (permsLoading) {
    return (
      <>
        <PageHeader title="Library reports" />
        <Spinner />
      </>
    );
  }

  if (!can("library:reports")) {
    return (
      <>
        <PageHeader title="Library reports" />
        <EmptyState message="You do not have permission to view library reports." />
      </>
    );
  }

  return (
    <>
      <PageHeader title="Library reports" subtitle="Stock, circulation & fines" />

      <div className="mb-4">
        <Link
          href="/library"
          className="text-sm font-medium text-brand-600 hover:text-brand-700"
        >
          ← Back to Library
        </Link>
      </div>

      <div className="space-y-6">
        <div className="flex flex-wrap gap-2">
          {REPORTS.map((report) => (
            <button
              key={report.key}
              onClick={() => setSelectedKey(report.key)}
              className={cx(
                "rounded-lg border px-3 py-2 text-sm font-medium transition",
                report.key === selectedKey
                  ? "border-brand-500 bg-brand-50 text-brand-700"
                  : "border-slate-200 text-slate-700 hover:bg-slate-50"
              )}
            >
              {report.title}
            </button>
          ))}
        </div>

        <Card>
          <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
            <h2 className="text-lg font-semibold text-slate-900">
              {data?.title ?? selected.title}
            </h2>
            <div className="flex flex-wrap items-end gap-3">
              {selected.needsMember && (
                <div className="w-64">
                  <span className="mb-1 block text-sm font-medium text-slate-700">
                    Member
                  </span>
                  <Select
                    value={memberId}
                    onChange={(event) => setMemberId(event.target.value)}
                  >
                    <option value="">Select a member…</option>
                    {members.map((member) => (
                      <option key={member.id} value={member.id}>
                        {member.name}
                        {member.memberCode ? ` (${member.memberCode})` : ""}
                      </option>
                    ))}
                  </Select>
                </div>
              )}
              <Button
                variant="secondary"
                onClick={() => runReport(selectedKey, memberId)}
                disabled={
                  dataLoading || (selected.needsMember && !memberId)
                }
              >
                {dataLoading ? "Running…" : "Refresh"}
              </Button>
            </div>
          </div>

          <ErrorNote message={dataError} />

          {selected.needsMember && !memberId ? (
            <EmptyState message="Select a member to run this report" />
          ) : dataLoading ? (
            <Spinner />
          ) : data && data.rows.length > 0 ? (
            <>
              <div className="overflow-x-auto rounded-xl border border-slate-200">
                <table className="w-full text-left text-sm">
                  <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
                    <tr>
                      {data.columns.map((col) => (
                        <th
                          key={col.key}
                          className="whitespace-nowrap px-4 py-3"
                        >
                          {col.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {data.rows.map((row, rowIndex) => (
                      <tr key={rowIndex}>
                        {data.columns.map((col) => (
                          <td
                            key={col.key}
                            className="whitespace-nowrap px-4 py-3 text-slate-600"
                          >
                            {renderCell(row[col.key])}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-3 text-sm text-slate-500">
                {data.rows.length} {data.rows.length === 1 ? "row" : "rows"}
              </p>
            </>
          ) : !dataError ? (
            <EmptyState message="No rows for this report" />
          ) : null}
        </Card>
      </div>
    </>
  );
}
