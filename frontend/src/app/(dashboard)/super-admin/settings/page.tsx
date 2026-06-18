"use client";

import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import {
  Badge,
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
import type {
  AdminInstitutionBrief,
  InstitutionLimits,
  InstitutionSettings,
} from "@/types";

function limitLabel(max: number | null): string {
  return max == null ? "∞" : max.toLocaleString();
}

export default function InstitutionSettingsPage() {
  const [institutions, setInstitutions] = useState<AdminInstitutionBrief[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [loadingList, setLoadingList] = useState(true);

  const [settings, setSettings] = useState<InstitutionSettings | null>(null);
  const [limits, setLimits] = useState<InstitutionLimits | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  // Editable form state.
  const [name, setName] = useState("");
  const [type, setType] = useState<"school" | "college">("school");
  const [isActive, setIsActive] = useState(true);
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [modulesText, setModulesText] = useState("");
  const [featureFlags, setFeatureFlags] = useState<Record<string, boolean>>({});
  const [newFlagKey, setNewFlagKey] = useState("");

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api
      .get<AdminInstitutionBrief[]>("/admin/institutions")
      .then(setInstitutions)
      .catch(() => undefined)
      .finally(() => setLoadingList(false));
  }, []);

  const loadDetail = useCallback(async (id: string) => {
    setLoadingDetail(true);
    setDetailError(null);
    setSaved(false);
    setSaveError(null);
    try {
      const [s, l] = await Promise.all([
        api.get<InstitutionSettings>(`/admin/institutions/${id}/settings`),
        api
          .get<InstitutionLimits>(`/admin/institutions/${id}/limits`)
          .catch(() => null),
      ]);
      setSettings(s);
      setLimits(l);
      const cfg = s.settings ?? {};
      setName(s.name);
      setType(s.type);
      setIsActive(s.isActive);
      setEmail(cfg.contact?.email ?? "");
      setPhone(cfg.contact?.phone ?? "");
      setAddress(cfg.contact?.address ?? "");
      setModulesText((cfg.enabledModules ?? []).join(", "));
      setFeatureFlags(cfg.featureFlags ?? {});
      setNewFlagKey("");
    } catch (err) {
      setSettings(null);
      setLimits(null);
      setDetailError(
        err instanceof ApiError ? err.message : "Failed to load settings"
      );
    } finally {
      setLoadingDetail(false);
    }
  }, []);

  const onSelect = (id: string) => {
    setSelectedId(id);
    if (id) loadDetail(id);
    else {
      setSettings(null);
      setLimits(null);
    }
  };

  const setFlag = (key: string, value: boolean) =>
    setFeatureFlags((prev) => ({ ...prev, [key]: value }));

  const removeFlag = (key: string) =>
    setFeatureFlags((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });

  const addFlag = () => {
    const key = newFlagKey.trim();
    if (!key) return;
    setFeatureFlags((prev) => ({ ...prev, [key]: prev[key] ?? false }));
    setNewFlagKey("");
  };

  const onSave = async () => {
    if (!selectedId) return;
    setSaving(true);
    setSaveError(null);
    setSaved(false);
    try {
      const enabledModules = modulesText
        .split(",")
        .map((m) => m.trim())
        .filter(Boolean);
      const updated = await api.patch<InstitutionSettings>(
        `/admin/institutions/${selectedId}/settings`,
        {
          name,
          type,
          isActive,
          contact: {
            email: email || null,
            phone: phone || null,
            address: address || null,
          },
          enabledModules,
          featureFlags,
        }
      );
      setSettings(updated);
      setSaved(true);
      // Refresh the brief list (name/type/status may have changed) + limits.
      api
        .get<AdminInstitutionBrief[]>("/admin/institutions")
        .then(setInstitutions)
        .catch(() => undefined);
      api
        .get<InstitutionLimits>(`/admin/institutions/${selectedId}/limits`)
        .then(setLimits)
        .catch(() => undefined);
    } catch (err) {
      setSaveError(
        err instanceof ApiError ? err.message : "Failed to save settings"
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Institution settings"
        subtitle="Configure tenant profile, modules, feature flags & plan limits"
      />

      <Card className="mb-6">
        <div className="w-full max-w-md">
          <span className="mb-1 block text-sm font-medium text-slate-700">
            Institution
          </span>
          {loadingList ? (
            <Spinner />
          ) : institutions.length === 0 ? (
            <EmptyState message="No institutions yet" />
          ) : (
            <Select value={selectedId} onChange={(e) => onSelect(e.target.value)}>
              <option value="">Select an institution…</option>
              {institutions.map((inst) => (
                <option key={inst.id} value={inst.id}>
                  {inst.name} ({inst.code})
                </option>
              ))}
            </Select>
          )}
        </div>
      </Card>

      {!selectedId ? (
        <EmptyState message="Select an institution to edit its settings." />
      ) : loadingDetail ? (
        <Spinner />
      ) : detailError ? (
        <ErrorNote message={detailError} />
      ) : settings ? (
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="space-y-6 lg:col-span-2">
            <Card>
              <h2 className="mb-4 text-lg font-semibold text-slate-900">
                Profile
              </h2>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Name">
                  <Input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                </Field>
                <Field label="Code">
                  <Input value={settings.code} disabled />
                </Field>
                <Field label="Type">
                  <Select
                    value={type}
                    onChange={(e) =>
                      setType(e.target.value as "school" | "college")
                    }
                  >
                    <option value="school">School</option>
                    <option value="college">College</option>
                  </Select>
                </Field>
                <Field label="Status">
                  <Select
                    value={isActive ? "active" : "inactive"}
                    onChange={(e) => setIsActive(e.target.value === "active")}
                  >
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                  </Select>
                </Field>
              </div>
            </Card>

            <Card>
              <h2 className="mb-4 text-lg font-semibold text-slate-900">
                Contact
              </h2>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Email">
                  <Input
                    type="email"
                    placeholder="admin@example.edu"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </Field>
                <Field label="Phone">
                  <Input
                    placeholder="+91…"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                  />
                </Field>
                <div className="sm:col-span-2">
                  <Field label="Address">
                    <Textarea
                      rows={2}
                      value={address}
                      onChange={(e) => setAddress(e.target.value)}
                    />
                  </Field>
                </div>
              </div>
            </Card>

            <Card>
              <h2 className="mb-1 text-lg font-semibold text-slate-900">
                Enabled modules
              </h2>
              <p className="mb-3 text-sm text-slate-500">
                Comma-separated module keys (e.g. library, transport, hostel).
              </p>
              <Field label="Modules">
                <Input
                  placeholder="library, transport, hostel"
                  value={modulesText}
                  onChange={(e) => setModulesText(e.target.value)}
                />
              </Field>
            </Card>

            <Card>
              <h2 className="mb-1 text-lg font-semibold text-slate-900">
                Feature flags
              </h2>
              <p className="mb-3 text-sm text-slate-500">
                Toggle per-tenant capabilities on or off.
              </p>
              <div className="space-y-2">
                {Object.keys(featureFlags).length === 0 ? (
                  <p className="text-sm text-slate-400">No feature flags set.</p>
                ) : (
                  Object.entries(featureFlags).map(([key, value]) => (
                    <div
                      key={key}
                      className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2"
                    >
                      <span className="font-mono text-sm text-slate-700">
                        {key}
                      </span>
                      <div className="flex items-center gap-3">
                        <label className="flex items-center gap-2 text-sm text-slate-600">
                          <input
                            type="checkbox"
                            className="h-4 w-4 rounded border-slate-300"
                            checked={value}
                            onChange={(e) => setFlag(key, e.target.checked)}
                          />
                          {value ? "On" : "Off"}
                        </label>
                        <Button
                          variant="ghost"
                          onClick={() => removeFlag(key)}
                          aria-label={`Remove ${key}`}
                        >
                          ✕
                        </Button>
                      </div>
                    </div>
                  ))
                )}
              </div>
              <div className="mt-3 flex gap-2">
                <Input
                  placeholder="new_flag_key"
                  value={newFlagKey}
                  onChange={(e) => setNewFlagKey(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addFlag();
                    }
                  }}
                />
                <Button
                  variant="secondary"
                  onClick={addFlag}
                  disabled={!newFlagKey.trim()}
                >
                  + Add flag
                </Button>
              </div>
            </Card>

            <div className="flex items-center gap-3">
              <Button onClick={onSave} disabled={saving}>
                {saving ? "Saving…" : "Save changes"}
              </Button>
              {saved && (
                <span className="text-sm font-medium text-emerald-600">
                  Saved ✓
                </span>
              )}
            </div>
            <ErrorNote message={saveError} />
          </div>

          <div className="lg:col-span-1">
            <Card>
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-lg font-semibold text-slate-900">
                  Plan limits
                </h2>
                {limits && (
                  <Badge tone={limits.withinLimits ? "green" : "red"}>
                    {limits.withinLimits ? "within limits" : "over limit"}
                  </Badge>
                )}
              </div>
              {limits ? (
                <dl className="space-y-3 text-sm">
                  <div className="flex justify-between">
                    <dt className="text-slate-500">Package</dt>
                    <dd className="font-medium text-slate-900">
                      {limits.packageName}
                    </dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-slate-500">Students</dt>
                    <dd
                      className={
                        limits.maxStudents != null &&
                        limits.students > limits.maxStudents
                          ? "font-medium text-red-600"
                          : "font-medium text-slate-900"
                      }
                    >
                      {limits.students.toLocaleString()} /{" "}
                      {limitLabel(limits.maxStudents)}
                    </dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-slate-500">Staff</dt>
                    <dd
                      className={
                        limits.maxStaff != null &&
                        limits.staff > limits.maxStaff
                          ? "font-medium text-red-600"
                          : "font-medium text-slate-900"
                      }
                    >
                      {limits.staff.toLocaleString()} /{" "}
                      {limitLabel(limits.maxStaff)}
                    </dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-slate-500">Storage (MB)</dt>
                    <dd className="font-medium text-slate-900">
                      {limits.storageLimitMb == null
                        ? "∞"
                        : limits.storageLimitMb.toLocaleString()}
                    </dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-slate-500">SMS quota</dt>
                    <dd className="font-medium text-slate-900">
                      {limits.smsQuota == null
                        ? "∞"
                        : limits.smsQuota.toLocaleString()}
                    </dd>
                  </div>
                </dl>
              ) : (
                <p className="text-sm text-slate-400">
                  Plan limits unavailable.
                </p>
              )}
            </Card>
          </div>
        </div>
      ) : null}
    </>
  );
}
