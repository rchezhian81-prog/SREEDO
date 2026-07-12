"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api, ApiError } from "@/lib/api";
import { usePermissions } from "@/lib/use-permissions";
import { currentMonth, money } from "@/lib/payroll";
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  ErrorNote,
  Input,
  Modal,
  PageHeader,
  Spinner,
} from "@/components/ui";
import type { Payslip, PayrollRun } from "@/types";

interface RunResult {
  runId: string;
  month: string;
  generated: number;
  skipped: number;
  status: string;
}

export default function PayrollRunPage() {
  const { can, loading: permsLoading } = usePermissions();
  const canRun = can("payroll:run");
  const canRecalc = can("payroll:update");
  const canFinalize = can("payroll:finalize");

  const [month, setMonth] = useState(currentMonth);
  const [runs, setRuns] = useState<PayrollRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [result, setResult] = useState<RunResult | null>(null);

  const [finalizingId, setFinalizingId] = useState<string | null>(null);
  const [pendingFinalize, setPendingFinalize] = useState<PayrollRun | null>(null);
  const [finalizeError, setFinalizeError] = useState<string | null>(null);

  // Run payslips modal.
  const [payslipsOpen, setPayslipsOpen] = useState(false);
  const [activeRun, setActiveRun] = useState<PayrollRun | null>(null);
  const [payslips, setPayslips] = useState<Payslip[]>([]);
  const [payslipsLoading, setPayslipsLoading] = useState(false);
  const [payslipsError, setPayslipsError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      setRuns(await api.get<PayrollRun[]>("/payroll/runs"));
    } catch (err) {
      setLoadError(
        err instanceof ApiError ? err.message : "Failed to load runs"
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
    load();
  }, [permsLoading, can, load]);

  const runPayroll = async (recalc: boolean) => {
    if (!month) {
      setRunError("Pick a month");
      return;
    }
    setRunning(true);
    setRunError(null);
    setResult(null);
    try {
      setResult(
        await api.post<RunResult>("/payroll/runs", { month, recalc })
      );
      await load();
    } catch (err) {
      setRunError(
        err instanceof ApiError ? err.message : "Failed to run payroll"
      );
    } finally {
      setRunning(false);
    }
  };

  const confirmFinalize = async () => {
    if (!pendingFinalize) return;
    const run = pendingFinalize;
    setFinalizeError(null);
    setFinalizingId(run.id);
    try {
      await api.post(`/payroll/runs/${run.id}/finalize`);
      setPendingFinalize(null);
      await load();
    } catch (err) {
      setFinalizeError(
        err instanceof ApiError ? err.message : "Failed to finalize run"
      );
    } finally {
      setFinalizingId(null);
    }
  };

  const viewPayslips = async (run: PayrollRun) => {
    setActiveRun(run);
    setPayslipsOpen(true);
    setPayslips([]);
    setPayslipsError(null);
    setPayslipsLoading(true);
    try {
      setPayslips(
        await api.get<Payslip[]>(`/payroll/payslips?runId=${run.id}`)
      );
    } catch (err) {
      setPayslipsError(
        err instanceof ApiError ? err.message : "Failed to load payslips"
      );
    } finally {
      setPayslipsLoading(false);
    }
  };

  if (permsLoading) {
    return (
      <>
        <PageHeader title="Run payroll" subtitle="Generate monthly payroll" />
        <Spinner />
      </>
    );
  }

  if (!can("payroll:read")) {
    return (
      <>
        <PageHeader title="Run payroll" subtitle="Generate monthly payroll" />
        <EmptyState message="You do not have access to payroll." />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Run payroll"
        subtitle="Generate & finalize monthly payroll"
      />

      <div className="mb-4">
        <Link
          href="/payroll"
          className="text-sm font-medium text-brand-600 hover:text-brand-700"
        >
          ← Back to Payroll
        </Link>
      </div>

      <div className="space-y-6">
        <Card>
          <div className="flex flex-wrap items-end gap-3">
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
            {canRun && (
              <Button onClick={() => runPayroll(false)} disabled={running}>
                {running ? "Running…" : "Run payroll"}
              </Button>
            )}
            {canRecalc && (
              <Button
                variant="secondary"
                onClick={() => runPayroll(true)}
                disabled={running}
              >
                Recalculate
              </Button>
            )}
          </div>

          <div className="mt-3 space-y-2">
            <ErrorNote message={runError} />
            {result && (
              <div className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
                Payroll for {result.month}: generated{" "}
                <strong>{result.generated}</strong>, skipped{" "}
                <strong>{result.skipped}</strong> (status {result.status}).
              </div>
            )}
          </div>
        </Card>

        {loading ? (
          <Spinner />
        ) : loadError ? (
          <ErrorNote message={loadError} />
        ) : runs.length === 0 ? (
          <EmptyState message="No payroll runs yet" />
        ) : (
          <div className="overflow-x-auto rounded-xl border border-line bg-white">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-line bg-surface-2 text-xs uppercase text-muted">
                <tr>
                  <th className="px-4 py-3">Month</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Payslips</th>
                  <th className="px-4 py-3 text-right">Net total</th>
                  <th className="px-4 py-3">Finalized</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {runs.map((run) => (
                  <tr key={run.id} className="hover:bg-hover">
                    <td className="px-4 py-3 font-medium text-ink">
                      {run.month}
                    </td>
                    <td className="px-4 py-3">
                      <Badge
                        tone={run.status === "finalized" ? "green" : "amber"}
                      >
                        {run.status}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-right">{run.payslipCount}</td>
                    <td className="px-4 py-3 text-right">
                      {money(run.netTotal)}
                    </td>
                    <td className="px-4 py-3 text-muted">
                      {run.finalizedAt
                        ? new Date(run.finalizedAt).toLocaleDateString()
                        : "—"}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex justify-end gap-3">
                        <button
                          onClick={() => viewPayslips(run)}
                          className="text-xs font-medium text-brand-600 hover:text-brand-700"
                        >
                          View payslips
                        </button>
                        {canFinalize && run.status !== "finalized" && (
                          <button
                            onClick={() => {
                              setFinalizeError(null);
                              setPendingFinalize(run);
                            }}
                            disabled={finalizingId === run.id}
                            className="text-xs font-medium text-emerald-600 hover:text-emerald-700 disabled:opacity-60"
                          >
                            {finalizingId === run.id
                              ? "Finalizing…"
                              : "Finalize"}
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
      </div>

      <Modal
        title={`Payslips — ${activeRun?.month ?? ""}`}
        open={payslipsOpen}
        onClose={() => setPayslipsOpen(false)}
      >
        {payslipsLoading ? (
          <Spinner />
        ) : payslipsError ? (
          <ErrorNote message={payslipsError} />
        ) : payslips.length === 0 ? (
          <EmptyState message="No payslips in this run" />
        ) : (
          <div className="overflow-x-auto rounded-xl border border-line">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-line bg-surface-2 text-xs uppercase text-muted">
                <tr>
                  <th className="px-4 py-3">Staff</th>
                  <th className="px-4 py-3 text-right">Gross</th>
                  <th className="px-4 py-3 text-right">Deductions</th>
                  <th className="px-4 py-3 text-right">Net</th>
                  <th className="px-4 py-3">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {payslips.map((slip) => (
                  <tr key={slip.id}>
                    <td className="px-4 py-3 font-medium text-ink">
                      {slip.teacherName}
                    </td>
                    <td className="px-4 py-3 text-right">{money(slip.gross)}</td>
                    <td className="px-4 py-3 text-right">
                      {money(slip.deductions)}
                    </td>
                    <td className="px-4 py-3 text-right text-ink">
                      {money(slip.net)}
                    </td>
                    <td className="px-4 py-3">
                      <Badge
                        tone={slip.status === "finalized" ? "green" : "amber"}
                      >
                        {slip.status}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Modal>

      <ConfirmDialog
        open={pendingFinalize !== null}
        title="Finalize payroll"
        message={
          <span className="space-y-2">
            <span className="block">
              Finalize payroll for <strong>{pendingFinalize?.month}</strong>?
              This locks the payslips and cannot be undone.
            </span>
            {finalizeError && <ErrorNote message={finalizeError} />}
          </span>
        }
        confirmLabel="Finalize"
        tone="primary"
        busy={finalizingId !== null}
        onConfirm={confirmFinalize}
        onClose={() => setPendingFinalize(null)}
      />
    </>
  );
}
