"use client";

import { useCallback, useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { api, ApiError } from "@/lib/api";
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
import type { SubscriptionPackage } from "@/types";

const optionalCount = z.preprocess(
  (v) => (v === "" || v === undefined || v === null ? undefined : v),
  z.coerce.number().int().nonnegative().optional()
);

const packageSchema = z.object({
  name: z.string().min(1, "Required"),
  price: z.coerce.number().nonnegative("Must be ≥ 0"),
  billingCycle: z.enum(["monthly", "quarterly", "annual"]),
  maxStudents: optionalCount,
  maxStaff: optionalCount,
});
type PackageForm = z.infer<typeof packageSchema>;

export default function SuperAdminPackagesPage() {
  const [packages, setPackages] = useState<SubscriptionPackage[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setPackages(await api.get<SubscriptionPackage[]>("/packages"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load().catch(() => setLoading(false));
  }, [load]);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<PackageForm>({
    resolver: zodResolver(packageSchema),
    defaultValues: { billingCycle: "annual" },
  });

  const onCreate = async (values: PackageForm) => {
    setServerError(null);
    try {
      await api.post("/packages", {
        name: values.name,
        price: values.price,
        billingCycle: values.billingCycle,
        maxStudents: values.maxStudents ?? undefined,
        maxStaff: values.maxStaff ?? undefined,
      });
      setModalOpen(false);
      reset({ billingCycle: "annual" });
      await load();
    } catch (err) {
      setServerError(
        err instanceof ApiError ? err.message : "Failed to create package"
      );
    }
  };

  return (
    <>
      <PageHeader
        title="Subscription packages"
        subtitle={`${packages.length} package${packages.length === 1 ? "" : "s"}`}
        action={<Button onClick={() => setModalOpen(true)}>+ Add package</Button>}
      />

      {loading ? (
        <Spinner />
      ) : packages.length === 0 ? (
        <EmptyState message="No packages yet" />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-line bg-surface">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-line bg-surface-2 text-xs uppercase text-muted">
              <tr>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Price</th>
                <th className="px-4 py-3">Billing</th>
                <th className="px-4 py-3">Max students</th>
                <th className="px-4 py-3">Max staff</th>
                <th className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {packages.map((pkg) => (
                <tr key={pkg.id} className="hover:bg-surface-2">
                  <td className="px-4 py-3 font-medium text-ink">{pkg.name}</td>
                  <td className="px-4 py-3">{Number(pkg.price).toLocaleString()}</td>
                  <td className="px-4 py-3 capitalize">{pkg.billingCycle}</td>
                  <td className="px-4 py-3">{pkg.maxStudents ?? "∞"}</td>
                  <td className="px-4 py-3">{pkg.maxStaff ?? "∞"}</td>
                  <td className="px-4 py-3">
                    <Badge tone={pkg.isActive ? "green" : "slate"}>
                      {pkg.isActive ? "active" : "inactive"}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal title="Add package" open={modalOpen} onClose={() => setModalOpen(false)}>
        <form onSubmit={handleSubmit(onCreate)} className="space-y-4">
          <Field label="Name" error={errors.name?.message}>
            <Input placeholder="e.g. Standard" {...register("name")} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Price" error={errors.price?.message}>
              <Input type="number" min={0} step="0.01" {...register("price")} />
            </Field>
            <Field label="Billing cycle" error={errors.billingCycle?.message}>
              <Select {...register("billingCycle")}>
                <option value="monthly">Monthly</option>
                <option value="quarterly">Quarterly</option>
                <option value="annual">Annual</option>
              </Select>
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Max students" error={errors.maxStudents?.message}>
              <Input type="number" min={0} placeholder="∞" {...register("maxStudents")} />
            </Field>
            <Field label="Max staff" error={errors.maxStaff?.message}>
              <Input type="number" min={0} placeholder="∞" {...register("maxStaff")} />
            </Field>
          </div>
          <ErrorNote message={serverError} />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setModalOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Saving…" : "Create package"}
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
