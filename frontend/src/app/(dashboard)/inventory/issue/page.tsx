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
  PageHeader,
  Select,
  Spinner,
  Textarea,
} from "@/components/ui";
import type { InventoryItem, StockIssue } from "@/types";

const ISSUED_TO_TYPES = ["staff", "department", "student", "other"] as const;

function fmtDate(value: string | null): string {
  if (!value) return "—";
  return value.slice(0, 10);
}

export default function IssuePage() {
  const { can, loading: permsLoading } = usePermissions();
  const canIssue = can("inventory:issue");

  const [items, setItems] = useState<InventoryItem[]>([]);
  const [issues, setIssues] = useState<StockIssue[]>([]);
  const [itemFilter, setItemFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Form state.
  const [itemId, setItemId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [issuedToType, setIssuedToType] = useState<string>("staff");
  const [issuedTo, setIssuedTo] = useState("");
  const [purpose, setPurpose] = useState("");
  const [receivedBy, setReceivedBy] = useState("");
  const [issueDate, setIssueDate] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const loadIssues = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const qs = itemFilter ? `?itemId=${encodeURIComponent(itemFilter)}` : "";
      setIssues(await api.get<StockIssue[]>(`/inventory/issues${qs}`));
    } catch (err) {
      setLoadError(
        err instanceof ApiError ? err.message : "Failed to load issues"
      );
    } finally {
      setLoading(false);
    }
  }, [itemFilter]);

  useEffect(() => {
    loadIssues();
  }, [loadIssues]);

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
    setIssuedToType("staff");
    setIssuedTo("");
    setPurpose("");
    setReceivedBy("");
    setIssueDate("");
  };

  const onSubmit = async () => {
    setFormError(null);
    if (!itemId) {
      setFormError("Select an item");
      return;
    }
    if (!quantity || Number(quantity) <= 0) {
      setFormError("Enter a quantity");
      return;
    }
    setSaving(true);
    try {
      await api.post("/inventory/issues", {
        itemId,
        quantity: Number(quantity),
        issuedToType: issuedToType || undefined,
        issuedTo: issuedTo || undefined,
        purpose: purpose || undefined,
        receivedBy: receivedBy || undefined,
        issueDate: issueDate || undefined,
      });
      resetForm();
      await Promise.all([loadIssues(), loadItems()]);
    } catch (err) {
      setFormError(
        err instanceof ApiError ? err.message : "Failed to record issue"
      );
    } finally {
      setSaving(false);
    }
  };

  if (permsLoading) {
    return (
      <>
        <PageHeader title="Stock issue" subtitle="Stock-out" />
        <Spinner />
      </>
    );
  }

  if (!can("inventory:read")) {
    return (
      <>
        <PageHeader title="Stock issue" subtitle="Stock-out" />
        <EmptyState message="You do not have access to inventory." />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Stock issue"
        subtitle="Issue stock to staff & departments"
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
          ) : issues.length === 0 ? (
            <EmptyState message="No issues recorded" />
          ) : (
            <div className="overflow-x-auto rounded-xl border border-line bg-surface">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-line bg-surface-2 text-xs uppercase text-muted">
                  <tr>
                    <th className="px-4 py-3">Date</th>
                    <th className="px-4 py-3">Item</th>
                    <th className="px-4 py-3 text-right">Qty</th>
                    <th className="px-4 py-3">Issued to</th>
                    <th className="px-4 py-3">Purpose</th>
                    <th className="px-4 py-3">Received by</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {issues.map((issue) => (
                    <tr key={issue.id} className="hover:bg-hover">
                      <td className="px-4 py-3 text-muted">
                        {fmtDate(issue.issueDate)}
                      </td>
                      <td className="px-4 py-3 font-medium text-ink">
                        {issue.itemName}
                        {issue.unit ? (
                          <span className="text-xs text-faint">
                            {" "}
                            ({issue.unit})
                          </span>
                        ) : null}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {Number(issue.quantity).toLocaleString()}
                      </td>
                      <td className="px-4 py-3">
                        {issue.issuedTo ?? "—"}
                        {issue.issuedToType ? (
                          <span className="block text-xs text-faint">
                            {issue.issuedToType}
                          </span>
                        ) : null}
                      </td>
                      <td className="px-4 py-3">{issue.purpose ?? "—"}</td>
                      <td className="px-4 py-3">{issue.receivedBy ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {canIssue && (
          <Card className="h-fit">
            <h2 className="text-sm font-semibold text-ink">Issue stock</h2>
            <p className="mt-1 text-sm text-muted">
              Records stock-out and decreases item stock.
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
              <Field label="Quantity">
                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  value={quantity}
                  onChange={(event) => setQuantity(event.target.value)}
                />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Issued to type">
                  <Select
                    value={issuedToType}
                    onChange={(event) => setIssuedToType(event.target.value)}
                  >
                    {ISSUED_TO_TYPES.map((type) => (
                      <option key={type} value={type}>
                        {type}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Issued to">
                  <Input
                    placeholder="Name / dept"
                    value={issuedTo}
                    onChange={(event) => setIssuedTo(event.target.value)}
                  />
                </Field>
              </div>
              <Field label="Purpose">
                <Input
                  value={purpose}
                  onChange={(event) => setPurpose(event.target.value)}
                />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Received by">
                  <Input
                    value={receivedBy}
                    onChange={(event) => setReceivedBy(event.target.value)}
                  />
                </Field>
                <Field label="Date">
                  <Input
                    type="date"
                    value={issueDate}
                    onChange={(event) => setIssueDate(event.target.value)}
                  />
                </Field>
              </div>
              <ErrorNote message={formError} />
              <Button
                type="button"
                className="w-full"
                onClick={onSubmit}
                disabled={saving}
              >
                {saving ? "Saving…" : "Issue stock"}
              </Button>
            </div>
          </Card>
        )}
      </div>
    </>
  );
}
