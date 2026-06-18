"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api, ApiError } from "@/lib/api";
import { usePermissions } from "@/lib/use-permissions";
import {
  Badge,
  Button,
  EmptyState,
  ErrorNote,
  PageHeader,
  Select,
  Spinner,
} from "@/components/ui";
import type { LeaveBalance, Paginated, Teacher } from "@/types";

export default function LeaveBalancesPage() {
  const { can, loading: permsLoading } = usePermissions();
  // Only admin/HR (leave:approve) can list all staff to filter by.
  const canFilter = can("leave:approve");

  const [balances, setBalances] = useState<LeaveBalance[]>([]);
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [teacherId, setTeacherId] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (permsLoading || !canFilter) return;
    api
      .get<Paginated<Teacher>>("/teachers?limit=200")
      .then((page) => setTeachers(page.data))
      .catch(() => undefined);
  }, [permsLoading, canFilter]);

  const load = useCallback(async (selectedTeacher: string) => {
    setLoading(true);
    setLoadError(null);
    try {
      const qs = selectedTeacher ? `?teacherId=${selectedTeacher}` : "";
      setBalances(await api.get<LeaveBalance[]>(`/leave/balances${qs}`));
    } catch (err) {
      setLoadError(
        err instanceof ApiError ? err.message : "Failed to load balances"
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (permsLoading || !can("leave:read")) return;
    load(teacherId);
  }, [permsLoading, can, load, teacherId]);

  if (permsLoading) {
    return (
      <>
        <PageHeader title="Leave balances" subtitle="Remaining leave by type" />
        <Spinner />
      </>
    );
  }

  if (!can("leave:read")) {
    return (
      <>
        <PageHeader title="Leave balances" subtitle="Remaining leave by type" />
        <EmptyState message="You do not have access to leave balances." />
      </>
    );
  }

  return (
    <>
      <PageHeader title="Leave balances" subtitle="Remaining leave by type" />

      <div className="mb-4">
        <Link
          href="/leave"
          className="text-sm font-medium text-brand-600 hover:text-brand-700"
        >
          ← Back to Leave
        </Link>
      </div>

      {canFilter && (
        <div className="mb-4 flex flex-wrap items-end gap-3">
          <div className="w-64">
            <span className="mb-1 block text-sm font-medium text-slate-700">
              Staff
            </span>
            <Select
              value={teacherId}
              onChange={(event) => setTeacherId(event.target.value)}
            >
              <option value="">All staff</option>
              {teachers.map((teacher) => (
                <option key={teacher.id} value={teacher.id}>
                  {teacher.firstName} {teacher.lastName} ({teacher.employeeNo})
                </option>
              ))}
            </Select>
          </div>
          <Button
            variant="secondary"
            onClick={() => load(teacherId)}
            disabled={loading}
          >
            {loading ? "Loading…" : "Refresh"}
          </Button>
        </div>
      )}

      <ErrorNote message={loadError} />

      {loading ? (
        <Spinner />
      ) : balances.length === 0 ? (
        <EmptyState message="No leave balances" />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3">Staff</th>
                <th className="px-4 py-3">Leave type</th>
                <th className="px-4 py-3">Paid</th>
                <th className="px-4 py-3">Balance</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {balances.map((bal) => (
                <tr key={bal.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium text-slate-900">
                    {bal.teacherName}
                  </td>
                  <td className="px-4 py-3">{bal.leaveTypeName}</td>
                  <td className="px-4 py-3">
                    <Badge tone={bal.isPaid ? "green" : "slate"}>
                      {bal.isPaid ? "paid" : "unpaid"}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 font-medium">{bal.balance}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
