"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api, ApiError } from "@/lib/api";
import { usePermissions } from "@/lib/use-permissions";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorNote,
  Field,
  Input,
  PageHeader,
  Select,
  Spinner,
} from "@/components/ui";
import type {
  RouteStop,
  TransportFee,
  TransportRoute,
} from "@/types";
import { FEE_FREQUENCIES } from "@/lib/fees";

export default function TransportFeesPage() {
  const { can, loading: permsLoading } = usePermissions();
  const canFees = can("transport:fees");

  const [routes, setRoutes] = useState<TransportRoute[]>([]);
  const [routeFilter, setRouteFilter] = useState("");
  const [fees, setFees] = useState<TransportFee[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Fee mapping form.
  const [feeRouteId, setFeeRouteId] = useState("");
  const [feeStopId, setFeeStopId] = useState("");
  const [feeStops, setFeeStops] = useState<RouteStop[]>([]);
  const [amount, setAmount] = useState("");
  const [frequency, setFrequency] = useState<string>("monthly");
  const [feeError, setFeeError] = useState<string | null>(null);
  const [savingFee, setSavingFee] = useState(false);

  // Invoice generation form.
  const [genRouteId, setGenRouteId] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [period, setPeriod] = useState("");
  const [description, setDescription] = useState("");
  const [genError, setGenError] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [genResult, setGenResult] = useState<{
    generated: number;
    skipped: number;
  } | null>(null);

  const loadFees = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const qs = routeFilter
        ? `?routeId=${encodeURIComponent(routeFilter)}`
        : "";
      setFees(await api.get<TransportFee[]>(`/transport/fees${qs}`));
    } catch (err) {
      setLoadError(
        err instanceof ApiError ? err.message : "Failed to load fees"
      );
    } finally {
      setLoading(false);
    }
  }, [routeFilter]);

  useEffect(() => {
    loadFees();
  }, [loadFees]);

  useEffect(() => {
    api
      .get<TransportRoute[]>("/transport/routes")
      .then(setRoutes)
      .catch(() => undefined);
  }, []);

  // Dependent stop dropdown for the fee mapping form.
  useEffect(() => {
    if (!feeRouteId) {
      setFeeStops([]);
      return;
    }
    let active = true;
    api
      .get<RouteStop[]>(`/transport/routes/${feeRouteId}/stops`)
      .then((list) => {
        if (active) setFeeStops(list);
      })
      .catch(() => {
        if (active) setFeeStops([]);
      });
    return () => {
      active = false;
    };
  }, [feeRouteId]);

  const saveFee = async () => {
    setFeeError(null);
    if (!feeRouteId) {
      setFeeError("Select a route");
      return;
    }
    if (!amount) {
      setFeeError("Enter an amount");
      return;
    }
    setSavingFee(true);
    try {
      await api.post("/transport/fees", {
        routeId: feeRouteId,
        stopId: feeStopId || undefined,
        amount: Number(amount),
        frequency,
      });
      setAmount("");
      setFeeStopId("");
      await loadFees();
    } catch (err) {
      setFeeError(err instanceof ApiError ? err.message : "Failed to save fee");
    } finally {
      setSavingFee(false);
    }
  };

  const removeFee = async (fee: TransportFee) => {
    if (
      !confirm(
        `Delete fee for ${fee.routeName}${fee.stopName ? ` · ${fee.stopName}` : ""}?`
      )
    )
      return;
    try {
      await api.delete(`/transport/fees/${fee.id}`);
      await loadFees();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : "Failed to delete fee");
    }
  };

  const generateInvoices = async () => {
    setGenError(null);
    setGenResult(null);
    if (!dueDate) {
      setGenError("Enter a due date");
      return;
    }
    if (!period) {
      setGenError("Enter a period");
      return;
    }
    setGenerating(true);
    try {
      const result = await api.post<{ generated: number; skipped: number }>(
        "/transport/fees/generate",
        {
          routeId: genRouteId || undefined,
          dueDate,
          period,
          description: description || undefined,
        }
      );
      setGenResult(result);
    } catch (err) {
      setGenError(
        err instanceof ApiError ? err.message : "Failed to generate invoices"
      );
    } finally {
      setGenerating(false);
    }
  };

  if (permsLoading) {
    return (
      <>
        <PageHeader title="Transport fees" subtitle="Fee mapping & invoices" />
        <Spinner />
      </>
    );
  }

  if (!can("transport:read")) {
    return (
      <>
        <PageHeader title="Transport fees" subtitle="Fee mapping & invoices" />
        <EmptyState message="You do not have access to transport." />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Transport fees"
        subtitle="Fee mapping & invoice generation"
      />

      <div className="mb-4">
        <Link
          href="/transport"
          className="text-sm font-medium text-brand-600 hover:text-brand-700"
        >
          ← Back to Transport
        </Link>
      </div>

      {!canFees && (
        <Card className="mb-6">
          <p className="text-sm text-slate-500">
            You do not have permission to manage transport fees. The fee list
            below is read-only.
          </p>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <div>
          <div className="mb-4 w-64">
            <span className="mb-1 block text-sm font-medium text-slate-700">
              Filter by route
            </span>
            <Select
              value={routeFilter}
              onChange={(event) => setRouteFilter(event.target.value)}
            >
              <option value="">All routes</option>
              {routes.map((route) => (
                <option key={route.id} value={route.id}>
                  {route.name} ({route.code})
                </option>
              ))}
            </Select>
          </div>

          {loading ? (
            <Spinner />
          ) : loadError ? (
            <ErrorNote message={loadError} />
          ) : fees.length === 0 ? (
            <EmptyState message="No fees defined" />
          ) : (
            <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-4 py-3">Route</th>
                    <th className="px-4 py-3">Stop</th>
                    <th className="px-4 py-3">Amount</th>
                    <th className="px-4 py-3">Frequency</th>
                    {canFees && <th className="px-4 py-3" />}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {fees.map((fee) => (
                    <tr key={fee.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3 font-medium text-slate-900">
                        {fee.routeName}
                      </td>
                      <td className="px-4 py-3">
                        {fee.stopName ? (
                          fee.stopName
                        ) : (
                          <Badge tone="blue">route-level</Badge>
                        )}
                      </td>
                      <td className="px-4 py-3">{fee.amount}</td>
                      <td className="px-4 py-3">{fee.frequency}</td>
                      {canFees && (
                        <td className="px-4 py-3 text-right">
                          <button
                            onClick={() => removeFee(fee)}
                            className="text-xs font-medium text-red-600 hover:text-red-700"
                          >
                            Delete
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {canFees && (
          <div className="space-y-6">
            <Card className="h-fit">
              <h2 className="text-sm font-semibold text-slate-900">Set fee</h2>
              <p className="mt-1 text-sm text-slate-500">
                Route- or stop-level fee (upserts existing).
              </p>
              <div className="mt-4 space-y-3">
                <Field label="Route">
                  <Select
                    value={feeRouteId}
                    onChange={(event) => {
                      setFeeRouteId(event.target.value);
                      setFeeStopId("");
                    }}
                  >
                    <option value="">Select a route…</option>
                    {routes.map((route) => (
                      <option key={route.id} value={route.id}>
                        {route.name} ({route.code})
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Stop (optional)">
                  <Select
                    value={feeStopId}
                    onChange={(event) => setFeeStopId(event.target.value)}
                    disabled={!feeRouteId}
                  >
                    <option value="">— Route-level —</option>
                    {feeStops.map((stop) => (
                      <option key={stop.id} value={stop.id}>
                        {stop.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Amount">
                  <Input
                    type="number"
                    step="0.01"
                    min={0}
                    value={amount}
                    onChange={(event) => setAmount(event.target.value)}
                  />
                </Field>
                <Field label="Frequency">
                  <Select
                    value={frequency}
                    onChange={(event) => setFrequency(event.target.value)}
                  >
                    {FEE_FREQUENCIES.map(({ value, label }) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </Select>
                </Field>
                <ErrorNote message={feeError} />
                <Button
                  type="button"
                  className="w-full"
                  onClick={saveFee}
                  disabled={savingFee}
                >
                  {savingFee ? "Saving…" : "Save fee"}
                </Button>
              </div>
            </Card>

            <Card className="h-fit">
              <h2 className="text-sm font-semibold text-slate-900">
                Generate invoices
              </h2>
              <p className="mt-1 text-sm text-slate-500">
                Create invoices for allocated students.
              </p>
              <div className="mt-4 space-y-3">
                <Field label="Route (optional)">
                  <Select
                    value={genRouteId}
                    onChange={(event) => setGenRouteId(event.target.value)}
                  >
                    <option value="">All routes</option>
                    {routes.map((route) => (
                      <option key={route.id} value={route.id}>
                        {route.name} ({route.code})
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Due date">
                  <Input
                    type="date"
                    value={dueDate}
                    onChange={(event) => setDueDate(event.target.value)}
                  />
                </Field>
                <Field label="Period">
                  <Input
                    placeholder="e.g. 2026-07"
                    value={period}
                    onChange={(event) => setPeriod(event.target.value)}
                  />
                </Field>
                <Field label="Description (optional)">
                  <Input
                    placeholder="Transport fee"
                    value={description}
                    onChange={(event) => setDescription(event.target.value)}
                  />
                </Field>
                <ErrorNote message={genError} />
                {genResult && (
                  <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
                    Generated {genResult.generated}, skipped {genResult.skipped}.
                  </p>
                )}
                <Button
                  type="button"
                  variant="secondary"
                  className="w-full"
                  onClick={generateInvoices}
                  disabled={generating}
                >
                  {generating ? "Generating…" : "Generate invoices"}
                </Button>
              </div>
            </Card>
          </div>
        )}
      </div>
    </>
  );
}
