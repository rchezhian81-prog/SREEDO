"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api, ApiError } from "@/lib/api";
import { usePermissions } from "@/lib/use-permissions";
import {
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
  Textarea,
} from "@/components/ui";
import type {
  InventoryItem,
  Purchase,
  PurchaseDetail,
  Vendor,
} from "@/types";

interface LineDraft {
  itemId: string;
  quantity: string;
  rate: string;
}

const emptyLine = (): LineDraft => ({ itemId: "", quantity: "", rate: "" });

function fmtDate(value: string | null): string {
  if (!value) return "—";
  return value.slice(0, 10);
}

function lineAmount(line: LineDraft): number {
  const qty = Number(line.quantity);
  const rate = Number(line.rate);
  if (!Number.isFinite(qty) || !Number.isFinite(rate)) return 0;
  return qty * rate;
}

export default function PurchasePage() {
  const { can, loading: permsLoading } = usePermissions();
  const canPurchase = can("inventory:purchase");

  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [items, setItems] = useState<InventoryItem[]>([]);

  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [vendorFilter, setVendorFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Form state.
  const [vendorId, setVendorId] = useState("");
  const [purchaseDate, setPurchaseDate] = useState("");
  const [billNo, setBillNo] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<LineDraft[]>([emptyLine()]);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // View lines modal.
  const [detail, setDetail] = useState<PurchaseDetail | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  const loadPurchases = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const qs = vendorFilter
        ? `?vendorId=${encodeURIComponent(vendorFilter)}`
        : "";
      setPurchases(await api.get<Purchase[]>(`/inventory/purchases${qs}`));
    } catch (err) {
      setLoadError(
        err instanceof ApiError ? err.message : "Failed to load purchases"
      );
    } finally {
      setLoading(false);
    }
  }, [vendorFilter]);

  useEffect(() => {
    loadPurchases();
  }, [loadPurchases]);

  useEffect(() => {
    Promise.all([
      api.get<Vendor[]>("/inventory/vendors"),
      api.get<InventoryItem[]>("/inventory/items"),
    ])
      .then(([vendorList, itemList]) => {
        setVendors(vendorList);
        setItems(itemList);
      })
      .catch(() => undefined);
  }, []);

  const total = lines.reduce((sum, line) => sum + lineAmount(line), 0);

  const updateLine = (index: number, patch: Partial<LineDraft>) => {
    setLines((current) =>
      current.map((line, i) => (i === index ? { ...line, ...patch } : line))
    );
  };

  const addLine = () => setLines((current) => [...current, emptyLine()]);

  const removeLine = (index: number) =>
    setLines((current) =>
      current.length === 1 ? current : current.filter((_, i) => i !== index)
    );

  const resetForm = () => {
    setVendorId("");
    setPurchaseDate("");
    setBillNo("");
    setNotes("");
    setLines([emptyLine()]);
  };

  const onSubmit = async () => {
    setFormError(null);
    const validLines = lines.filter(
      (line) => line.itemId && Number(line.quantity) > 0
    );
    if (validLines.length === 0) {
      setFormError("Add at least one line with an item and quantity");
      return;
    }
    setSaving(true);
    try {
      await api.post("/inventory/purchases", {
        vendorId: vendorId || undefined,
        purchaseDate: purchaseDate || undefined,
        billNo: billNo || undefined,
        notes: notes || undefined,
        items: validLines.map((line) => ({
          itemId: line.itemId,
          quantity: Number(line.quantity),
          rate: line.rate === "" ? undefined : Number(line.rate),
        })),
      });
      resetForm();
      await loadPurchases();
    } catch (err) {
      setFormError(
        err instanceof ApiError ? err.message : "Failed to record purchase"
      );
    } finally {
      setSaving(false);
    }
  };

  const viewLines = async (purchase: Purchase) => {
    setDetailOpen(true);
    setDetail(null);
    setDetailError(null);
    setDetailLoading(true);
    try {
      setDetail(
        await api.get<PurchaseDetail>(`/inventory/purchases/${purchase.id}`)
      );
    } catch (err) {
      setDetailError(
        err instanceof ApiError ? err.message : "Failed to load purchase"
      );
    } finally {
      setDetailLoading(false);
    }
  };

  if (permsLoading) {
    return (
      <>
        <PageHeader title="Purchase" subtitle="Stock-in" />
        <Spinner />
      </>
    );
  }

  if (!can("inventory:read")) {
    return (
      <>
        <PageHeader title="Purchase" subtitle="Stock-in" />
        <EmptyState message="You do not have access to inventory." />
      </>
    );
  }

  return (
    <>
      <PageHeader title="Purchase" subtitle="Stock-in from vendors" />

      <div className="mb-4">
        <Link
          href="/inventory"
          className="text-sm font-medium text-brand-600 hover:text-brand-700"
        >
          ← Back to Inventory
        </Link>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_24rem]">
        <div>
          <div className="mb-4 w-64">
            <span className="mb-1 block text-sm font-medium text-ink">
              Filter by vendor
            </span>
            <Select
              value={vendorFilter}
              onChange={(event) => setVendorFilter(event.target.value)}
            >
              <option value="">All vendors</option>
              {vendors.map((vendor) => (
                <option key={vendor.id} value={vendor.id}>
                  {vendor.name}
                </option>
              ))}
            </Select>
          </div>

          {loading ? (
            <Spinner />
          ) : loadError ? (
            <ErrorNote message={loadError} />
          ) : purchases.length === 0 ? (
            <EmptyState message="No purchases recorded" />
          ) : (
            <div className="overflow-x-auto rounded-xl border border-line bg-surface">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-line bg-surface-2 text-xs uppercase text-muted">
                  <tr>
                    <th className="px-4 py-3">Date</th>
                    <th className="px-4 py-3">Vendor</th>
                    <th className="px-4 py-3">Bill no</th>
                    <th className="px-4 py-3 text-right">Lines</th>
                    <th className="px-4 py-3 text-right">Total</th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {purchases.map((purchase) => (
                    <tr key={purchase.id} className="hover:bg-hover">
                      <td className="px-4 py-3 text-muted">
                        {fmtDate(purchase.purchaseDate)}
                      </td>
                      <td className="px-4 py-3 font-medium text-ink">
                        {purchase.vendorName ?? "—"}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs">
                        {purchase.billNo ?? "—"}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {purchase.lineCount}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {Number(purchase.totalAmount).toLocaleString()}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          onClick={() => viewLines(purchase)}
                          className="text-xs font-medium text-brand-600 hover:text-brand-700"
                        >
                          View lines
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {canPurchase && (
          <Card className="h-fit">
            <h2 className="text-sm font-semibold text-ink">
              New purchase
            </h2>
            <p className="mt-1 text-sm text-muted">
              Records stock-in and increases item stock.
            </p>
            <div className="mt-4 space-y-3">
              <Field label="Vendor (optional)">
                <Select
                  value={vendorId}
                  onChange={(event) => setVendorId(event.target.value)}
                >
                  <option value="">— No vendor —</option>
                  {vendors.map((vendor) => (
                    <option key={vendor.id} value={vendor.id}>
                      {vendor.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Date">
                  <Input
                    type="date"
                    value={purchaseDate}
                    onChange={(event) => setPurchaseDate(event.target.value)}
                  />
                </Field>
                <Field label="Bill no">
                  <Input
                    value={billNo}
                    onChange={(event) => setBillNo(event.target.value)}
                  />
                </Field>
              </div>

              <div className="space-y-2">
                <span className="block text-sm font-medium text-ink">
                  Items
                </span>
                {lines.map((line, index) => (
                  <div
                    key={index}
                    className="space-y-2 rounded-lg border border-line p-3"
                  >
                    <Select
                      value={line.itemId}
                      onChange={(event) =>
                        updateLine(index, { itemId: event.target.value })
                      }
                    >
                      <option value="">Select an item…</option>
                      {items.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.name} ({item.code})
                        </option>
                      ))}
                    </Select>
                    <div className="grid grid-cols-2 gap-2">
                      <Input
                        type="number"
                        min={0}
                        step="0.01"
                        placeholder="Qty"
                        value={line.quantity}
                        onChange={(event) =>
                          updateLine(index, { quantity: event.target.value })
                        }
                      />
                      <Input
                        type="number"
                        min={0}
                        step="0.01"
                        placeholder="Rate"
                        value={line.rate}
                        onChange={(event) =>
                          updateLine(index, { rate: event.target.value })
                        }
                      />
                    </div>
                    <div className="flex items-center justify-between text-xs text-muted">
                      <span>
                        Amount: {lineAmount(line).toLocaleString()}
                      </span>
                      {lines.length > 1 && (
                        <button
                          onClick={() => removeLine(index)}
                          className="font-medium text-red-600 hover:text-red-700"
                        >
                          Remove
                        </button>
                      )}
                    </div>
                  </div>
                ))}
                <Button
                  type="button"
                  variant="secondary"
                  className="w-full"
                  onClick={addLine}
                >
                  + Add line
                </Button>
              </div>

              <Field label="Notes (optional)">
                <Textarea
                  rows={2}
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                />
              </Field>

              <div className="flex items-center justify-between border-t border-line pt-3 text-sm">
                <span className="font-medium text-ink">Total</span>
                <span className="text-lg font-semibold text-ink">
                  {total.toLocaleString()}
                </span>
              </div>

              <ErrorNote message={formError} />
              <Button
                type="button"
                className="w-full"
                onClick={onSubmit}
                disabled={saving}
              >
                {saving ? "Saving…" : "Record purchase"}
              </Button>
            </div>
          </Card>
        )}
      </div>

      <Modal
        title={`Purchase — ${detail?.vendorName ?? detail?.billNo ?? ""}`}
        open={detailOpen}
        onClose={() => setDetailOpen(false)}
      >
        {detailLoading ? (
          <Spinner />
        ) : detailError ? (
          <ErrorNote message={detailError} />
        ) : detail ? (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2 text-sm text-muted">
              <p>
                <span className="text-faint">Vendor: </span>
                {detail.vendorName ?? "—"}
              </p>
              <p>
                <span className="text-faint">Date: </span>
                {fmtDate(detail.purchaseDate)}
              </p>
              <p>
                <span className="text-faint">Bill no: </span>
                {detail.billNo ?? "—"}
              </p>
              <p>
                <span className="text-faint">Total: </span>
                {Number(detail.totalAmount).toLocaleString()}
              </p>
            </div>
            {detail.notes ? (
              <p className="text-sm text-muted">{detail.notes}</p>
            ) : null}
            {detail.items.length === 0 ? (
              <EmptyState message="No lines on this purchase" />
            ) : (
              <div className="overflow-x-auto rounded-xl border border-line">
                <table className="w-full text-left text-sm">
                  <thead className="border-b border-line bg-surface-2 text-xs uppercase text-muted">
                    <tr>
                      <th className="px-4 py-3">Item</th>
                      <th className="px-4 py-3 text-right">Qty</th>
                      <th className="px-4 py-3 text-right">Rate</th>
                      <th className="px-4 py-3 text-right">Amount</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {detail.items.map((line) => (
                      <tr key={line.id}>
                        <td className="px-4 py-3 text-ink">
                          {line.itemName}
                          {line.unit ? (
                            <span className="text-xs text-faint">
                              {" "}
                              ({line.unit})
                            </span>
                          ) : null}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums">
                          {Number(line.quantity).toLocaleString()}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums">
                          {line.rate === null
                            ? "—"
                            : Number(line.rate).toLocaleString()}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums">
                          {Number(line.amount).toLocaleString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ) : null}
      </Modal>
    </>
  );
}
