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
  Textarea,
} from "@/components/ui";
import type { InventoryItem, StockAdjustment } from "@/types";

const REASONS = ["damage", "lost", "correction"] as const;

function fmtDateTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function signed(value: number): string {
  return value > 0 ? `+${value}` : String(value);
}

export default function AdjustmentsPage() {
  const { can, loading: permsLoading } = usePermissions();
  const canAdjust = can("inventory:adjust");

  const [items, setItems] = useState<InventoryItem[]>([]);
  const [adjustments, setAdjustments] = useState<StockAdjustment[]>([]);
  const [itemFilter, setItemFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Form state.
  const [itemId, setItemId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [reason, setReason] = useState<string>("correction");
  const [note, setNote] = useState("");
  const [approvedBy, setApprovedBy] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const loadAdjustments = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const qs = itemFilter ? `?itemId=${encodeURIComponent(itemFilter)}` : "";
      setAdjustments(
        await api.get<StockAdjustment[]>(`/inventory/adjustments${qs}`)
      );
    } catch (err) {
      setLoadError(
        err instanceof ApiError ? err.message : "Failed to load adjustments"
      );
    } finally {
      setLoading(false);
    }
  }, [itemFilter]);

  useEffect(() => {
    loadAdjustments();
  }, [loadAdjustments]);

  const loadItems = useCallback(() => {
    api
      .get<InventoryItem[]>("/inventory/items")
      .then(setItems)
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    loadItems();
  }, [loadItems]);

  const selectedItem = items.find((item) => item.id === itemId) ?? null;

  const resetForm = () => {
    setItemId("");
    setQuantity("");
    setReason("correction");
    setNote("");
    setApprovedBy("");
  };

  const onSubmit = async () => {
    setFormError(null);
    if (!itemId) {
      setFormError("Select an item");
      return;
    }
    const qty = Number(quantity);
    if (!quantity || qty === 0 || !Number.isFinite(qty)) {
      setFormError("Enter a non-zero quantity (negative reduces stock)");
      return;
    }
    setSaving(true);
    try {
      await api.post("/inventory/adjustments", {
        itemId,
        quantity: qty,
        reason: reason || undefined,
        note: note || undefined,
        approvedBy: approvedBy || undefined,
      });
      resetForm();
      await Promise.all([loadAdjustments(), loadItems()]);
    } catch (err) {
      setFormError(
        err instanceof ApiError ? err.message : "Failed to record adjustment"
      );
    } finally {
      setSaving(false);
    }
  };

  if (permsLoading) {
    return (
      <>
        <PageHeader title="Stock adjustment" subtitle="Damage, loss & corrections" />
        <Spinner />
      </>
    );
  }

  if (!can("inventory:read")) {
    return (
      <>
        <PageHeader title="Stock adjustment" subtitle="Damage, loss & corrections" />
        <EmptyState message="You do not have access to inventory." />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Stock adjustment"
        subtitle="Damage, loss & corrections"
      />

      <div className="mb-4">
        <Link
          href="/inventory"
          className="text-sm font-medium text-brand-600 hover:text-brand-700"
        >
          ← Back to Inventory
        </Link>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
        <div>
          <div className="mb-4 w-64">
            <span className="mb-1 block text-sm font-medium text-ink">
              Filter by item
            </span>
            <Select
              value={itemFilter}
              onChange={(event) => setItemFilter(event.target.value)}
            >
              <option value="">All items</option>
              {items.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name} ({item.code})
                </option>
              ))}
            </Select>
          </div>

          {loading ? (
            <Spinner />
          ) : loadError ? (
            <ErrorNote message={loadError} />
          ) : adjustments.length === 0 ? (
            <EmptyState message="No adjustments recorded" />
          ) : (
            <div className="overflow-x-auto rounded-xl border border-line bg-surface">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-line bg-surface-2 text-xs uppercase text-muted">
                  <tr>
                    <th className="px-4 py-3">Date</th>
                    <th className="px-4 py-3">Item</th>
                    <th className="px-4 py-3 text-right">Qty</th>
                    <th className="px-4 py-3">Reason</th>
                    <th className="px-4 py-3">Note</th>
                    <th className="px-4 py-3">Approved by</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {adjustments.map((adjustment) => {
                    const qty = Number(adjustment.quantity);
                    return (
                      <tr key={adjustment.id} className="hover:bg-hover">
                        <td className="px-4 py-3 text-muted">
                          {fmtDateTime(adjustment.createdAt)}
                        </td>
                        <td className="px-4 py-3 font-medium text-ink">
                          {adjustment.itemName}
                        </td>
                        <td
                          className={
                            qty < 0
                              ? "px-4 py-3 text-right font-medium tabular-nums text-danger"
                              : "px-4 py-3 text-right font-medium tabular-nums text-success"
                          }
                        >
                          {signed(qty)}
                        </td>
                        <td className="px-4 py-3">
                          {adjustment.reason ? (
                            <Badge
                              tone={
                                adjustment.reason === "correction"
                                  ? "blue"
                                  : "amber"
                              }
                            >
                              {adjustment.reason}
                            </Badge>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className="px-4 py-3 text-muted">
                          {adjustment.note ?? "—"}
                        </td>
                        <td className="px-4 py-3">
                          {adjustment.approvedBy ?? "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {canAdjust && (
          <Card className="h-fit">
            <h2 className="text-sm font-semibold text-ink">
              New adjustment
            </h2>
            <p className="mt-1 text-sm text-muted">
              Use a negative quantity to reduce stock.
            </p>
            <div className="mt-4 space-y-3">
              <Field label="Item">
                <Select
                  value={itemId}
                  onChange={(event) => setItemId(event.target.value)}
                >
                  <option value="">Select an item…</option>
                  {items.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name} ({item.code}) — {item.currentStock}
                      {item.unit ? ` ${item.unit}` : ""}
                    </option>
                  ))}
                </Select>
              </Field>
              {selectedItem && (
                <p className="text-xs text-muted">
                  Current stock:{" "}
                  <span className="font-medium text-ink">
                    {selectedItem.currentStock}
                    {selectedItem.unit ? ` ${selectedItem.unit}` : ""}
                  </span>
                </p>
              )}
              <Field label="Quantity (signed)">
                <Input
                  type="number"
                  step="0.01"
                  placeholder="e.g. -5"
                  value={quantity}
                  onChange={(event) => setQuantity(event.target.value)}
                />
              </Field>
              <Field label="Reason">
                <Select
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                >
                  {REASONS.map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Note (optional)">
                <Textarea
                  rows={2}
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                />
              </Field>
              <Field label="Approved by (optional)">
                <Input
                  value={approvedBy}
                  onChange={(event) => setApprovedBy(event.target.value)}
                />
              </Field>
              <ErrorNote message={formError} />
              <Button
                type="button"
                className="w-full"
                onClick={onSubmit}
                disabled={saving}
              >
                {saving ? "Saving…" : "Record adjustment"}
              </Button>
            </div>
          </Card>
        )}
      </div>
    </>
  );
}
