"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api, ApiError } from "@/lib/api";
import { usePermissions } from "@/lib/use-permissions";
import { downloadPdf, money } from "@/lib/payroll";
import {
  Badge,
  Button,
  EmptyState,
  ErrorNote,
  PageHeader,
  Spinner,
} from "@/components/ui";
import type { Payslip } from "@/types";

export default function MyPayslipsPage() {
  const { can, loading: permsLoading } = usePermissions();
  const canPayslip = can("payroll:payslip");

  const [payslips, setPayslips] = useState<Payslip[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      setPayslips(await api.get<Payslip[]>("/payroll/payslips/mine"));
    } catch (err) {
      setLoadError(
        err instanceof ApiError ? err.message : "Failed to load payslips"
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (permsLoading || !canPayslip) {
      setLoading(false);
      return;
    }
    load();
  }, [permsLoading, canPayslip, load]);

  const download = async (slip: Payslip) => {
    setDownloadError(null);
    setDownloadingId(slip.id);
    try {
      await downloadPdf(
        `/payroll/payslips/${slip.id}/pdf`,
        `payslip-${slip.month}.pdf`
      );
    } catch (err) {
      setDownloadError(
        err instanceof ApiError ? err.message : "Failed to download payslip"
      );
    } finally {
      setDownloadingId(null);
    }
  };

  if (permsLoading) {
    return (
      <>
        <PageHeader title="My Payslips" subtitle="Your monthly payslips" />
        <Spinner />
      </>
    );
  }

  if (!canPayslip) {
    return (
      <>
        <PageHeader title="My Payslips" subtitle="Your monthly payslips" />
        <EmptyState message="You do not have access to payslips." />
      </>
    );
  }

  return (
    <>
      <PageHeader title="My Payslips" subtitle="Your monthly payslips" />

      <div className="mb-4">
        <Link
          href="/payroll"
          className="text-sm font-medium text-brand-600 hover:text-brand-700"
        >
          ← Back to Payroll
        </Link>
      </div>

      <div className="mb-3">
        <ErrorNote message={downloadError} />
      </div>

      {loading ? (
        <Spinner />
      ) : loadError ? (
        <ErrorNote message={loadError} />
      ) : payslips.length === 0 ? (
        <EmptyState message="You have no payslips yet" />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3">Month</th>
                <th className="px-4 py-3 text-right">Gross</th>
                <th className="px-4 py-3 text-right">Deductions</th>
                <th className="px-4 py-3 text-right">Net</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {payslips.map((slip) => (
                <tr key={slip.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium text-slate-900">
                    {slip.month}
                  </td>
                  <td className="px-4 py-3 text-right">{money(slip.gross)}</td>
                  <td className="px-4 py-3 text-right">
                    {money(slip.deductions)}
                  </td>
                  <td className="px-4 py-3 text-right text-slate-900">
                    {money(slip.net)}
                  </td>
                  <td className="px-4 py-3">
                    <Badge
                      tone={slip.status === "finalized" ? "green" : "amber"}
                    >
                      {slip.status}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => download(slip)}
                      disabled={downloadingId === slip.id}
                      className="text-xs font-medium text-brand-600 hover:text-brand-700 disabled:opacity-60"
                    >
                      {downloadingId === slip.id
                        ? "Downloading…"
                        : "Download PDF"}
                    </button>
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
