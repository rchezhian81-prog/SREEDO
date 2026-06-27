"use client";

import { useCallback, useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import Link from "next/link";
import { api, ApiError } from "@/lib/api";
import { usePermissions } from "@/lib/use-permissions";
import {
  Badge,
  Button,
  EmptyState,
  ErrorNote,
  Field,
  Input,
  Modal,
  PageHeader,
  Select,
  Spinner,
} from "@/components/ui";
import type { FeeCategory, FeeDiscount } from "@/types";

const KINDS: { value: string; label: string }[] = [
  { value: "discount", label: "Discount" },
  { value: "scholarship", label: "Scholarship" },
];

const DISCOUNT_TYPES: { value: string; label: string }[] = [
  { value: "fixed", label: "Fixed" },
  { value: "percent", label: "Percent" },
];

const discountSchema = z.object({
  name: z.string().min(1, "Required"),
  kind: z.enum(["discount", "scholarship"]),
  discountType: z.enum(["fixed", "percent"]),
  value: z.coerce.number().positive("Must be positive"),
  categoryId: z.string().optional(),
});

type DiscountForm = z.infer<typeof discountSchema>;

function labelOf(
  options: { value: string; label: string }[],
  value: string
): string {
  return options.find((o) => o.value === value)?.label ?? value;
}

export default function FeeDiscountsPage() {
  const { can, loading: permsLoading } = usePermissions();
  const canApply = can("fee_discounts:apply");

  const [discounts, setDiscounts] = useState<FeeDiscount[]>([]);
  const [categories, setCategories] = useState<FeeCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      setDiscounts(await api.get<FeeDiscount[]>("/fees/discounts"));
    } catch (err) {
      setLoadError(
        err instanceof ApiError ? err.message : "Failed to load discounts"
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    api
      .get<FeeCategory[]>("/fees/categories")
      .then(setCategories)
      .catch(() => undefined);
  }, []);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<DiscountForm>({
    resolver: zodResolver(discountSchema),
    defaultValues: { kind: "discount", discountType: "fixed" },
  });

  const openCreate = () => {
    setFormError(null);
    reset({
      name: "",
      kind: "discount",
      discountType: "fixed",
      value: undefined,
      categoryId: "",
    });
    setModalOpen(true);
  };

  const onSubmit = async (values: DiscountForm) => {
    setFormError(null);
    const body = {
      name: values.name,
      kind: values.kind,
      discountType: values.discountType,
      value: values.value,
      categoryId: values.categoryId || undefined,
    };
    try {
      await api.post("/fees/discounts", body);
      setModalOpen(false);
      reset();
      await load();
    } catch (err) {
      setFormError(
        err instanceof ApiError ? err.message : "Failed to save discount"
      );
    }
  };

  if (!loading && !can("fee_discounts:read")) {
    return (
      <>
        <PageHeader title="Discounts" subtitle="Discounts & scholarships" />
        <EmptyState message="You don't have permission to view this page." />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Discounts"
        subtitle="Discounts & scholarships"
        action={
          canApply ? (
            <Button onClick={openCreate}>+ New discount</Button>
          ) : undefined
        }
      />

      <div className="mb-4">
        <Link
          href="/fees/setup"
          className="text-sm font-medium text-brand-600 hover:text-brand-700"
        >
          ← Back to Fee Setup
        </Link>
      </div>

      {loading || permsLoading ? (
        <Spinner />
      ) : loadError ? (
        <ErrorNote message={loadError} />
      ) : discounts.length === 0 ? (
        <EmptyState message="No discounts yet" />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Kind</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3 text-right">Value</th>
                <th className="px-4 py-3">Category</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {discounts.map((discount) => (
                <tr key={discount.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium text-slate-900">
                    {discount.name}
                  </td>
                  <td className="px-4 py-3">
                    <Badge
                      tone={discount.kind === "scholarship" ? "blue" : "slate"}
                    >
                      {labelOf(KINDS, discount.kind)}
                    </Badge>
                  </td>
                  <td className="px-4 py-3">
                    {labelOf(DISCOUNT_TYPES, discount.discountType)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {Number(discount.value).toLocaleString()}
                    {discount.discountType === "percent" ? "%" : ""}
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    {discount.categoryName ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal
        title="New discount"
        open={modalOpen}
        onClose={() => setModalOpen(false)}
      >
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <Field label="Name" error={errors.name?.message}>
            <Input placeholder="Sibling discount" {...register("name")} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Kind" error={errors.kind?.message}>
              <Select {...register("kind")}>
                {KINDS.map((kind) => (
                  <option key={kind.value} value={kind.value}>
                    {kind.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Discount type" error={errors.discountType?.message}>
              <Select {...register("discountType")}>
                {DISCOUNT_TYPES.map((type) => (
                  <option key={type.value} value={type.value}>
                    {type.label}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Value" error={errors.value?.message}>
              <Input type="number" step="0.01" {...register("value")} />
            </Field>
            <Field label="Category (optional)" error={errors.categoryId?.message}>
              <Select {...register("categoryId")}>
                <option value="">No category</option>
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <ErrorNote message={formError} />
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setModalOpen(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Saving…" : "Save discount"}
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
