"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import {
  Badge,
  Button,
  Card,
  ErrorNote,
  Field,
  Input,
  PageHeader,
  Select,
  Spinner,
} from "@/components/ui";
import type {
  PlatformInstitutionDetail,
  SubscriptionPackage,
} from "@/types";
import { usePlatformGuard } from "../../_guard";
import { formatNumber, limitLabel } from "../../_utils";

function StatTile({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-4 py-3">
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <p className="mt-1 text-xl font-semibold text-slate-900">{value}</p>
    </div>
  );
}

export default function PlatformInstitutionDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const { ready, gate } = usePlatformGuard("Institution", "Tenant management");

  const [detail, setDetail] = useState<PlatformInstitutionDetail | null>(null);
  const [packages, setPackages] = useState<SubscriptionPackage[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Edit profile form state.
  const [editName, setEditName] = useState("");
  const [editType, setEditType] = useState<"school" | "college">("school");

  // Subscription form state.
  const [packageId, setPackageId] = useState("");
  const [subStatus, setSubStatus] = useState("active");

  // Limits form state (string-backed for empty handling).
  const [maxStudents, setMaxStudents] = useState("");
  const [maxStaff, setMaxStaff] = useState("");
  const [maxBranches, setMaxBranches] = useState("");
  const [storageLimitMb, setStorageLimitMb] = useState("");
  const [reportsQuota, setReportsQuota] = useState("");

  const syncForms = useCallback((d: PlatformInstitutionDetail) => {
    setEditName(d.name);
    setEditType(d.type);
    const l = d.limits;
    setMaxStudents(l?.maxStudents != null ? String(l.maxStudents) : "");
    setMaxStaff(l?.maxStaff != null ? String(l.maxStaff) : "");
    setMaxBranches(l?.maxBranches != null ? String(l.maxBranches) : "");
    setStorageLimitMb(
      l?.storageLimitMb != null ? String(l.storageLimitMb) : ""
    );
    setReportsQuota(l?.reportsQuota != null ? String(l.reportsQuota) : "");
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const d = await api.get<PlatformInstitutionDetail>(
        `/platform/institutions/${id}`
      );
      setDetail(d);
      syncForms(d);
    } catch (err) {
      setDetail(null);
      if (err instanceof ApiError && err.status === 404) {
        setLoadError("This institution could not be found.");
      } else {
        setLoadError(
          err instanceof ApiError ? err.message : "Failed to load institution"
        );
      }
    } finally {
      setLoading(false);
    }
  }, [id, syncForms]);

  useEffect(() => {
    if (!ready) return;
    load();
    api
      .get<SubscriptionPackage[]>("/packages")
      .then(setPackages)
      .catch(() => undefined);
  }, [ready, load]);

  const run = async (label: string, fn: () => Promise<unknown>) => {
    setActionError(null);
    setBusy(true);
    try {
      await fn();
      await load();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : `Failed to ${label}`);
    } finally {
      setBusy(false);
    }
  };

  const onSaveProfile = () =>
    run("update institution", () =>
      api.patch(`/platform/institutions/${id}`, {
        name: editName,
        type: editType,
      })
    );

  const onSuspend = () => {
    if (!confirm("Suspend this institution? Tenant users will lose access."))
      return;
    const reason = window.prompt("Reason (optional):") ?? undefined;
    run("suspend institution", () =>
      api.post(`/platform/institutions/${id}/suspend`, { reason })
    );
  };

  const onActivate = () => {
    if (!confirm("Re-activate this institution?")) return;
    run("activate institution", () =>
      api.post(`/platform/institutions/${id}/activate`)
    );
  };

  const onAssignSubscription = () => {
    if (!packageId) return;
    if (!confirm("Assign this subscription package to the institution?")) return;
    run("assign subscription", () =>
      api.post(`/platform/institutions/${id}/subscription`, {
        packageId,
        status: subStatus,
      })
    );
  };

  const toNum = (v: string) => {
    const t = v.trim();
    if (t === "") return undefined;
    const n = Number(t);
    return Number.isFinite(n) ? n : undefined;
  };

  const onSaveLimits = () => {
    if (!confirm("Update plan limits for this institution?")) return;
    run("update limits", () =>
      api.patch(`/platform/institutions/${id}/limits`, {
        maxStudents: toNum(maxStudents),
        maxStaff: toNum(maxStaff),
        maxBranches: toNum(maxBranches),
        storageLimitMb: toNum(storageLimitMb),
        reportsQuota: toNum(reportsQuota),
      })
    );
  };

  if (!ready) return gate;

  if (loading) {
    return (
      <>
        <PageHeader title="Institution" subtitle="Tenant management" />
        <Spinner />
      </>
    );
  }

  if (loadError || !detail) {
    return (
      <>
        <PageHeader title="Institution" subtitle="Tenant management" />
        <div className="mb-4">
          <Link
            href="/super-admin/platform/institutions"
            className="text-sm font-medium text-brand-600 hover:text-brand-700"
          >
            ← Back to Institutions
          </Link>
        </div>
        <ErrorNote message={loadError ?? "Institution not found."} />
      </>
    );
  }

  const limits = detail.limits;
  const stats = detail.stats;

  return (
    <>
      <PageHeader
        title={detail.name}
        subtitle={detail.code}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={detail.isActive ? "green" : "red"}>
              {detail.isActive ? "active" : "suspended"}
            </Badge>
            {detail.isActive ? (
              <Button variant="danger" onClick={onSuspend} disabled={busy}>
                Suspend
              </Button>
            ) : (
              <Button onClick={onActivate} disabled={busy}>
                Activate
              </Button>
            )}
          </div>
        }
      />

      <div className="mb-4">
        <Link
          href="/super-admin/platform/institutions"
          className="text-sm font-medium text-brand-600 hover:text-brand-700"
        >
          ← Back to Institutions
        </Link>
      </div>

      <ErrorNote message={actionError} />

      <div className="mt-4 grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <h2 className="mb-4 text-lg font-semibold text-slate-900">
              Profile
            </h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Name">
                <Input
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                />
              </Field>
              <Field label="Code">
                <Input value={detail.code} disabled />
              </Field>
              <Field label="Type">
                <Select
                  value={editType}
                  onChange={(e) =>
                    setEditType(e.target.value as "school" | "college")
                  }
                >
                  <option value="school">School</option>
                  <option value="college">College</option>
                </Select>
              </Field>
            </div>
            <div className="mt-4">
              <Button onClick={onSaveProfile} disabled={busy}>
                {busy ? "Saving…" : "Save profile"}
              </Button>
            </div>
          </Card>

          <Card>
            <h2 className="mb-4 text-lg font-semibold text-slate-900">
              Usage stats
            </h2>
            {stats ? (
              <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-4">
                <StatTile label="Students" value={formatNumber(stats.students)} />
                <StatTile label="Teachers" value={formatNumber(stats.teachers)} />
                <StatTile label="Classes" value={formatNumber(stats.classes)} />
                <StatTile label="Users" value={formatNumber(stats.users)} />
                <StatTile
                  label="Fees outstanding"
                  value={formatNumber(stats.feesOutstanding)}
                />
              </div>
            ) : (
              <p className="text-sm text-slate-400">Stats unavailable.</p>
            )}
          </Card>

          <Card>
            <h2 className="mb-1 text-lg font-semibold text-slate-900">
              Plan limits
            </h2>
            <p className="mb-4 text-sm text-slate-500">
              Leave a field blank for unlimited (∞).
            </p>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <Field label="Max students">
                <Input
                  type="number"
                  min={0}
                  placeholder="∞"
                  value={maxStudents}
                  onChange={(e) => setMaxStudents(e.target.value)}
                />
              </Field>
              <Field label="Max staff">
                <Input
                  type="number"
                  min={0}
                  placeholder="∞"
                  value={maxStaff}
                  onChange={(e) => setMaxStaff(e.target.value)}
                />
              </Field>
              <Field label="Max branches">
                <Input
                  type="number"
                  min={0}
                  placeholder="∞"
                  value={maxBranches}
                  onChange={(e) => setMaxBranches(e.target.value)}
                />
              </Field>
              <Field label="Storage limit (MB)">
                <Input
                  type="number"
                  min={0}
                  placeholder="∞"
                  value={storageLimitMb}
                  onChange={(e) => setStorageLimitMb(e.target.value)}
                />
              </Field>
              <Field label="Reports quota">
                <Input
                  type="number"
                  min={0}
                  placeholder="∞"
                  value={reportsQuota}
                  onChange={(e) => setReportsQuota(e.target.value)}
                />
              </Field>
            </div>
            <div className="mt-4">
              <Button onClick={onSaveLimits} disabled={busy}>
                {busy ? "Saving…" : "Save limits"}
              </Button>
            </div>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-slate-900">
                Subscription
              </h2>
              {limits && (
                <Badge tone={limits.withinLimits === false ? "red" : "green"}>
                  {limits.withinLimits === false ? "over limit" : "within limits"}
                </Badge>
              )}
            </div>
            {detail.subscription ? (
              <p className="mb-4 text-sm text-slate-600">
                <Badge tone="blue">
                  {detail.subscription.packageName ?? "—"}
                </Badge>{" "}
                <span className="capitalize">{detail.subscription.status}</span>
              </p>
            ) : (
              <p className="mb-4 text-sm text-slate-400">
                No active subscription.
              </p>
            )}
            <div className="space-y-2">
              <Field label="Package">
                <Select
                  value={packageId}
                  onChange={(e) => setPackageId(e.target.value)}
                >
                  <option value="">Choose package…</option>
                  {packages.map((pkg) => (
                    <option key={pkg.id} value={pkg.id}>
                      {pkg.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Status">
                <Select
                  value={subStatus}
                  onChange={(e) => setSubStatus(e.target.value)}
                >
                  <option value="active">Active</option>
                  <option value="trial">Trial</option>
                  <option value="past_due">Past due</option>
                  <option value="cancelled">Cancelled</option>
                </Select>
              </Field>
              <Button
                className="w-full"
                onClick={onAssignSubscription}
                disabled={busy || !packageId}
              >
                Assign subscription
              </Button>
            </div>
          </Card>

          {limits && (
            <Card>
              <h2 className="mb-4 text-lg font-semibold text-slate-900">
                Plan usage
              </h2>
              <dl className="space-y-3 text-sm">
                <div className="flex justify-between">
                  <dt className="text-slate-500">Package</dt>
                  <dd className="font-medium text-slate-900">
                    {limits.packageName ?? "—"}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-slate-500">Students</dt>
                  <dd className="font-medium text-slate-900">
                    {formatNumber(limits.students)} /{" "}
                    {limitLabel(limits.maxStudents)}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-slate-500">Staff</dt>
                  <dd className="font-medium text-slate-900">
                    {formatNumber(limits.staff)} / {limitLabel(limits.maxStaff)}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-slate-500">Branches</dt>
                  <dd className="font-medium text-slate-900">
                    {formatNumber(limits.branches)} /{" "}
                    {limitLabel(limits.maxBranches)}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-slate-500">Storage (MB)</dt>
                  <dd className="font-medium text-slate-900">
                    {limitLabel(limits.storageLimitMb)}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-slate-500">Reports quota</dt>
                  <dd className="font-medium text-slate-900">
                    {limitLabel(limits.reportsQuota)}
                  </dd>
                </div>
              </dl>
            </Card>
          )}

          {detail.branches.length > 0 && (
            <Card>
              <h2 className="mb-3 text-lg font-semibold text-slate-900">
                Branches ({detail.branches.length})
              </h2>
              <ul className="space-y-1 text-sm text-slate-600">
                {detail.branches.map((branch) => (
                  <li key={branch.id} className="flex justify-between">
                    <span>{branch.name}</span>
                    {branch.timezone && (
                      <span className="text-xs text-slate-400">
                        {branch.timezone}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
