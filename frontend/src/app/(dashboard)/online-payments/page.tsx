"use client";

import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { useAuthStore } from "@/stores/auth-store";
import { usePermissions } from "@/lib/use-permissions";
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  ErrorNote,
  PageHeader,
  Select,
  Spinner,
} from "@/components/ui";
import type { GatewayStatus, PaymentOrder } from "@/types";

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

const STATUS_TONES: Record<
  PaymentOrder["status"],
  "green" | "amber" | "red" | "slate"
> = {
  created: "amber",
  pending: "amber",
  success: "green",
  failed: "red",
  expired: "red",
  cancelled: "slate",
  refunded: "slate",
};

const STATUS_OPTIONS: PaymentOrder["status"][] = [
  "created",
  "pending",
  "success",
  "failed",
  "cancelled",
  "expired",
  "refunded",
];

export default function OnlinePaymentsPage() {
  const { can, loading: permsLoading } = usePermissions();

  const [settings, setSettings] = useState<GatewayStatus | null>(null);
  const [orders, setOrders] = useState<PaymentOrder[]>([]);
  const [statusFilter, setStatusFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [actionError, setActionError] = useState<string | null>(null);
  const [togglingSettings, setTogglingSettings] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [pendingRefund, setPendingRefund] = useState<PaymentOrder | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const query = statusFilter ? `?status=${statusFilter}` : "";
      const [ordersList, gateway] = await Promise.all([
        api.get<PaymentOrder[]>(`/online-payments${query}`),
        can("online_payments:settings")
          ? api.get<GatewayStatus>("/online-payments/settings")
          : Promise.resolve(null),
      ]);
      setOrders(ordersList);
      setSettings(gateway);
    } catch (err) {
      setLoadError(
        err instanceof ApiError ? err.message : "Failed to load online payments"
      );
    } finally {
      setLoading(false);
    }
    // `can` is stable for a loaded permission set; re-run on filter changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter, permsLoading]);

  useEffect(() => {
    if (!permsLoading && can("online_payments:read")) load();
    else if (!permsLoading) setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [permsLoading, load]);

  const toggleEnabled = async () => {
    if (!settings) return;
    setActionError(null);
    setTogglingSettings(true);
    try {
      const updated = await api.patch<GatewayStatus>(
        "/online-payments/settings",
        { enabled: !settings.enabled }
      );
      setSettings(updated);
    } catch (err) {
      setActionError(
        err instanceof ApiError ? err.message : "Could not update settings"
      );
    } finally {
      setTogglingSettings(false);
    }
  };

  const downloadReceipt = async (order: PaymentOrder) => {
    setActionError(null);
    try {
      await downloadPdf(
        `/online-payments/${order.id}/receipt`,
        `receipt-${order.orderNo}.pdf`
      );
    } catch (err) {
      setActionError(
        err instanceof ApiError ? err.message : "Failed to download receipt"
      );
    }
  };

  const confirmRefund = async () => {
    if (!pendingRefund) return;
    const order = pendingRefund;
    setActionError(null);
    setBusyId(order.id);
    try {
      await api.post<PaymentOrder>(`/online-payments/${order.id}/refund`);
      await load();
    } catch (err) {
      setActionError(
        err instanceof ApiError ? err.message : "Refund failed"
      );
    } finally {
      setBusyId(null);
      setPendingRefund(null);
    }
  };

  if (permsLoading || loading) {
    return (
      <>
        <PageHeader title="Online Payments" subtitle="Gateway orders & settings" />
        <Spinner />
      </>
    );
  }

  if (!can("online_payments:read")) {
    return (
      <>
        <PageHeader title="Online Payments" subtitle="Gateway orders & settings" />
        <EmptyState message="You don't have permission to view this page." />
      </>
    );
  }

  return (
    <>
      <PageHeader title="Online Payments" subtitle="Gateway orders & settings" />

      <ErrorNote message={loadError} />
      {actionError && (
        <div className="mb-4">
          <ErrorNote message={actionError} />
        </div>
      )}

      {can("online_payments:settings") && settings && (
        <div className="mb-6">
          {settings.configured ? (
            <Card>
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="space-y-1">
                  <p className="text-sm font-medium text-muted">
                    Payment gateway
                  </p>
                  <p className="text-lg font-semibold text-ink">
                    {settings.provider ?? "Not configured"}
                  </p>
                  <div className="flex flex-wrap items-center gap-2 text-sm text-muted">
                    <Badge tone={settings.enabled ? "green" : "slate"}>
                      {settings.enabled ? "Enabled" : "Disabled"}
                    </Badge>
                    <span>·</span>
                    <span>Currency {settings.currency}</span>
                  </div>
                </div>
                <Button
                  variant={settings.enabled ? "secondary" : "primary"}
                  onClick={toggleEnabled}
                  disabled={togglingSettings}
                >
                  {togglingSettings
                    ? "Saving…"
                    : settings.enabled
                      ? "Disable online payments"
                      : "Enable online payments"}
                </Button>
              </div>
            </Card>
          ) : (
            <Card className="border-blue-200 bg-blue-50">
              <p className="text-sm font-medium text-ink">
                No payment gateway is configured.
              </p>
              <p className="mt-1 text-sm text-muted">
                Set PAYMENT_GATEWAY_PROVIDER and PAYMENT_GATEWAY_WEBHOOK_SECRET on
                the server to enable online payments. Offline fee collection is
                unaffected.
              </p>
            </Card>
          )}
        </div>
      )}

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-ink">Orders</h2>
        <div className="w-48">
          <Select
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value)}
          >
            <option value="">All statuses</option>
            {STATUS_OPTIONS.map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </Select>
        </div>
      </div>

      {orders.length === 0 ? (
        <EmptyState message="No online payment orders yet." />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-line bg-white">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-line bg-surface-2 text-xs uppercase text-muted">
              <tr>
                <th className="px-4 py-3">Order</th>
                <th className="px-4 py-3">Invoice</th>
                <th className="px-4 py-3">Student</th>
                <th className="px-4 py-3 text-right">Amount</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Provider</th>
                <th className="px-4 py-3">Created</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {orders.map((order) => (
                <tr key={order.id}>
                  <td className="px-4 py-3 font-medium text-ink">
                    {order.orderNo}
                  </td>
                  <td className="px-4 py-3 text-muted">{order.invoiceNo}</td>
                  <td className="px-4 py-3 text-muted">
                    {order.studentName}
                  </td>
                  <td className="px-4 py-3 text-right text-ink">
                    {Number(order.amount).toLocaleString()} {order.currency}
                  </td>
                  <td className="px-4 py-3">
                    <Badge tone={STATUS_TONES[order.status]}>
                      {order.status}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-muted">{order.provider}</td>
                  <td className="px-4 py-3 text-muted">
                    {new Date(order.createdAt).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-3">
                      {order.status === "success" && (
                        <button
                          onClick={() => downloadReceipt(order)}
                          className="text-xs font-medium text-brand-600 hover:text-brand-700"
                        >
                          Receipt
                        </button>
                      )}
                      {order.status === "success" &&
                        can("online_payments:refund") && (
                          <button
                            onClick={() => setPendingRefund(order)}
                            disabled={busyId === order.id}
                            className="text-xs font-medium text-red-600 hover:text-red-700 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            {busyId === order.id ? "Refunding…" : "Refund"}
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

      <ConfirmDialog
        open={pendingRefund !== null}
        title="Refund payment"
        message={
          pendingRefund
            ? `Refund payment ${pendingRefund.orderNo} for ${pendingRefund.studentName}? This cannot be undone.`
            : ""
        }
        confirmLabel="Refund"
        busy={busyId !== null && busyId === pendingRefund?.id}
        onConfirm={confirmRefund}
        onClose={() => setPendingRefund(null)}
      />
    </>
  );
}
