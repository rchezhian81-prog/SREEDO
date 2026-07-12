"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api, ApiError } from "@/lib/api";
import { usePermissions } from "@/lib/use-permissions";
import { currentMonth, downloadPdf, money } from "@/lib/payroll";
import {
  Badge,
  Button,
  EmptyState,
  ErrorNote,
  Input,
  Modal,
  PageHeader,
  Spinner,
} from "@/components/ui";
import type { Payslip, PayslipDetail } from "@/types";

export default function PayslipsPage() {
  const { can, loading: permsLoading } = usePermissions();
  const canPayslip = can("payroll:payslip");

  const [month, setMonth] = useState(currentMonth);
  const [payslips, setPayslips] = useState<Payslip[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  // Detail modal.
  const [detailOpen, setDetailOpen] = useState(false);
  const [detail, setDetail] = useState<PayslipDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  const load = useCallback(async (selectedMonth: string) => {
    setLoading(true);
    setLoadError(null);
    try {
      const qs = selectedMonth ? `?month=${selectedMonth}` : "";
      setPayslips(await api.get<Payslip[]>(`/payroll/payslips${qs}`));
    } catch (err) {
      setLoadError(
        err instanceof ApiError ? err.message : "Failed to load payslips"
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (permsLoading || !can("payroll:read")) {
      setLoading(false);
      return;
    }
    load(month);
  }, [permsLoading, can, load, month]);

  const download = async (slip: Payslip) => {
    setDownloadError(null);
    setDownloadingId(slip.id);
    try {
      await downloadPdf(
        `/payroll/payslips/${slip.id}/pdf`,
        `payslip-${slip.employeeNo}-${slip.month}.pdf`
      );
    } catch (err) {
      setDownloadError(
        err instanceof ApiError ? err.message : "Failed to download payslip"
      );
    } finally {
      setDownloadingId(null);
    }
  };

  const viewDetail = async (slip: Payslip) => {
    setDetailOpen(true);
    setDetail(null);
    setDetailError(null);
    setDetailLoading(true);
    try {
      setDetail(await api.get<PayslipDetail>(`/payroll/payslips/${slip.id}`));
    } catch (err) {
      setDetailError(
        err instanceof ApiError ? err.message : "Failed to load payslip"
      );
    } finally {
      setDetailLoading(false);
    }
  };

  if (permsLoading) {
    return (
      <>
        <PageHeader title="Payslips" subtitle="Browse & download payslips" />
        <Spinner />
      </>
    );
  }

  if (!can("payroll:read")) {
    return (
      <>
        <PageHeader title="Payslips" subtitle="Browse & download payslips" />
        <EmptyState message="You do not have access to payslips." />
      </>
    );
  }

  return (
    <>
      <PageHeader title="Payslips" subtitle="Browse, view & download payslips" />

      <div className="mb-4">
        <Link
          href="/payroll"
          className="text-sm font-medium text-brand-600 hover:text-brand-700"
        >
          ← Back to Payroll
        </Link>
      </div>

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="w-44">
          <span className="mb-1 block text-sm font-medium text-ink">
            Month
          </span>
          <Input
            type="month"
            value={month}
            onChange={(event) => setMonth(event.target.value)}
          />
        </div>
        <Button
          variant="secondary"
          onClick={() => load(month)}
          disabled={loading}
        >
          {loading ? "Loading…" : "Refresh"}
        </Button>
      </div>

      <div className="mb-3">
        <ErrorNote message={downloadError} />
      </div>

      {loading ? (
        <Spinner />
      ) : loadError ? (
        <ErrorNote message={loadError} />
      ) : payslips.length === 0 ? (
        <EmptyState message="No payslips for this month" />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-line bg-white">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-line bg-surface-2 text-xs uppercase text-muted">
              <tr>
                <th className="px-4 py-3">Staff</th>
                <th className="px-4 py-3">Employee No</th>
                <th className="px-4 py-3 text-right">Gross</th>
                <th className="px-4 py-3 text-right">Deductions</th>
                <th className="px-4 py-3 text-right">Net</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {payslips.map((slip) => (
                <tr key={slip.id} className="hover:bg-hover">
                  <td className="px-4 py-3 font-medium text-ink">
                    {slip.teacherName}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs">
                    {slip.employeeNo}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {money(slip.gross)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {money(slip.deductions)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-ink">
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
                    <div className="flex justify-end gap-3">
                      <button
                        onClick={() => viewDetail(slip)}
                        className="text-xs font-medium text-brand-600 hover:text-brand-700"
                      >
                        View
                      </button>
                      {canPayslip && (
                        <button
                          onClick={() => download(slip)}
                          disabled={downloadingId === slip.id}
                          className="text-xs font-medium text-brand-600 hover:text-brand-700 disabled:opacity-60"
                        >
                          {downloadingId === slip.id
                            ? "Downloading…"
                            : "Download PDF"}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal
        title={`Payslip — ${detail?.teacherName ?? ""} ${
          detail?.month ?? ""
        }`}
        open={detailOpen}
        onClose={() => setDetailOpen(false)}
      >
        {detailLoading ? (
          <Spinner />
        ) : detailError ? (
          <ErrorNote message={detailError} />
        ) : detail ? (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-3 text-sm">
              <div>
                <p className="text-muted">Working</p>
                <p className="font-medium text-ink">
                  {detail.workingDays}
                </p>
              </div>
              <div>
                <p className="text-muted">Present</p>
                <p className="font-medium text-ink">
                  {detail.presentDays}
                </p>
              </div>
              <div>
                <p className="text-muted">Unpaid leave</p>
                <p className="font-medium text-ink">
                  {detail.unpaidLeave}
                </p>
              </div>
            </div>
            <div className="overflow-x-auto rounded-xl border border-line">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-line bg-surface-2 text-xs uppercase text-muted">
                  <tr>
                    <th className="px-4 py-3">Component</th>
                    <th className="px-4 py-3">Type</th>
                    <th className="px-4 py-3 text-right">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {detail.lines.map((line, index) => (
                    <tr key={index}>
                      <td className="px-4 py-3 font-medium text-ink">
                        {line.name}
                      </td>
                      <td className="px-4 py-3">
                        <Badge
                          tone={line.type === "earning" ? "green" : "red"}
                        >
                          {line.type}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-ink">
                        {money(line.amount)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="rounded-lg bg-surface-2 p-3 text-sm">
              <div className="flex justify-between">
                <span className="text-muted">Gross</span>
                <span className="font-medium tabular-nums text-success">
                  {money(detail.gross)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted">Deductions</span>
                <span className="font-medium tabular-nums text-danger">
                  {money(detail.deductions)}
                </span>
              </div>
              <div className="mt-1 flex justify-between border-t border-line pt-1">
                <span className="font-medium text-ink">Net</span>
                <span className="font-semibold tabular-nums text-ink">
                  {money(detail.net)}
                </span>
              </div>
            </div>
          </div>
        ) : (
          <EmptyState message="Payslip not found" />
        )}
      </Modal>
    </>
  );
}
