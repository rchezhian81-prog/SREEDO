"use client";

import { useCallback, useEffect, useState } from "react";
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
import type { FeeSummary, Invoice, Paginated, Student } from "@/types";

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
  const [summary, setSummary] = useState<FeeSummary | null>(null);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [statusFilter, setStatusFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [invoiceModal, setInvoiceModal] = useState(false);
  const [payingInvoice, setPayingInvoice] = useState<Invoice | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);

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

  return (
    <>
      <PageHeader
        title="Fees"
        subtitle="Invoices, payments and collections"
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
                    {invoice.status !== "paid" &&
                      invoice.status !== "cancelled" && (
                        <button
                          onClick={() => setPayingInvoice(invoice)}
                          className="text-xs font-medium text-brand-600 hover:text-brand-700"
                        >
                          Record payment
                        </button>
                      )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

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
