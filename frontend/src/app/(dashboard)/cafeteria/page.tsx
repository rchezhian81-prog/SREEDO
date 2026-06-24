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

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MEALS = ["breakfast", "lunch", "snacks", "dinner"] as const;

interface MenuItem {
  id: string;
  dayOfWeek: number;
  meal: string;
  items: string;
  notes: string | null;
}

const menuSchema = z.object({
  dayOfWeek: z.coerce.number().int().min(0).max(6),
  meal: z.enum(MEALS),
  items: z.string().min(1, "Required"),
  notes: z.string().optional(),
});
type MenuForm = z.infer<typeof menuSchema>;

export default function CafeteriaPage() {
  const [rows, setRows] = useState<MenuItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [day, setDay] = useState("");
  const [meal, setMeal] = useState("");
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);

  const limit = 20;

  const load = useCallback(async () => {
    setLoading(true);
    setRowError(null);
    try {
      const params = new URLSearchParams({ page: String(page), limit: String(limit) });
      if (day !== "") params.set("dayOfWeek", day);
      if (meal) params.set("meal", meal);
      const result = await api.get<Paginated<MenuItem>>(`/cafeteria/menu?${params.toString()}`);
      setRows(result.data);
      setTotal(result.meta.total);
    } finally {
      setLoading(false);
    }
  }, [page, day, meal]);

  useEffect(() => {
    load().catch(() => setLoading(false));
  }, [load]);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<MenuForm>({
    resolver: zodResolver(menuSchema),
    defaultValues: { dayOfWeek: 1, meal: "breakfast" },
  });

  const onSubmit = async (values: MenuForm) => {
    setServerError(null);
    try {
      await api.post("/cafeteria/menu", values);
      setModalOpen(false);
      reset({ dayOfWeek: 1, meal: "breakfast" });
      await load();
    } catch (err) {
      setServerError(err instanceof ApiError ? err.message : "Failed to save");
    }
  };

  const removeRow = async (m: MenuItem) => {
    if (!confirm(`Delete ${DAYS[m.dayOfWeek]} ${m.meal}?`)) return;
    setRowError(null);
    try {
      await api.delete(`/cafeteria/menu/${m.id}`);
      await load();
    } catch (err) {
      setRowError(err instanceof ApiError ? err.message : "Failed to delete");
    }
  };

  const totalPages = Math.max(1, Math.ceil(total / limit));

  return (
    <>
      <PageHeader
        title="Cafeteria"
        subtitle="Weekly mess menu"
        action={<Button onClick={() => setModalOpen(true)}>+ Add menu item</Button>}
      />

      <div className="mb-4 flex flex-wrap gap-3">
        <div className="w-44">
          <Select
            value={day}
            onChange={(e) => {
              setDay(e.target.value);
              setPage(1);
            }}
          >
            <option value="">All days</option>
            {DAYS.map((d, i) => (
              <option key={d} value={i}>
                {d}
              </option>
            ))}
          </Select>
        </div>
        <div className="w-44">
          <Select
            value={meal}
            onChange={(e) => {
              setMeal(e.target.value);
              setPage(1);
            }}
          >
            <option value="">All meals</option>
            {MEALS.map((m) => (
              <option key={m} value={m}>
                {m[0].toUpperCase() + m.slice(1)}
              </option>
            ))}
          </Select>
        </div>
      </div>

      <ErrorNote message={rowError} />

      {loading ? (
        <Spinner />
      ) : rows.length === 0 ? (
        <EmptyState message="No menu items yet" />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-line bg-surface">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-line bg-surface-2 text-xs uppercase text-muted">
              <tr>
                <th className="px-4 py-3">Day</th>
                <th className="px-4 py-3">Meal</th>
                <th className="px-4 py-3">Items</th>
                <th className="px-4 py-3">Notes</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((m) => (
                <tr key={m.id} className="hover:bg-surface-2">
                  <td className="whitespace-nowrap px-4 py-3 text-muted">{DAYS[m.dayOfWeek]}</td>
                  <td className="px-4 py-3 capitalize text-ink">{m.meal}</td>
                  <td className="px-4 py-3 text-ink">{m.items}</td>
                  <td className="px-4 py-3 text-muted">{m.notes ?? "—"}</td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => removeRow(m)}
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

      <Modal title="Add menu item" open={modalOpen} onClose={() => setModalOpen(false)}>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Day" error={errors.dayOfWeek?.message}>
              <Select {...register("dayOfWeek")}>
                {DAYS.map((d, i) => (
                  <option key={d} value={i}>
                    {d}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Meal" error={errors.meal?.message}>
              <Select {...register("meal")}>
                {MEALS.map((m) => (
                  <option key={m} value={m}>
                    {m[0].toUpperCase() + m.slice(1)}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <Field label="Items" error={errors.items?.message}>
            <Textarea rows={2} placeholder="e.g. Rice, Dal, Mixed veg, Curd" {...register("items")} />
          </Field>
          <Field label="Notes">
            <Input placeholder="Optional (e.g. special / festival menu)" {...register("notes")} />
          </Field>
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
