"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { portalApi } from "@/lib/portal-api";
import { ApiError } from "@/lib/api";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorNote,
  PageHeader,
  Spinner,
} from "@/components/ui";
import type { PaymentOrder } from "@/types";

async function downloadPortalPdf(path: string, filename: string) {
  const base =
    process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api/v1";
  const res = await fetch(`${base}${path}`, { credentials: "include" });
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

const STATUS_TONES: Record<
  PaymentOrder["status"],
  "green" | "amber" | "red" | "slate" | "blue"
> = {
  created: "slate",
  pending: "slate",
  success: "green",
  failed: "red",
  cancelled: "amber",
  expired: "red",
  refunded: "slate",
};

function BackToFees() {
  return (
    <Link
      href="/portal/fees"
      className="text-sm font-medium text-brand-600 hover:text-brand-700"
    >
      Back to fees
    </Link>
  );
}

function PaymentResult() {
  const params = useSearchParams();
  const orderId = params.get("order");

  const [order, setOrder] = useState<PaymentOrder | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [receiptError, setReceiptError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!orderId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      setOrder(await portalApi.get<PaymentOrder>(`/online-payments/${orderId}`));
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Could not load this payment."
      );
    } finally {
      setLoading(false);
    }
  }, [orderId]);

  useEffect(() => {
    load();
  }, [load]);

  const downloadReceipt = async () => {
    if (!order) return;
    setReceiptError(null);
    try {
      await downloadPortalPdf(
        `/online-payments/${order.id}/receipt`,
        `receipt-${order.orderNo}.pdf`
      );
    } catch (err) {
      setReceiptError(
        err instanceof ApiError ? err.message : "Failed to download receipt"
      );
    }
  };

  if (!orderId) {
    return (
      <>
        <PageHeader title="Payment" />
        <EmptyState message="No payment reference was provided." />
        <div className="mt-4">
          <BackToFees />
        </div>
      </>
    );
  }

  if (loading) {
    return (
      <>
        <PageHeader title="Payment" />
        <Spinner />
      </>
    );
  }

  if (error || !order) {
    return (
      <>
        <PageHeader title="Payment" />
        <ErrorNote message={error ?? "Payment not found."} />
        <div className="mt-4">
          <BackToFees />
        </div>
      </>
    );
  }

  const amount = `${Number(order.amount).toLocaleString()} ${order.currency}`;

  let heading = "";
  let body = "";
  let cardClass = "";
  let icon = "";
  if (order.status === "success") {
    heading = "Payment successful";
    body = "Your fee payment has been received. Thank you.";
    cardClass = "border-emerald-200 bg-emerald-50";
    icon = "✅";
  } else if (order.status === "failed" || order.status === "expired") {
    heading = "Payment failed";
    body = "We could not process this payment. Please try again from the fees page.";
    cardClass = "border-red-200 bg-red-50";
    icon = "❌";
  } else if (order.status === "cancelled") {
    heading = "Payment cancelled";
    body = "This payment was cancelled. You can try again from the fees page.";
    cardClass = "border-amber-200 bg-amber-50";
    icon = "⚠️";
  } else {
    // created | pending
    heading = "Payment is being processed";
    body =
      "We are confirming your payment with the gateway. This can take a few moments.";
    cardClass = "border-slate-200 bg-slate-50";
    icon = "⏳";
  }

  return (
    <>
      <PageHeader title="Payment" subtitle={`Order ${order.orderNo}`} />
      <div className="mx-auto max-w-lg space-y-4">
        <Card className={cardClass}>
          <div className="flex items-start gap-3">
            <span className="text-3xl" aria-hidden>
              {icon}
            </span>
            <div className="min-w-0">
              <h2 className="text-lg font-semibold text-slate-900">{heading}</h2>
              <p className="mt-1 text-sm text-slate-600">{body}</p>
              <div className="mt-3 flex flex-wrap items-center gap-2 text-sm text-slate-600">
                <Badge tone={STATUS_TONES[order.status]}>{order.status}</Badge>
                <span>·</span>
                <span>Invoice {order.invoiceNo}</span>
                <span>·</span>
                <span>{amount}</span>
              </div>
            </div>
          </div>

          <div className="mt-5 flex flex-wrap items-center gap-3">
            {order.status === "success" && (
              <Button onClick={downloadReceipt}>Download receipt</Button>
            )}
            {(order.status === "created" || order.status === "pending") && (
              <Button variant="secondary" onClick={load}>
                Refresh
              </Button>
            )}
            <BackToFees />
          </div>
          <div className="mt-3">
            <ErrorNote message={receiptError} />
          </div>
        </Card>
      </div>
    </>
  );
}

export default function PortalPaymentPage() {
  return (
    <Suspense fallback={<Spinner />}>
      <PaymentResult />
    </Suspense>
  );
}
