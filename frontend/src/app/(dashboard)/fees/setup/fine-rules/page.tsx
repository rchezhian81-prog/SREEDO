"use client";

import { useCallback, useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import Link from "next/link";
import { api, ApiError } from "@/lib/api";
import { usePermissions } from "@/lib/use-permissions";
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
} from "@/components/ui";
import type { FeeCategory, FineRule } from "@/types";

const FINE_TYPES: { value: string; label: string }[] = [
  { value: "fixed", label: "Fixed" },
  { value: "per_day", label: "Per day" },
  { value: "percent", label: "Percent" },
];

const fineRuleSchema = z.object({
  name: z.string().min(1, "Required"),
  fineType: z.enum(["fixed", "per_day", "percent"]),
  amount: z.coerce.number().positive("Must be positive"),
  graceDays: z.coerce.number().int().min(0).optional(),
  categoryId: z.string().optional(),
});

type FineRuleForm = z.infer<typeof fineRuleSchema>;

function fineTypeLabel(value: string): string {
  return FINE_TYPES.find((t) => t.value === value)?.label ?? value;
}

export default function FineRulesPage() {
  const { can, loading: permsLoading } = usePermissions();
  const canApply = can("fee_fines:apply");

  const [rules, setRules] = useState<FineRule[]>([]);
  const [categories, setCategories] = useState<FeeCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [applying, setApplying] = useState(false);
  const [resultNote, setResultNote] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      setRules(await api.get<FineRule[]>("/fees/fine-rules"));
    } catch (err) {
      setLoadError(
        err instanceof ApiError ? err.message : "Failed to load fine rules"
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
  } = useForm<FineRuleForm>({
    resolver: zodResolver(fineRuleSchema),
    defaultValues: { fineType: "fixed" },
  });

  const openCreate = () => {
    setFormError(null);
    reset({
      name: "",
      fineType: "fixed",
      amount: undefined,
      graceDays: undefined,
      categoryId: "",
    });
    setModalOpen(true);
  };

  const onSubmit = async (values: FineRuleForm) => {
    setFormError(null);
    const body = {
      name: values.name,
      fineType: values.fineType,
      amount: values.amount,
      graceDays: values.graceDays ?? undefined,
      categoryId: values.categoryId || undefined,
    };
    try {
      await api.post("/fees/fine-rules", body);
      setModalOpen(false);
      reset();
      await load();
    } catch (err) {
      setFormError(
        err instanceof ApiError ? err.message : "Failed to save fine rule"
      );
    }
  };

  const applyOverdue = async () => {
    setResultNote(null);
    setActionError(null);
    setApplying(true);
    try {
      const res = await api.post<{ applied: number }>(
        "/fees/fines/apply-overdue"
      );
      setResultNote(
        `Applied fines to ${res.applied} overdue invoice${res.applied === 1 ? "" : "s"}.`
      );
    } catch (err) {
      setActionError(
        err instanceof ApiError ? err.message : "Failed to apply fines"
      );
    } finally {
      setApplying(false);
    }
  };

  if (!loading && !can("fee_fines:read")) {
    return (
      <>
        <PageHeader title="Fine rules" subtitle="Late-payment fines" />
        <EmptyState message="You don't have permission to view this page." />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Fine rules"
        subtitle="Late-payment fines & overdue application"
        action={
          <div className="flex gap-2">
            {canApply && (
              <Button
                variant="secondary"
                onClick={applyOverdue}
                disabled={applying}
              >
                {applying ? "Applying…" : "Apply to overdue invoices"}
              </Button>
            )}
            {canApply && <Button onClick={openCreate}>+ New rule</Button>}
          </div>
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

      {resultNote && (
        <p className="mb-4 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          {resultNote}
        </p>
      )}
      {actionError && (
        <div className="mb-4">
          <ErrorNote message={actionError} />
        </div>
      )}

      {loading || permsLoading ? (
        <Spinner />
      ) : loadError ? (
        <ErrorNote message={loadError} />
      ) : rules.length === 0 ? (
        <EmptyState message="No fine rules yet" />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3 text-right">Amount</th>
                <th className="px-4 py-3 text-right">Grace days</th>
                <th className="px-4 py-3">Category</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rules.map((rule) => (
                <tr key={rule.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium text-slate-900">
                    {rule.name}
                  </td>
                  <td className="px-4 py-3">{fineTypeLabel(rule.fineType)}</td>
                  <td className="px-4 py-3 text-right">
                    {Number(rule.amount).toLocaleString()}
                    {rule.fineType === "percent" ? "%" : ""}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {rule.graceDays ?? 0}
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    {rule.categoryName ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal
        title="New fine rule"
        open={modalOpen}
        onClose={() => setModalOpen(false)}
      >
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <Field label="Name" error={errors.name?.message}>
            <Input placeholder="Late fee" {...register("name")} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Fine type" error={errors.fineType?.message}>
              <Select {...register("fineType")}>
                {FINE_TYPES.map((type) => (
                  <option key={type.value} value={type.value}>
                    {type.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Amount" error={errors.amount?.message}>
              <Input type="number" step="0.01" {...register("amount")} />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Grace days (optional)" error={errors.graceDays?.message}>
              <Input type="number" min={0} step="1" {...register("graceDays")} />
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
              {isSubmitting ? "Saving…" : "Save rule"}
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
