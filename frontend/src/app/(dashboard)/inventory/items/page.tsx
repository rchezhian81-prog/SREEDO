"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api, ApiError } from "@/lib/api";
import { usePermissions } from "@/lib/use-permissions";
import {
  Badge,
  Button,
  ConfirmDialog,
  EmptyState,
  ErrorNote,
  Field,
  Input,
  Modal,
  PageHeader,
  Select,
  Spinner,
} from "@/components/ui";
import type { InventoryItem, ItemCategory, StockMovement } from "@/types";

function fmtDateTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function signed(value: number): string {
  return value > 0 ? `+${value}` : String(value);
}

export default function ItemsPage() {
  const { can, loading: permsLoading } = usePermissions();
  const canCreate = can("inventory:create");
  const canUpdate = can("inventory:update");
  const canDelete = can("inventory:delete");

  const [items, setItems] = useState<InventoryItem[]>([]);
  const [categories, setCategories] = useState<ItemCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Filters.
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [lowStockOnly, setLowStockOnly] = useState(false);

  // Item form state.
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<InventoryItem | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [unit, setUnit] = useState("");
  const [openingStock, setOpeningStock] = useState("");
  const [minStockLevel, setMinStockLevel] = useState("");
  const [location, setLocation] = useState("");

  // Movements modal.
  const [movementsItem, setMovementsItem] = useState<InventoryItem | null>(null);
  const [movements, setMovements] = useState<StockMovement[]>([]);
  const [movementsLoading, setMovementsLoading] = useState(false);
  const [movementsError, setMovementsError] = useState<string | null>(null);

  // Delete confirmation.
  const [pendingDelete, setPendingDelete] = useState<InventoryItem | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const params = new URLSearchParams();
      if (categoryFilter) params.set("categoryId", categoryFilter);
      if (search) params.set("search", search);
      if (lowStockOnly) params.set("lowStock", "true");
      const qs = params.toString();
      setItems(
        await api.get<InventoryItem[]>(
          `/inventory/items${qs ? `?${qs}` : ""}`
        )
      );
    } catch (err) {
      setLoadError(
        err instanceof ApiError ? err.message : "Failed to load items"
      );
    } finally {
      setLoading(false);
    }
  }, [categoryFilter, search, lowStockOnly]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    api
      .get<ItemCategory[]>("/inventory/categories")
      .then(setCategories)
      .catch(() => undefined);
  }, []);

  const openCreate = () => {
    setEditing(null);
    setFormError(null);
    setName("");
    setCode("");
    setCategoryId("");
    setUnit("");
    setOpeningStock("");
    setMinStockLevel("");
    setLocation("");
    setModalOpen(true);
  };

  const openEdit = (item: InventoryItem) => {
    setEditing(item);
    setFormError(null);
    setName(item.name);
    setCode(item.code);
    setCategoryId(item.categoryId ?? "");
    setUnit(item.unit ?? "");
    setOpeningStock(String(item.openingStock));
    setMinStockLevel(String(item.minStockLevel));
    setLocation(item.location ?? "");
    setModalOpen(true);
  };

  const onSubmit = async () => {
    setFormError(null);
    if (!name.trim()) {
      setFormError("Enter a name");
      return;
    }
    if (!code.trim()) {
      setFormError("Enter a code");
      return;
    }
    setSaving(true);
    try {
      if (editing) {
        // openingStock is immutable — never sent on update.
        await api.patch(`/inventory/items/${editing.id}`, {
          name: name.trim(),
          code: code.trim(),
          categoryId: categoryId || undefined,
          unit: unit || undefined,
          minStockLevel: minStockLevel === "" ? undefined : Number(minStockLevel),
          location: location || undefined,
        });
      } else {
        await api.post("/inventory/items", {
          name: name.trim(),
          code: code.trim(),
          categoryId: categoryId || undefined,
          unit: unit || undefined,
          openingStock: openingStock === "" ? undefined : Number(openingStock),
          minStockLevel: minStockLevel === "" ? undefined : Number(minStockLevel),
          location: location || undefined,
        });
      }
      setModalOpen(false);
      await load();
    } catch (err) {
      setFormError(
        err instanceof ApiError ? err.message : "Failed to save item"
      );
    } finally {
      setSaving(false);
    }
  };

  const confirmRemove = async () => {
    if (!pendingDelete) return;
    setDeleteError(null);
    setDeleting(true);
    try {
      await api.delete(`/inventory/items/${pendingDelete.id}`);
      setPendingDelete(null);
      await load();
    } catch (err) {
      setDeleteError(
        err instanceof ApiError ? err.message : "Failed to delete item"
      );
    } finally {
      setDeleting(false);
    }
  };

  const viewMovements = async (item: InventoryItem) => {
    setMovementsItem(item);
    setMovements([]);
    setMovementsError(null);
    setMovementsLoading(true);
    try {
      setMovements(
        await api.get<StockMovement[]>(`/inventory/items/${item.id}/movements`)
      );
    } catch (err) {
      setMovementsError(
        err instanceof ApiError ? err.message : "Failed to load movements"
      );
    } finally {
      setMovementsLoading(false);
    }
  };

  if (permsLoading) {
    return (
      <>
        <PageHeader title="Items" subtitle="Stock items & levels" />
        <Spinner />
      </>
    );
  }

  if (!can("inventory:read")) {
    return (
      <>
        <PageHeader title="Items" subtitle="Stock items & levels" />
        <EmptyState message="You do not have access to inventory." />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Items"
        subtitle="Stock items, levels & movements"
        action={
          canCreate ? <Button onClick={openCreate}>+ Add item</Button> : undefined
        }
      />

      <div className="mb-4">
        <Link
          href="/inventory"
          className="text-sm font-medium text-brand-600 hover:text-brand-700"
        >
          ← Back to Inventory
        </Link>
      </div>

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="w-64">
          <span className="mb-1 block text-sm font-medium text-ink">
            Search
          </span>
          <Input
            placeholder="Name or code…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        <div className="w-56">
          <span className="mb-1 block text-sm font-medium text-ink">
            Category
          </span>
          <Select
            value={categoryFilter}
            onChange={(event) => setCategoryFilter(event.target.value)}
          >
            <option value="">All categories</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </Select>
        </div>
        <label className="flex items-center gap-2 pb-2 text-sm font-medium text-ink">
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-line text-brand-600 focus:ring-brand-500"
            checked={lowStockOnly}
            onChange={(event) => setLowStockOnly(event.target.checked)}
          />
          Low stock only
        </label>
      </div>

      {loading ? (
        <Spinner />
      ) : loadError ? (
        <ErrorNote message={loadError} />
      ) : items.length === 0 ? (
        <EmptyState message="No items found" />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-line bg-surface">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-line bg-surface-2 text-xs uppercase text-muted">
              <tr>
                <th className="px-4 py-3">Code</th>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Category</th>
                <th className="px-4 py-3">Unit</th>
                <th className="px-4 py-3 text-right">Current stock</th>
                <th className="px-4 py-3 text-right">Min level</th>
                <th className="px-4 py-3">Location</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {items.map((item) => (
                <tr key={item.id} className="hover:bg-hover">
                  <td className="px-4 py-3 font-mono text-xs">{item.code}</td>
                  <td className="px-4 py-3 font-medium text-ink">
                    {item.name}
                  </td>
                  <td className="px-4 py-3">{item.categoryName ?? "—"}</td>
                  <td className="px-4 py-3">{item.unit ?? "—"}</td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    <span className="inline-flex items-center gap-2">
                      {item.currentStock}
                      {item.lowStock && <Badge tone="red">low</Badge>}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {item.minStockLevel}
                  </td>
                  <td className="px-4 py-3">{item.location ?? "—"}</td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex justify-end gap-3">
                      <button
                        onClick={() => viewMovements(item)}
                        className="text-xs font-medium text-brand-600 hover:text-brand-700"
                      >
                        Movements
                      </button>
                      {canUpdate && (
                        <button
                          onClick={() => openEdit(item)}
                          className="text-xs font-medium text-brand-600 hover:text-brand-700"
                        >
                          Edit
                        </button>
                      )}
                      {canDelete && (
                        <button
                          onClick={() => {
                            setDeleteError(null);
                            setPendingDelete(item);
                          }}
                          className="text-xs font-medium text-red-600 hover:text-red-700"
                        >
                          Delete
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
        title={editing ? "Edit item" : "Add item"}
        open={modalOpen}
        onClose={() => setModalOpen(false)}
      >
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Name">
              <Input
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </Field>
            <Field label="Code">
              <Input
                value={code}
                onChange={(event) => setCode(event.target.value)}
              />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Category">
              <Select
                value={categoryId}
                onChange={(event) => setCategoryId(event.target.value)}
              >
                <option value="">— No category —</option>
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Unit">
              <Input
                placeholder="e.g. pcs, kg"
                value={unit}
                onChange={(event) => setUnit(event.target.value)}
              />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {editing ? (
              <Field label="Opening stock">
                <Input
                  value={openingStock}
                  disabled
                  className="bg-surface-2 text-muted"
                />
              </Field>
            ) : (
              <Field label="Opening stock">
                <Input
                  type="number"
                  min={0}
                  value={openingStock}
                  onChange={(event) => setOpeningStock(event.target.value)}
                />
              </Field>
            )}
            <Field label="Min stock level">
              <Input
                type="number"
                min={0}
                value={minStockLevel}
                onChange={(event) => setMinStockLevel(event.target.value)}
              />
            </Field>
          </div>
          <Field label="Location">
            <Input
              placeholder="e.g. Store room A"
              value={location}
              onChange={(event) => setLocation(event.target.value)}
            />
          </Field>
          {editing && (
            <p className="text-xs text-faint">
              Opening stock is fixed after creation. Use Purchase, Issue and
              Adjustment to change current stock.
            </p>
          )}
          <ErrorNote message={formError} />
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setModalOpen(false)}
            >
              Cancel
            </Button>
            <Button type="button" onClick={onSubmit} disabled={saving}>
              {saving ? "Saving…" : "Save item"}
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        title={`Movements — ${movementsItem?.name ?? ""}`}
        open={movementsItem !== null}
        onClose={() => setMovementsItem(null)}
      >
        {movementsLoading ? (
          <Spinner />
        ) : movementsError ? (
          <ErrorNote message={movementsError} />
        ) : movements.length === 0 ? (
          <EmptyState message="No movements recorded" />
        ) : (
          <div className="overflow-x-auto rounded-xl border border-line">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-line bg-surface-2 text-xs uppercase text-muted">
                <tr>
                  <th className="px-4 py-3">Date</th>
                  <th className="px-4 py-3">Type</th>
                  <th className="px-4 py-3 text-right">Change</th>
                  <th className="px-4 py-3 text-right">Balance</th>
                  <th className="px-4 py-3">Note</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {movements.map((movement) => (
                  <tr key={movement.id}>
                    <td className="px-4 py-3 text-muted">
                      {fmtDateTime(movement.createdAt)}
                    </td>
                    <td className="px-4 py-3">{movement.type}</td>
                    <td
                      className={
                        movement.change < 0
                          ? "px-4 py-3 text-right font-medium tabular-nums text-danger"
                          : "px-4 py-3 text-right font-medium tabular-nums text-success"
                      }
                    >
                      {signed(movement.change)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-ink">
                      {movement.balanceAfter}
                    </td>
                    <td className="px-4 py-3 text-muted">
                      {movement.note ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Modal>

      <ConfirmDialog
        open={pendingDelete !== null}
        title="Delete item"
        message={
          <span className="space-y-2">
            <span className="block">
              Delete item <strong>{pendingDelete?.name}</strong>? This cannot be
              undone.
            </span>
            {deleteError && <ErrorNote message={deleteError} />}
          </span>
        }
        confirmLabel="Delete"
        busy={deleting}
        onConfirm={confirmRemove}
        onClose={() => setPendingDelete(null)}
      />
    </>
  );
}
