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
import type { Hostel, HostelFee } from "@/types";
import { FEE_FREQUENCIES } from "@/lib/fees";

export default function HostelFeesPage() {
  const { can, loading: permsLoading } = usePermissions();
  const canFees = can("hostel:fees");

  const [hostels, setHostels] = useState<Hostel[]>([]);
  const [hostelFilter, setHostelFilter] = useState("");
  const [fees, setFees] = useState<HostelFee[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Fee mapping form.
  const [feeHostelId, setFeeHostelId] = useState("");
  const [roomType, setRoomType] = useState("");
  const [amount, setAmount] = useState("");
  const [frequency, setFrequency] = useState<string>("monthly");
  const [feeError, setFeeError] = useState<string | null>(null);
  const [savingFee, setSavingFee] = useState(false);

  // Invoice generation form.
  const [genHostelId, setGenHostelId] = useState("");
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
      const qs = hostelFilter
        ? `?hostelId=${encodeURIComponent(hostelFilter)}`
        : "";
      setFees(await api.get<HostelFee[]>(`/hostel/fees${qs}`));
    } catch (err) {
      setLoadError(
        err instanceof ApiError ? err.message : "Failed to load fees"
      );
    } finally {
      setLoading(false);
    }
  }, [hostelFilter]);

  useEffect(() => {
    loadFees();
  }, [loadFees]);

  useEffect(() => {
    api
      .get<Hostel[]>("/hostel/hostels")
      .then(setHostels)
      .catch(() => undefined);
  }, []);

  const saveFee = async () => {
    setFeeError(null);
    if (!feeHostelId) {
      setFeeError("Select a hostel");
      return;
    }
    if (!amount) {
      setFeeError("Enter an amount");
      return;
    }
    setSavingFee(true);
    try {
      await api.post("/hostel/fees", {
        hostelId: feeHostelId,
        roomType: roomType || undefined,
        amount: Number(amount),
        frequency,
      });
      setAmount("");
      setRoomType("");
      await loadFees();
    } catch (err) {
      setFeeError(err instanceof ApiError ? err.message : "Failed to save fee");
    } finally {
      setSavingFee(false);
    }
  };

  const removeFee = async (fee: HostelFee) => {
    if (
      !confirm(
        `Delete fee for ${fee.hostelName}${fee.roomType ? ` · ${fee.roomType}` : ""}?`
      )
    )
      return;
    try {
      await api.delete(`/hostel/fees/${fee.id}`);
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
        "/hostel/fees/generate",
        {
          hostelId: genHostelId || undefined,
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
        <PageHeader title="Hostel fees" subtitle="Fee mapping & invoices" />
        <Spinner />
      </>
    );
  }

  if (!can("hostel:read")) {
    return (
      <>
        <PageHeader title="Hostel fees" subtitle="Fee mapping & invoices" />
        <EmptyState message="You do not have access to hostel." />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Hostel fees"
        subtitle="Fee mapping & invoice generation"
      />

      <div className="mb-4">
        <Link
          href="/hostel"
          className="text-sm font-medium text-brand-600 hover:text-brand-700"
        >
          ← Back to Hostel
        </Link>
      </div>

      {!canFees && (
        <Card className="mb-6">
          <p className="text-sm text-slate-500">
            You do not have permission to manage hostel fees. The fee list below
            is read-only.
          </p>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <div>
          <div className="mb-4 w-64">
            <span className="mb-1 block text-sm font-medium text-slate-700">
              Filter by hostel
            </span>
            <Select
              value={hostelFilter}
              onChange={(event) => setHostelFilter(event.target.value)}
            >
              <option value="">All hostels</option>
              {hostels.map((hostel) => (
                <option key={hostel.id} value={hostel.id}>
                  {hostel.name} ({hostel.code})
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
                    <th className="px-4 py-3">Hostel</th>
                    <th className="px-4 py-3">Room type</th>
                    <th className="px-4 py-3">Amount</th>
                    <th className="px-4 py-3">Frequency</th>
                    {canFees && <th className="px-4 py-3" />}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {fees.map((fee) => (
                    <tr key={fee.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3 font-medium text-slate-900">
                        {fee.hostelName}
                      </td>
                      <td className="px-4 py-3">
                        {fee.roomType ? (
                          fee.roomType
                        ) : (
                          <Badge tone="blue">hostel-level</Badge>
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
                Hostel- or room-type-level fee (upserts existing).
              </p>
              <div className="mt-4 space-y-3">
                <Field label="Hostel">
                  <Select
                    value={feeHostelId}
                    onChange={(event) => setFeeHostelId(event.target.value)}
                  >
                    <option value="">Select a hostel…</option>
                    {hostels.map((hostel) => (
                      <option key={hostel.id} value={hostel.id}>
                        {hostel.name} ({hostel.code})
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Room type (optional)">
                  <Input
                    placeholder="— Hostel-level —"
                    value={roomType}
                    onChange={(event) => setRoomType(event.target.value)}
                  />
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
                <Field label="Hostel (optional)">
                  <Select
                    value={genHostelId}
                    onChange={(event) => setGenHostelId(event.target.value)}
                  >
                    <option value="">All hostels</option>
                    {hostels.map((hostel) => (
                      <option key={hostel.id} value={hostel.id}>
                        {hostel.name} ({hostel.code})
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
                    placeholder="Hostel fee"
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
