"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { api, ApiError } from "@/lib/api";
import { useAuthStore } from "@/stores/auth-store";
import { useModeStore } from "@/stores/mode-store";
import { useTerms } from "@/lib/terms";
import { toast } from "@/components/toast";
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  ErrorNote,
  Field,
  Input,
  Modal,
  PageHeader,
  Spinner,
} from "@/components/ui";
import { Icon } from "@/components/icons";
import type { AcademicYear, TenantSettings } from "@/types";

const yearSchema = z.object({
  name: z.string().min(1, "Required"),
  startDate: z.string().min(1, "Required"),
  endDate: z.string().min(1, "Required"),
});
type YearForm = z.infer<typeof yearSchema>;

/** Render an ISO date as a short, locale-friendly label; fall back to raw. */
function fmtDate(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? value
    : parsed.toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
      });
}

/** `<input type="date">` wants a bare YYYY-MM-DD, so trim any time component. */
function toDateInput(value: string): string {
  return value ? value.slice(0, 10) : "";
}

export default function SettingsPage() {
  const role = useAuthStore((state) => state.user?.role);
  const isAdmin = role === "admin";
  const term = useTerms();

  const [settings, setSettings] = useState<TenantSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [switchOpen, setSwitchOpen] = useState(false);
  const [switching, setSwitching] = useState(false);

  const [yearModalOpen, setYearModalOpen] = useState(false);
  const [editingYear, setEditingYear] = useState<AcademicYear | null>(null);
  const [yearError, setYearError] = useState<string | null>(null);
  const [settingCurrentId, setSettingCurrentId] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<YearForm>({ resolver: zodResolver(yearSchema) });

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      setSettings(await api.get<TenantSettings>("/tenant-settings"));
    } catch (err) {
      setLoadError(
        err instanceof ApiError ? err.message : "Failed to load settings"
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isAdmin) load();
  }, [isAdmin, load]);

  const switchMode = async () => {
    if (!settings) return;
    const next = settings.mode === "college" ? "school" : "college";
    setSwitching(true);
    try {
      await api.patch<TenantSettings>("/tenant-settings/mode", { type: next });
      // Reconcile the derived mode cache immediately so terminology + nav across
      // the app track the new source-of-truth without a remount.
      useModeStore.getState().setMode(next);
      toast.success(`Switched to ${next} mode`);
      setSwitchOpen(false);
      await load();
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : "Failed to switch mode"
      );
    } finally {
      setSwitching(false);
    }
  };

  const openAddYear = () => {
    setEditingYear(null);
    setYearError(null);
    reset({ name: "", startDate: "", endDate: "" });
    setYearModalOpen(true);
  };

  const openEditYear = (year: AcademicYear) => {
    setEditingYear(year);
    setYearError(null);
    reset({
      name: year.name,
      startDate: toDateInput(year.startDate),
      endDate: toDateInput(year.endDate),
    });
    setYearModalOpen(true);
  };

  const closeYearModal = () => {
    setYearModalOpen(false);
    setEditingYear(null);
  };

  const onSubmitYear = async (values: YearForm) => {
    setYearError(null);
    try {
      if (editingYear) {
        await api.patch(`/academic-years/${editingYear.id}`, values);
        toast.success("Academic year updated");
      } else {
        await api.post("/academic-years", values);
        toast.success("Academic year added");
      }
      closeYearModal();
      await load();
    } catch (err) {
      setYearError(
        err instanceof ApiError ? err.message : "Failed to save academic year"
      );
    }
  };

  const setCurrent = async (year: AcademicYear) => {
    setSettingCurrentId(year.id);
    try {
      await api.post(`/academic-years/${year.id}/current`);
      toast.success(`${year.name} set as current`);
      await load();
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : "Failed to set current year"
      );
    } finally {
      setSettingCurrentId(null);
    }
  };

  if (!isAdmin) {
    return (
      <>
        <PageHeader title="Settings" />
        <EmptyState message="Admins only — ask an administrator for access to tenant settings." />
      </>
    );
  }

  const otherMode = settings?.mode === "college" ? "school" : "college";
  const termRows = [
    { label: "Teacher / Faculty", value: term.teacher },
    { label: "Class / Program", value: term.klass },
    { label: "Section / Batch", value: term.section },
    { label: "Subject / Course", value: term.subject },
    { label: "Term / Semester", value: term.term },
    { label: "Admission / Registration No", value: term.admissionNo },
  ];

  return (
    <>
      <PageHeader
        title="Settings"
        subtitle="Institution profile, mode, academic years & branding"
        action={
          settings ? (
            <Badge tone={settings.mode === "college" ? "blue" : "slate"}>
              {settings.mode === "college" ? "College mode" : "School mode"}
            </Badge>
          ) : undefined
        }
      />

      {loading ? (
        <Spinner />
      ) : loadError ? (
        <ErrorNote message={loadError} />
      ) : !settings ? (
        <EmptyState message="No settings available" />
      ) : (
        <div className="space-y-6">
          {/* Institution profile */}
          <Card>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-ink">
                <Icon name="building" className="h-4 w-4 text-brand-600" />
                Institution profile
              </h2>
              <Badge tone={settings.institution.isActive ? "green" : "slate"}>
                {settings.institution.isActive ? "Active" : "Inactive"}
              </Badge>
            </div>
            <dl className="mt-4 grid gap-4 sm:grid-cols-2">
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-faint">
                  Name
                </dt>
                <dd className="mt-1 text-sm font-medium text-ink">
                  {settings.institution.name}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-faint">
                  Code
                </dt>
                <dd className="mt-1 font-mono text-sm text-ink">
                  {settings.institution.code}
                </dd>
              </div>
            </dl>
            <p className="mt-4 text-xs text-muted">
              Managed by your platform administrator (Super Admin).
            </p>
          </Card>

          {/* School / College mode */}
          <Card>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <h2 className="flex items-center gap-2 text-sm font-semibold text-ink">
                  <Icon name="school" className="h-4 w-4 text-brand-600" />
                  School / College mode
                </h2>
                <p className="mt-1 text-sm text-muted">
                  This institution runs in{" "}
                  <strong className="text-ink">
                    {settings.mode === "college" ? "College" : "School"}
                  </strong>{" "}
                  mode. Switching changes the terminology and which modules are
                  available across the app.
                </p>
              </div>
              <Button variant="secondary" onClick={() => setSwitchOpen(true)}>
                Switch to {otherMode} mode
              </Button>
            </div>
          </Card>

          {/* Academic years */}
          <Card>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <h2 className="flex items-center gap-2 text-sm font-semibold text-ink">
                  <Icon name="calendar" className="h-4 w-4 text-brand-600" />
                  Academic years
                </h2>
                <p className="mt-1 text-sm text-muted">
                  Organize your calendar into {term.term.toLowerCase()}s. The
                  current year is used as the default across the app.
                </p>
              </div>
              <Button onClick={openAddYear}>+ Add year</Button>
            </div>

            <div className="mt-4">
              {settings.academicYears.length === 0 ? (
                <EmptyState message="No academic years yet — add your first one to get started." />
              ) : (
                <div className="overflow-x-auto rounded-xl border border-line">
                  <table className="w-full text-left text-sm">
                    <thead className="border-b border-line bg-surface-2 text-xs uppercase text-muted">
                      <tr>
                        <th className="px-4 py-3">Name</th>
                        <th className="px-4 py-3">Period</th>
                        <th className="px-4 py-3">Status</th>
                        <th className="px-4 py-3" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line">
                      {settings.academicYears.map((year) => (
                        <tr key={year.id} className="hover:bg-surface-2">
                          <td className="px-4 py-3 font-medium text-ink">
                            {year.name}
                          </td>
                          <td className="px-4 py-3 text-muted">
                            {fmtDate(year.startDate)} – {fmtDate(year.endDate)}
                          </td>
                          <td className="px-4 py-3">
                            {year.isCurrent ? (
                              <Badge tone="green">Current</Badge>
                            ) : (
                              <span className="text-xs text-faint">—</span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-right">
                            <div className="flex justify-end gap-3">
                              {!year.isCurrent && (
                                <button
                                  onClick={() => setCurrent(year)}
                                  disabled={settingCurrentId === year.id}
                                  className="text-xs font-medium text-brand-600 hover:text-brand-600 disabled:opacity-50 dark:text-brand-300"
                                >
                                  {settingCurrentId === year.id
                                    ? "Setting…"
                                    : "Set current"}
                                </button>
                              )}
                              <button
                                onClick={() => openEditYear(year)}
                                className="text-xs font-medium text-brand-600 hover:text-brand-600 dark:text-brand-300"
                              >
                                Edit
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </Card>

          {/* Branding */}
          <Card>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <h2 className="flex items-center gap-2 text-sm font-semibold text-ink">
                  <Icon name="palette" className="h-4 w-4 text-brand-600" />
                  Branding
                </h2>
                <div className="mt-3 flex items-center gap-3">
                  {settings.branding?.logoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={settings.branding.logoUrl}
                      alt=""
                      className="h-10 w-10 shrink-0 rounded-lg object-cover"
                    />
                  ) : (
                    <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-hover text-muted">
                      <Icon name="image" className="h-5 w-5" />
                    </div>
                  )}
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-ink">
                      {settings.branding?.displayName ||
                        settings.institution.name}
                    </div>
                    <div className="truncate text-xs text-muted">
                      {settings.branding?.tagline || "No tagline set"}
                    </div>
                  </div>
                </div>
              </div>
              <Link
                href="/branding"
                className="inline-flex items-center gap-2 rounded-xl border border-line bg-surface px-4 py-2.5 text-sm font-semibold text-ink transition hover:bg-hover"
              >
                Manage branding
                <Icon name="arrowRight" className="h-4 w-4" />
              </Link>
            </div>
          </Card>

          {/* Roles & permissions */}
          <Card>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <h2 className="flex items-center gap-2 text-sm font-semibold text-ink">
                  <Icon name="shieldCheck" className="h-4 w-4 text-brand-600" />
                  Roles &amp; permissions
                </h2>
                <p className="mt-1 text-sm text-muted">
                  Control what each built-in role (teacher, accountant, front
                  office…) can see and do. High-risk changes are audited.
                </p>
              </div>
              <Link
                href="/settings/rbac"
                className="inline-flex items-center gap-2 rounded-xl border border-line bg-surface px-4 py-2.5 text-sm font-semibold text-ink transition hover:bg-hover"
              >
                Manage roles
                <Icon name="arrowRight" className="h-4 w-4" />
              </Link>
            </div>
          </Card>

          {/* Terminology preview */}
          <Card>
            <h2 className="flex items-center gap-2 text-sm font-semibold text-ink">
              <Icon name="bookOpen" className="h-4 w-4 text-brand-600" />
              Terminology preview
            </h2>
            <p className="mt-1 text-sm text-muted">
              How key nouns read in{" "}
              {settings.mode === "college" ? "College" : "School"} mode.
            </p>
            <dl className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {termRows.map((row) => (
                <div
                  key={row.label}
                  className="rounded-xl border border-line bg-surface-2 px-3 py-2"
                >
                  <dt className="text-xs font-medium uppercase tracking-wide text-faint">
                    {row.label}
                  </dt>
                  <dd className="mt-0.5 text-sm font-medium text-ink">
                    {row.value}
                  </dd>
                </div>
              ))}
            </dl>
          </Card>

          {/* Enabled modules */}
          <Card>
            <h2 className="flex items-center gap-2 text-sm font-semibold text-ink">
              <Icon name="package" className="h-4 w-4 text-brand-600" />
              Enabled modules
            </h2>
            <p className="mt-1 text-sm text-muted">
              Modules available to this institution.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {settings.enabledModules.length === 0 ? (
                <span className="text-sm text-muted">All modules enabled.</span>
              ) : (
                settings.enabledModules.map((module) => (
                  <Badge key={module} tone="blue">
                    {module}
                  </Badge>
                ))
              )}
            </div>
          </Card>
        </div>
      )}

      <ConfirmDialog
        open={switchOpen}
        title={`Switch to ${otherMode} mode?`}
        tone="primary"
        confirmLabel={`Switch to ${otherMode}`}
        busy={switching}
        message={
          <p>
            This changes the terminology used across the app (for example{" "}
            <strong>{term.teacher}</strong> vs Faculty,{" "}
            <strong>{term.klass}</strong> vs Program) and which modules appear in
            the sidebar. You can switch back at any time.
          </p>
        }
        onConfirm={switchMode}
        onClose={() => setSwitchOpen(false)}
      />

      <Modal
        title={editingYear ? "Edit academic year" : "Add academic year"}
        open={yearModalOpen}
        onClose={closeYearModal}
      >
        <form onSubmit={handleSubmit(onSubmitYear)} className="space-y-4">
          <Field label="Name" error={errors.name?.message} hint="e.g. 2026 – 2027">
            <Input placeholder="2026 – 2027" {...register("name")} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Start date" error={errors.startDate?.message}>
              <Input type="date" {...register("startDate")} />
            </Field>
            <Field label="End date" error={errors.endDate?.message}>
              <Input type="date" {...register("endDate")} />
            </Field>
          </div>
          <ErrorNote message={yearError} />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={closeYearModal}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting
                ? "Saving…"
                : editingYear
                  ? "Save changes"
                  : "Add year"}
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
