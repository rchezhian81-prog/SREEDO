"use client";

import { useCallback, useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { api, ApiError } from "@/lib/api";
import {
  Badge,
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
} from "@/components/ui";
import type { Institution, SubscriptionPackage } from "@/types";

const institutionSchema = z.object({
  name: z.string().min(1, "Required"),
  code: z
    .string()
    .min(2, "Min 2 chars")
    .regex(/^[A-Za-z0-9_-]+$/, "Letters, digits, - and _ only"),
  type: z.enum(["school", "college"]),
});
type InstitutionForm = z.infer<typeof institutionSchema>;

export default function SuperAdminInstitutionsPage() {
  const [institutions, setInstitutions] = useState<Institution[]>([]);
  const [packages, setPackages] = useState<SubscriptionPackage[]>([]);
  const [selected, setSelected] = useState<Institution | null>(null);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const [branchName, setBranchName] = useState("");
  const [branchAddress, setBranchAddress] = useState("");
  const [packageId, setPackageId] = useState("");
  const [panelError, setPanelError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setInstitutions(await api.get<Institution[]>("/institutions"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load().catch(() => setLoading(false));
    api.get<SubscriptionPackage[]>("/packages").then(setPackages).catch(() => undefined);
  }, [load]);

  const openDetail = useCallback(async (id: string) => {
    setPanelError(null);
    const detail = await api.get<Institution>(`/institutions/${id}`);
    setSelected(detail);
  }, []);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<InstitutionForm>({
    resolver: zodResolver(institutionSchema),
    defaultValues: { type: "school" },
  });

  const onCreate = async (values: InstitutionForm) => {
    setServerError(null);
    try {
      const created = await api.post<Institution>("/institutions", values);
      setModalOpen(false);
      reset({ name: "", code: "", type: "school" });
      await load();
      await openDetail(created.id);
    } catch (err) {
      setServerError(
        err instanceof ApiError ? err.message : "Failed to create institution"
      );
    }
  };

  const toggleActive = async () => {
    if (!selected) return;
    await api.patch(`/institutions/${selected.id}`, {
      isActive: !selected.isActive,
    });
    await load();
    await openDetail(selected.id);
  };

  const addBranch = async () => {
    if (!selected || !branchName.trim()) return;
    setPanelError(null);
    try {
      await api.post(`/institutions/${selected.id}/branches`, {
        name: branchName,
        address: branchAddress || undefined,
      });
      setBranchName("");
      setBranchAddress("");
      await openDetail(selected.id);
      await load();
    } catch (err) {
      setPanelError(err instanceof ApiError ? err.message : "Failed to add branch");
    }
  };

  const assignSubscription = async () => {
    if (!selected || !packageId) return;
    setPanelError(null);
    try {
      await api.post(`/institutions/${selected.id}/subscription`, {
        packageId,
        status: "active",
      });
      setPackageId("");
      await openDetail(selected.id);
    } catch (err) {
      setPanelError(
        err instanceof ApiError ? err.message : "Failed to assign subscription"
      );
    }
  };

  return (
    <>
      <PageHeader
        title="Institutions"
        subtitle={`${institutions.length} tenant${institutions.length === 1 ? "" : "s"}`}
        action={<Button onClick={() => setModalOpen(true)}>+ Add institution</Button>}
      />

      <div className="grid gap-6 lg:grid-cols-5">
        <div className="lg:col-span-3">
          {loading ? (
            <Spinner />
          ) : institutions.length === 0 ? (
            <EmptyState message="No institutions yet" />
          ) : (
            <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-4 py-3">Name</th>
                    <th className="px-4 py-3">Code</th>
                    <th className="px-4 py-3">Type</th>
                    <th className="px-4 py-3">Branches</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {institutions.map((inst) => (
                    <tr
                      key={inst.id}
                      className={selected?.id === inst.id ? "bg-brand-50" : "hover:bg-slate-50"}
                    >
                      <td className="px-4 py-3 font-medium text-slate-900">{inst.name}</td>
                      <td className="px-4 py-3 font-mono text-xs">{inst.code}</td>
                      <td className="px-4 py-3 capitalize">{inst.type}</td>
                      <td className="px-4 py-3">{inst.branchCount ?? 0}</td>
                      <td className="px-4 py-3">
                        <Badge tone={inst.isActive ? "green" : "slate"}>
                          {inst.isActive ? "active" : "inactive"}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Button variant="secondary" onClick={() => openDetail(inst.id)}>
                          Manage
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="lg:col-span-2">
          {selected ? (
            <Card>
              <div className="mb-3 flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-semibold text-slate-900">{selected.name}</h2>
                  <p className="font-mono text-xs text-slate-500">{selected.code}</p>
                </div>
                <Button variant="secondary" onClick={toggleActive}>
                  {selected.isActive ? "Deactivate" : "Activate"}
                </Button>
              </div>

              <ErrorNote message={panelError} />

              <div className="mt-4">
                <h3 className="mb-2 text-sm font-semibold text-slate-700">Subscription</h3>
                {selected.subscription ? (
                  <p className="text-sm text-slate-600">
                    <Badge tone="blue">{selected.subscription.packageName}</Badge>{" "}
                    <span className="capitalize">{selected.subscription.status}</span>
                  </p>
                ) : (
                  <p className="text-sm text-slate-400">No active subscription</p>
                )}
                <div className="mt-2 flex gap-2">
                  <Select value={packageId} onChange={(e) => setPackageId(e.target.value)}>
                    <option value="">Choose package…</option>
                    {packages.map((pkg) => (
                      <option key={pkg.id} value={pkg.id}>
                        {pkg.name}
                      </option>
                    ))}
                  </Select>
                  <Button onClick={assignSubscription} disabled={!packageId}>
                    Assign
                  </Button>
                </div>
              </div>

              <div className="mt-6">
                <h3 className="mb-2 text-sm font-semibold text-slate-700">
                  Branches ({selected.branches?.length ?? 0})
                </h3>
                <ul className="mb-3 space-y-1 text-sm text-slate-600">
                  {(selected.branches ?? []).map((branch) => (
                    <li key={branch.id} className="flex justify-between">
                      <span>{branch.name}</span>
                      <span className="text-xs text-slate-400">{branch.timezone}</span>
                    </li>
                  ))}
                  {(selected.branches?.length ?? 0) === 0 && (
                    <li className="text-slate-400">No branches yet</li>
                  )}
                </ul>
                <div className="space-y-2">
                  <Input
                    placeholder="Branch name"
                    value={branchName}
                    onChange={(e) => setBranchName(e.target.value)}
                  />
                  <Input
                    placeholder="Address (optional)"
                    value={branchAddress}
                    onChange={(e) => setBranchAddress(e.target.value)}
                  />
                  <Button onClick={addBranch} disabled={!branchName.trim()}>
                    + Add branch
                  </Button>
                </div>
              </div>
            </Card>
          ) : (
            <Card>
              <p className="text-sm text-slate-500">
                Select an institution to manage its branches and subscription.
              </p>
            </Card>
          )}
        </div>
      </div>

      <Modal title="Add institution" open={modalOpen} onClose={() => setModalOpen(false)}>
        <form onSubmit={handleSubmit(onCreate)} className="space-y-4">
          <Field label="Name" error={errors.name?.message}>
            <Input placeholder="e.g. Greenwood High" {...register("name")} />
          </Field>
          <Field label="Code" error={errors.code?.message}>
            <Input placeholder="e.g. GRNWD" {...register("code")} />
          </Field>
          <Field label="Type" error={errors.type?.message}>
            <Select {...register("type")}>
              <option value="school">School</option>
              <option value="college">College</option>
            </Select>
          </Field>
          <ErrorNote message={serverError} />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setModalOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Saving…" : "Create institution"}
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
