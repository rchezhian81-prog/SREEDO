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
  Spinner,
} from "@/components/ui";
import type { PlatformInstitution } from "@/types";
import { usePlatformGuard } from "../_guard";
import { formatNumber } from "../_utils";

export default function PlatformInstitutionsPage() {
  const { ready, gate } = usePlatformGuard(
    "Institutions",
    "All tenants on the platform"
  );

  const [institutions, setInstitutions] = useState<PlatformInstitution[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setInstitutions(
        await api.get<PlatformInstitution[]>("/platform/institutions")
      );
    } catch (err) {
      setInstitutions([]);
      setError(
        err instanceof ApiError ? err.message : "Failed to load institutions"
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (ready) load();
  }, [ready, load]);

  if (!ready) return gate;

  return (
    <>
      <PageHeader
        title="Institutions"
        subtitle={`${institutions.length} tenant${
          institutions.length === 1 ? "" : "s"
        }`}
        action={
          <Link href="/super-admin/platform/institutions/new">
            <Button>+ New institution</Button>
          </Link>
        }
      />

      {loading ? (
        <Spinner />
      ) : error ? (
        <ErrorNote message={error} />
      ) : institutions.length === 0 ? (
        <EmptyState message="No institutions yet. Create one to get started." />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Code</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Students</th>
                <th className="px-4 py-3">Staff</th>
                <th className="px-4 py-3">Package</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {institutions.map((inst) => (
                <tr key={inst.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium text-slate-900">
                    <Link
                      href={`/super-admin/platform/institutions/${inst.id}`}
                      className="text-brand-600 hover:text-brand-700"
                    >
                      {inst.name}
                    </Link>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs">{inst.code}</td>
                  <td className="px-4 py-3 capitalize">{inst.type}</td>
                  <td className="px-4 py-3">
                    <Badge tone={inst.isActive ? "green" : "red"}>
                      {inst.isActive ? "active" : "suspended"}
                    </Badge>
                  </td>
                  <td className="px-4 py-3">{formatNumber(inst.students)}</td>
                  <td className="px-4 py-3">{formatNumber(inst.staff)}</td>
                  <td className="px-4 py-3">
                    {inst.packageName ? (
                      <Badge tone="blue">{inst.packageName}</Badge>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      href={`/super-admin/platform/institutions/${inst.id}`}
                      className="text-xs font-medium text-brand-600 hover:text-brand-700"
                    >
                      Manage
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
