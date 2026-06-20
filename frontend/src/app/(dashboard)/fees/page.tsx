"use client";

import { useCallback, useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { api, ApiError } from "@/lib/api";
import { useAuthStore } from "@/stores/auth-store";
import { usePermissions } from "@/lib/use-permissions";
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
import type {
  FeeDiscount,
  FeeSummary,
  FineRule,
  Invoice,
  InvoiceBreakdown,
  InvoiceWithPayments,
  Paginated,
  Student,
} from "@/types";
import { useI18n } from "@/i18n/I18nProvider";

const ADJ_STATUS_TONES: Record<string, "slate" | "green" | "amber" | "red"> = {
  applied: "green",
  approved: "green",
  active: "green",
  pending: "amber",
  waived: "slate",
  rejected: "red",
  reversed: "slate",
};

async function downloadPdf(path: string, filename: string) {
  const base =
    process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api/v1";
  const token = useAuthStore.getState().accessToken;
  const res = await fetch(`${base}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) {
    let msg = res.statusText;
    try {
      const d = await res.json();
      if (typeof d.error === "string") msg = d.error;
    } catch {
      // non-JSON error body — keep statusText
    }
    throw new ApiError(res.status, msg);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

const invoiceSchema = z.object({
  studentId: z.string().min(1, "Pick a student"),
  description: z.string().min(1, "Required"),
  amountDue: z.coerce.number().positive("Must be positive"),
  dueDate: z.string().min(1, "Required"),
});

const paymentSchema = z.object({
  amount: z.coerce.number().positive("Must be positive"),
  method: z.enum(["cash", "card", "bank_transfer", "upi", "cheque", "online"]),
  reference: z.string().optional(),
});

type InvoiceForm = z.infer<typeof invoiceSchema>;
type PaymentForm = z.infer<typeof paymentSchema>;

const STATUS_TONES: Record<Invoice["status"], "green" | "amber" | "red" | "slate"> =
  {
    paid: "green",
    partially_paid: "amber",
    pending: "red",
    cancelled: "slate",
  };

export default function FeesPage() {
  const { t } = useI18n();
  const { can } = usePermissions();
  const canApplyFine = can("fee_fines:apply");
  const canWaiveFine = can("fee_fines:waive");
  const canApplyDiscount = can("fee_discounts:apply");
  const canApproveDiscount = can("fee_discounts:approve");

  const [summary, setSummary] = useState<FeeSummary | null>(null);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [statusFilter, setStatusFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [invoiceModal, setInvoiceModal] = useState(false);
  const [payingInvoice, setPayingInvoice] = useState<Invoice | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);

  // "View payments" modal state.
  const [paymentsInvoice, setPaymentsInvoice] =
    useState<InvoiceWithPayments | null>(null);
  const [paymentsOpen, setPaymentsOpen] = useState(false);
  const [paymentsLoading, setPaymentsLoading] = useState(false);
  const [paymentsError, setPaymentsError] = useState<string | null>(null);
  const [receiptError, setReceiptError] = useState<string | null>(null);

  // Adjustments (breakdown / fines / discounts) inside the detail modal.
  const [breakdown, setBreakdown] = useState<InvoiceBreakdown | null>(null);
  const [breakdownLoading, setBreakdownLoading] = useState(false);
  const [breakdownError, setBreakdownError] = useState<string | null>(null);
  const [adjError, setAdjError] = useState<string | null>(null);
  const [adjBusy, setAdjBusy] = useState(false);
  const [fineRules, setFineRules] = useState<FineRule[]>([]);
  const [discounts, setDiscounts] = useState<FeeDiscount[]>([]);
  const [selectedFineRule, setSelectedFineRule] = useState("");
  const [discountType, setDiscountType] = useState<"fixed" | "percent">("fixed");
  const [discountValue, setDiscountValue] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: "50" });
      if (statusFilter) params.set("status", statusFilter);
      const [summaryData, invoicesData] = await Promise.all([
        api.get<FeeSummary>("/fees/summary"),
        api.get<Paginated<Invoice>>(`/fees/invoices?${params.toString()}`),
      ]);
      setSummary(summaryData);
      setInvoices(invoicesData.data);
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    load().catch(() => setLoading(false));
  }, [load]);

  useEffect(() => {
    api
      .get<Paginated<Student>>("/students?limit=100")
      .then((result) => setStudents(result.data))
      .catch(() => undefined);
  }, []);

  const invoiceForm = useForm<InvoiceForm>({
    resolver: zodResolver(invoiceSchema),
  });
  const paymentForm = useForm<PaymentForm>({
    resolver: zodResolver(paymentSchema),
    defaultValues: { method: "cash" },
  });

  const createInvoice = async (values: InvoiceForm) => {
    setServerError(null);
    try {
      await api.post("/fees/invoices", values);
      setInvoiceModal(false);
      invoiceForm.reset();
      await load();
    } catch (err) {
      setServerError(
        err instanceof ApiError ? err.message : "Failed to create invoice"
      );
    }
  };

  const recordPayment = async (values: PaymentForm) => {
    if (!payingInvoice) return;
    setServerError(null);
    try {
      await api.post(`/fees/invoices/${payingInvoice.id}/payments`, {
        ...values,
        reference: values.reference || undefined,
      });
      setPayingInvoice(null);
      paymentForm.reset({ method: "cash" });
      await load();
    } catch (err) {
      setServerError(
        err instanceof ApiError ? err.message : "Failed to record payment"
      );
    }
  };

  // Load adjustment option lists once, only if the user can apply them.
  useEffect(() => {
    if (canApplyFine) {
      api
        .get<FineRule[]>("/fees/fine-rules")
        .then(setFineRules)
        .catch(() => undefined);
    }
    if (canApplyDiscount) {
      api
        .get<FeeDiscount[]>("/fees/discounts")
        .then(setDiscounts)
        .catch(() => undefined);
    }
  }, [canApplyFine, canApplyDiscount]);

  const loadBreakdown = useCallback(async (invoiceId: string) => {
    setBreakdownError(null);
    setBreakdownLoading(true);
    try {
      setBreakdown(
        await api.get<InvoiceBreakdown>(
          `/fees/invoices/${invoiceId}/breakdown`
        )
      );
    } catch (err) {
      setBreakdownError(
        err instanceof ApiError ? err.message : "Failed to load breakdown"
      );
    } finally {
      setBreakdownLoading(false);
    }
  }, []);

  const viewPayments = async (invoice: Invoice) => {
    setPaymentsOpen(true);
    setPaymentsInvoice(null);
    setPaymentsError(null);
    setReceiptError(null);
    setBreakdown(null);
    setBreakdownError(null);
    setAdjError(null);
    setSelectedFineRule("");
    setDiscountType("fixed");
    setDiscountValue("");
    setPaymentsLoading(true);
    loadBreakdown(invoice.id);
    try {
      setPaymentsInvoice(
        await api.get<InvoiceWithPayments>(`/fees/invoices/${invoice.id}`)
      );
    } catch (err) {
      setPaymentsError(
        err instanceof ApiError ? err.message : "Failed to load payments"
      );
    } finally {
      setPaymentsLoading(false);
    }
  };

  // Re-fetch the breakdown and the invoice list after any adjustment.
  const refreshAfterAdjustment = async () => {
    if (paymentsInvoice) await loadBreakdown(paymentsInvoice.id);
    await load();
  };

  const applyFine = async () => {
    if (!paymentsInvoice || !selectedFineRule) return;
    setAdjError(null);
    setAdjBusy(true);
    try {
      await api.post(`/fees/invoices/${paymentsInvoice.id}/fines`, {
        fineRuleId: selectedFineRule,
      });
      setSelectedFineRule("");
      await refreshAfterAdjustment();
    } catch (err) {
      setAdjError(
        err instanceof ApiError ? err.message : "Failed to apply fine"
      );
    } finally {
      setAdjBusy(false);
    }
  };

  const waiveFine = async (fineId: string) => {
    setAdjError(null);
    setAdjBusy(true);
    try {
      await api.post(`/fees/applied-fines/${fineId}/waive`);
      await refreshAfterAdjustment();
    } catch (err) {
      setAdjError(
        err instanceof ApiError ? err.message : "Failed to waive fine"
      );
    } finally {
      setAdjBusy(false);
    }
  };

  const applyDiscount = async () => {
    if (!paymentsInvoice) return;
    if (!discountValue || Number(discountValue) <= 0) {
      setAdjError("Enter a discount value");
      return;
    }
    setAdjError(null);
    setAdjBusy(true);
    try {
      await api.post(`/fees/invoices/${paymentsInvoice.id}/discounts`, {
        discountType,
        value: Number(discountValue),
      });
      setDiscountValue("");
      await refreshAfterAdjustment();
    } catch (err) {
      setAdjError(
        err instanceof ApiError ? err.message : "Failed to apply discount"
      );
    } finally {
      setAdjBusy(false);
    }
  };

  const approveDiscount = async (discountId: string) => {
    setAdjError(null);
    setAdjBusy(true);
    try {
      await api.post(`/fees/applied-discounts/${discountId}/approve`);
      await refreshAfterAdjustment();
    } catch (err) {
      setAdjError(
        err instanceof ApiError ? err.message : "Failed to approve discount"
      );
    } finally {
      setAdjBusy(false);
    }
  };

  const downloadReceipt = async (paymentId: string) => {
    setReceiptError(null);
    try {
      await downloadPdf(
        `/fee-receipts/${paymentId}/download`,
        "receipt.pdf"
      );
    } catch (err) {
      setReceiptError(
        err instanceof ApiError ? err.message : "Failed to download receipt"
      );
    }
  };

  return (
    <>
      <PageHeader
        title={t("pages.fees.title")}
        subtitle={t("pages.fees.subtitle")}
        action={
          <Button onClick={() => setInvoiceModal(true)}>+ New invoice</Button>
        }
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <Card>
          <p className="text-sm text-slate-500">Total invoiced</p>
          <p className="mt-1 text-2xl font-semibold">
            {summary?.totalInvoiced.toLocaleString() ?? "—"}
          </p>
        </Card>
        <Card>
          <p className="text-sm text-slate-500">Collected</p>
          <p className="mt-1 text-2xl font-semibold text-emerald-600">
            {summary?.totalCollected.toLocaleString() ?? "—"}
          </p>
        </Card>
        <Card>
          <p className="text-sm text-slate-500">Outstanding</p>
          <p className="mt-1 text-2xl font-semibold text-red-600">
            {summary?.outstanding.toLocaleString() ?? "—"}
          </p>
        </Card>
      </div>

      <div className="mb-4 w-48">
        <Select
          value={statusFilter}
          onChange={(event) => setStatusFilter(event.target.value)}
        >
          <option value="">All statuses</option>
          <option value="pending">Pending</option>
          <option value="partially_paid">Partially paid</option>
          <option value="paid">Paid</option>
          <option value="cancelled">Cancelled</option>
        </Select>
      </div>

      {loading ? (
        <Spinner />
      ) : invoices.length === 0 ? (
        <EmptyState message="No invoices found" />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3">Invoice</th>
                <th className="px-4 py-3">Student</th>
                <th className="px-4 py-3">Description</th>
                <th className="px-4 py-3 text-right">Due</th>
                <th className="px-4 py-3 text-right">Paid</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {invoices.map((invoice) => (
                <tr key={invoice.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-mono text-xs">
                    {invoice.invoiceNo}
                  </td>
                  <td className="px-4 py-3 font-medium text-slate-900">
                    {invoice.studentName}
                  </td>
                  <td className="px-4 py-3">{invoice.description}</td>
                  <td className="px-4 py-3 text-right">
                    {Number(invoice.amountDue).toLocaleString()}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {Number(invoice.amountPaid).toLocaleString()}
                  </td>
                  <td className="px-4 py-3">
                    <Badge tone={STATUS_TONES[invoice.status]}>
                      {invoice.status.replace("_", " ")}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex justify-end gap-3">
                      <button
                        onClick={() => viewPayments(invoice)}
                        className="text-xs font-medium text-brand-600 hover:text-brand-700"
                      >
                        View payments
                      </button>
                      {invoice.status !== "paid" &&
                        invoice.status !== "cancelled" && (
                          <button
                            onClick={() => setPayingInvoice(invoice)}
                            className="text-xs font-medium text-brand-600 hover:text-brand-700"
                          >
                            Record payment
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
        title={`Payments — ${paymentsInvoice?.invoiceNo ?? ""}`}
        open={paymentsOpen}
        onClose={() => setPaymentsOpen(false)}
      >
        {paymentsLoading ? (
          <Spinner />
        ) : paymentsError ? (
          <ErrorNote message={paymentsError} />
        ) : (
          <div className="space-y-6">
            {/* --- Adjustments: breakdown, fines & discounts --- */}
            <section className="space-y-3">
              <h3 className="text-sm font-semibold text-slate-900">
                Adjustments
              </h3>
              {breakdownLoading ? (
                <Spinner />
              ) : breakdownError ? (
                <ErrorNote message={breakdownError} />
              ) : breakdown ? (
                <>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    <div className="rounded-lg border border-slate-200 p-3">
                      <p className="text-xs text-slate-500">Base</p>
                      <p className="mt-1 text-base font-semibold text-slate-900">
                        {Number(breakdown.base).toLocaleString()}
                      </p>
                    </div>
                    <div className="rounded-lg border border-slate-200 p-3">
                      <p className="text-xs text-slate-500">Fines</p>
                      <p className="mt-1 text-base font-semibold text-red-600">
                        {Number(breakdown.fineTotal).toLocaleString()}
                      </p>
                    </div>
                    <div className="rounded-lg border border-slate-200 p-3">
                      <p className="text-xs text-slate-500">Discounts</p>
                      <p className="mt-1 text-base font-semibold text-emerald-600">
                        {Number(breakdown.discountTotal).toLocaleString()}
                      </p>
                    </div>
                    <div className="rounded-lg border border-slate-200 p-3">
                      <p className="text-xs text-slate-500">Outstanding</p>
                      <p className="mt-1 text-base font-semibold text-slate-900">
                        {Number(breakdown.outstanding).toLocaleString()}
                      </p>
                    </div>
                  </div>

                  <ErrorNote message={adjError} />

                  {/* Fines list */}
                  {breakdown.fines.length > 0 && (
                    <div className="overflow-x-auto rounded-xl border border-slate-200">
                      <table className="w-full text-left text-sm">
                        <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
                          <tr>
                            <th className="px-4 py-2">Fine</th>
                            <th className="px-4 py-2 text-right">Amount</th>
                            <th className="px-4 py-2">Status</th>
                            {canWaiveFine && <th className="px-4 py-2" />}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {breakdown.fines.map((fine) => (
                            <tr key={fine.id}>
                              <td className="px-4 py-2 text-slate-700">
                                {fine.reason ?? "Fine"}
                                {fine.days != null && (
                                  <span className="text-xs text-slate-400">
                                    {" "}
                                    ({fine.days}d)
                                  </span>
                                )}
                              </td>
                              <td className="px-4 py-2 text-right text-slate-900">
                                {Number(fine.amount).toLocaleString()}
                              </td>
                              <td className="px-4 py-2">
                                <Badge
                                  tone={ADJ_STATUS_TONES[fine.status] ?? "slate"}
                                >
                                  {fine.status}
                                </Badge>
                              </td>
                              {canWaiveFine && (
                                <td className="px-4 py-2 text-right">
                                  {fine.status === "applied" && (
                                    <button
                                      onClick={() => waiveFine(fine.id)}
                                      disabled={adjBusy}
                                      className="text-xs font-medium text-brand-600 hover:text-brand-700 disabled:cursor-not-allowed disabled:opacity-60"
                                    >
                                      Waive
                                    </button>
                                  )}
                                </td>
                              )}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {/* Discounts list */}
                  {breakdown.discounts.length > 0 && (
                    <div className="overflow-x-auto rounded-xl border border-slate-200">
                      <table className="w-full text-left text-sm">
                        <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
                          <tr>
                            <th className="px-4 py-2">Discount</th>
                            <th className="px-4 py-2 text-right">Amount</th>
                            <th className="px-4 py-2">Status</th>
                            {canApproveDiscount && <th className="px-4 py-2" />}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {breakdown.discounts.map((discount) => (
                            <tr key={discount.id}>
                              <td className="px-4 py-2 text-slate-700">
                                {discount.reason ?? "Discount"}
                              </td>
                              <td className="px-4 py-2 text-right text-slate-900">
                                {Number(discount.amount).toLocaleString()}
                              </td>
                              <td className="px-4 py-2">
                                <Badge
                                  tone={
                                    ADJ_STATUS_TONES[discount.status] ?? "slate"
                                  }
                                >
                                  {discount.status}
                                </Badge>
                              </td>
                              {canApproveDiscount && (
                                <td className="px-4 py-2 text-right">
                                  {discount.status === "pending" && (
                                    <button
                                      onClick={() => approveDiscount(discount.id)}
                                      disabled={adjBusy}
                                      className="text-xs font-medium text-brand-600 hover:text-brand-700 disabled:cursor-not-allowed disabled:opacity-60"
                                    >
                                      Approve
                                    </button>
                                  )}
                                </td>
                              )}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {/* Apply fine control */}
                  {canApplyFine && (
                    <div className="flex items-end gap-2">
                      <div className="flex-1">
                        <Field label="Apply fine">
                          <Select
                            value={selectedFineRule}
                            onChange={(event) =>
                              setSelectedFineRule(event.target.value)
                            }
                          >
                            <option value="">Select a fine rule…</option>
                            {fineRules.map((rule) => (
                              <option key={rule.id} value={rule.id}>
                                {rule.name}
                              </option>
                            ))}
                          </Select>
                        </Field>
                      </div>
                      <Button
                        type="button"
                        variant="secondary"
                        onClick={applyFine}
                        disabled={adjBusy || !selectedFineRule}
                      >
                        Apply
                      </Button>
                    </div>
                  )}

                  {/* Apply discount control */}
                  {canApplyDiscount && (
                    <div className="flex items-end gap-2">
                      <div className="w-32">
                        <Field label="Apply discount">
                          <Select
                            value={discountType}
                            onChange={(event) =>
                              setDiscountType(
                                event.target.value as "fixed" | "percent"
                              )
                            }
                          >
                            <option value="fixed">Fixed</option>
                            <option value="percent">Percent</option>
                          </Select>
                        </Field>
                      </div>
                      <div className="flex-1">
                        <Field label="Value">
                          <Input
                            type="number"
                            step="0.01"
                            value={discountValue}
                            onChange={(event) =>
                              setDiscountValue(event.target.value)
                            }
                          />
                        </Field>
                      </div>
                      <Button
                        type="button"
                        variant="secondary"
                        onClick={applyDiscount}
                        disabled={adjBusy}
                      >
                        Apply
                      </Button>
                    </div>
                  )}
                </>
              ) : null}
            </section>

            {/* --- Payments --- */}
            <section className="space-y-3">
              <h3 className="text-sm font-semibold text-slate-900">Payments</h3>
              <ErrorNote message={receiptError} />
              {paymentsInvoice && paymentsInvoice.payments.length > 0 ? (
                <div className="overflow-x-auto rounded-xl border border-slate-200">
                  <table className="w-full text-left text-sm">
                    <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
                      <tr>
                        <th className="px-4 py-3 text-right">Amount</th>
                        <th className="px-4 py-3">Method</th>
                        <th className="px-4 py-3">Reference</th>
                        <th className="px-4 py-3">Paid</th>
                        <th className="px-4 py-3" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {paymentsInvoice.payments.map((payment) => (
                        <tr key={payment.id}>
                          <td className="px-4 py-3 text-right text-slate-900">
                            {Number(payment.amount).toLocaleString()}
                          </td>
                          <td className="px-4 py-3 text-slate-600">
                            {payment.method.replace("_", " ")}
                          </td>
                          <td className="px-4 py-3 text-slate-500">
                            {payment.reference ?? "—"}
                          </td>
                          <td className="px-4 py-3 text-slate-500">
                            {new Date(payment.paidAt).toLocaleDateString()}
                          </td>
                          <td className="px-4 py-3 text-right">
                            <button
                              onClick={() => downloadReceipt(payment.id)}
                              className="text-xs font-medium text-brand-600 hover:text-brand-700"
                            >
                              Receipt
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <EmptyState message="No payments recorded yet" />
              )}
            </section>
          </div>
        )}
      </Modal>

      <Modal
        title="New invoice"
        open={invoiceModal}
        onClose={() => setInvoiceModal(false)}
      >
        <form
          onSubmit={invoiceForm.handleSubmit(createInvoice)}
          className="space-y-4"
        >
          <Field
            label="Student"
            error={invoiceForm.formState.errors.studentId?.message}
          >
            <Select {...invoiceForm.register("studentId")}>
              <option value="">Select a student…</option>
              {students.map((student) => (
                <option key={student.id} value={student.id}>
                  {student.firstName} {student.lastName} ({student.admissionNo})
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label="Description"
            error={invoiceForm.formState.errors.description?.message}
          >
            <Input
              placeholder="Term 1 Tuition"
              {...invoiceForm.register("description")}
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field
              label="Amount"
              error={invoiceForm.formState.errors.amountDue?.message}
            >
              <Input
                type="number"
                step="0.01"
                {...invoiceForm.register("amountDue")}
              />
            </Field>
            <Field
              label="Due date"
              error={invoiceForm.formState.errors.dueDate?.message}
            >
              <Input type="date" {...invoiceForm.register("dueDate")} />
            </Field>
          </div>
          <ErrorNote message={serverError} />
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setInvoiceModal(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={invoiceForm.formState.isSubmitting}
            >
              Create invoice
            </Button>
          </div>
        </form>
      </Modal>

      <Modal
        title={`Record payment — ${payingInvoice?.invoiceNo ?? ""}`}
        open={payingInvoice !== null}
        onClose={() => setPayingInvoice(null)}
      >
        <form
          onSubmit={paymentForm.handleSubmit(recordPayment)}
          className="space-y-4"
        >
          <p className="text-sm text-slate-500">
            Outstanding:{" "}
            <strong>
              {payingInvoice
                ? (
                    Number(payingInvoice.amountDue) -
                    Number(payingInvoice.amountPaid)
                  ).toLocaleString()
                : ""}
            </strong>
          </p>
          <Field
            label="Amount"
            error={paymentForm.formState.errors.amount?.message}
          >
            <Input
              type="number"
              step="0.01"
              {...paymentForm.register("amount")}
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Method">
              <Select {...paymentForm.register("method")}>
                <option value="cash">Cash</option>
                <option value="card">Card</option>
                <option value="bank_transfer">Bank transfer</option>
                <option value="upi">UPI</option>
                <option value="cheque">Cheque</option>
                <option value="online">Online</option>
              </Select>
            </Field>
            <Field label="Reference">
              <Input
                placeholder="Txn id…"
                {...paymentForm.register("reference")}
              />
            </Field>
          </div>
          <ErrorNote message={serverError} />
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setPayingInvoice(null)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={paymentForm.formState.isSubmitting}
            >
              Record payment
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
