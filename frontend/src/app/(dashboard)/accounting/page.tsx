"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { api, ApiError } from "@/lib/api";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorNote,
  Field,
  Input,
  Modal,
  PageHeader,
  Select,
  Spinner,
} from "@/components/ui";
import type { Paginated } from "@/types";

interface FinanceTransaction {
  id: string;
  txnDate: string;
  type: "income" | "expense";
  category: string;
  amount: number;
  description: string | null;
  paymentMethod: string | null;
  referenceNo: string | null;
  createdAt: string;
}

interface FinanceSummary {
  income: number;
  expense: number;
  net: number;
  byCategory: { category: string; type: string; total: number }[];
}

const txnSchema = z.object({
  txnDate: z.string().min(1, "Required"),
  type: z.enum(["income", "expense"]),
  category: z.string().min(1, "Required"),
  amount: z.coerce.number().positive("Enter an amount"),
  description: z.string().optional(),
  paymentMethod: z.string().optional(),
  referenceNo: z.string().optional(),
});
type TxnForm = z.infer<typeof txnSchema>;

const money = (n: number) =>
  n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function StatCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "income" | "expense" | "net";
}) {
  const color =
    tone === "income"
      ? "text-emerald-600 dark:text-emerald-400"
      : tone === "expense"
        ? "text-red-600 dark:text-red-400"
        : value >= 0
          ? "text-ink"
          : "text-red-600 dark:text-red-400";
  return (
    <Card>
      <p className="text-xs font-medium uppercase text-muted">{label}</p>
      <p className={`mt-1 text-2xl font-bold ${color}`}>{money(value)}</p>
    </Card>
  );
}

export default function AccountingPage() {
  const today = new Date().toISOString().slice(0, 10);

  const [txns, setTxns] = useState<FinanceTransaction[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [summary, setSummary] = useState<FinanceSummary | null>(null);
  const [typeFilter, setTypeFilter] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);

  const limit = 10;

  const dateParams = useMemo(() => {
    const p = new URLSearchParams();
    if (dateFrom) p.set("dateFrom", dateFrom);
    if (dateTo) p.set("dateTo", dateTo);
    return p;
  }, [dateFrom, dateTo]);

  const load = useCallback(async () => {
    setLoading(true);
    setRowError(null);
    try {
      const listParams = new URLSearchParams(dateParams);
      listParams.set("page", String(page));
      listParams.set("limit", String(limit));
      if (typeFilter) listParams.set("type", typeFilter);
      const [list, sum] = await Promise.all([
        api.get<Paginated<FinanceTransaction>>(`/finance/transactions?${listParams.toString()}`),
        api.get<FinanceSummary>(`/finance/summary?${dateParams.toString()}`),
      ]);
      setTxns(list.data);
      setTotal(list.meta.total);
      setSummary(sum);
    } finally {
      setLoading(false);
    }
  }, [page, typeFilter, dateParams]);

  useEffect(() => {
    load().catch(() => setLoading(false));
  }, [load]);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<TxnForm>({
    resolver: zodResolver(txnSchema),
    defaultValues: { type: "expense", txnDate: today },
  });

  const onSubmit = async (values: TxnForm) => {
    setServerError(null);
    try {
      await api.post("/finance/transactions", values);
      setModalOpen(false);
      reset({ type: "expense", txnDate: today });
      await load();
    } catch (err) {
      setServerError(
        err instanceof ApiError ? err.message : "Failed to save transaction"
      );
    }
  };

  const removeTxn = async (txn: FinanceTransaction) => {
    if (!confirm("Delete this transaction?")) return;
    setRowError(null);
    try {
      await api.delete(`/finance/transactions/${txn.id}`);
      await load();
    } catch (err) {
      setRowError(err instanceof ApiError ? err.message : "Failed to delete");
    }
  };

  const totalPages = Math.max(1, Math.ceil(total / limit));

  return (
    <>
      <PageHeader
        title="Accounting"
        subtitle="Income & expense ledger (day-book)"
        action={<Button onClick={() => setModalOpen(true)}>+ New entry</Button>}
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <StatCard label="Income" value={summary?.income ?? 0} tone="income" />
        <StatCard label="Expense" value={summary?.expense ?? 0} tone="expense" />
        <StatCard label="Net" value={summary?.net ?? 0} tone="net" />
      </div>

      <div className="mb-4 flex flex-wrap gap-3">
        <div className="w-40">
          <Select
            value={typeFilter}
            onChange={(e) => {
              setTypeFilter(e.target.value);
              setPage(1);
            }}
          >
            <option value="">All types</option>
            <option value="income">Income</option>
            <option value="expense">Expense</option>
          </Select>
        </div>
        <div className="w-40">
          <Input
            type="date"
            value={dateFrom}
            onChange={(e) => {
              setDateFrom(e.target.value);
              setPage(1);
            }}
          />
        </div>
        <div className="w-40">
          <Input
            type="date"
            value={dateTo}
            onChange={(e) => {
              setDateTo(e.target.value);
              setPage(1);
            }}
          />
        </div>
      </div>

      <ErrorNote message={rowError} />

      {loading ? (
        <Spinner />
      ) : txns.length === 0 ? (
        <EmptyState message="No transactions for this range" />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-line bg-surface">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-line bg-surface-2 text-xs uppercase text-muted">
              <tr>
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Category</th>
                <th className="px-4 py-3">Description</th>
                <th className="px-4 py-3 text-right">Amount</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {txns.map((txn) => (
                <tr key={txn.id} className="hover:bg-surface-2">
                  <td className="whitespace-nowrap px-4 py-3 text-muted">{txn.txnDate}</td>
                  <td className="px-4 py-3">
                    <Badge tone={txn.type === "income" ? "green" : "red"}>{txn.type}</Badge>
                  </td>
                  <td className="px-4 py-3 text-ink">{txn.category}</td>
                  <td className="px-4 py-3 text-muted">{txn.description ?? "—"}</td>
                  <td className="px-4 py-3 text-right font-medium text-ink">
                    {money(txn.amount)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => removeTxn(txn)}
                      className="text-xs font-medium text-red-600 hover:text-red-700"
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {totalPages > 1 && (
        <div className="mt-4 flex items-center justify-end gap-2 text-sm">
          <Button variant="secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>
            Previous
          </Button>
          <span className="text-muted">
            Page {page} of {totalPages}
          </span>
          <Button
            variant="secondary"
            disabled={page >= totalPages}
            onClick={() => setPage(page + 1)}
          >
            Next
          </Button>
        </div>
      )}

      <Modal title="New transaction" open={modalOpen} onClose={() => setModalOpen(false)}>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Date" error={errors.txnDate?.message}>
              <Input type="date" {...register("txnDate")} />
            </Field>
            <Field label="Type">
              <Select {...register("type")}>
                <option value="expense">Expense</option>
                <option value="income">Income</option>
              </Select>
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Category" error={errors.category?.message}>
              <Input placeholder="e.g. Supplies" {...register("category")} />
            </Field>
            <Field label="Amount" error={errors.amount?.message}>
              <Input type="number" step="0.01" min="0" {...register("amount")} />
            </Field>
          </div>
          <Field label="Description">
            <Input {...register("description")} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Payment method">
              <Input placeholder="Cash / Bank / UPI" {...register("paymentMethod")} />
            </Field>
            <Field label="Reference no">
              <Input {...register("referenceNo")} />
            </Field>
          </div>
          <ErrorNote message={serverError} />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setModalOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Saving…" : "Save entry"}
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
