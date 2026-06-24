"use client";

import { useCallback, useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { api, ApiError } from "@/lib/api";
import {
  Button,
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
import type { Paginated } from "@/types";

const STATUSES = ["open", "claimed", "returned", "closed"] as const;

interface Item {
  id: string;
  type: "lost" | "found";
  title: string;
  description: string | null;
  location: string | null;
  status: (typeof STATUSES)[number];
  reporterName: string | null;
  itemDate: string;
}

const itemSchema = z.object({
  type: z.enum(["lost", "found"]),
  title: z.string().min(1, "Required"),
  description: z.string().optional(),
  location: z.string().optional(),
  reporterName: z.string().optional(),
  reporterContact: z.string().optional(),
});
type ItemForm = z.infer<typeof itemSchema>;

export default function LostFoundPage() {
  const [rows, setRows] = useState<Item[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [typeFilter, setTypeFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);

  const limit = 15;

  const load = useCallback(async () => {
    setLoading(true);
    setRowError(null);
    try {
      const params = new URLSearchParams({ page: String(page), limit: String(limit) });
      if (typeFilter) params.set("type", typeFilter);
      if (statusFilter) params.set("status", statusFilter);
      if (search) params.set("search", search);
      const result = await api.get<Paginated<Item>>(`/lost-found?${params.toString()}`);
      setRows(result.data);
      setTotal(result.meta.total);
    } finally {
      setLoading(false);
    }
  }, [page, typeFilter, statusFilter, search]);

  useEffect(() => {
    load().catch(() => setLoading(false));
  }, [load]);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<ItemForm>({ resolver: zodResolver(itemSchema), defaultValues: { type: "found" } });

  const onSubmit = async (values: ItemForm) => {
    setServerError(null);
    try {
      await api.post("/lost-found", values);
      setModalOpen(false);
      reset({ type: "found" });
      await load();
    } catch (err) {
      setServerError(err instanceof ApiError ? err.message : "Failed to save");
    }
  };

  const setStatus = async (item: Item, status: string) => {
    setRowError(null);
    try {
      await api.patch(`/lost-found/${item.id}`, { status });
      await load();
    } catch (err) {
      setRowError(err instanceof ApiError ? err.message : "Failed to update");
    }
  };

  const removeItem = async (item: Item) => {
    if (!confirm(`Delete "${item.title}"?`)) return;
    setRowError(null);
    try {
      await api.delete(`/lost-found/${item.id}`);
      await load();
    } catch (err) {
      setRowError(err instanceof ApiError ? err.message : "Failed to delete");
    }
  };

  const totalPages = Math.max(1, Math.ceil(total / limit));

  return (
    <>
      <PageHeader
        title="Lost & Found"
        subtitle="Register of lost and found items"
        action={<Button onClick={() => setModalOpen(true)}>+ Log item</Button>}
      />

      <div className="mb-4 flex flex-wrap gap-3">
        <div className="w-56">
          <Input
            placeholder="Search title, description…"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
        </div>
        <div className="w-36">
          <Select value={typeFilter} onChange={(e) => { setTypeFilter(e.target.value); setPage(1); }}>
            <option value="">All types</option>
            <option value="lost">Lost</option>
            <option value="found">Found</option>
          </Select>
        </div>
        <div className="w-36">
          <Select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}>
            <option value="">All statuses</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s[0].toUpperCase() + s.slice(1)}
              </option>
            ))}
          </Select>
        </div>
      </div>

      <ErrorNote message={rowError} />

      {loading ? (
        <Spinner />
      ) : rows.length === 0 ? (
        <EmptyState message="No items logged" />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-line bg-surface">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-line bg-surface-2 text-xs uppercase text-muted">
              <tr>
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Item</th>
                <th className="px-4 py-3">Location</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((item) => (
                <tr key={item.id} className="hover:bg-surface-2">
                  <td className="whitespace-nowrap px-4 py-3 text-muted">{item.itemDate}</td>
                  <td className="px-4 py-3 capitalize text-muted">{item.type}</td>
                  <td className="px-4 py-3 font-medium text-ink">{item.title}</td>
                  <td className="px-4 py-3 text-muted">{item.location ?? "—"}</td>
                  <td className="px-4 py-3">
                    <Select value={item.status} onChange={(e) => setStatus(item, e.target.value)}>
                      {STATUSES.map((s) => (
                        <option key={s} value={s}>
                          {s[0].toUpperCase() + s.slice(1)}
                        </option>
                      ))}
                    </Select>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => removeItem(item)}
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
          <span className="text-muted">Page {page} of {totalPages}</span>
          <Button variant="secondary" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>
            Next
          </Button>
        </div>
      )}

      <Modal title="Log item" open={modalOpen} onClose={() => setModalOpen(false)}>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Type" error={errors.type?.message}>
              <Select {...register("type")}>
                <option value="found">Found</option>
                <option value="lost">Lost</option>
              </Select>
            </Field>
            <Field label="Location">
              <Input {...register("location")} />
            </Field>
          </div>
          <Field label="Item" error={errors.title?.message}>
            <Input {...register("title")} />
          </Field>
          <Field label="Description">
            <Textarea rows={2} {...register("description")} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Reporter name">
              <Input {...register("reporterName")} />
            </Field>
            <Field label="Reporter contact">
              <Input {...register("reporterContact")} />
            </Field>
          </div>
          <ErrorNote message={serverError} />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setModalOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Saving…" : "Save"}
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
